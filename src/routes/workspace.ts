import { Router, type Request, type Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { db } from '../index.js';
import { RPC_URLS, FRIENDBOT_URLS } from '../config/index.js';

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

function resolveSafe(baseDir: string, relPath: string): string {
  const resolved = path.resolve(baseDir, relPath);
  const base = path.resolve(baseDir);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error(`Path traversal attempt blocked: "${relPath}"`);
  }
  return resolved;
}

/**
 * Find the directory to run cargo/stellar commands from.
 * `stellar contract init` creates files in a subdirectory, not at workspace root.
 * Check root first; if no Cargo.toml there, scan one level of subdirectories.
 */
async function findCargoRoot(workspaceDir: string): Promise<string> {
  // 1. Check workspace root directly
  try {
    await fs.access(path.join(workspaceDir, 'Cargo.toml'));
    return workspaceDir;
  } catch { /* not at root */ }

  // 2. Scan immediate subdirectories
  try {
    const entries = await fs.readdir(workspaceDir, { withFileTypes: true });
    for (const entry of entries.filter((e) => e.isDirectory())) {
      const subdir = path.join(workspaceDir, entry.name);
      try {
        await fs.access(path.join(subdir, 'Cargo.toml'));
        return subdir;
      } catch { /* not here */ }
    }
  } catch { /* readdir failed */ }

  return workspaceDir; // fall back — let cargo produce its own error
}

async function listWasmFiles(workspaceDir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, rel: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const nextRel = rel ? `${rel}/${e.name}` : e.name;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full, nextRel);
      } else if (e.isFile() && e.name.endsWith('.wasm')) {
        out.push(nextRel);
      }
    }
  }
  await walk(workspaceDir, '');
  return out.sort();
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function findRuntimeRoot(workspaceDir: string): Promise<string | null> {
  const candidates = [
    path.join(workspaceDir, 'frontend', 'dist'),
    path.join(workspaceDir, 'dist'),
    path.join(workspaceDir, 'frontend'),
    path.join(workspaceDir, 'app'),
    path.join(workspaceDir, 'ui'),
    workspaceDir,
  ];
  for (const dir of candidates) {
    if (await pathExists(path.join(dir, 'index.html'))) return dir;
  }
  return null;
}

function parseInterfaceToAbi(output: string): Array<{
  name: string;
  params: Array<{ name: string; type: string }>;
  returnType?: string;
  isReadOnly: boolean;
}> {
  const splitTopLevel = (text: string): string[] => {
    const out: string[] = [];
    let current = '';
    let angle = 0;
    let paren = 0;
    let bracket = 0;
    for (const ch of text) {
      if (ch === '<') angle++;
      else if (ch === '>') angle = Math.max(0, angle - 1);
      else if (ch === '(') paren++;
      else if (ch === ')') paren = Math.max(0, paren - 1);
      else if (ch === '[') bracket++;
      else if (ch === ']') bracket = Math.max(0, bracket - 1);
      if (ch === ',' && angle === 0 && paren === 0 && bracket === 0) {
        if (current.trim()) out.push(current.trim());
        current = '';
        continue;
      }
      current += ch;
    }
    if (current.trim()) out.push(current.trim());
    return out;
  };

  const simplifyType = (t: string): string =>
    t
      .replace(/\bsoroban_sdk::/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const functions: Array<{
    name: string;
    params: Array<{ name: string; type: string }>;
    returnType?: string;
    isReadOnly: boolean;
  }> = [];
  const re = /fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)(?:\s*->\s*([^\n{]+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(output)) !== null) {
    const name = m[1] ?? '';
    const paramsRaw = (m[2] ?? '').trim();
    const returnType = simplifyType((m[3] ?? '').trim()) || undefined;
    const params = paramsRaw
      ? splitTopLevel(paramsRaw).map((part, idx) => {
          const colonIdx = part.indexOf(':');
          if (colonIdx === -1) {
            return { name: `arg${idx + 1}`, type: simplifyType(part) || 'Unknown' };
          }
          const pname = part.slice(0, colonIdx).trim();
          const ptype = part.slice(colonIdx + 1).trim();
          return { name: pname || `arg${idx + 1}`, type: simplifyType(ptype) || 'Unknown' };
        })
      : [];
    const lowered = name.toLowerCase();
    const isReadOnly = /^(get_|get|read_|read|view_|view|balance|allowance|name|symbol|decimals|is_)/.test(lowered);
    functions.push({ name, params, returnType, isReadOnly });
  }
  return functions;
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
  const cargoRoot = await findCargoRoot(ws.workspaceDir);
  const result = await runCommand('stellar', ['contract', 'build'], cargoRoot);
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
  const cargoRoot = await findCargoRoot(ws.workspaceDir);
  const result = await runCommand('cargo', ['test', '--', '--nocapture'], cargoRoot);
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

// GET /workspace/:projectId/artifacts/wasm
workspaceRouter.get('/:projectId/artifacts/wasm', async (req: Request, res: Response) => {
  const ws = await getProjectWorkspace(req.params['projectId'] as string);
  if (!ws) { res.status(404).json({ error: 'Project not found' }); return; }
  const files = await listWasmFiles(ws.workspaceDir);
  res.json({ files });
});

// POST /workspace/:projectId/deploy
workspaceRouter.post('/:projectId/deploy', async (req: Request, res: Response) => {
  const projectId = req.params['projectId'] as string;
  const project = db.getProject(projectId);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

  const {
    wasmPath,
    source,
    contractAlias,
    network,
    sessionId,
  } = req.body as {
    wasmPath?: string;
    source?: string;
    contractAlias?: string;
    network?: string;
    sessionId?: string;
  };
  if (!wasmPath || !source) {
    res.status(400).json({ error: 'wasmPath and source are required' });
    return;
  }

  let wasmAbs: string;
  try {
    wasmAbs = resolveSafe(project.workspace_dir, wasmPath);
    await fs.access(wasmAbs);
  } catch {
    res.status(400).json({ error: 'Invalid wasmPath or file does not exist' });
    return;
  }

  const targetNetwork = network ?? project.network ?? 'testnet';
  const args = ['contract', 'deploy', '--wasm', wasmAbs, '--source', source, '--network', targetNetwork];
  if (contractAlias?.trim()) args.push('--alias', contractAlias.trim());
  const result = await runCommand('stellar', args, project.workspace_dir);

  if (result.success) {
    const contractIdMatch = result.output.match(/C[A-Z0-9]{55}/);
    const contractId = contractIdMatch?.[0] ?? '';
    if (contractId) {
      const activeSession = sessionId
        ? db.getActiveSession(sessionId)
        : db.loadActiveSessions().find((s) => s.project_id === projectId);
      if (activeSession?.id) {
        try {
          db.saveContract({
            contractId,
            projectId,
            sessionId: activeSession.id,
            userId: project.user_id,
            network: targetNetwork as 'testnet' | 'mainnet' | 'futurenet' | 'local',
            wasmPath,
            sourceAccount: source,
            contractAlias: contractAlias?.trim() || undefined,
          });
        } catch (e) {
          console.warn('[deploy] saveContract failed (non-fatal):', (e as Error).message);
        }
      }
    }
  }

  db.insertLog({
    sessionId: sessionId ?? '',
    projectId,
    source: 'deploy',
    level: result.success ? 'INFO' : 'ERROR',
    message: `[deploy] ${result.success ? 'success' : 'failed'} — ${result.output.slice(0, 200)}`,
    data: JSON.stringify({ success: result.success, outputLen: result.output.length }),
  });

  res.json(result);
});

// GET /workspace/:projectId/contracts/:contractId/abi?network=
workspaceRouter.get('/:projectId/contracts/:contractId/abi', async (req: Request, res: Response) => {
  const project = db.getProject(req.params['projectId'] as string);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  const contractId = req.params['contractId'] as string;
  const network = ((req.query['network'] as string) ?? project.network ?? 'testnet');
  const result = await runCommand(
    'stellar',
    ['contract', 'info', 'interface', '--id', contractId, '--network', network],
    project.workspace_dir,
  );
  const functions = parseInterfaceToAbi(result.output);
  res.json({ success: result.success, output: result.output, functions });
});

// POST /workspace/:projectId/contracts/:contractId/invoke
workspaceRouter.post('/:projectId/contracts/:contractId/invoke', async (req: Request, res: Response) => {
  const project = db.getProject(req.params['projectId'] as string);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  const contractId = req.params['contractId'] as string;
  const {
    functionName,
    params,
    source,
    network,
    sendTransaction,
  } = req.body as {
    functionName?: string;
    params?: Record<string, string>;
    source?: string;
    network?: string;
    sendTransaction?: boolean;
  };
  if (!functionName || !source) {
    res.status(400).json({ error: 'functionName and source are required' });
    return;
  }
  const targetNetwork = network ?? project.network ?? 'testnet';
  const send = sendTransaction === false ? 'no' : 'yes';

  const fnArgs: string[] = [];
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (!k) continue;
      // Env/context argument is provided by runtime, never via CLI flags.
      if (k === 'env') continue;
      fnArgs.push(`--${k}`, v ?? '');
    }
  }

  const result = await runCommand(
    'stellar',
    ['contract', 'invoke', '--id', contractId, '--source', source, '--network', targetNetwork, `--send=${send}`, '--', functionName, ...fnArgs],
    project.workspace_dir,
  );
  res.json(result);
});

// GET /workspace/:projectId/runtime-info
workspaceRouter.get('/:projectId/runtime-info', async (req: Request, res: Response) => {
  const ws = await getProjectWorkspace(req.params['projectId'] as string);
  if (!ws) { res.status(404).json({ error: 'Project not found' }); return; }
  const root = await findRuntimeRoot(ws.workspaceDir);
  if (!root) {
    res.json({ available: false });
    return;
  }
  res.json({
    available: true,
    url: `/api/workspace/${req.params['projectId'] as string}/runtime/index.html`,
  });
});

// GET /workspace/:projectId/runtime/*runtimePath  (serves local app preview)
workspaceRouter.get('/:projectId/runtime/*runtimePath', async (req: Request, res: Response) => {
  const projectId = req.params['projectId'] as string;
  const ws = await getProjectWorkspace(projectId);
  if (!ws) { res.status(404).json({ error: 'Project not found' }); return; }
  const root = await findRuntimeRoot(ws.workspaceDir);
  if (!root) { res.status(404).json({ error: 'No local runtime found' }); return; }

  const raw = (req.params as Record<string, string | string[]>)['runtimePath'];
  const relPath = (Array.isArray(raw) ? raw.join('/') : (raw ?? 'index.html')).trim() || 'index.html';
  let full: string;
  try {
    full = resolveSafe(root, relPath);
  } catch {
    res.status(400).json({ error: 'Invalid path' });
    return;
  }

  if (!(await pathExists(full))) {
    res.status(404).json({ error: 'Runtime file not found' });
    return;
  }
  res.sendFile(full);
});

// POST /workspace/:projectId/rpc-proxy  ─ forwards JSON-RPC to the project's Soroban RPC
// Allows browser UIs (iframes) to call the RPC without hitting CORS restrictions.
workspaceRouter.post('/:projectId/rpc-proxy', async (req: Request, res: Response) => {
  const project = db.getProject(req.params['projectId'] as string);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

  const rpcUrl = RPC_URLS[project.network] ?? RPC_URLS['testnet'];
  try {
    const upstream = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await upstream.json();
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: `RPC proxy error: ${(e as Error).message}` });
  }
});

// GET /workspace/:projectId/fund/:address  ─ funds an address via network friendbot
workspaceRouter.get('/:projectId/fund/:address', async (req: Request, res: Response) => {
  const project = db.getProject(req.params['projectId'] as string);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

  const friendbotUrl = FRIENDBOT_URLS[project.network];
  if (!friendbotUrl) {
    res.status(400).json({ error: `No friendbot available for network: ${project.network}` });
    return;
  }

  const address = req.params['address'] as string;
  try {
    const resp = await fetch(`${friendbotUrl}?addr=${encodeURIComponent(address)}`);
    const data = await resp.json();
    res.status(resp.ok ? 200 : 400).json(data);
  } catch (e) {
    res.status(502).json({ error: `Friendbot error: ${(e as Error).message}` });
  }
});
