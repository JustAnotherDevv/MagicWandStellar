export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  name          TEXT NOT NULL,
  spec          TEXT NOT NULL DEFAULT '',
  app_name      TEXT NOT NULL DEFAULT '',
  app_description TEXT NOT NULL DEFAULT '',
  app_tags      TEXT NOT NULL DEFAULT '',
  app_logo_url  TEXT NOT NULL DEFAULT '',
  app_banner_url TEXT NOT NULL DEFAULT '',
  app_runtime_url TEXT NOT NULL DEFAULT '',
  app_like_count INTEGER NOT NULL DEFAULT 0,
  app_dislike_count INTEGER NOT NULL DEFAULT 0,
  app_published_at INTEGER,
  network       TEXT NOT NULL,
  workspace_dir TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_network  ON projects(network);

CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id),
  user_id         TEXT NOT NULL REFERENCES users(id),
  network         TEXT NOT NULL,
  workspace_dir   TEXT NOT NULL,
  thinking_budget INTEGER,
  created_at      INTEGER NOT NULL,
  last_activity   INTEGER NOT NULL,
  is_active       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_sessions_project_id ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_is_active  ON sessions(is_active);

CREATE TABLE IF NOT EXISTS messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT    NOT NULL REFERENCES sessions(id),
  project_id   TEXT    NOT NULL REFERENCES projects(id),
  seq          INTEGER NOT NULL,
  role         TEXT    NOT NULL,
  content      TEXT,
  tool_calls   TEXT,
  tool_call_id TEXT,
  created_at   INTEGER NOT NULL,
  UNIQUE(session_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_messages_project_id ON messages(project_id);

CREATE TABLE IF NOT EXISTS contracts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id    TEXT    NOT NULL,
  project_id     TEXT    NOT NULL REFERENCES projects(id),
  session_id     TEXT    NOT NULL REFERENCES sessions(id),
  user_id        TEXT    NOT NULL REFERENCES users(id),
  network        TEXT    NOT NULL,
  wasm_path      TEXT,
  source_account TEXT,
  contract_alias TEXT,
  deployed_at    INTEGER NOT NULL,
  UNIQUE(contract_id, network)
);
CREATE INDEX IF NOT EXISTS idx_contracts_project_id ON contracts(project_id);
CREATE INDEX IF NOT EXISTS idx_contracts_network    ON contracts(network);
CREATE INDEX IF NOT EXISTS idx_contracts_user_id    ON contracts(user_id);
`;
