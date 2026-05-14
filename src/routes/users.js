import { Hono } from 'hono';
import { hashPassword, verifyPassword } from '../services/password.js';
import { requireAuth, requireMaster, createSession, deleteSession, ALL_PERMISSIONS, PERMISSION_GROUPS } from '../middleware/auth.js';
import { logActivity } from '../services/logger.js';

const users = new Hono();

users.get('/check', async (c) => {
  const db = c.get("db");
  const row = await db.prepare('SELECT COUNT(*) as count FROM users').first();
  return c.json({ initialized: row.count > 0 });
});

users.post('/setup', async (c) => {
  const db = c.get("db");
  const row = await db.prepare('SELECT COUNT(*) as count FROM users').first();
  if (row.count > 0) return c.json({ error: 'Setup already completed' }, 400);

  const { username, password } = await c.req.json();
  if (!username || !password) return c.json({ error: 'Username and password required' }, 400);
  if (password.length < 4) return c.json({ error: 'Password must be at least 4 characters' }, 400);

  const hash = await hashPassword(password);
  await db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').bind(username, hash, 'master').run();
  return c.json({ success: true });
});

users.post('/login', async (c) => {
  const db = c.get("db");
  const { username, password } = await c.req.json();
  if (!username || !password) return c.json({ error: 'Username and password required' }, 400);

  const user = await db.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
  if (!user) return c.json({ error: 'Invalid credentials' }, 401);

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return c.json({ error: 'Invalid credentials' }, 401);

  const session = await createSession(db, user.id);

  await logActivity(db, user.id, user.username, 'login', null);
  c.header('Set-Cookie', `udrive_session=${session.token}; HttpOnly; SameSite=Lax; Path=/; Expires=${new Date(session.expiresAt).toUTCString()}`);
  return c.json({ success: true, role: user.role });
});

users.post('/logout', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Not logged in' }, 401);

  const db = c.get("db");
  await logActivity(db, user.id, user.username, 'logout', null);

  const cookie = c.req.header('Cookie') || '';
  const match = cookie.match(/udrive_session=([^;]+)/);
  if (match) await deleteSession(c.get("db"), match[1]);

  c.header('Set-Cookie', 'udrive_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  return c.json({ success: true });
});

users.get('/me', async (c) => {
  const user = c.get('user');
  const err = requireAuth(c, user);
  if (err) return err;
  return c.json({ id: user.id, username: user.username, role: user.role, permissions: user.permissions });
});

users.get('/', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requireMaster(c, user);
  if (err) return err;

  const db = c.get("db");
  const { results } = await db.prepare('SELECT id, username, role, session_timeout_hours, created_at FROM users ORDER BY role DESC, created_at ASC').all();

  for (const u of results) {
    if (u.role === 'master') {
      u.permissions = ALL_PERMISSIONS;
    } else {
      const { results: perms } = await db.prepare('SELECT permission FROM user_permissions WHERE user_id = ?').bind(u.id).all();
      u.permissions = perms.map(r => r.permission);
    }
  }

  return c.json(results);
});

users.post('/', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requireMaster(c, user);
  if (err) return err;

  const db = c.get("db");
  const { username, password, permissions } = await c.req.json();
  if (!username || !password) return c.json({ error: 'Username and password required' }, 400);
  if (password.length < 4) return c.json({ error: 'Password must be at least 4 characters' }, 400);

  const existing = await db.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (existing) return c.json({ error: 'Username already exists' }, 409);

  const hash = await hashPassword(password);
  const result = await db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').bind(username, hash, 'slave').run();
  const newId = result.meta.last_row_id;

  if (permissions && Array.isArray(permissions)) {
    for (const perm of permissions) {
      if (ALL_PERMISSIONS.includes(perm)) {
        await db.prepare('INSERT OR IGNORE INTO user_permissions (user_id, permission) VALUES (?, ?)').bind(newId, perm).run();
      }
    }
  }

  return c.json({ success: true, id: newId });
});

users.delete('/:id', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requireMaster(c, user);
  if (err) return err;

  const db = c.get("db");
  const id = c.req.param('id');
  const target = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (!target) return c.json({ error: 'User not found' }, 404);
  if (target.role === 'master') return c.json({ error: 'Cannot delete master account' }, 400);

  await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
  return c.json({ success: true });
});

users.get('/:id/permissions', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requireMaster(c, user);
  if (err) return err;

  const db = c.get("db");
  const id = c.req.param('id');
  const { results } = await db.prepare('SELECT permission FROM user_permissions WHERE user_id = ?').bind(id).all();
  return c.json(results.map(r => r.permission));
});

users.put('/:id/permissions', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requireMaster(c, user);
  if (err) return err;

  const db = c.get("db");
  const id = c.req.param('id');
  const { permissions } = await c.req.json();
  if (!Array.isArray(permissions)) return c.json({ error: 'Permissions must be an array' }, 400);

  const target = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (!target) return c.json({ error: 'User not found' }, 404);
  if (target.role === 'master') return c.json({ error: 'Cannot modify master permissions' }, 400);

  await db.prepare('DELETE FROM user_permissions WHERE user_id = ?').bind(id).run();
  for (const perm of permissions) {
    if (ALL_PERMISSIONS.includes(perm)) {
      await db.prepare('INSERT INTO user_permissions (user_id, permission) VALUES (?, ?)').bind(id, perm).run();
    }
  }

  return c.json({ success: true });
});

users.patch('/:id/timeout', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requireMaster(c, user);
  if (err) return err;

  const db = c.get("db");
  const id = c.req.param('id');
  const { hours } = await c.req.json();
  if (!hours || hours < 1) return c.json({ error: 'Timeout must be at least 1 hour' }, 400);

  await db.prepare('UPDATE users SET session_timeout_hours = ? WHERE id = ?').bind(hours, id).run();
  return c.json({ success: true });
});

users.patch('/:id/password', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requireMaster(c, user);
  if (err) return err;

  const db = c.get("db");
  const id = c.req.param('id');
  const { password } = await c.req.json();
  if (!password || password.length < 4) return c.json({ error: 'Password must be at least 4 characters' }, 400);

  const hash = await hashPassword(password);
  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(hash, id).run();
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
  return c.json({ success: true });
});

export default users;
