import OpenAI from 'openai';
import * as httpsModule from 'node:https';
import * as httpModule from 'node:http';
import { Readable } from 'node:stream';
import type { Session, SSEEvent, UsageSummary } from '../types/index.js';
import type { RAGStore } from '../rag/index.js';
import type { DatabaseStore } from '../db/index.js';
import { TOOLS } from '../tools/definitions.js';
import { buildSystemPrompt } from './system-prompt.js';
import { executeToolSafe } from './executor.js';
import { MINIMAX_API_KEY, MINIMAX_BASE_URL, MODEL } from '../config/index.js';

// Do NOT create a module-level OpenAI singleton.
// MiniMax closes the underlying TCP connection after a long streaming response, but Node.js's
// undici connection pool doesn't detect it immediately. The next request (step 2 after step 1)
// reuses the stale connection and gets 0 bytes back. Creating a new client per agent-loop call
// ensures each session uses a fresh HTTP connection without reuse issues.

const MAX_TURNS = 20;

function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string, data?: unknown): void {
  const ts = new Date().toISOString();
  const extra = data !== undefined ? ' ' + JSON.stringify(data) : '';
  console.log(`[${ts}][${level}][loop] ${msg}${extra}`);
}
const MAX_RETRIES = 2;              // up to 2 retries per LLM turn
const RATE_LIMIT_WAIT_MS = 63_000;  // 63s for actual 429s (per-minute quota window)
const PROVIDER_ERROR_WAIT_MS = 8_000; // 8s for 5xx/provider errors (transient)
const EMPTY_RESPONSE_WAIT_MS = 2_000; // 2s for empty 200s — paid model, just retry fast

/** Classify the error to determine retry wait time. Returns 0 if not retryable. */
function retryWaitMs(err: unknown): number {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    // 400 = bad request — permanent client error, never retry
    if (msg.includes('400')) return 0;
    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('rate_limit')) {
      return RATE_LIMIT_WAIT_MS;
    }
    if (msg.includes('provider returned error') || msg.includes('502') || msg.includes('503')) {
      return PROVIDER_ERROR_WAIT_MS;
    }
  }
  return 0;
}

/** Return true if the error is transient and worth retrying */
function isRateLimit(err: unknown): boolean {
  return retryWaitMs(err) > 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type OAIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/**
 * Some models (e.g. Gemini) output tool calls as Python-style prose instead of
 * using the function-calling API. Detect `update_project_spec(spec="...")` in
 * the assistant's text content and return the spec string if found.
 * Exported so chat.ts can backfill specs from existing message history.
 */
export function extractPythonSpec(content: string): string | null {
  const marker = 'update_project_spec(spec=';
  const idx = content.indexOf(marker);
  if (idx === -1) return null;
  const after = content.slice(idx + marker.length);
  const quote = after[0];
  if (quote !== '"' && quote !== "'") return null;
  let spec = '';
  let i = 1;
  while (i < after.length) {
    const ch = after[i];
    if (ch === '\\' && i + 1 < after.length) {
      const next = after[i + 1];
      if (next === 'n') spec += '\n';
      else if (next === 't') spec += '\t';
      else if (next === '\\') spec += '\\';
      else if (next === quote) spec += quote;
      else spec += next;
      i += 2;
    } else if (ch === quote) {
      break;
    } else {
      spec += ch;
      i++;
    }
  }
  return spec.trim() || null;
}

/** Persist any new messages since last watermark */
function persistTurn(session: Session, db: DatabaseStore): void {
  const from = session._persistedMsgCount ?? 0;
  if (session.messages.length > from) {
    db.persistMessages(session.id, session.projectId, session.messages, from);
    session._persistedMsgCount = session.messages.length;
    db.updateSessionActivity(session.id, session.lastActivityAt);
  }
}

/**
 * Trim conversation history to avoid context-window overload.
 * Keeps the first 2 messages (original request + first response) for context,
 * then the most recent messages up to `maxMessages` total.
 * Ensures we never start mid-tool-exchange by scanning for the first user message
 * in the tail window.
 */
const MAX_TOOL_RESULT_CHARS = 4_000;     // truncate huge build outputs / file reads
const MAX_ASSISTANT_CONTENT_CHARS = 1_200;

function trimHistory(messages: OAIMessage[], maxMessages = 32): OAIMessage[] {
  // Truncate oversized messages — a single design response or build output can be 10k+ tokens
  const capped = messages.map((m) => {
    if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > MAX_TOOL_RESULT_CHARS) {
      return { ...m, content: m.content.slice(0, MAX_TOOL_RESULT_CHARS) + '\n[...truncated]' };
    }
    // Replace long assistant TEXT messages (no tool_calls) with a concise placeholder.
    // MiniMax returns 0 chunks when a prior assistant message contains a truncated mermaid block
    // (the model tries to "continue" the malformed markdown instead of processing the new request).
    // Replacing with a short summary avoids this — the spec is already in the system prompt.
    if (
      m.role === 'assistant' &&
      typeof m.content === 'string' &&
      m.content.length > MAX_ASSISTANT_CONTENT_CHARS &&
      !(m as any).tool_calls
    ) {
      const isDesign = (m.content as string).includes('mermaid') || (m.content as string).includes('IDEATE');
      const placeholder = isDesign
        ? '[Architecture design complete — mermaid diagram and full spec saved to project. Awaiting user approval to proceed to implementation.]'
        : `[Previous response summarized — ${(m.content as string).length} chars — proceeding.]`;
      return { ...m, content: placeholder };
    }
    return m;
  });

  if (capped.length <= maxMessages) return capped;

  // Take only a contiguous tail — never splice head+tail, which creates orphaned
  // tool_call_id references that Claude rejects with a 400 bad-request error.
  const tail = capped.slice(-maxMessages);
  // Don't start mid-tool-exchange — skip forward to the first user message
  const firstUser = tail.findIndex((m) => m.role === 'user');
  return firstUser > 0 ? tail.slice(firstUser) : tail;
}

/**
 * Core agentic loop using OpenRouter (OpenAI-compatible API).
 * Streams SSE events via the emit callback.
 * Handles streaming tool calls, which arrive in chunks across deltas.
 */
export async function* agentLoop(
  session: Session,
  userMessage: string,
  ragStore: RAGStore,
  db: DatabaseStore,
  emit: (event: SSEEvent) => void,
  signal: AbortSignal,
): AsyncGenerator<void> {
  // Append user message to session history
  session.messages.push({ role: 'user', content: userMessage } satisfies OAIMessage);
  session.lastActivityAt = Date.now();

  log('INFO', 'agent loop started', { sessionId: session.id, msgLen: userMessage.length, model: MODEL });

  // Use node:https with keepAlive:false to bypass undici's connection pool.
  // Without this, undici reuses the TCP connection from step 1's long SSE stream,
  // which MiniMax has already closed — causing step 2 to get 0 SSE chunks.
  // Readable.toWeb() converts Node.js IncomingMessage to a proper WHATWG ReadableStream,
  // compatible with Node.js 24's native Symbol.asyncIterator used by the OpenAI SDK.
  const fetchWithFreshConnection = (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    return new Promise((resolve, reject) => {
      const urlStr = url instanceof Request ? url.url : String(url);
      const parsed = new URL(urlStr);
      const isHttps = parsed.protocol === 'https:';
      const agent = isHttps
        ? new httpsModule.Agent({ keepAlive: false })
        : new httpModule.Agent({ keepAlive: false });

      const headers: Record<string, string> = { 'Connection': 'close' };
      if (init?.headers) {
        new Headers(init.headers).forEach((v, k) => { headers[k] = v; });
      }

      const opts = {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: init?.method ?? 'GET',
        headers,
        agent,
      };

      const req = (isHttps ? httpsModule : httpModule).request(opts, (res) => {
        const status = res.statusCode ?? 200;
        const responseHeaders = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (v) responseHeaders.set(k, Array.isArray(v) ? v.join(', ') : v);
        }
        // Convert Node.js Readable (IncomingMessage) to WHATWG ReadableStream.
        // The native toWeb() conversion is safe with Node.js 24's Symbol.asyncIterator.
        const webStream = Readable.toWeb(res) as ReadableStream<Uint8Array>;
        resolve(new Response(webStream, { status, headers: responseHeaders }));
      });

      req.on('error', reject);
      if (init?.body) req.write(init.body);
      req.end();
    });
  };

  const openai = new OpenAI({
    apiKey: MINIMAX_API_KEY,
    baseURL: MINIMAX_BASE_URL,
    maxRetries: 0, // disable SDK auto-retry — we handle 429s ourselves with user-visible backoff
    fetch: fetchWithFreshConnection,
  });

  // Rebuild system prompt on every loop entry so projectSpec updates are reflected
  const systemPrompt = buildSystemPrompt(ragStore, session.workspaceDir, session.projectSpec);

  let doneSent = false;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (signal.aborted) break;

    log('INFO', `turn ${turn + 1}/${MAX_TURNS}`, { sessionId: session.id });

    // ── Call the model via OpenRouter (with 429 retry) ───────────────────
    type ToolCallAccum = { id: string; name: string; argumentsJson: string };
    const toolCallsById = new Map<number, ToolCallAccum>();
    let fullContent = '';
    let finishReason: string | null = null;
    let usage: UsageSummary | null = null;
    let streamError = false;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (signal.aborted) break;

      log('INFO', `LLM call attempt ${attempt + 1}/${MAX_RETRIES + 1}`, { model: MODEL, historyLen: session.messages.length });

      const trimmed = trimHistory(session.messages as OAIMessage[]);

      let stream: ReturnType<typeof openai.chat.completions.stream>;
      try {
        stream = openai.chat.completions.stream({
          model: MODEL,
          max_tokens: 16000,
          messages: [
            { role: 'system', content: systemPrompt },
            ...trimmed,
          ],
          tools: TOOLS,
          tool_choice: 'auto',
          stream: true,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isRateLimit(err) && attempt < MAX_RETRIES) {
          const waitMs = retryWaitMs(err);
          log('WARN', `rate limit / provider error — retrying`, { waitMs, attempt, error: msg });
          emit({ type: 'text_delta', text: `\n[Retrying in ${Math.round(waitMs / 1000)}s…]\n` });
          await sleep(waitMs);
          continue;
        }
        log('ERROR', 'LLM API call failed', { error: msg });
        emit({ type: 'error', message: `API call failed: ${msg}` });
        streamError = true;
        break;
      }

      // ── Accumulate streaming response ───────────────────────────────────
      let chunkError = false;
      let chunkCount = 0;
      try {
        for await (const chunk of stream) {
          if (signal.aborted) break;
          chunkCount++;

          const choice = chunk.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta;

          // Stream text content
          if (delta.content) {
            fullContent += delta.content;
            emit({ type: 'text_delta', text: delta.content });
          }

          // Accumulate tool call chunks
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              if (!toolCallsById.has(idx)) {
                toolCallsById.set(idx, {
                  id: tc.id ?? '',
                  name: tc.function?.name ?? '',
                  argumentsJson: '',
                });
                if (tc.id && tc.function?.name) {
                  emit({
                    type: 'tool_use',
                    toolName: tc.function.name,
                    toolUseId: tc.id,
                    input: {},
                  });
                }
              }
              if (tc.function?.arguments) {
                toolCallsById.get(idx)!.argumentsJson += tc.function.arguments;
              }
            }
          }

          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
          }

          if (chunk.usage) {
            usage = {
              inputTokens: chunk.usage.prompt_tokens,
              outputTokens: chunk.usage.completion_tokens,
              cacheReadTokens: null,
              cacheCreationTokens: null,
            };
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (isRateLimit(err) && attempt < MAX_RETRIES) {
          const waitMs = retryWaitMs(err);
          log('WARN', 'stream error — retrying', { waitMs, attempt, error: errMsg });
          emit({ type: 'text_delta', text: `\n[Retrying in ${Math.round(waitMs / 1000)}s…]\n` });
          // Reset accumulated state for retry
          toolCallsById.clear();
          fullContent = '';
          finishReason = null;
          usage = null;
          await sleep(waitMs);
          continue;
        }
        if (!signal.aborted) {
          log('ERROR', 'stream error', { error: errMsg });
          emit({ type: 'error', message: `Stream error: ${errMsg}` });
        }
        chunkError = true;
      }

      if (chunkError) {
        streamError = true;
        break; // unrecoverable error — exit retry loop
      }

      log('INFO', 'stream complete', { totalChunks: chunkCount, fullContentLen: fullContent.length, toolCallsAccum: toolCallsById.size, finishReason });

      // Detect empty completion: model returned no text and no tool calls.
      // On a paid model this is a transient glitch — retry quickly.
      if (fullContent === '' && toolCallsById.size === 0 && attempt < MAX_RETRIES) {
        log('WARN', 'empty response — retrying', { attempt, waitMs: EMPTY_RESPONSE_WAIT_MS, finishReason, inputTokens: usage?.inputTokens ?? null });
        await sleep(EMPTY_RESPONSE_WAIT_MS);
        continue;
      }

      log('INFO', 'LLM response received', {
        finishReason,
        contentLen: fullContent.length,
        toolCalls: toolCallsById.size,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
      });
      break; // success — exit retry loop
    }

    if (streamError) break;

    // If all retries produced empty content, emit an error rather than pushing
    // a null message that would corrupt future context.
    if (fullContent === '' && toolCallsById.size === 0) {
      log('ERROR', 'model returned empty response after all retries', { sessionId: session.id, historyLen: session.messages.length });
      emit({ type: 'error', message: 'Model returned empty response — try sending your message again.' });
      break;
    }

    // ── Append assistant message to history ───────────────────────────────
    const toolCalls = [...toolCallsById.values()];
    const assistantMessage: OAIMessage = {
      role: 'assistant',
      content: fullContent || '',
      ...(toolCalls.length > 0
        ? {
            tool_calls: toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.name, arguments: tc.argumentsJson },
            })),
          }
        : {}),
    };
    session.messages.push(assistantMessage);
    session.lastActivityAt = Date.now();

    // Done — no tool calls pending
    if (finishReason !== 'tool_calls' || toolCalls.length === 0) {
      // Detect Python-style update_project_spec calls that some models (Gemini)
      // incorrectly emit as text content instead of real function calls.
      if (fullContent?.includes('update_project_spec(')) {
        const pythonSpec = extractPythonSpec(fullContent);
        if (pythonSpec) {
          log('INFO', 'detected Python-style update_project_spec — executing', { sessionId: session.id });
          db.updateProjectSpec(session.projectId, pythonSpec);
          session.projectSpec = pythonSpec;
          emit({ type: 'spec_updated', spec: pythonSpec });
        }
      }

      // MiniMax and similar models may produce the architecture diagram in text without
      // ever calling update_project_spec. Auto-save if the response contains a mermaid
      // block and the project spec is still empty.
      if (fullContent?.includes('```mermaid')) {
        const currentSpec = db.getProject(session.projectId)?.spec ?? '';
        if (!currentSpec.trim()) {
          log('INFO', 'auto-saving mermaid spec from text response', { sessionId: session.id });
          db.updateProjectSpec(session.projectId, fullContent);
          session.projectSpec = fullContent;
          emit({ type: 'spec_updated', spec: fullContent });
        }

        // Replace the text design response in history with a synthetic update_project_spec
        // tool call exchange. MiniMax returns an empty response for step 2 when it sees its own
        // text design response in history — the model treats the text as still being in the
        // IDEATE/DIAGRAM stage rather than moving to CREATE.
        // Converting the history to a tool-call exchange (the expected workflow shape) fixes this.
        // IMPORTANT: the spec argument must NOT contain "### IDEATE" or other workflow stage markers
        // (e.g. "### DIAGRAM") — MiniMax sees those as triggers to stay in the design phase and
        // returns an empty completion. Use a clean architectural summary instead.
        const rawSpec = session.projectSpec || fullContent;
        // Extract just the mermaid block from the raw spec (if present) and build a clean summary
        const mermaidMatch = rawSpec.match(/```mermaid[\s\S]*?```/);
        const cleanSpec = [
          '# Contract Architecture',
          '',
          mermaidMatch ? mermaidMatch[0] : '',
          '',
          'Architecture design complete. Implementation details ready.',
        ].join('\n').trim();
        const syntheticId = `spec_${Date.now()}`;
        session.messages[session.messages.length - 1] = {
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: syntheticId,
            type: 'function',
            function: {
              name: 'update_project_spec',
              arguments: JSON.stringify({ spec: cleanSpec }),
            },
          }],
        } as OAIMessage;
        session.messages.push({
          role: 'tool',
          tool_call_id: syntheticId,
          content: 'Project specification updated successfully.',
        } as OAIMessage);
        log('INFO', 'converted text design to synthetic tool call (clean spec)', { sessionId: session.id, cleanSpecLen: cleanSpec.length });
      }

      try { persistTurn(session, db); } catch (dbErr) { log('WARN', 'persistTurn failed (natural stop)', { error: String(dbErr) }); }
      log('INFO', 'loop done — natural stop', { turn: turn + 1, finishReason, sessionId: session.id });
      emit({
        type: 'done',
        usage: usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: null, cacheCreationTokens: null },
      });
      doneSent = true;
      break;
    }

    // ── Execute all tool calls in parallel ────────────────────────────────
    const toolNames = toolCalls.map((tc) => tc.name);
    log('INFO', `dispatching ${toolCalls.length} tool call(s)`, { tools: toolNames, sessionId: session.id });
    const toolResultMessages = await Promise.all(
      toolCalls.map(async (tc) => {
        let parsedInput: unknown = {};
        try {
          parsedInput = tc.argumentsJson ? JSON.parse(tc.argumentsJson) : {};
        } catch {
          parsedInput = {};
        }

        const result = await executeToolSafe(tc.name, parsedInput, session, ragStore, db);

        emit({
          type: 'tool_result',
          toolUseId: tc.id,
          result: result.content,
          isError: result.isError,
        });

        return {
          role: 'tool' as const,
          tool_call_id: tc.id,
          content: result.content,
        } satisfies OAIMessage;
      }),
    );

    // If the spec was updated, notify the frontend so it can refresh live
    for (const tc of toolCalls) {
      if (tc.name === 'update_project_spec') {
        try {
          const parsed = JSON.parse(tc.argumentsJson) as { spec?: string };
          if (parsed.spec) emit({ type: 'spec_updated', spec: parsed.spec });
        } catch { /* ok */ }
      }
    }

    // Append all tool results to history and persist
    session.messages.push(...toolResultMessages);
    try { persistTurn(session, db); } catch (dbErr) { log('WARN', 'persistTurn failed (tool results)', { error: String(dbErr) }); }

    yield; // allow SSE writes to flush between turns
  }

  // If MAX_TURNS exhausted without a natural stop, close the stream so callers don't hang
  if (!doneSent && !signal.aborted) {
    log('WARN', `max turns (${MAX_TURNS}) exhausted`, { sessionId: session.id });
    emit({
      type: 'done',
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: null, cacheCreationTokens: null },
    });
  } else if (signal.aborted) {
    log('INFO', 'loop aborted by client disconnect', { sessionId: session.id });
  }
}
