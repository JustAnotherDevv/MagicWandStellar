import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import type { ChatRequest, SSEEvent } from '../types/index.js';
import { agentLoop, extractPythonSpec } from '../agent/loop.js';
import { sessionStore, ragStore, db } from '../index.js';
import type { StellarNetwork } from '../config/index.js';
import { DEFAULT_NETWORK, MPP_ENABLED, WORKSPACES_DIR } from '../config/index.js';
import { paymentMiddleware } from '../middleware/mpp.js';
import path from 'path';

function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string, data?: unknown): void {
  const ts = new Date().toISOString();
  const extra = data !== undefined ? ' ' + JSON.stringify(data) : '';
  console.log(`[${ts}][${level}][chat] ${msg}${extra}`);
}

function isImplementationIntent(message: string): boolean {
  const m = message.toLowerCase();
  return [
    'implement',
    'create contract',
    'write contract',
    'generate contract',
    'fix build',
    'build errors',
    'compile error',
    'modify',
    'edit',
    'update',
    'add ',
    'remove',
    'refactor',
    'change',
    'write tests',
    'fix tests',
  ].some((kw) => m.includes(kw));
}

export const chatRouter = Router();

/** Convert an SSE event to a one-line log string (mirrors ChatPanel appendLog format).
 *  Returns null for high-volume events (text_delta, thinking) that are too noisy to store. */
function logLineForEvent(event: SSEEvent): string | null {
  switch (event.type) {
    case 'session_created': return `[session] created ${event.sessionId}`;
    case 'tool_use':        return `[tool] ${event.toolName} — running`;
    case 'tool_result':     return `[tool_result] ${event.toolUseId.slice(0, 8)} — ${event.isError ? 'error' : 'ok'}`;
    case 'spec_updated':    return `[spec] updated (${event.spec.length} chars)`;
    case 'done':            return `[chat] done — ${event.usage.outputTokens} output tokens`;
    case 'error':           return `[chat] error — ${event.message}`;
    default:                return null;
  }
}

// Apply payment middleware when MPP_ENABLED=true
if (MPP_ENABLED) {
  chatRouter.use('/', paymentMiddleware);
}

chatRouter.post('/', async (req: Request, res: Response) => {
  const body = req.body as ChatRequest;

  if (!body.message?.trim()) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Declare session early so the emit closure can reference it as it changes.
  // session is assigned below and reassigned as the handler progresses.
  let session = body.sessionId ? sessionStore.get(body.sessionId) : undefined;

  const emit = (event: SSEEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    // Persist notable events to DB so logs survive refresh / server restart
    if (session) {
      const logLine = logLineForEvent(event);
      if (logLine) {
        const raw = JSON.stringify(event);
        const data = raw.length > 2000 ? raw.slice(0, 2000) + '…' : raw;
        try {
          db.insertLog({
            sessionId: session.id,
            projectId: session.projectId,
            source: 'agent',
            level: event.type === 'error' ? 'ERROR' : 'INFO',
            message: logLine,
            data,
          });
        } catch { /* never let a log write break the SSE stream */ }
      }
    }
  };

  // ── Resolve userId ───────────────────────────────────────────────────────
  const userId = body.userId?.trim() || randomUUID();
  db.upsertUser(userId);

  const network = (body.network ?? DEFAULT_NETWORK) as StellarNetwork;
  const agentMode = body.agentMode === 'ui' ? 'ui' : 'contract';
  log('INFO', 'POST /chat', { userId, sessionId: body.sessionId ?? null, projectId: body.projectId ?? null, network, agentMode });

  // ── Resolve session ──────────────────────────────────────────────────────
  // (session already declared above emit — reassign from DB if needed)

  // Session not in memory — try to load from DB
  if (!session && body.sessionId) {
    const row = db.getActiveSession(body.sessionId);
    if (row) {
      // Reconstruct session in memory with lazy message loading
      const project = db.getProject(row.project_id);
      session = {
        id: row.id,
        projectId: row.project_id,
        userId: row.user_id,
        createdAt: row.created_at,
        lastActivityAt: row.last_activity,
        workspaceDir: row.workspace_dir,
        messages: [],
        network: row.network as StellarNetwork,
        thinkingBudget: row.thinking_budget ?? undefined,
        phase: (project?.phase ?? 'design') as 'design' | 'code',
        projectSpec: project?.spec ?? '',
        agentMode,
        _messagesLoaded: false,
        _persistedMsgCount: 0,
      };
      // Register back into the in-memory store
      (sessionStore as any).sessions.set(row.id, session);
    }
  }

  // Lazy message hydration — load from DB on first access
  if (session && !session._messagesLoaded) {
    const rows = db.getMessages(session.id);
    session.messages = rows.map((r) => {
      const base: Record<string, unknown> = {
        role: r.role,
        content: r.content ?? null,
      };
      if (r.tool_calls) {
        try { base.tool_calls = JSON.parse(r.tool_calls); } catch { /* ignore */ }
      }
      if (r.tool_call_id) base.tool_call_id = r.tool_call_id;
      return base;
    });
    session._messagesLoaded = true;
    session._persistedMsgCount = session.messages.length;

    // Backfill spec from Python-style tool calls in existing message history.
    // Gemini sometimes outputs `update_project_spec(spec="...")` as text instead
    // of a real function call — detect and persist it now if the project spec is empty.
    const currentSpec = db.getProject(session.projectId)?.spec ?? '';
    if (!currentSpec.trim()) {
      for (const r of rows) {
        if (r.role === 'assistant' && r.content?.includes('update_project_spec(')) {
          const extracted = extractPythonSpec(r.content);
          if (extracted) {
            log('INFO', 'backfilling spec from Python-style tool call in history', { sessionId: session.id });
            db.updateProjectSpec(session.projectId, extracted);
            session.projectSpec = extracted;
            break;
          }
        }
      }
    }
  }

  // If a spec already exists and the user is clearly asking for implementation/edit/fix,
  // auto-enter code phase. This prevents getting stuck in design-mode on follow-up turns.
  if (
    session &&
    agentMode === 'contract' &&
    session.phase === 'design' &&
    session.projectSpec?.trim() &&
    isImplementationIntent(body.message)
  ) {
    session.phase = 'code';
    db.updateProjectPhase(session.projectId, 'code');
    log('INFO', 'auto-promoted session to code phase from user intent', {
      sessionId: session.id,
      projectId: session.projectId,
    });
  }

  // No existing session — create one under a project
  if (!session) {
    let projectId: string;
    let projectWorkspaceDir: string;

    if (body.projectId) {
      // Resume existing project with a new session
      const existingProject = db.getProject(body.projectId);
      if (!existingProject) {
        res.status(404).json({ error: `Project ${body.projectId} not found` });
        return;
      }
      projectId = body.projectId;
      projectWorkspaceDir = existingProject.workspace_dir;
    } else {
      // Brand new project — workspace lives at WORKSPACES_DIR/projectId so that
      // /workspace/:projectId/* routes always point at the right directory.
      projectId = `proj_${Date.now()}_${randomUUID().slice(0, 8)}`;
      const name = body.message.trim().slice(0, 60);
      projectWorkspaceDir = path.join(WORKSPACES_DIR, projectId);
      db.createProject({ id: projectId, userId, name, network, workspaceDir: projectWorkspaceDir });
    }

    session = await sessionStore.create(network, body.thinkingBudget ?? 8000, projectId, userId, projectWorkspaceDir);

    // Load project spec into session
    const project = db.getProject(projectId);
    session.projectSpec = project?.spec ?? '';
    session.agentMode = agentMode;

    log('INFO', 'session created', { sessionId: session.id, projectId, userId, network });
    emit({ type: 'session_created', sessionId: session.id });
  } else {
    session.agentMode = agentMode;
    log('INFO', 'session resumed', { sessionId: session.id, projectId: session.projectId, userId, network });
  }

  const controller = new AbortController();
  // Use res.on('close') — NOT req.on('close') — to detect SSE client disconnection.
  // For POST-based SSE, req.on('close') fires when the request body stream is closed
  // (which happens quickly after body-parser reads the JSON body, especially through
  // a dev proxy like Vite that half-closes the request TCP stream after forwarding the body).
  // res.on('close') fires only when the actual SSE response connection is torn down.
  res.on('close', () => {
    log('INFO', 'SSE client disconnected (res close)', { sessionId: session?.id ?? 'unknown' });
    controller.abort();
  });
  // Debug: log req close separately so we can see if it fires prematurely
  req.on('close', () => {
    log('INFO', 'req close fired', { sessionId: session?.id ?? 'unknown', alreadyAborted: controller.signal.aborted });
  });

  const loopStart = Date.now();
  log('INFO', 'agent loop starting', { sessionId: session.id });
  try {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of agentLoop(
      session,
      body.message.trim(),
      ragStore,
      db,
      emit,
      controller.signal,
      agentMode,
    )) {
      // generator yields between turns for backpressure
    }
    log('INFO', 'agent loop complete', { sessionId: session.id, elapsedMs: Date.now() - loopStart });
  } catch (err: unknown) {
    if (!controller.signal.aborted) {
      const msg = err instanceof Error ? err.message : String(err);
      log('ERROR', 'agent loop threw', { error: msg, sessionId: session.id });
      emit({ type: 'error', message: msg });
    }
  } finally {
    res.end();
  }
});
