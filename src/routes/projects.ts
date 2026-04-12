import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import path from 'path';
import { db } from '../index.js';
import { WORKSPACES_DIR } from '../config/index.js';

export const projectsRouter = Router();

// GET /projects?userId=&network=
projectsRouter.get('/', (req: Request, res: Response) => {
  const userId = req.query['userId'] as string | undefined;
  const network = req.query['network'] as string | undefined;
  const projects = db.listProjects({ userId, network });

  const result = projects.map((p) => {
    const contracts = db.getContractsByProject(p.id);
    return { ...p, contractCount: contracts.length };
  });

  res.json({ projects: result });
});

// POST /projects
projectsRouter.post('/', (req: Request, res: Response) => {
  const { userId, name, description, network } = req.body as {
    userId?: string;
    name?: string;
    description?: string;
    network?: string;
  };

  if (!userId || !name?.trim()) {
    res.status(400).json({ error: 'userId and name are required' });
    return;
  }

  db.upsertUser(userId);

  const id = randomUUID();
  const workspaceDir = path.join(WORKSPACES_DIR, id);
  const project = db.createProject({
    id,
    userId,
    name: name.trim(),
    network: (network ?? 'testnet') as 'testnet' | 'mainnet',
    workspaceDir,
  });

  if (description) {
    db.updateProjectSpec(id, description);
    res.json({ ...project, spec: description });
  } else {
    res.json(project);
  }
});

// GET /projects/:id
projectsRouter.get('/:id', (req: Request, res: Response) => {
  const id = req.params['id'] as string;
  const project = db.getProject(id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const contracts = db.getContractsByProject(id);
  res.json({ project, contracts });
});

// PATCH /projects/:id
projectsRouter.patch('/:id', (req: Request, res: Response) => {
  const id = req.params['id'] as string;
  const project = db.getProject(id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const { spec } = req.body as { spec?: string };
  if (spec !== undefined) {
    db.updateProjectSpec(id, spec);
  }

  res.json(db.getProject(id));
});

// GET /projects/:id/logs
projectsRouter.get('/:id/logs', (req: Request, res: Response) => {
  const id = req.params['id'] as string;
  const project = db.getProject(id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const rows = db.getProjectLogs(id);
  res.json({ logs: rows });
});

// GET /projects/:id/contracts
projectsRouter.get('/:id/contracts', (req: Request, res: Response) => {
  const id = req.params['id'] as string;
  const project = db.getProject(id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  res.json({ contracts: db.getContractsByProject(id) });
});
