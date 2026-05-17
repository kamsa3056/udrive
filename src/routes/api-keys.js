import { Hono } from 'hono';
import { requireAuth, requireMaster } from '../middleware/auth.js';
import { generateApiKey, API_PERMISSIONS } from '../middleware/api-auth.js';

const apiKeys = new Hono();

apiKeys.get('/', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requireMaster(c, user);
  if (err) return err;

  const db = c.get('db');
  const { results } = await db.prepare('SELECT id, name, key_prefix, user_id, permissions, rate_limit, expires_at, last_used_at, created_at FROM api_keys ORDER BY created_at DESC').all();
  return c.json(results.map(r => ({ ...r, permissions: JSON.parse(r.permissions || '[]') })));
});

apiKeys.post('/', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requireMaster(c, user);
  if (err) return err;

  const db = c.get('db');
  const { name, permissions, rate_limit, expires_at, user_id } = await c.req.json();
  if (!name) return c.json({ error: 'Name required' }, 400);

  const validPerms = (permissions || []).filter(p => API_PERMISSIONS.includes(p));
  const { raw, keyHash, keyPrefix } = await generateApiKey();

  await db.prepare('INSERT INTO api_keys (name, key_hash, key_prefix, user_id, permissions, rate_limit, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(name, keyHash, keyPrefix, user_id || null, JSON.stringify(validPerms), rate_limit || 60, expires_at || null).run();

  return c.json({ success: true, key: raw, prefix: keyPrefix });
});

apiKeys.patch('/:id', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requireMaster(c, user);
  if (err) return err;

  const db = c.get('db');
  const id = c.req.param('id');
  const body = await c.req.json();

  const existing = await db.prepare('SELECT * FROM api_keys WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ error: 'API key not found' }, 404);

  const name = body.name || existing.name;
  const permissions = body.permissions ? JSON.stringify(body.permissions.filter(p => API_PERMISSIONS.includes(p))) : existing.permissions;
  const rate_limit = body.rate_limit || existing.rate_limit;
  const expires_at = body.expires_at !== undefined ? body.expires_at : existing.expires_at;

  await db.prepare('UPDATE api_keys SET name = ?, permissions = ?, rate_limit = ?, expires_at = ? WHERE id = ?')
    .bind(name, permissions, rate_limit, expires_at, id).run();

  return c.json({ success: true });
});

apiKeys.delete('/:id', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requireMaster(c, user);
  if (err) return err;

  const db = c.get('db');
  const id = c.req.param('id');
  await db.prepare('DELETE FROM api_keys WHERE id = ?').bind(id).run();
  await db.prepare("DELETE FROM api_rate_limits WHERE key_hash IN (SELECT key_hash FROM api_keys WHERE id = ?)").bind(id).run();
  return c.json({ success: true });
});

apiKeys.get('/settings', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requireMaster(c, user);
  if (err) return err;

  const db = c.get('db');
  const keys = ['api_enabled', 'api_default_rate_limit', 'api_cors_origins', 'api_max_upload_size'];
  const settings = {};
  for (const key of keys) {
    const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
    settings[key] = row?.value || null;
  }
  return c.json(settings);
});

apiKeys.put('/settings', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requireMaster(c, user);
  if (err) return err;

  const db = c.get('db');
  const body = await c.req.json();
  const allowed = ['api_enabled', 'api_default_rate_limit', 'api_cors_origins', 'api_max_upload_size'];

  for (const [key, value] of Object.entries(body)) {
    if (allowed.includes(key)) {
      await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(key, String(value)).run();
    }
  }

  return c.json({ success: true });
});

apiKeys.get('/permissions', async (c) => {
  return c.json(API_PERMISSIONS);
});

export default apiKeys;
