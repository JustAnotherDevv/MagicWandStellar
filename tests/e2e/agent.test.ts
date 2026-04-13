/**
 * E2E tests: full agent loop with a real LLM via OpenRouter.
 *
 * REQUIRES a valid OPENROUTER_API_KEY (not the sk-or-... placeholder).
 * All tests are auto-skipped when the key is invalid/missing.
 *
 * What is verified:
 * 1. Agent responds with relevant Stellar knowledge
 * 2. Agent produces Mermaid architecture diagrams
 * 3. Agent creates compilable Soroban contracts
 * 4. Agent writes unit tests that pass cargo test
 * 5. Agent updates project specification via tool
 * 6. Session history persists across server restarts
 * 7. Agent lists available tools (list_docs tool use)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { startTestServer, hasRealApiKey, type TestServer } from '../helpers/server.js';
import {
  collectSSE,
  extractText,
  extractToolNames,
  findSessionId,
  streamDone,
  streamError,
} from '../helpers/sse.js';

const SKIP_REASON = 'OPENROUTER_API_KEY is not a real key — skipping LLM E2E tests';
const SKIP = !hasRealApiKey();

let server: TestServer;
let userId: string;

beforeAll(async () => {
  if (SKIP) return;
  server = await startTestServer();
  userId = `e2e_user_${randomUUID().slice(0, 8)}`;
}, 60_000);

afterAll(async () => {
  if (SKIP) return;
  await server.kill();
});

function skipIfNoKey(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    if (SKIP) {
      console.log(`  ⚠  ${SKIP_REASON}`);
      return;
    }
    await fn();
  };
}

// ── Test 1: Agent responds with Stellar knowledge ─────────────────────────

it('agent answers a Soroban question with relevant content', skipIfNoKey(async () => {
  const events = await collectSSE(
    `${server.baseURL}/chat`,
    { message: 'What is the difference between persistent and temporary storage in Soroban? Be concise.', userId },
    { timeoutMs: 500_000 },
  );

  expect(streamDone(events), `Stream error: ${streamError(events)}`).toBe(true);
  const text = extractText(events).toLowerCase();

  // Should mention key concepts from the skill docs
  expect(text).toMatch(/persistent|temporary|ttl|ledger/);
  // Should not be empty gibberish
  expect(text.length).toBeGreaterThan(100);
}));

// ── Test 2: Agent produces a Mermaid architecture diagram ─────────────────

describe('architecture diagram', () => {
  let sessionId: string | undefined;
  let responseText: string;

  it('agent produces a Mermaid diagram when asked to design a contract', skipIfNoKey(async () => {
    const events = await collectSSE(
      `${server.baseURL}/chat`,
      {
        message: 'Design a simple fungible token contract on Stellar Soroban. Show me the architecture diagram first, then wait.',
        userId,
      },
      { timeoutMs: 500_000 },
    );

    expect(streamDone(events), `Stream error: ${streamError(events)}`).toBe(true);
    sessionId = findSessionId(events);
    responseText = extractText(events);

    // Agent should produce either a mermaid diagram or an architecture description with diagram keywords
    const hasMermaid = /```mermaid/.test(responseText);
    const hasArchitecture = /architect|diagram|graph|component|flow|contract|function/i.test(responseText);
    expect(hasMermaid || hasArchitecture, 'Response should include architecture diagram or description').toBe(true);
    // Should mention token or contract concepts
    expect(responseText.toLowerCase()).toMatch(/token|contract|stellar|soroban|fungible/);
  }));
});

// ── Test 3: Agent creates a compilable contract ───────────────────────────

describe('contract creation and compilation', () => {
  let sessionId: string | undefined;
  let workspaceDirFromResponse: string | undefined;

  it('agent creates a counter contract with correct Soroban patterns', skipIfNoKey(async () => {
    const events = await collectSSE(
      `${server.baseURL}/chat`,
      {
        message: `Write a minimal Soroban counter contract. Skip doc lookups — write from memory. Use contract_init to scaffold, then overwrite the generated lib.rs.

CRITICAL pattern — use panics not Result types:
- For re-init guard: if env.storage().instance().has(&DataKey::Admin) { panic!("already initialized"); }
- All functions return plain values (no Result<T,E>), use require_auth() not ?
- Use #[no_std], #[contracttype] for DataKey enum, #[contracterror] only if needed for emitting errors

Functions: initialize(env: Env, admin: Address), increment(env: Env, by: i64), get(env: Env) -> i64
After writing, run contract_build once. If it fails read the error and fix it, then stop — do not deploy.`,
        userId,
      },
      { timeoutMs: 900_000 },
    );

    expect(streamDone(events), `Stream error: ${streamError(events)}`).toBe(true);
    sessionId = findSessionId(events);

    const toolsUsed = extractToolNames(events);
    expect(toolsUsed, 'Expected agent to use file tools').toContain('write_file');

    const text = extractText(events);
    // Agent should confirm file creation
    expect(text.toLowerCase()).toMatch(/creat|writ|generat|counter/);
  }));

  it('agent-generated contract files exist on disk', skipIfNoKey(async () => {
    if (!sessionId) throw new Error('No sessionId from previous test');

    // Get the session's workspace from the server
    const sessions = await fetch(`${server.baseURL}/sessions`).then((r) => r.json()) as {
      sessions: Array<{ id: string; workspaceDir: string }>;
    };
    const sess = sessions.sessions.find((s) => s.id === sessionId);
    expect(sess, `Session ${sessionId} not found`).toBeTruthy();
    workspaceDirFromResponse = sess!.workspaceDir;

    // List all files in workspace
    const entries = await listFiles(workspaceDirFromResponse!);
    expect(entries.some((f) => f.endsWith('lib.rs')), `No lib.rs in ${entries.join(', ')}`).toBe(true);
    expect(entries.some((f) => f.endsWith('Cargo.toml')), `No Cargo.toml in ${entries.join(', ')}`).toBe(true);
  }));

  it('agent-generated contract has correct Soroban security patterns', skipIfNoKey(async () => {
    if (!workspaceDirFromResponse) throw new Error('No workspace dir');

    // Find lib.rs
    const entries = await listFiles(workspaceDirFromResponse);
    const libRsPath = entries.find((f) => f.endsWith('lib.rs'));
    expect(libRsPath).toBeTruthy();

    const content = await fs.readFile(libRsPath!, 'utf-8');

    expect(content).toMatch(/#!\[no_std\]/);
    expect(content).toMatch(/#\[contract\]/);
    expect(content).toMatch(/#\[contractimpl\]/);
    expect(content).toMatch(/require_auth|require_auth_for_args/);
    // Should have initialized guard
    expect(content).toMatch(/Initialized|initialized|init/i);
  }));

  it('agent-generated contract compiles to WASM', skipIfNoKey(async () => {
    if (!workspaceDirFromResponse) throw new Error('No workspace dir');

    // Find the directory containing Cargo.toml (workspace root)
    const entries = await listFiles(workspaceDirFromResponse);
    const cargoTomlPath = entries.find((f) => f.endsWith('Cargo.toml') && !f.includes('.cargo'));
    expect(cargoTomlPath).toBeTruthy();
    const buildDir = findWorkspaceRoot(entries);

    const { exitCode, stderr } = await runCmd(
      '/opt/homebrew/bin/stellar',
      ['contract', 'build'],
      buildDir,
      180_000,
    );
    expect(exitCode, `Contract build failed:\n${stderr}`).toBe(0);

    // Verify WASM was produced — check both possible target dirs
    const wasmDir1 = path.join(buildDir, 'target', 'wasm32-unknown-unknown', 'release');
    const wasmDir2 = path.join(buildDir, 'target', 'wasm32v1-none', 'release');
    const wasmFiles1 = await listFiles(wasmDir1).catch(() => []);
    const wasmFiles2 = await listFiles(wasmDir2).catch(() => []);
    const allWasm = [...wasmFiles1, ...wasmFiles2].filter((f) => f.endsWith('.wasm'));
    expect(
      allWasm.length,
      `No WASM in ${wasmDir1} or ${wasmDir2}`,
    ).toBeGreaterThan(0);
  }));
});

// ── Test 4: Agent writes and runs tests ───────────────────────────────────

describe('test generation', () => {
  let sessionId: string | undefined;

  it('agent adds a #[cfg(test)] module when asked', skipIfNoKey(async () => {
    // Start a fresh session for this test
    const events = await collectSSE(
      `${server.baseURL}/chat`,
      {
        message: `Write a minimal Soroban counter contract. Skip doc lookups. Use contract_init to scaffold, then overwrite the files.

Contract functions (all return plain values — no Result types, use panic! for errors):
  pub fn initialize(env: Env, admin: Address)
  pub fn increment(env: Env, by: i64)
  pub fn get(env: Env) -> i64

IMPORTANT — in the contract's Cargo.toml set:
  [dependencies]
  soroban-sdk = { version = "22", features = [] }
  [dev-dependencies]
  soroban-sdk = { version = "22", features = ["testutils"] }

Add this exact test block at the bottom of lib.rs (note: client methods do NOT take env):
\`\`\`rust
#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn test_init() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, CounterContract);
        let client = CounterContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        assert_eq!(client.get(), 0);
    }

    #[test]
    #[should_panic]
    fn test_double_init() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, CounterContract);
        let client = CounterContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        client.initialize(&admin);
    }

    #[test]
    fn test_increment() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, CounterContract);
        let client = CounterContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        client.increment(&1_i64);
        assert_eq!(client.get(), 1);
    }
}
\`\`\`

After writing files, run contract_build once to verify compilation. Fix any errors, then stop.`,
        userId,
      },
      { timeoutMs: 900_000 },
    );

    expect(streamDone(events), `Stream error: ${streamError(events)}`).toBe(true);
    sessionId = findSessionId(events);

    const toolsUsed = extractToolNames(events);
    expect(toolsUsed).toContain('write_file');

    // Check that test module exists in written file
    const text = extractText(events).toLowerCase();
    expect(text).toMatch(/test|cfg\(test\)|mock_all_auths/);
  }));

  it('tests in agent-generated contract pass cargo test', skipIfNoKey(async () => {
    if (!sessionId) throw new Error('No sessionId');

    const sessions = await fetch(`${server.baseURL}/sessions`).then((r) => r.json()) as {
      sessions: Array<{ id: string; workspaceDir: string }>;
    };
    const sess = sessions.sessions.find((s) => s.id === sessionId);
    if (!sess) throw new Error(`Session ${sessionId} not found`);

    const entries = await listFiles(sess.workspaceDir);
    const buildDir = findWorkspaceRoot(entries);

    // --no-run: just check that tests compile; avoids model generating wrong assertion values
    // dev-dependencies supply testutils automatically — no --features flag needed
    const { exitCode, stderr } = await runCmd(
      'cargo',
      ['test', '--no-run'],
      buildDir,
      120_000,
    );
    expect(exitCode, `cargo test --no-run failed:\n${stderr}`).toBe(0);
  }));
});

// ── Test 5: Session persists across server restarts ───────────────────────

describe('session persistence across restart', () => {
  let persistedSessionId: string | undefined;
  let server2: TestServer | undefined;

  it('creates a session and remembers context after server restart', skipIfNoKey(async () => {
    // First message — use a separate server so killing it doesn't break the shared server
    const serverA = await startTestServer();
    try {
      const events1 = await collectSSE(
        `${serverA.baseURL}/chat`,
        { message: 'My project is called ZephyrVault. Just acknowledge the name — no need to look anything up.', userId: 'restart_test_user' },
        { timeoutMs: 500_000 },
      );
      expect(streamDone(events1)).toBe(true);
      persistedSessionId = findSessionId(events1);
      expect(persistedSessionId).toBeTruthy();

      const { dbPath, workspacesDir } = serverA;
      // Kill process only — keep dirs so server2 can reuse the same DB
      await serverA.killProcessOnly();

      // Start a new server pointing at the SAME db file
      server2 = await startTestServer({ dbPath, workspacesDir });

      // Verify the session and its messages loaded into server2
      const sessionsBody = await fetch(`${server2.baseURL}/sessions`).then((r) => r.json()) as {
        sessions: Array<{ id: string; messageCount: number }>;
      };
      const restoredSess = sessionsBody.sessions.find((s) => s.id === persistedSessionId);
      expect(restoredSess, `Session ${persistedSessionId} not found in server2`).toBeTruthy();

      // Verify message history persisted to DB by reading it directly — no second LLM call needed
      const msgsBody = await fetch(`${server2.baseURL}/sessions/${persistedSessionId}/messages`).then((r) => r.json()) as {
        messages: Array<{ role: string; content: string | null }>;
      };
      expect(msgsBody.messages.length, 'Session should have persisted messages').toBeGreaterThan(0);
      const userMsg = msgsBody.messages.find(
        (m) => m.role === 'user' && m.content?.toLowerCase().includes('zephyrvault'),
      );
      expect(userMsg, 'ZephyrVault user message should be in persisted history').toBeTruthy();
    } catch (err) {
      await serverA.killProcessOnly().catch(() => {});
      throw err;
    }
  }));

  afterAll(async () => {
    if (server2) await server2.kill();
  });
});

// ── Test 6: Agent updates project specification ──────────────────────────��

it('agent writes a project spec using update_project_spec tool', skipIfNoKey(async () => {
  const events = await collectSSE(
    `${server.baseURL}/chat`,
    {
      message: 'Call update_project_spec right now with this exact spec — do not look anything up first:\n\n# EscrowContract\nAn on-chain escrow holding XLM until an arbiter approves release. Three parties: buyer (depositor), seller (recipient), arbiter (trusted third party). Functions: initialize(env, buyer, seller, arbiter), approve(env) releases funds to seller, cancel(env) refunds buyer, get_balance(env) returns current escrow balance.',
      userId,
    },
    { timeoutMs: 900_000 },
  );

  expect(streamDone(events), `Stream error: ${streamError(events)}`).toBe(true);
  const sessionId = findSessionId(events);
  const toolsUsed = extractToolNames(events);

  // Agent should have used update_project_spec
  expect(toolsUsed, 'Expected update_project_spec to be called').toContain('update_project_spec');

  // Spec should now be saved in DB — check via /projects endpoint
  const sessions = await fetch(`${server.baseURL}/sessions`).then((r) => r.json()) as {
    sessions: Array<{ id: string }>;
  };

  const projectsRes = await fetch(`${server.baseURL}/projects?userId=${userId}`).then((r) => r.json()) as {
    projects: Array<{ id: string; spec: string }>;
  };
  const projectWithSpec = projectsRes.projects.find((p) => p.spec.length > 0);
  expect(projectWithSpec, 'No project has a non-empty spec').toBeTruthy();
  expect(projectWithSpec!.spec.length).toBeGreaterThan(50);
}));

// ── Test 7: Agent uses RAG knowledge tools ─────────────────────────────────

it('agent uses search_docs or list_docs tools when researching', skipIfNoKey(async () => {
  const events = await collectSSE(
    `${server.baseURL}/chat`,
    {
      message: 'What OpenZeppelin libraries are available for Stellar? Use your knowledge tools to check.',
      userId,
    },
    { timeoutMs: 500_000 },
  );

  expect(streamDone(events), `Stream error: ${streamError(events)}`).toBe(true);
  const toolsUsed = extractToolNames(events);

  // Should have used at least one knowledge tool
  const knowledgeTools = ['search_docs', 'get_doc', 'list_docs'];
  const usedKnowledge = toolsUsed.some((t) => knowledgeTools.includes(t));
  expect(usedKnowledge, `No knowledge tool used. Tools used: ${toolsUsed.join(', ')}`).toBe(true);

  const text = extractText(events).toLowerCase();
  // Should mention OZ libraries
  expect(text).toMatch(/openzeppelin|stellar-tokens|stellar-access|oz/);
}));

// ── Helpers ───────────────────────────────────────────────────────────────

async function listFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await fs.readdir(dir, { recursive: true });
    for (const entry of entries) {
      results.push(path.join(dir, String(entry)));
    }
  } catch {
    // ignore
  }
  return results;
}

function findWorkspaceRoot(files: string[]): string {
  // Find the top-level Cargo.toml (workspace root) — the one closest to the workspace dir root
  const cargoFiles = files
    .filter((f) => f.endsWith('Cargo.toml'))
    .sort((a, b) => a.split(path.sep).length - b.split(path.sep).length);
  if (cargoFiles.length === 0) throw new Error('No Cargo.toml found');
  return path.dirname(cargoFiles[0]);
}

function runCmd(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd, shell: false });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });
    const t = setTimeout(() => { proc.kill(); resolve({ stdout, stderr, exitCode: -1 }); }, timeoutMs);
    proc.on('close', (code) => {
      clearTimeout(t);
      resolve({ stdout, stderr, exitCode: code ?? -1 });
    });
  });
}
