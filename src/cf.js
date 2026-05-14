import { createApp } from './app.js';
import { runKeepAlive } from './services/keep-alive.js';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    token_expiry INTEGER NOT NULL,
    is_primary INTEGER DEFAULT 0,
    storage_limit INTEGER DEFAULT 16106127360,
    storage_used INTEGER DEFAULT 0,
    card_color TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  INSERT OR IGNORE INTO settings (key, value) VALUES ('shared_folder_id', '');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('theme', 'auto');
  CREATE TABLE IF NOT EXISTS file_owners (
    file_id TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'slave',
    session_timeout_hours INTEGER DEFAULT 24,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS user_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    permission TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, permission)
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`;

let migrated = false;

async function ensureMigrated(db) {
  if (migrated) return;
  const statements = SCHEMA.split(';').map(s => s.trim()).filter(s => s.length > 0);
  for (const sql of statements) {
    await db.prepare(sql).run();
  }
  migrated = true;
}

const app = createApp((env) => env.DB);

// Auto-migrate on first request
app.use('*', async (c, next) => {
  await ensureMigrated(c.env.DB);
  await next();
});

// Fallback: let CF Pages handle static files
app.all('*', (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default {
  fetch: app.fetch,
  async scheduled(event, env, ctx) {
    await ensureMigrated(env.DB);
    ctx.waitUntil(runKeepAlive(env, env.DB));
  }
};
