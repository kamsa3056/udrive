import { Hono } from 'hono';
import { requireAuth, requireMaster, requirePermission } from '../middleware/auth.js';
import { runKeepAlive } from '../services/keep-alive.js';
import { logActivity } from '../services/logger.js';

const settings = new Hono();

const EXPORT_TABLES = ['accounts', 'settings', 'file_owners', 'users', 'user_permissions'];

settings.get('/', async (c) => {
  const user = c.get('user');
  const err = requireAuth(c, user);
  if (err) return err;

  const db = c.get("db");
  const { results } = await db.prepare('SELECT * FROM settings').all();
  const obj = {};
  for (const row of results) obj[row.key] = row.value;
  return c.json(obj);
});

settings.put('/', async (c) => {
  const user = c.get('user');
  const err = requireAuth(c, user);
  if (err) return err;

  const db = c.get("db");
  const body = await c.req.json();
  for (const [key, value] of Object.entries(body)) {
    await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(key, String(value)).run();
  }
  return c.json({ success: true });
});

settings.post('/keepalive', async (c) => {
  const user = c.get('user');
  const err = requireAuth(c, user);
  if (err) return err;

  const results = await runKeepAlive(c.env, c.get("db"));
  return c.json({ success: true, results });
});

settings.get('/export-db', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requireMaster(c, user);
  if (err) return err;

  const db = c.get("db");
  const tablesParam = c.req.query('tables');
  const tables = tablesParam ? tablesParam.split(',') : EXPORT_TABLES;
  const dump = {};

  for (const table of tables) {
    if (!EXPORT_TABLES.includes(table)) continue;
    const { results } = await db.prepare(`SELECT * FROM ${table}`).all();
    if (table === 'users') {
      dump[table] = results.filter(r => r.role !== 'master');
    } else {
      dump[table] = results;
    }
  }

  return c.json(dump);
});

settings.post('/import-db', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requireMaster(c, user);
  if (err) return err;

  const db = c.get("db");
  const { tables: selectedTables, data: dump } = await c.req.json();
  const tables = selectedTables || Object.keys(dump);

  for (const table of tables) {
    if (!EXPORT_TABLES.includes(table)) continue;
    if (!dump[table] || !Array.isArray(dump[table])) continue;

    if (table === 'users') {
      await db.prepare(`DELETE FROM ${table} WHERE role != 'master'`).run();
      for (const row of dump[table]) {
        if (row.role === 'master') continue;
        const keys = Object.keys(row);
        const placeholders = keys.map(() => '?').join(', ');
        const values = keys.map(k => row[k]);
        await db.prepare(`INSERT OR REPLACE INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`).bind(...values).run();
      }
    } else {
      await db.prepare(`DELETE FROM ${table}`).run();
      for (const row of dump[table]) {
        const keys = Object.keys(row);
        const placeholders = keys.map(() => '?').join(', ');
        const values = keys.map(k => row[k]);
        await db.prepare(`INSERT OR REPLACE INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`).bind(...values).run();
      }
    }
  }

  return c.json({ success: true });
});

export default settings;
