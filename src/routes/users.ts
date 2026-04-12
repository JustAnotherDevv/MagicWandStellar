import { Router, type Request, type Response } from 'express';
import { db } from '../index.js';

export const usersRouter = Router();

// GET /users
usersRouter.get('/', (_req: Request, res: Response) => {
  const users = db.getUsersWithCounts();
  res.json({ users });
});

// GET /users/:id
usersRouter.get('/:id', (req: Request, res: Response) => {
  const id = req.params['id'] as string;
  const user = db.getUser(id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const projects = db.listProjects({ userId: id });
  const contracts = db.getContractsByUser(id);

  res.json({ user, projects, contracts });
});
