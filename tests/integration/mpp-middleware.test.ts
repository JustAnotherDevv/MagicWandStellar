/**
 * Integration tests: MPP payment middleware.
 *
 * Tests three server configurations:
 *  1. MPP_ENABLED=false (default) — /chat proceeds normally (no 402)
 *  2. MPP_ENABLED=true + no STELLAR_PUBLIC_KEY — /chat returns 500 (init error)
 *  3. MPP_ENABLED=true + valid STELLAR_PUBLIC_KEY — /chat returns 402 (payment challenge)
 *
 * Starts a real test server for each configuration via startTestServer.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer, type TestServer } from '../helpers/server.js';

// ── Test 1: MPP disabled (default behaviour) ──────────────────────────────────

describe('MPP_ENABLED=false — chat endpoint not gated', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer({
      overrideEnv: {
        OPENROUTER_API_KEY: 'sk-integration-test-invalid',
        MPP_ENABLED: 'false',
      },
    });
  }, 40_000);

  afterAll(async () => {
    await server.kill();
  });

  it('POST /chat does NOT return 402', async () => {
    const res = await fetch(`${server.baseURL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello', userId: 'mpp-test-user' }),
    });
    // Should be 200 (SSE) not 402 — payment not required
    expect(res.status).not.toBe(402);
    expect(res.status).toBe(200);
  });

  it('POST /chat returns SSE content-type when MPP disabled', async () => {
    const res = await fetch(`${server.baseURL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello', userId: 'mpp-test-user-2' }),
    });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    // Drain body to avoid connection leak
    await res.body?.cancel();
  });
});

// ── Test 2: MPP enabled but no STELLAR_PUBLIC_KEY ─────────────────────────────

describe('MPP_ENABLED=true + no STELLAR_PUBLIC_KEY — middleware init fails gracefully', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer({
      overrideEnv: {
        OPENROUTER_API_KEY: 'sk-integration-test-invalid',
        MPP_ENABLED: 'true',
        STELLAR_PUBLIC_KEY: '',   // explicitly unset
        STELLAR_SECRET_KEY: '',
      },
    });
  }, 40_000);

  afterAll(async () => {
    await server.kill();
  });

  it('POST /chat returns 500 with MPP init error (not a crash)', async () => {
    const res = await fetch(`${server.baseURL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello', userId: 'mpp-init-error-user' }),
    });
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('MPP');
  });

  it('GET /health still works despite MPP config error', async () => {
    const res = await fetch(`${server.baseURL}/health`);
    expect(res.ok).toBe(true);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('ok');
  });
});

// ── Test 3: MPP enabled with STELLAR_PUBLIC_KEY ───────────────────────────────

describe('MPP_ENABLED=true + STELLAR_PUBLIC_KEY set — /chat returns 402', () => {
  let server: TestServer;

  // Use a syntactically valid Stellar public key (testnet, won't exist on-chain)
  const FAKE_PUBLIC_KEY = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';

  beforeAll(async () => {
    server = await startTestServer({
      overrideEnv: {
        OPENROUTER_API_KEY: 'sk-integration-test-invalid',
        MPP_ENABLED: 'true',
        STELLAR_PUBLIC_KEY: FAKE_PUBLIC_KEY,
        MPP_SECRET_KEY: 'test-secret-key-32-chars-padded-xx',
        STELLAR_NETWORK: 'testnet',
      },
    });
  }, 40_000);

  afterAll(async () => {
    await server.kill();
  });

  it('POST /chat returns 402 with WWW-Authenticate header', async () => {
    const res = await fetch(`${server.baseURL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello', userId: 'mpp-402-user' }),
    });
    expect(res.status).toBe(402);
    const wwwAuth = res.headers.get('www-authenticate');
    expect(wwwAuth).not.toBeNull();
    // Drain body
    await res.body?.cancel();
  });

  it('GET /health is NOT gated by MPP (only /chat is)', async () => {
    const res = await fetch(`${server.baseURL}/health`);
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
  });
});
