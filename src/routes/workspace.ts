import { Router, type Request, type Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { db } from '../index.js';

export const workspaceRouter = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getProjectWorkspace(id: string): Promise<{ workspaceDir: string } | null> {
  const project = db.getProject(id);
  if (!project) return null;
  return { workspaceDir: project.workspace_dir };
}

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
}

async function listDir(dirPath: string, relBase: string): Promise<FileNode[]> {
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const IGNORE = new Set(['target', '.git', 'node_modules', '.stellar']);
  const nodes: FileNode[] = [];

  for (const e of entries) {
    if (IGNORE.has(e.name)) continue;
    const relPath = relBase ? `${relBase}/${e.name}` : e.name;
    const fullPath = path.join(dirPath, e.name);

    if (e.isDirectory()) {
      const children = await listDir(fullPath, relPath);
      nodes.push({ name: e.name, path: relPath, isDirectory: true, children });
    } else {
      nodes.push({ name: e.name, path: relPath, isDirectory: false });
    }
  }

  return nodes.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function runCommand(cmd: string, args: string[], cwd: string): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd, stdio: 'pipe' });
    let output = '';
    proc.stdout.on('data', (d) => { output += d.toString(); });
    proc.stderr.on('data', (d) => { output += d.toString(); });
    proc.on('close', (code) => resolve({ success: code === 0, output }));
    proc.on('error', (e) => resolve({ success: false, output: e.message }));
    // 5 minute timeout
    setTimeout(() => { proc.kill(); resolve({ success: false, output: output + '\n[TIMEOUT]' }); }, 300_000);
  });
}

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /workspace/:projectId/files
workspaceRouter.get('/:projectId/files', async (req: Request, res: Response) => {
  const ws = await getProjectWorkspace(req.params['projectId'] as string);
  if (!ws) { res.status(404).json({ error: 'Project not found' }); return; }

  const nodes = await listDir(ws.workspaceDir, '');
  res.json({ files: nodes });
});

// GET /workspace/:projectId/files/:filePath  (filePath may contain slashes via query param)
// GET /workspace/:projectId/file?path=src/lib.rs
workspaceRouter.get('/:projectId/file', async (req: Request, res: Response) => {
  const ws = await getProjectWorkspace(req.params['projectId'] as string);
  if (!ws) { res.status(404).json({ error: 'Project not found' }); return; }

  const filePath = (req.query['path'] as string) ?? '';
  if (!filePath) { res.status(400).json({ error: 'path query param required' }); return; }
  const full = path.join(ws.workspaceDir, filePath);

  // Prevent path traversal
  if (!full.startsWith(ws.workspaceDir)) {
    res.status(400).json({ error: 'Invalid path' });
    return;
  }

  try {
    const content = await fs.readFile(full, 'utf-8');
    res.json({ content });
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

// PUT /workspace/:projectId/file?path=src/lib.rs
workspaceRouter.put('/:projectId/file', async (req: Request, res: Response) => {
  const ws = await getProjectWorkspace(req.params['projectId'] as string);
  if (!ws) { res.status(404).json({ error: 'Project not found' }); return; }

  const filePath = (req.query['path'] as string) ?? '';
  if (!filePath) { res.status(400).json({ error: 'path query param required' }); return; }
  const full = path.join(ws.workspaceDir, filePath);

  if (!full.startsWith(ws.workspaceDir)) {
    res.status(400).json({ error: 'Invalid path' });
    return;
  }

  const { content } = req.body as { content?: string };
  if (content === undefined) {
    res.status(400).json({ error: 'content is required' });
    return;
  }

  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf-8');
  res.json({ ok: true });
});

// POST /workspace/:projectId/build
workspaceRouter.post('/:projectId/build', async (req: Request, res: Response) => {
  const ws = await getProjectWorkspace(req.params['projectId'] as string);
  if (!ws) { res.status(404).json({ error: 'Project not found' }); return; }

  try {
    await fs.access(ws.workspaceDir);
  } catch {
    res.status(400).json({ error: 'Workspace not initialized. Use the chat to generate a contract first.' });
    return;
  }

  const projectId = req.params['projectId'] as string;
  const result = await runCommand('stellar', ['contract', 'build'], ws.workspaceDir);
  db.insertLog({
    sessionId: '',
    projectId,
    source: 'build',
    level: result.success ? 'INFO' : 'ERROR',
    message: `[build] ${result.success ? 'success' : 'failed'} — ${result.output.slice(0, 200)}`,
    data: JSON.stringify({ success: result.success, outputLen: result.output.length }),
  });
  res.json(result);
});

// POST /workspace/:projectId/test
workspaceRouter.post('/:projectId/test', async (req: Request, res: Response) => {
  const ws = await getProjectWorkspace(req.params['projectId'] as string);
  if (!ws) { res.status(404).json({ error: 'Project not found' }); return; }

  try {
    await fs.access(ws.workspaceDir);
  } catch {
    res.status(400).json({ error: 'Workspace not initialized. Use the chat to generate a contract first.' });
    return;
  }

  const projectId = req.params['projectId'] as string;
  const result = await runCommand('cargo', ['test', '--', '--nocapture'], ws.workspaceDir);
  db.insertLog({
    sessionId: '',
    projectId,
    source: 'test',
    level: result.success ? 'INFO' : 'ERROR',
    message: `[test] ${result.success ? 'success' : 'failed'} — ${result.output.slice(0, 200)}`,
    data: JSON.stringify({ success: result.success, outputLen: result.output.length }),
  });
  res.json(result);
});
