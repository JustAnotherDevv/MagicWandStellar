import { Router, type Request, type Response } from 'express';
import { sessionStore, db } from '../index.js';
import { extractPythonSpec } from '../agent/loop.js';

export const sessionsRouter = Router();

sessionsRouter.get('/', (req: Request, res: Response) => {
  const userId = req.query['userId'] as string | undefined;
  const projectId = req.query['projectId'] as string | undefined;
  let sessions = sessionStore.list();
  if (userId) sessions = sessions.filter((s) => s.userId === userId);
  if (projectId) sessions = sessions.filter((s) => s.projectId === projectId);
  res.json({ sessions });
});

sessionsRouter.get('/:id/messages', (req: Request, res: Response) => {
  const id = req.params['id'] as string;
  const rows = db.getMessages(id);

  // Build a map of tool results: tool_call_id → result string
  const toolResults = new Map<string, string>();
  for (const r of rows) {
    if (r.role === 'tool' && r.tool_call_id) {
      toolResults.set(r.tool_call_id, r.content ?? '');
    }
  }

  const messages = rows
    .filter((r) => r.role === 'user' || r.role === 'assistant')
    .map((r) => {
      const out: Record<string, unknown> = {
        role: r.role,
        content: r.content ?? '',
        createdAt: r.created_at,
      };
      if (r.tool_calls) {
        try {
          const tcs = JSON.parse(r.tool_calls) as Array<{
            id: string;
            type: string;
            function: { name: string; arguments: string };
          }>;
          out['toolUses'] = tcs.map((tc) => {
            const result = toolResults.get(tc.id);
            let input: unknown = {};
            try { input = JSON.parse(tc.function.arguments); } catch { /* ok */ }
            return {
              id: tc.id,
              name: tc.function.name,
              input,
              status: result !== undefined ? 'success' : 'running',
              result,
            };
          });
        } catch { /* ignore bad JSON */ }
      }
      return out;
    });

  // Return current project spec (and backfill if it was a Python-style call).
  let projectSpec: string | undefined;
  const projectId = rows[0]?.project_id;
  if (projectId) {
    const currentSpec = db.getProject(projectId)?.spec ?? '';
    if (currentSpec.trim()) {
      projectSpec = currentSpec;
    } else {
      // Gemini sometimes writes update_project_spec(spec="...") as text rather
      // than a real function call — detect and persist it retroactively.
      for (const r of rows) {
        if (r.role === 'assistant' && r.content?.includes('update_project_spec(')) {
          const extracted = extractPythonSpec(r.content);
          if (extracted) {
            db.updateProjectSpec(projectId, extracted);
            projectSpec = extracted;
            break;
          }
        }
      }
    }
  }

  res.json({ messages, projectSpec });
});

sessionsRouter.get('/:id/logs', (req: Request, res: Response) => {
  const id = req.params['id'] as string;
  const limitParam = parseInt((req.query['limit'] as string) ?? '2000', 10);
  const limit = Number.isNaN(limitParam) ? 2000 : Math.min(limitParam, 10000);
  const rows = db.getLogs(id, limit);
  res.json({ logs: rows });
});

sessionsRouter.delete('/:id', async (req: Request, res: Response) => {
  const id = req.params['id'] as string;
  const deleted = await sessionStore.delete(id);
  res.json({ deleted });
});
