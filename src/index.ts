import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import { validateConfig, PORT, DOCS_DIR, WORKSPACES_DIR, DB_DIR, DB_PATH } from './config/index.js';
import { RAGStore } from './rag/index.js';
import { SessionStore } from './agent/session.js';
import { DatabaseStore } from './db/index.js';
import { downloadDocs } from '../scripts/download-docs.js';

// ── Singletons (exported for use by routes) ───────────────────────────────
// DB is sync and must be created before sessionStore
await fs.mkdir(DB_DIR, { recursive: true });
export const db = new DatabaseStore(DB_PATH);
export const ragStore = new RAGStore();
export const sessionStore = new SessionStore(WORKSPACES_DIR, db);

async function startServer() {
  validateConfig();

  await fs.mkdir(DOCS_DIR, { recursive: true });
  await fs.mkdir(WORKSPACES_DIR, { recursive: true });

  // Restore active sessions from DB before accepting traffic
  await sessionStore.loadFromDb();

  await downloadDocs(DOCS_DIR);
  await ragStore.loadFromDir(DOCS_DIR);

  const { chatRouter }      = await import('./routes/chat.js');
  const { sessionsRouter }  = await import('./routes/sessions.js');
  const { healthRouter }    = await import('./routes/health.js');
  const { projectsRouter }  = await import('./routes/projects.js');
  const { usersRouter }     = await import('./routes/users.js');
  const { statsRouter }     = await import('./routes/stats.js');
  const { workspaceRouter } = await import('./routes/workspace.js');

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '4mb' }));

  app.use('/chat',      chatRouter);
  app.use('/sessions',  sessionsRouter);
  app.use('/health',    healthRouter);
  app.use('/projects',  projectsRouter);
  app.use('/users',     usersRouter);
  app.use('/stats',     statsRouter);
  app.use('/workspace', workspaceRouter);

  app.use((_req, res) => { res.status(404).json({ error: 'Not found' }); });

  setInterval(() => { sessionStore.cleanup().catch(console.error); }, 60 * 60 * 1000);

  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════╗
║           Stellar AI Agent (OpenRouter)              ║
║           http://localhost:${PORT}                       ║
╠══════════════════════════════════════════════════════╣
║  POST /chat             — SSE streaming chat         ║
║  GET  /sessions         — list active sessions       ║
║  DELETE /sessions/:id   — delete session             ║
║  GET  /projects         — list projects              ║
║  GET  /projects/:id     — project detail             ║
║  GET  /users            — list users                 ║
║  GET  /users/:id        — user detail                ║
║  GET  /stats            — global stats               ║
║  GET  /health           — health check               ║
╚══════════════════════════════════════════════════════╝
`);
  });
}

startServer().catch((err) => {
  console.error('[fatal] Startup error:', err);
  process.exit(1);
});
