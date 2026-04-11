import Database from 'better-sqlite3';
import { runMigrations } from './migrations.js';
import type { StellarNetwork } from '../config/index.js';

function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string, data?: unknown): void {
  const ts = new Date().toISOString();
  const extra = data !== undefined ? ' ' + JSON.stringify(data) : '';
  console.log(`[${ts}][${level}][db] ${msg}${extra}`);
}

// ── Row types (snake_case as returned by better-sqlite3) ──────────────────

export interface UserRow {
  id: string;
  created_at: number;
  last_seen: number;
}

export interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  spec: string;
  network: string;
  workspace_dir: string;
  created_at: number;
  updated_at: number;
}

export interface SessionRow {
  id: string;
  project_id: string;
  user_id: string;
  network: string;
  workspace_dir: string;
  thinking_budget: number | null;
  created_at: number;
  last_activity: number;
  is_active: number;
}

export interface MessageRow {
  id: number;
  session_id: string;
  project_id: string;
  seq: number;
  role: string;
  content: string | null;
  tool_calls: string | null;
  tool_call_id: string | null;
  created_at: number;
}

export interface ContractRow {
  id: number;
  contract_id: string;
  project_id: string;
  session_id: string;
  user_id: string;
  network: string;
  wasm_path: string | null;
  source_account: string | null;
  contract_alias: string | null;
  deployed_at: number;
}

export interface LogRow {
  id: number;
  session_id: string;
  project_id: string;
  source: string;
  level: string;
  message: string;
  data: string | null;
  created_at: number;
}

// ── DatabaseStore ─────────────────────────────────────────────────────────

export class DatabaseStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    runMigrations(this.db);
    log('INFO', 'database opened', { dbPath });
  }

  // ── Users ────────────────────────────────────────────────────────────────

  upsertUser(id: string): UserRow {
    const now = Date.now();
    this.db
      .prepare(`INSERT OR IGNORE INTO users (id, created_at, last_seen) VALUES (?, ?, ?)`)
      .run(id, now, now);
    this.db
      .prepare(`UPDATE users SET last_seen = ? WHERE id = ?`)
      .run(now, id);
    log('INFO', 'upsertUser', { userId: id });
    return this.db.prepare<string, UserRow>(`SELECT * FROM users WHERE id = ?`).get(id)!;
  }

  getUser(id: string): UserRow | undefined {
    return this.db.prepare<string, UserRow>(`SELECT * FROM users WHERE id = ?`).get(id);
  }

  listUsers(): UserRow[] {
    return this.db.prepare<[], UserRow>(`SELECT * FROM users ORDER BY created_at DESC`).all();
  }

  getUsersWithCounts(): Array<UserRow & { project_count: number; contract_count: number }> {
    return this.db
      .prepare<
        [],
        UserRow & { project_count: number; contract_count: number }
      >(
        `SELECT u.*,
           (SELECT COUNT(*) FROM projects p WHERE p.user_id = u.id) AS project_count,
           (SELECT COUNT(*) FROM contracts c WHERE c.user_id = u.id) AS contract_count
         FROM users u
         ORDER BY u.last_seen DESC`,
      )
      .all();
  }

  // ── Projects ─────────────────────────────────────────────────────────────

  createProject(p: {
    id: string;
    userId: string;
    name: string;
    network: StellarNetwork;
    workspaceDir: string;
  }): ProjectRow {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO projects (id, user_id, name, spec, network, workspace_dir, created_at, updated_at)
         VALUES (?, ?, ?, '', ?, ?, ?, ?)`,
      )
      .run(p.id, p.userId, p.name, p.network, p.workspaceDir, now, now);
    log('INFO', 'createProject', { projectId: p.id, userId: p.userId, name: p.name, network: p.network });
    return this.db.prepare<string, ProjectRow>(`SELECT * FROM projects WHERE id = ?`).get(p.id)!;
  }

  getProject(id: string): ProjectRow | undefined {
    return this.db.prepare<string, ProjectRow>(`SELECT * FROM projects WHERE id = ?`).get(id);
  }

  updateProjectSpec(projectId: string, spec: string): void {
    this.db
      .prepare(`UPDATE projects SET spec = ?, updated_at = ? WHERE id = ?`)
      .run(spec, Date.now(), projectId);
  }

  listProjects(filter?: { userId?: string; network?: string }): ProjectRow[] {
    if (filter?.userId && filter?.network) {
      return this.db
        .prepare<[string, string], ProjectRow>(
          `SELECT * FROM projects WHERE user_id = ? AND network = ? ORDER BY created_at DESC`,
        )
        .all(filter.userId, filter.network);
    }
    if (filter?.userId) {
      return this.db
        .prepare<string, ProjectRow>(
          `SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC`,
        )
        .all(filter.userId);
    }
    if (filter?.network) {
      return this.db
        .prepare<string, ProjectRow>(
          `SELECT * FROM projects WHERE network = ? ORDER BY created_at DESC`,
        )
        .all(filter.network);
    }
    return this.db
      .prepare<[], ProjectRow>(`SELECT * FROM projects ORDER BY created_at DESC`)
      .all();
  }

  // ── Sessions ─────────────────────────────────────────────────────────────

  createSession(s: {
    id: string;
    projectId: string;
    userId: string;
    network: StellarNetwork;
    workspaceDir: string;
    thinkingBudget?: number;
  }): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO sessions (id, project_id, user_id, network, workspace_dir, thinking_budget, created_at, last_activity, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(
        s.id,
        s.projectId,
        s.userId,
        s.network,
        s.workspaceDir,
        s.thinkingBudget ?? null,
        now,
        now,
      );
  }

  getActiveSession(id: string): SessionRow | undefined {
    return this.db
      .prepare<string, SessionRow>(`SELECT * FROM sessions WHERE id = ? AND is_active = 1`)
      .get(id);
  }

  loadActiveSessions(): SessionRow[] {
    return this.db
      .prepare<[], SessionRow>(`SELECT * FROM sessions WHERE is_active = 1 ORDER BY last_activity DESC`)
      .all();
  }

  markSessionInactive(id: string): void {
    this.db.prepare(`UPDATE sessions SET is_active = 0 WHERE id = ?`).run(id);
  }

  updateSessionActivity(id: string, lastActivity: number): void {
    this.db.prepare(`UPDATE sessions SET last_activity = ? WHERE id = ?`).run(lastActivity, id);
  }

  // ── Messages ─────────────────────────────────────────────────────────────

  persistMessages(
    sessionId: string,
    projectId: string,
    messages: any[],
    fromSeq: number,
  ): void {
    const count = messages.length - fromSeq;
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO messages (session_id, project_id, seq, role, content, tool_calls, tool_call_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertAll = this.db.transaction((msgs: any[]) => {
      for (let i = fromSeq; i < msgs.length; i++) {
        const m = msgs[i];
        insert.run(
          sessionId,
          projectId,
          i,
          m.role,
          typeof m.content === 'string' ? m.content : null,
          m.tool_calls ? JSON.stringify(m.tool_calls) : null,
          m.tool_call_id ?? null,
          Date.now(),
        );
      }
    });
    insertAll(messages);
    log('INFO', 'persistMessages', { sessionId, projectId, count, fromSeq });
  }

  getMessages(sessionId: string): MessageRow[] {
    return this.db
      .prepare<string, MessageRow>(
        `SELECT * FROM messages WHERE session_id = ? ORDER BY seq ASC`,
      )
      .all(sessionId);
  }

  // ── Contracts ─────────────────────────────────────────────────────────────

  saveContract(c: {
    contractId: string;
    projectId: string;
    sessionId: string;
    userId: string;
    network: StellarNetwork;
    wasmPath?: string;
    sourceAccount?: string;
    contractAlias?: string;
  }): void {
    log('INFO', 'saveContract', { contractId: c.contractId, projectId: c.projectId, network: c.network });
    this.db
      .prepare(
        `INSERT OR IGNORE INTO contracts
           (contract_id, project_id, session_id, user_id, network, wasm_path, source_account, contract_alias, deployed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        c.contractId,
        c.projectId,
        c.sessionId,
        c.userId,
        c.network,
        c.wasmPath ?? null,
        c.sourceAccount ?? null,
        c.contractAlias ?? null,
        Date.now(),
      );
  }

  getContractsByProject(projectId: string): ContractRow[] {
    return this.db
      .prepare<string, ContractRow>(
        `SELECT * FROM contracts WHERE project_id = ? ORDER BY deployed_at DESC`,
      )
      .all(projectId);
  }

  getContractsByUser(userId: string): ContractRow[] {
    return this.db
      .prepare<string, ContractRow>(
        `SELECT * FROM contracts WHERE user_id = ? ORDER BY deployed_at DESC`,
      )
      .all(userId);
  }

  listContracts(): ContractRow[] {
    return this.db
      .prepare<[], ContractRow>(`SELECT * FROM contracts ORDER BY deployed_at DESC`)
      .all();
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  getStats(): {
    users: { total: number };
    projects: { total: number; byNetwork: Record<string, number> };
    sessions: { active: number; total: number };
    contracts: {
      total: number;
      byNetwork: Record<string, number>;
      recentDeployments: ContractRow[];
    };
  } {
    const userTotal = (this.db.prepare(`SELECT COUNT(*) as n FROM users`).get() as { n: number }).n;

    const projectTotal = (this.db.prepare(`SELECT COUNT(*) as n FROM projects`).get() as { n: number }).n;
    const projectByNet = this.db
      .prepare<[], { network: string; n: number }>(
        `SELECT network, COUNT(*) as n FROM projects GROUP BY network`,
      )
      .all();

    const sessionActive = (
      this.db.prepare(`SELECT COUNT(*) as n FROM sessions WHERE is_active = 1`).get() as { n: number }
    ).n;
    const sessionTotal = (this.db.prepare(`SELECT COUNT(*) as n FROM sessions`).get() as { n: number }).n;

    const contractTotal = (this.db.prepare(`SELECT COUNT(*) as n FROM contracts`).get() as { n: number }).n;
    const contractByNet = this.db
      .prepare<[], { network: string; n: number }>(
        `SELECT network, COUNT(*) as n FROM contracts GROUP BY network`,
      )
      .all();
    const recentDeployments = this.db
      .prepare<[], ContractRow>(`SELECT * FROM contracts ORDER BY deployed_at DESC LIMIT 10`)
      .all();

    return {
      users: { total: userTotal },
      projects: {
        total: projectTotal,
        byNetwork: Object.fromEntries(projectByNet.map((r) => [r.network, r.n])),
      },
      sessions: { active: sessionActive, total: sessionTotal },
      contracts: {
        total: contractTotal,
        byNetwork: Object.fromEntries(contractByNet.map((r) => [r.network, r.n])),
        recentDeployments,
      },
    };
  }

  // ── Logs ──────────────────────────────────────────────────────────────────

  insertLog(entry: {
    sessionId: string;
    projectId: string;
    source?: string;
    level?: string;
    message: string;
    data?: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO logs (session_id, project_id, source, level, message, data, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.sessionId,
        entry.projectId,
        entry.source ?? 'agent',
        entry.level ?? 'INFO',
        entry.message,
        entry.data ?? null,
        Date.now(),
      );
  }

  getLogs(sessionId: string, limit = 2000): LogRow[] {
    return this.db
      .prepare<[string, number], LogRow>(
        `SELECT * FROM logs WHERE session_id = ? ORDER BY created_at ASC LIMIT ?`,
      )
      .all(sessionId, limit);
  }

  getProjectLogs(projectId: string, limit = 5000): LogRow[] {
    return this.db
      .prepare<[string, number], LogRow>(
        `SELECT * FROM logs WHERE project_id = ? ORDER BY created_at ASC LIMIT ?`,
      )
      .all(projectId, limit);
  }

  close(): void {
    this.db.close();
  }
}
