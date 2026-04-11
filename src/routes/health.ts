import { Router, type Request, type Response } from 'express';
import { ragStore, sessionStore } from '../index.js';
import { MODEL } from '../config/index.js';
import { TOOLS } from '../tools/definitions.js';

export const healthRouter = Router();

healthRouter.get('/', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    docsLoaded: ragStore.listDocs().length,
    sessionsActive: sessionStore.size,
    uptimeSeconds: Math.floor(process.uptime()),
    model: MODEL,
    tools: TOOLS.length,
  });
});
