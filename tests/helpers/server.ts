import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

export interface TestServer {
  baseURL: string;
  port: number;
  dbPath: string;
  workspacesDir: string;
  /** Kill process and delete temp dirs */
  kill: () => Promise<void>;
  /** Kill process only — leave dirs on disk (use when handing dirs to another server) */
  killProcessOnly: () => Promise<void>;
}

export interface StartTestServerOptions {
  /** Reuse an existing DB file (for restart tests) */
  dbPath?: string;
  /** Reuse an existing workspaces dir (for restart tests) */
  workspacesDir?: string;
  /** Override specific env vars (e.g. force invalid LLM key for infra-only tests) */
  overrideEnv?: Record<string, string>;
}

/** Start an isolated test server with a throwaway DB and workspace dir */
export async function startTestServer(opts: StartTestServerOptions = {}): Promise<TestServer> {
  const port = 3100 + Math.floor(Math.random() * 800); // 3100-3899
  const uid = randomUUID().slice(0, 8);

  let dbDir: string;
  let dbPath: string;
  let workspacesDir: string;
  let ownDirs = true;

  if (opts.dbPath && opts.workspacesDir) {
    // Reuse provided dirs — don't clean them up on kill
    dbPath = opts.dbPath;
    dbDir = path.dirname(dbPath);
    workspacesDir = opts.workspacesDir;
    ownDirs = false;
  } else {
    dbDir = path.join(os.tmpdir(), `stellar-test-${uid}`);
    dbPath = path.join(dbDir, 'test.db');
    workspacesDir = path.join(os.tmpdir(), `stellar-ws-${uid}`);
    await fs.mkdir(dbDir, { recursive: true });
    await fs.mkdir(workspacesDir, { recursive: true });
  }

  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([, v]) => v !== undefined),
    ) as Record<string, string>,
    PORT: String(port),
    DB_DIR: dbDir,
    DB_PATH: dbPath,
    WORKSPACES_DIR: workspacesDir,
    DOCS_DIR: path.join(ROOT, 'docs'),  // reuse real docs (already downloaded)
    NODE_ENV: 'test',
    ...(opts.overrideEnv ?? {}),
  };

  const proc: ChildProcess = spawn(
    'npx',
    ['tsx', path.join(ROOT, 'src', 'index.ts')],
    { env, cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] },
  );

  // Wait for server to be ready by polling /health
  const baseURL = `http://localhost:${port}`;
  await waitForReady(baseURL, 30_000);

  const killProcessOnly = async (): Promise<void> => {
    proc.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      proc.on('exit', resolve);
      setTimeout(resolve, 3000);
    });
  };

  const kill = async (): Promise<void> => {
    await killProcessOnly();
    // Clean up temp dirs only if we own them
    if (ownDirs) {
      await fs.rm(dbDir, { recursive: true, force: true });
      await fs.rm(workspacesDir, { recursive: true, force: true });
    }
  };

  return { baseURL, port, dbPath, workspacesDir, kill, killProcessOnly };
}

async function waitForReady(baseURL: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseURL}/health`);
      if (res.ok) return;
    } catch {
      // server not up yet
    }
    await sleep(400);
  }
  throw new Error(`Server at ${baseURL} did not start within ${timeoutMs}ms`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Returns true if a real LLM API key is present (OpenRouter or MiniMax) */
export function hasRealApiKey(): boolean {
  const or = process.env.OPENROUTER_API_KEY ?? '';
  const mm = process.env.MINIMAX_API_KEY ?? '';
  const orValid = or.startsWith('sk-or-') && or.length > 20 && !or.endsWith('...');
  const mmValid = mm.startsWith('sk-api-') && mm.length > 20 && !mm.endsWith('...');
  return orValid || mmValid;
}
