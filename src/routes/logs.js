import { Hono } from 'hono';
import { requireAuth, requireMaster } from '../middleware/auth.js';

const logs = new Hono();

logs.get('/', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requireMaster(c, user);
  if (err) return err;

  const db = c.get('db');
  const limit = parseInt(c.req.query('limit') || '100');
  const offset = parseInt(c.req.query('offset') || '0');
  const filterLevel = c.req.query('level') || '';

  let sql = 'SELECT * FROM system_log WHERE 1=1';
  const params = [];

  if (filterLevel) {
    sql += ' AND level = ?';
    params.push(filterLevel);
  }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await db.prepare(sql).bind(...params).all();
  const total = await db.prepare('SELECT COUNT(*) as count FROM system_log').first();

  return c.json({ results, total: total.count });
});

logs.delete('/', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requireMaster(c, user);
  if (err) return err;

  const db = c.get('db');
  await db.prepare('DELETE FROM system_log').run();
  return c.json({ success: true });
});

export default logs;
