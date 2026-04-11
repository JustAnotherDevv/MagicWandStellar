import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Session, SessionSummary, StellarNetwork } from '../types/index.js';
import { DEFAULT_NETWORK, DEFAULT_THINKING_BUDGET } from '../config/index.js';
import type { DatabaseStore } from '../db/index.js';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class SessionStore {
  private sessions = new Map<string, Session>();
  private workspacesBase: string;
  private db: DatabaseStore;

  constructor(workspacesBase: string, db: DatabaseStore) {
    this.workspacesBase = workspacesBase;
    this.db = db;
  }

  async create(
    network: StellarNetwork = DEFAULT_NETWORK,
    thinkingBudget = DEFAULT_THINKING_BUDGET,
    projectId: string,
    userId: string,
    workspaceDir?: string,
  ): Promise<Session> {
    const id = `sess_${Date.now()}_${randomUUID().slice(0, 8)}`;
    // Use the provided workspace (project-level) or fall back to a session-specific one.
    // Sharing the project workspace ensures /workspace/:projectId/* routes point at the
    // same directory the agent writes to.
    const effectiveWorkspaceDir = workspaceDir ?? path.join(this.workspacesBase, id);
    await fs.mkdir(effectiveWorkspaceDir, { recursive: true });

    const session: Session = {
      id,
      projectId,
      userId,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      workspaceDir: effectiveWorkspaceDir,
      messages: [],
      network,
      thinkingBudget,
      _messagesLoaded: true,
      _persistedMsgCount: 0,
    };

    this.sessions.set(id, session);
    this.db.createSession({ id, projectId, userId, network, workspaceDir: effectiveWorkspaceDir, thinkingBudget });
    console.log(`[session] Created ${id} (project: ${projectId}, network: ${network})`);
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  async delete(id: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session) return false;

    this.sessions.delete(id);
    this.db.markSessionInactive(id);

    try {
      await fs.rm(session.workspaceDir, { recursive: true, force: true });
    } catch {
      // non-fatal
    }

    console.log(`[session] Deleted ${id}`);
    return true;
  }

  list(): SessionSummary[] {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      projectId: s.projectId,
      userId: s.userId,
      createdAt: s.createdAt,
      lastActivityAt: s.lastActivityAt,
      workspaceDir: s.workspaceDir,
      network: s.network,
      messageCount: s.messages.length,
    }));
  }

  /** Load previously active sessions from DB into memory on startup */
  async loadFromDb(): Promise<void> {
    const rows = this.db.loadActiveSessions();
    let loaded = 0;
    for (const row of rows) {
      // Verify workspace still exists on disk
      try {
        await fs.access(row.workspace_dir);
      } catch {
        this.db.markSessionInactive(row.id);
        continue;
      }

      // Load project spec for this session
      const project = this.db.getProject(row.project_id);

      const session: Session = {
        id: row.id,
        projectId: row.project_id,
        userId: row.user_id,
        createdAt: row.created_at,
        lastActivityAt: row.last_activity,
        workspaceDir: row.workspace_dir,
        messages: [],
        network: row.network as StellarNetwork,
        thinkingBudget: row.thinking_budget ?? undefined,
        projectSpec: project?.spec ?? '',
        _messagesLoaded: false,  // lazy — load on first chat access
        _persistedMsgCount: 0,
      };
      this.sessions.set(row.id, session);
      loaded++;
    }
    console.log(`[session] Loaded ${loaded} active sessions from DB`);
  }

  /** Remove sessions that have been idle for more than SESSION_TTL_MS */
  async cleanup(): Promise<number> {
    const now = Date.now();
    const toDelete = [...this.sessions.values()].filter(
      (s) => now - s.lastActivityAt > SESSION_TTL_MS,
    );

    for (const session of toDelete) {
      await this.delete(session.id);
    }

    if (toDelete.length > 0) {
      console.log(`[session] Cleaned up ${toDelete.length} idle sessions`);
    }

    return toDelete.length;
  }

  get size(): number {
    return this.sessions.size;
  }
}
