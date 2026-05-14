import { Hono } from 'hono';
import { requireAuth, requireMaster } from '../middleware/auth.js';

const activity = new Hono();

activity.get('/', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requireMaster(c, user);
  if (err) return err;

  const db = c.get('db');
  const limit = parseInt(c.req.query('limit') || '100');
  const offset = parseInt(c.req.query('offset') || '0');
  const filterUser = c.req.query('user') || '';
  const filterAction = c.req.query('action') || '';

  let sql = 'SELECT * FROM activity_log WHERE 1=1';
  const params = [];

  if (filterUser) {
    sql += ' AND username = ?';
    params.push(filterUser);
  }
  if (filterAction) {
    sql += ' AND action = ?';
    params.push(filterAction);
  }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await db.prepare(sql).bind(...params).all();
  const total = await db.prepare('SELECT COUNT(*) as count FROM activity_log').first();

  return c.json({ results, total: total.count });
});

activity.delete('/', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requireMaster(c, user);
  if (err) return err;

  const db = c.get('db');
  await db.prepare('DELETE FROM activity_log').run();
  return c.json({ success: true });
});

export default activity;
