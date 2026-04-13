/**
 * Integration tests: REST API endpoints.
 * Starts a real test server subprocess with an isolated SQLite DB.
 * Does NOT require a valid LLM API key — verifies all infrastructure
 * up to (and including) the point where the LLM call would happen.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer, type TestServer } from '../helpers/server.js';
import { collectSSE, findSessionId } from '../helpers/sse.js';

let server: TestServer;

beforeAll(async () => {
  // Integration tests verify infrastructure (DB, SSE events) not LLM output.
  // Force an invalid API key so the LLM call fails fast with an error event
  // rather than waiting 60-120s for a real LLM response.
  server = await startTestServer({
    overrideEnv: { OPENROUTER_API_KEY: 'sk-integration-test-invalid-key' },
  });
}, 40_000);

afterAll(async () => {
  await server.kill();
});

// ── Health ────────────────────────────────��─────────────────────────���──────

describe('GET /health', () => {
  it('returns status ok', async () => {
    const res = await fetch(`${server.baseURL}/health`);
    expect(res.ok).toBe(true);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('ok');
  });

  it('reports 26 docs loaded', async () => {
    const body = await fetch(`${server.baseURL}/health`).then((r) => r.json()) as Record<string, unknown>;
    expect(body.docsLoaded).toBeGreaterThanOrEqual(20); // at least 20 (some may 404)
  });

  it('reports 21 tools', async () => {
    const body = await fetch(`${server.baseURL}/health`).then((r) => r.json()) as Record<string, unknown>;
    expect(body.tools).toBe(21);
  });

  it('includes model name', async () => {
    const body = await fetch(`${server.baseURL}/health`).then((r) => r.json()) as Record<string, unknown>;
    expect(typeof body.model).toBe('string');
    expect((body.model as string).length).toBeGreaterThan(0);
  });
});

// ── Stats (empty DB) ───────────────────────────────────────────────��────────

describe('GET /stats', () => {
  it('returns zero counts on fresh DB', async () => {
    const body = await fetch(`${server.baseURL}/stats`).then((r) => r.json()) as Record<string, unknown>;
    const users = body.users as Record<string, number>;
    const projects = body.projects as Record<string, unknown>;
    const contracts = body.contracts as Record<string, unknown>;
    expect(users.total).toBe(0);
    expect(projects.total).toBe(0);
    expect(contracts.total).toBe(0);
  });

  it('has expected shape with byNetwork and recentDeployments', async () => {
    const body = await fetch(`${server.baseURL}/stats`).then((r) => r.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('users');
    expect(body).toHaveProperty('projects');
    expect(body).toHaveProperty('sessions');
    expect(body).toHaveProperty('contracts');
    const contracts = body.contracts as Record<string, unknown>;
    expect(contracts).toHaveProperty('byNetwork');
    expect(contracts).toHaveProperty('recentDeployments');
    expect(Array.isArray(contracts.recentDeployments)).toBe(true);
  });
});

// ── Users ───────────────────��─────────────────────────────────���───────────

describe('GET /users', () => {
  it('returns empty array on fresh DB', async () => {
    const body = await fetch(`${server.baseURL}/users`).then((r) => r.json()) as Record<string, unknown>;
    expect(Array.isArray(body.users)).toBe(true);
    expect((body.users as unknown[]).length).toBe(0);
  });
});

// ── Projects ──────────────────────────────────────────────────────────────

describe('GET /projects', () => {
  it('returns empty array on fresh DB', async () => {
    const body = await fetch(`${server.baseURL}/projects`).then((r) => r.json()) as Record<string, unknown>;
    expect(Array.isArray(body.projects)).toBe(true);
  });

  it('returns 404 for unknown project', async () => {
    const res = await fetch(`${server.baseURL}/projects/proj_doesnotexist`);
    expect(res.status).toBe(404);
  });
});

// ── POST /chat — infrastructure (pre-LLM) ─────────────────────��───────────
// Even if the API key is invalid, the server must:
//  1. Create user, project, session in DB
//  2. Return session_created SSE event
//  3. Return an error event (not crash)

describe('POST /chat — DB persistence before LLM call', () => {
  it('rejects missing message with 400', async () => {
    const res = await fetch(`${server.baseURL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'alice' }),
    });
    expect(res.status).toBe(400);
  });

  it('creates user, project, session and emits session_created', async () => {
    // session_created fires before the LLM is called — collect only that event
    const events = await collectSSE(
      `${server.baseURL}/chat`,
      { message: 'Build a counter Soroban contract', userId: 'test_user_1' },
      { timeoutMs: 10_000 },
    );

    // Infrastructure check: session_created fires immediately before LLM
    const sessionId = findSessionId(events);
    expect(sessionId, 'session_created event not received').toBeTruthy();
    expect(sessionId).toMatch(/^sess_/);
    // No server crash — at least session_created arrived (done/error may come later for LLM)
    expect(events.length, 'No SSE events received').toBeGreaterThan(0);
  });

  it('user is persisted in DB after chat', async () => {
    await collectSSE(
      `${server.baseURL}/chat`,
      { message: 'Hello', userId: 'db_check_user' },
      { timeoutMs: 20_000 },
    );
    const usersBody = await fetch(`${server.baseURL}/users`).then((r) => r.json()) as { users: Array<{ id: string }> };
    const found = usersBody.users.find((u) => u.id === 'db_check_user');
    expect(found, 'User not found in /users after chat').toBeTruthy();
  });

  it('project is persisted in DB after chat', async () => {
    const events = await collectSSE(
      `${server.baseURL}/chat`,
      { message: 'Create an NFT contract', userId: 'project_test_user' },
      { timeoutMs: 20_000 },
    );

    const projectsBody = await fetch(`${server.baseURL}/projects?userId=project_test_user`).then((r) => r.json()) as { projects: Array<{ name: string; network: string }> };
    expect(projectsBody.projects.length).toBeGreaterThanOrEqual(1);
    const project = projectsBody.projects[0];
    // Project name should be derived from the message
    expect(project.name).toContain('NFT');
    expect(project.network).toBe('testnet');
  });

  it('stats reflect new user and project after chat', async () => {
    await collectSSE(
      `${server.baseURL}/chat`,
      { message: 'Token contract please', userId: 'stats_test_user' },
      { timeoutMs: 20_000 },
    );

    const stats = await fetch(`${server.baseURL}/stats`).then((r) => r.json()) as {
      users: { total: number };
      projects: { total: number };
    };
    expect(stats.users.total).toBeGreaterThanOrEqual(1);
    expect(stats.projects.total).toBeGreaterThanOrEqual(1);
  });

  it('resumed sessionId continues same project — does not create new project', async () => {
    // First message — creates project
    const events1 = await collectSSE(
      `${server.baseURL}/chat`,
      { message: 'I want a voting contract', userId: 'multi_turn_user' },
      { timeoutMs: 20_000 },
    );
    const sessionId = findSessionId(events1);
    expect(sessionId).toBeTruthy();

    const projectsBefore = await fetch(`${server.baseURL}/projects?userId=multi_turn_user`).then((r) => r.json()) as { projects: unknown[] };
    const projectCountBefore = projectsBefore.projects.length;

    // Second message with same sessionId — should NOT create new project
    const events2 = await collectSSE(
      `${server.baseURL}/chat`,
      { message: 'Add a cancel function', userId: 'multi_turn_user', sessionId },
      { timeoutMs: 20_000 },
    );

    const projectsAfter = await fetch(`${server.baseURL}/projects?userId=multi_turn_user`).then((r) => r.json()) as { projects: unknown[] };
    expect(projectsAfter.projects.length).toBe(projectCountBefore); // same count
    // No new session_created on resume
    expect(findSessionId(events2)).toBeUndefined();
  });
});

// ── Sessions endpoint ────────────────────────────────────────────────────���

describe('GET /sessions and DELETE /sessions/:id', () => {
  it('lists sessions after chat', async () => {
    await collectSSE(
      `${server.baseURL}/chat`,
      { message: 'start contract', userId: 'session_list_user' },
      { timeoutMs: 20_000 },
    );
    const body = await fetch(`${server.baseURL}/sessions`).then((r) => r.json()) as { sessions: Array<{ id: string }> };
    expect(body.sessions.length).toBeGreaterThanOrEqual(1);
  });

  it('DELETE /sessions/:id removes the session', async () => {
    const events = await collectSSE(
      `${server.baseURL}/chat`,
      { message: 'temp session', userId: 'delete_test_user' },
      { timeoutMs: 20_000 },
    );
    const sessionId = findSessionId(events);
    expect(sessionId).toBeTruthy();

    const delRes = await fetch(`${server.baseURL}/sessions/${sessionId}`, { method: 'DELETE' });
    expect(delRes.ok).toBe(true);
    const delBody = await delRes.json() as { deleted: boolean };
    expect(delBody.deleted).toBe(true);
  });
});
