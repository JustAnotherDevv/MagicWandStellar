/**
 * Full agent workflow E2E test — counter contract lifecycle.
 *
 * Drives the agent through a complete smart-contract development cycle:
 *   1. Describe project  → spec with mermaid diagram appears + logs saved to DB
 *   2. Approve + code    → contract .rs file written to workspace
 *   3. Build             → `stellar contract build` succeeds
 *   4. Change            → increment step changed to 5, build still passes
 *   5. Tests             → agent writes tests, `cargo test` passes
 *
 * REQUIRES a real MINIMAX_API_KEY or OPENROUTER_API_KEY.
 * All tests are auto-skipped when neither key is present/valid.
 *
 * Run:
 *   npx vitest run tests/e2e/full-workflow.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { startTestServer, hasRealApiKey, type TestServer } from '../helpers/server.js';
import {
  collectSSE,
  extractToolNames,
  findSessionId,
  streamDone,
  streamError,
} from '../helpers/sse.js';

const SKIP = !hasRealApiKey();
const SKIP_MSG = 'No real LLM API key (MINIMAX_API_KEY or OPENROUTER_API_KEY) — skipping';

let server: TestServer;
let baseURL: string;
// Shared state across test steps
let sessionId = '';
let projectId = '';
const userId = `e2e_wf_${randomUUID().slice(0, 8)}`;

beforeAll(async () => {
  if (SKIP) return;
  server = await startTestServer();
  baseURL = server.baseURL;
}, 60_000);

afterAll(async () => {
  if (SKIP) return;
  await server?.kill();
});

/** Recursively flatten a file tree into a flat array of leaf nodes */
function flattenFiles(nodes: Array<{ name: string; path: string; isDirectory: boolean; children?: any[] }>): Array<{ name: string; path: string }> {
  return nodes.flatMap((n) => n.isDirectory ? flattenFiles(n.children ?? []) : [n]);
}

// ── Step 1: Design ────────────────────────────────────────────────────────────

it('step 1 — agent designs a spec with mermaid diagram and saves logs', async () => {
  if (SKIP) { console.log(SKIP_MSG); return; }

  const events = await collectSSE(`${baseURL}/chat`, {
    message:
      'I want to build a Soroban counter smart contract on Stellar testnet. ' +
      'It should have increment, decrement, and get_count functions. ' +
      'Please design the architecture and update the project spec with a mermaid diagram.',
    userId,
    network: 'testnet',
  }, { timeoutMs: 120_000 });

  sessionId = findSessionId(events) ?? '';
  expect(sessionId, 'session_created event must be present').toBeTruthy();
  expect(streamDone(events), 'stream must finish cleanly').toBe(true);
  expect(streamError(events), 'no error events').toBeUndefined();

  // Get projectId from session list
  const sessRes = await fetch(`${baseURL}/sessions?userId=${userId}`);
  const { sessions } = await sessRes.json() as { sessions: Array<{ id: string; projectId: string }> };
  const sess = sessions.find((s) => s.id === sessionId);
  expect(sess, 'session must appear in session list').toBeTruthy();
  projectId = sess!.projectId;

  // Spec must contain a mermaid diagram
  const projRes = await fetch(`${baseURL}/projects/${projectId}`);
  const { project } = await projRes.json() as { project: { spec: string } };
  expect(project.spec, 'spec must contain mermaid diagram').toContain('mermaid');

  // Logs must be persisted to DB
  const logsRes = await fetch(`${baseURL}/sessions/${sessionId}/logs`);
  const { logs } = await logsRes.json() as { logs: Array<{ message: string; source: string }> };
  expect(logs.length, 'at least 1 log entry must be saved').toBeGreaterThan(0);
  expect(
    logs.some((l) => l.message.includes('[chat] done')),
    'done log entry must be present',
  ).toBe(true);

  console.log(`✓ step 1: spec created, ${logs.length} log entries persisted, projectId=${projectId}`);
}, 180_000);

// ── Step 2: Code ──────────────────────────────────────────────────────────────

it('step 2 — agent writes contract code when approved', async () => {
  if (SKIP) { console.log(SKIP_MSG); return; }
  expect(sessionId, 'step 1 must have set sessionId').toBeTruthy();

  const events = await collectSSE(`${baseURL}/chat`, {
    message: 'Looks great! Please implement the full Soroban contract code now.',
    sessionId,
    projectId,
    userId,
  }, { timeoutMs: 600_000 });

  expect(streamDone(events), 'stream must finish cleanly').toBe(true);
  expect(streamError(events), 'no error events').toBeUndefined();
  expect(extractToolNames(events), 'write_file must be called').toContain('write_file');

  // At least one .rs file must exist in the workspace
  const filesRes = await fetch(`${baseURL}/workspace/${projectId}/files`);
  const { files } = await filesRes.json() as { files: any[] };
  const allFiles = flattenFiles(files);
  const contractFile = allFiles.find((f) => f.path.endsWith('.rs'));
  expect(contractFile, 'at least one .rs file must be in workspace').toBeTruthy();

  console.log(`✓ step 2: contract written — ${contractFile?.path}`);
}, 900_000);

// ── Step 3: Build ─────────────────────────────────────────────────────────────

it('step 3 — contract builds successfully', async () => {
  if (SKIP) { console.log(SKIP_MSG); return; }
  expect(projectId, 'step 2 must have set projectId').toBeTruthy();

  const buildRes = await fetch(`${baseURL}/workspace/${projectId}/build`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const result = await buildRes.json() as { success: boolean; output: string };

  if (!result.success) {
    console.error('Build output:', result.output.slice(0, 600));
  }
  expect(result.success, `Build must succeed. Output: ${result.output.slice(0, 300)}`).toBe(true);

  // Build result must appear in project-level logs
  const logsRes = await fetch(`${baseURL}/projects/${projectId}/logs`);
  const { logs } = await logsRes.json() as { logs: Array<{ source: string; message: string }> };
  expect(
    logs.some((l) => l.source === 'build' && l.message.includes('success')),
    'build success must be in project logs',
  ).toBe(true);

  console.log('✓ step 3: build succeeded');
}, 600_000);

// ── Step 4: Change + re-build ─────────────────────────────────────────────────

it('step 4 — agent applies a small change and build still passes', async () => {
  if (SKIP) { console.log(SKIP_MSG); return; }
  expect(sessionId, 'step 2 must have set sessionId').toBeTruthy();

  const events = await collectSSE(`${baseURL}/chat`, {
    message: 'Please change the increment step from 1 to 5 (each call to increment adds 5 to the counter).',
    sessionId,
    projectId,
    userId,
  }, { timeoutMs: 600_000 });

  expect(streamDone(events), 'stream must finish cleanly').toBe(true);
  expect(extractToolNames(events), 'write_file must be called for the change').toContain('write_file');

  // Re-build to confirm change doesn't break compilation
  const buildRes = await fetch(`${baseURL}/workspace/${projectId}/build`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const buildResult = await buildRes.json() as { success: boolean; output: string };

  if (!buildResult.success) {
    console.error('Build after change output:', buildResult.output.slice(0, 600));
  }
  expect(buildResult.success, 'Build must still pass after change').toBe(true);

  console.log('✓ step 4: change applied, build still passes');
}, 600_000);

// ── Step 5: Write + run tests ─────────────────────────────────────────────────

it('step 5 — agent writes tests and they pass', async () => {
  if (SKIP) { console.log(SKIP_MSG); return; }
  expect(sessionId, 'step 2 must have set sessionId').toBeTruthy();

  const events = await collectSSE(`${baseURL}/chat`, {
    message:
      'Please add unit tests for the counter contract covering increment, decrement, and get_count.',
    sessionId,
    projectId,
    userId,
  }, { timeoutMs: 600_000 });

  expect(streamDone(events), 'stream must finish cleanly').toBe(true);
  expect(extractToolNames(events), 'write_file must be called for tests').toContain('write_file');

  // Run tests via API
  const testRes = await fetch(`${baseURL}/workspace/${projectId}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const testResult = await testRes.json() as { success: boolean; output: string };

  if (!testResult.success) {
    console.error('Test output:', testResult.output.slice(0, 600));
  }
  expect(testResult.success, `Tests must pass. Output: ${testResult.output.slice(0, 300)}`).toBe(true);

  // Final summary: full session log must be accessible via API
  const logsRes = await fetch(`${baseURL}/sessions/${sessionId}/logs`);
  const { logs } = await logsRes.json() as { logs: Array<{ message: string }> };
  const toolLogs = logs.filter((l) => l.message.startsWith('[tool]'));
  const buildLogs = logs.filter((l) => l.message.startsWith('[chat] done'));

  console.log(`✓ step 5: tests pass`);
  console.log(`  total log entries : ${logs.length}`);
  console.log(`  tool calls logged : ${toolLogs.length}`);
  console.log(`  chat completions  : ${buildLogs.length}`);
  console.log(`  tool call log     : ${toolLogs.map((l) => l.message).join(' | ')}`);

  expect(toolLogs.length, 'multiple tool calls must be logged across the full session').toBeGreaterThan(3);
}, 600_000);
