import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { randomUUID } from 'crypto';
import { DatabaseStore } from '../../src/db/index.js';

let db: DatabaseStore;
let dbPath: string;

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `test-db-${randomUUID()}.db`);
  db = new DatabaseStore(dbPath);
});

afterEach(() => {
  db.close();
  try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
});

// ── Users ─────────────────────────────────────────────────────────────────

describe('users', () => {
  it('upserts a user and retrieves it', () => {
    const user = db.upsertUser('alice');
    expect(user.id).toBe('alice');
    expect(user.created_at).toBeGreaterThan(0);
    expect(user.last_seen).toBeGreaterThan(0);
  });

  it('updates last_seen on repeated upsert', async () => {
    const u1 = db.upsertUser('bob');
    await new Promise((r) => setTimeout(r, 10));
    const u2 = db.upsertUser('bob');
    expect(u2.last_seen).toBeGreaterThanOrEqual(u1.last_seen);
    expect(u2.created_at).toBe(u1.created_at); // created_at must not change
  });

  it('lists all users', () => {
    db.upsertUser('alice');
    db.upsertUser('bob');
    expect(db.listUsers()).toHaveLength(2);
  });

  it('getUsersWithCounts includes project_count and contract_count', () => {
    db.upsertUser('charlie');
    db.createProject({ id: 'proj_1', userId: 'charlie', name: 'Test', network: 'testnet', workspaceDir: '/tmp/p1' });
    const rows = db.getUsersWithCounts();
    const charlie = rows.find((r) => r.id === 'charlie');
    expect(charlie?.project_count).toBe(1);
    expect(charlie?.contract_count).toBe(0);
  });
});

// ── Projects ─────────────────────────────────────────────────────────────

describe('projects', () => {
  beforeEach(() => { db.upsertUser('alice'); });

  it('creates and retrieves a project', () => {
    const p = db.createProject({
      id: 'proj_abc',
      userId: 'alice',
      name: 'Counter Contract',
      network: 'testnet',
      workspaceDir: '/tmp/ws/proj_abc',
    });
    expect(p.id).toBe('proj_abc');
    expect(p.user_id).toBe('alice');
    expect(p.spec).toBe('');
    expect(p.network).toBe('testnet');
  });

  it('updateProjectSpec stores markdown and updates updated_at', async () => {
    db.createProject({ id: 'proj_spec', userId: 'alice', name: 'Test', network: 'testnet', workspaceDir: '/tmp' });
    const before = db.getProject('proj_spec')!.updated_at;
    await new Promise((r) => setTimeout(r, 10));
    db.updateProjectSpec('proj_spec', '# My Counter\n\n## Functions\n- increment()\n- get()');
    const p = db.getProject('proj_spec')!;
    expect(p.spec).toContain('# My Counter');
    expect(p.updated_at).toBeGreaterThan(before);
  });

  it('listProjects supports userId filter', () => {
    db.upsertUser('bob');
    db.createProject({ id: 'p1', userId: 'alice', name: 'A', network: 'testnet', workspaceDir: '/tmp' });
    db.createProject({ id: 'p2', userId: 'bob',   name: 'B', network: 'testnet', workspaceDir: '/tmp' });
    expect(db.listProjects({ userId: 'alice' })).toHaveLength(1);
    expect(db.listProjects({ userId: 'bob' })).toHaveLength(1);
    expect(db.listProjects()).toHaveLength(2);
  });

  it('listProjects supports network filter', () => {
    db.createProject({ id: 'p3', userId: 'alice', name: 'C', network: 'mainnet',  workspaceDir: '/tmp' });
    db.createProject({ id: 'p4', userId: 'alice', name: 'D', network: 'testnet',  workspaceDir: '/tmp' });
    expect(db.listProjects({ network: 'mainnet' })).toHaveLength(1);
    expect(db.listProjects({ network: 'testnet' })).toHaveLength(1);
  });
});

// ── Sessions ──────────────────────────────────────────────────────────────

describe('sessions', () => {
  beforeEach(() => {
    db.upsertUser('alice');
    db.createProject({ id: 'proj_s', userId: 'alice', name: 'Test', network: 'testnet', workspaceDir: '/tmp' });
  });

  it('creates and retrieves an active session', () => {
    db.createSession({ id: 'sess_1', projectId: 'proj_s', userId: 'alice', network: 'testnet', workspaceDir: '/tmp/sess_1' });
    const row = db.getActiveSession('sess_1');
    expect(row).toBeTruthy();
    expect(row!.is_active).toBe(1);
    expect(row!.project_id).toBe('proj_s');
  });

  it('markSessionInactive hides session from getActiveSession', () => {
    db.createSession({ id: 'sess_2', projectId: 'proj_s', userId: 'alice', network: 'testnet', workspaceDir: '/tmp/sess_2' });
    db.markSessionInactive('sess_2');
    expect(db.getActiveSession('sess_2')).toBeUndefined();
  });

  it('loadActiveSessions returns only active sessions', () => {
    db.createSession({ id: 'sess_a', projectId: 'proj_s', userId: 'alice', network: 'testnet', workspaceDir: '/tmp/sa' });
    db.createSession({ id: 'sess_b', projectId: 'proj_s', userId: 'alice', network: 'testnet', workspaceDir: '/tmp/sb' });
    db.markSessionInactive('sess_b');
    const active = db.loadActiveSessions();
    expect(active.map((r) => r.id)).toContain('sess_a');
    expect(active.map((r) => r.id)).not.toContain('sess_b');
  });

  it('updateSessionActivity updates last_activity', async () => {
    db.createSession({ id: 'sess_c', projectId: 'proj_s', userId: 'alice', network: 'testnet', workspaceDir: '/tmp/sc' });
    const before = db.getActiveSession('sess_c')!.last_activity;
    await new Promise((r) => setTimeout(r, 10));
    const newTs = Date.now();
    db.updateSessionActivity('sess_c', newTs);
    expect(db.getActiveSession('sess_c')!.last_activity).toBe(newTs);
    expect(newTs).toBeGreaterThan(before);
  });
});

// ── Messages ──────────────────────────────────────────────────────────────

describe('messages', () => {
  beforeEach(() => {
    db.upsertUser('alice');
    db.createProject({ id: 'proj_m', userId: 'alice', name: 'Test', network: 'testnet', workspaceDir: '/tmp' });
    db.createSession({ id: 'sess_m', projectId: 'proj_m', userId: 'alice', network: 'testnet', workspaceDir: '/tmp/sm' });
  });

  const sampleMessages = [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'world', tool_calls: undefined },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"lib.rs"}' } }],
    },
    { role: 'tool', content: 'file contents', tool_call_id: 'call_1' },
  ];

  it('persists messages and retrieves them in order', () => {
    db.persistMessages('sess_m', 'proj_m', sampleMessages, 0);
    const rows = db.getMessages('sess_m');
    expect(rows).toHaveLength(4);
    expect(rows[0].role).toBe('user');
    expect(rows[0].content).toBe('hello');
    expect(rows[2].tool_calls).toBeTruthy();
    const parsed = JSON.parse(rows[2].tool_calls!);
    expect(parsed[0].function.name).toBe('read_file');
    expect(rows[3].tool_call_id).toBe('call_1');
  });

  it('fromSeq watermark only persists new messages', () => {
    db.persistMessages('sess_m', 'proj_m', sampleMessages, 0);
    // Append two more messages and persist from watermark 4
    const extended = [...sampleMessages, { role: 'user', content: 'follow up' }];
    db.persistMessages('sess_m', 'proj_m', extended, 4);
    const rows = db.getMessages('sess_m');
    expect(rows).toHaveLength(5);
    expect(rows[4].content).toBe('follow up');
  });

  it('INSERT OR IGNORE is idempotent — duplicate persist does not create extra rows', () => {
    db.persistMessages('sess_m', 'proj_m', sampleMessages, 0);
    db.persistMessages('sess_m', 'proj_m', sampleMessages, 0); // same range
    expect(db.getMessages('sess_m')).toHaveLength(4);
  });
});

// ── Contracts ──────────────────────────────────────────────────────────────

describe('contracts', () => {
  beforeEach(() => {
    db.upsertUser('alice');
    db.createProject({ id: 'proj_c', userId: 'alice', name: 'Token', network: 'testnet', workspaceDir: '/tmp' });
    db.createSession({ id: 'sess_c2', projectId: 'proj_c', userId: 'alice', network: 'testnet', workspaceDir: '/tmp/sc2' });
  });

  const CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'; // valid C + 55

  it('saves a contract and retrieves by project', () => {
    db.saveContract({
      contractId: CONTRACT_ID,
      projectId: 'proj_c',
      sessionId: 'sess_c2',
      userId: 'alice',
      network: 'testnet',
      wasmPath: 'contracts/token/target/wasm32-unknown-unknown/release/token.wasm',
      sourceAccount: 'alice',
    });
    const contracts = db.getContractsByProject('proj_c');
    expect(contracts).toHaveLength(1);
    expect(contracts[0].contract_id).toBe(CONTRACT_ID);
    expect(contracts[0].network).toBe('testnet');
  });

  it('INSERT OR IGNORE prevents duplicate contract_id+network', () => {
    db.saveContract({ contractId: CONTRACT_ID, projectId: 'proj_c', sessionId: 'sess_c2', userId: 'alice', network: 'testnet' });
    db.saveContract({ contractId: CONTRACT_ID, projectId: 'proj_c', sessionId: 'sess_c2', userId: 'alice', network: 'testnet' });
    expect(db.getContractsByProject('proj_c')).toHaveLength(1);
  });

  it('same contract_id on different networks is allowed', () => {
    db.saveContract({ contractId: CONTRACT_ID, projectId: 'proj_c', sessionId: 'sess_c2', userId: 'alice', network: 'testnet' });
    db.saveContract({ contractId: CONTRACT_ID, projectId: 'proj_c', sessionId: 'sess_c2', userId: 'alice', network: 'mainnet' });
    expect(db.getContractsByProject('proj_c')).toHaveLength(2);
  });
});

// ── Stats ─────────────────────────────────────────────────────────────────

describe('stats', () => {
  it('returns correct aggregate counts', () => {
    db.upsertUser('u1');
    db.upsertUser('u2');
    db.createProject({ id: 'ps1', userId: 'u1', name: 'A', network: 'testnet',  workspaceDir: '/tmp' });
    db.createProject({ id: 'ps2', userId: 'u2', name: 'B', network: 'mainnet',  workspaceDir: '/tmp' });
    db.createSession({ id: 'ss1', projectId: 'ps1', userId: 'u1', network: 'testnet', workspaceDir: '/tmp' });

    const stats = db.getStats();
    expect(stats.users.total).toBe(2);
    expect(stats.projects.total).toBe(2);
    expect(stats.projects.byNetwork['testnet']).toBe(1);
    expect(stats.projects.byNetwork['mainnet']).toBe(1);
    expect(stats.sessions.active).toBe(1);
    expect(stats.sessions.total).toBe(1);
    expect(stats.contracts.total).toBe(0);
  });
});
