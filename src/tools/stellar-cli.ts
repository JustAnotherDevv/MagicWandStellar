import { spawn } from 'child_process';
import path from 'path';
import type { ToolResult } from '../types/index.js';
import type { Session, StellarNetwork } from '../types/index.js';
import { HORIZON_URLS } from '../config/index.js';

function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string, data?: unknown): void {
  const ts = new Date().toISOString();
  const extra = data !== undefined ? ' ' + JSON.stringify(data) : '';
  console.log(`[${ts}][${level}][stellar-cli] ${msg}${extra}`);
}

/** Resolve and guard against path traversal */
function resolveSafe(workspaceDir: string, relPath: string): string {
  const resolved = path.resolve(workspaceDir, relPath);
  const base = path.resolve(workspaceDir);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error(`Path traversal attempt blocked: "${relPath}"`);
  }
  return resolved;
}

/** Run a subprocess — NEVER uses shell:true */
async function runCmd(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs = 60_000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const t0 = Date.now();
  log('INFO', `spawn: ${cmd} ${args.join(' ')}`, { cwd, timeoutMs });
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      shell: false, // CRITICAL: no shell injection
      env: { ...process.env },
      timeout: timeoutMs,
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code) => {
      const elapsedMs = Date.now() - t0;
      const exitCode = code ?? 1;
      if (exitCode !== 0) {
        log('WARN', `exit ${exitCode}`, { cmd, elapsedMs });
      } else {
        log('INFO', `exit ${exitCode}`, { cmd, elapsedMs });
      }
      resolve({ stdout, stderr, exitCode });
    });
    child.on('error', (err) => {
      log('ERROR', `spawn error: ${err.message}`, { cmd });
      reject(err);
    });
  });
}

function formatOutput(stdout: string, stderr: string, exitCode: number): string {
  const parts: string[] = [];
  if (stdout.trim()) parts.push(`STDOUT:\n${stdout.trim()}`);
  if (stderr.trim()) parts.push(`STDERR:\n${stderr.trim()}`);
  parts.push(`Exit code: ${exitCode}`);
  return parts.join('\n\n');
}

// ── Contract tools ────────────────────────────────────────────────────��─────

export async function contractInit(
  input: { contractName: string },
  session: Session,
): Promise<ToolResult> {
  try {
    // stellar contract init <PROJECT_PATH> [--name <NAME>]
    // Derive a safe directory name (slug) from the contract name
    const slug = input.contractName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const { stdout, stderr, exitCode } = await runCmd(
      'stellar',
      ['contract', 'init', slug, '--name', input.contractName],
      session.workspaceDir,
      30_000,
    );
    const output = formatOutput(stdout, stderr, exitCode);
    // On success, tell the agent where the project was scaffolded
    const result = exitCode === 0
      ? `Initialized contract project at: ${slug}/\n\n${output}`
      : output;
    return {
      content: result,
      isError: exitCode !== 0,
    };
  } catch (err) {
    return { content: `contract_init error: ${(err as Error).message}`, isError: true };
  }
}

export async function contractBuild(
  input: { contractDir: string },
  session: Session,
): Promise<ToolResult> {
  try {
    const contractPath = resolveSafe(session.workspaceDir, input.contractDir);
    const { stdout, stderr, exitCode } = await runCmd(
      'stellar',
      ['contract', 'build'],
      contractPath,
      180_000, // 3 min — cargo compile can be slow
    );
    return {
      content: formatOutput(stdout, stderr, exitCode),
      isError: exitCode !== 0,
    };
  } catch (err) {
    return { content: `contract_build error: ${(err as Error).message}`, isError: true };
  }
}

export async function contractDeploy(
  input: { wasmPath: string; source: string; contractAlias?: string },
  session: Session,
): Promise<ToolResult> {
  try {
    const wasmAbsPath = resolveSafe(session.workspaceDir, input.wasmPath);
    const args = [
      'contract', 'deploy',
      '--wasm', wasmAbsPath,
      '--source', input.source,
      '--network', session.network,
    ];
    if (input.contractAlias) {
      args.push('--alias', input.contractAlias);
    }

    const { stdout, stderr, exitCode } = await runCmd('stellar', args, session.workspaceDir, 60_000);

    // Extract contract ID from output (starts with C, 56 chars)
    const contractIdMatch = (stdout + stderr).match(/C[A-Z0-9]{55}/);
    const contractId = contractIdMatch ? contractIdMatch[0] : null;

    const output = formatOutput(stdout, stderr, exitCode);
    const result = contractId
      ? `Contract deployed successfully!\nContract ID: ${contractId}\n\n${output}`
      : output;

    return { content: result, isError: exitCode !== 0 };
  } catch (err) {
    return { content: `contract_deploy error: ${(err as Error).message}`, isError: true };
  }
}

export async function contractInvoke(
  input: {
    contractId: string;
    source: string;
    functionName: string;
    args?: string[];
    sendTransaction?: boolean;
    network?: StellarNetwork;
  },
  session: Session,
): Promise<ToolResult> {
  try {
    const network = input.network ?? session.network;
    const send = input.sendTransaction !== false ? 'yes' : 'no';

    const args = [
      'contract', 'invoke',
      '--id', input.contractId,
      '--source', input.source,
      '--network', network,
      `--send=${send}`,
      '--',
      input.functionName,
    ];

    if (input.args?.length) {
      args.push(...input.args); // already validated as string[] — no shell injection
    }

    const { stdout, stderr, exitCode } = await runCmd(
      'stellar', args, session.workspaceDir, 60_000,
    );
    return {
      content: formatOutput(stdout, stderr, exitCode),
      isError: exitCode !== 0,
    };
  } catch (err) {
    return { content: `contract_invoke error: ${(err as Error).message}`, isError: true };
  }
}

export async function contractInfo(
  input: { contractId: string; network?: StellarNetwork },
  session: Session,
): Promise<ToolResult> {
  try {
    const network = input.network ?? session.network;
    const { stdout, stderr, exitCode } = await runCmd(
      'stellar',
      ['contract', 'info', 'interface', '--id', input.contractId, '--network', network],
      session.workspaceDir,
      15_000,
    );
    return {
      content: formatOutput(stdout, stderr, exitCode),
      isError: exitCode !== 0,
    };
  } catch (err) {
    return { content: `contract_info error: ${(err as Error).message}`, isError: true };
  }
}

export async function accountInfo(
  input: { accountId: string; network?: StellarNetwork },
  session: Session,
): Promise<ToolResult> {
  try {
    const network = input.network ?? session.network;
    const horizonBase = HORIZON_URLS[network] ?? HORIZON_URLS['testnet'];
    const res = await fetch(`${horizonBase}/accounts/${input.accountId}`, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return {
        content: `Horizon returned HTTP ${res.status} for account ${input.accountId}`,
        isError: true,
      };
    }

    const data = (await res.json()) as {
      id: string;
      sequence: string;
      balances: Array<{ balance: string; asset_type: string; asset_code?: string; asset_issuer?: string }>;
    };

    const summary = {
      id: data.id,
      sequence: data.sequence,
      balances: data.balances.map((b) => ({
        asset: b.asset_type === 'native' ? 'XLM' : `${b.asset_code}:${b.asset_issuer}`,
        balance: b.balance,
      })),
    };

    return { content: JSON.stringify(summary, null, 2), isError: false };
  } catch (err) {
    return { content: `account_info error: ${(err as Error).message}`, isError: true };
  }
}

export async function runCargoTest(
  input: { contractDir: string; testFilter?: string },
  session: Session,
): Promise<ToolResult> {
  try {
    const contractPath = resolveSafe(session.workspaceDir, input.contractDir);
    const args = ['test'];
    if (input.testFilter) args.push(input.testFilter);

    const { stdout, stderr, exitCode } = await runCmd(
      'cargo', args, contractPath, 180_000,
    );
    return {
      content: formatOutput(stdout, stderr, exitCode),
      isError: exitCode !== 0,
    };
  } catch (err) {
    return { content: `run_cargo_test error: ${(err as Error).message}`, isError: true };
  }
}
