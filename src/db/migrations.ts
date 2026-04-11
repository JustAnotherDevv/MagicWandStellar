import type Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema.js';

// Persistent log table — stores all notable SSE events and build/test outcomes
// so logs survive page refresh, server restart, and wallet reconnect.
const MIGRATION_V2 = `
CREATE TABLE IF NOT EXISTS logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT    NOT NULL DEFAULT '',
  project_id  TEXT    NOT NULL,
  source      TEXT    NOT NULL DEFAULT 'agent',
  level       TEXT    NOT NULL DEFAULT 'INFO',
  message     TEXT    NOT NULL,
  data        TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_session ON logs(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_logs_project ON logs(project_id, created_at);
`;

export function runMigrations(db: Database.Database): void {
  const currentVersion = db.pragma('user_version', { simple: true }) as number;

  if (currentVersion === 0) {
    db.exec(SCHEMA_SQL);
    db.pragma('user_version = 1');
    console.log('[db] Schema initialized (v1)');
  }
  if (currentVersion < 2) {
    db.exec(MIGRATION_V2);
    db.pragma('user_version = 2');
    console.log('[db] Migrated to v2 (logs table)');
  }
}
