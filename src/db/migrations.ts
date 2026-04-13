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

const MIGRATION_V3 = `
ALTER TABLE projects ADD COLUMN phase TEXT NOT NULL DEFAULT 'design';
`;

const MIGRATION_V4 = `
ALTER TABLE projects ADD COLUMN app_name TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN app_description TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN app_tags TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN app_logo_url TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN app_published_at INTEGER;
`;

const MIGRATION_V5 = `
ALTER TABLE projects ADD COLUMN app_banner_url TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN app_runtime_url TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN app_like_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN app_dislike_count INTEGER NOT NULL DEFAULT 0;
`;

export function runMigrations(db: Database.Database): void {
  const hasColumn = (table: string, column: string): boolean => {
    const rows = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
    return rows.some((r) => r.name === column);
  };
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
  if (currentVersion < 3) {
    if (!hasColumn('projects', 'phase')) db.exec(MIGRATION_V3);
    db.pragma('user_version = 3');
    console.log('[db] Migrated to v3 (project phase)');
  }
  if (currentVersion < 4) {
    if (!hasColumn('projects', 'app_name')) db.exec(`ALTER TABLE projects ADD COLUMN app_name TEXT NOT NULL DEFAULT '';`);
    if (!hasColumn('projects', 'app_description')) db.exec(`ALTER TABLE projects ADD COLUMN app_description TEXT NOT NULL DEFAULT '';`);
    if (!hasColumn('projects', 'app_tags')) db.exec(`ALTER TABLE projects ADD COLUMN app_tags TEXT NOT NULL DEFAULT '';`);
    if (!hasColumn('projects', 'app_logo_url')) db.exec(`ALTER TABLE projects ADD COLUMN app_logo_url TEXT NOT NULL DEFAULT '';`);
    if (!hasColumn('projects', 'app_published_at')) db.exec(`ALTER TABLE projects ADD COLUMN app_published_at INTEGER;`);
    db.pragma('user_version = 4');
    console.log('[db] Migrated to v4 (project app metadata)');
  }
  if (currentVersion < 5) {
    if (!hasColumn('projects', 'app_banner_url')) db.exec(`ALTER TABLE projects ADD COLUMN app_banner_url TEXT NOT NULL DEFAULT '';`);
    if (!hasColumn('projects', 'app_runtime_url')) db.exec(`ALTER TABLE projects ADD COLUMN app_runtime_url TEXT NOT NULL DEFAULT '';`);
    if (!hasColumn('projects', 'app_like_count')) db.exec(`ALTER TABLE projects ADD COLUMN app_like_count INTEGER NOT NULL DEFAULT 0;`);
    if (!hasColumn('projects', 'app_dislike_count')) db.exec(`ALTER TABLE projects ADD COLUMN app_dislike_count INTEGER NOT NULL DEFAULT 0;`);
    db.pragma('user_version = 5');
    console.log('[db] Migrated to v5 (app runtime, banner, reactions)');
  }
}
