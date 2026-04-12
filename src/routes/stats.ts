import { Router, type Request, type Response } from 'express';
import { db, sessionStore } from '../index.js';

export const statsRouter = Router();

// GET /stats
statsRouter.get('/', (_req: Request, res: Response) => {
  const stats = db.getStats();
  // Override active session count with in-memory truth (may be more accurate than DB)
  stats.sessions.active = sessionStore.size;
  res.json(stats);
});
