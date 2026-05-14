import { Hono } from 'hono';
import { authenticate } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import accountRoutes from './routes/accounts.js';
import fileRoutes from './routes/files.js';
import settingsRoutes from './routes/settings.js';
import userRoutes from './routes/users.js';
import activityRoutes from './routes/activity.js';
import logsRoutes from './routes/logs.js';

export function createApp(getDB, envVars = null) {
  const app = new Hono();

  // Inject DB and env into context
  app.use('*', async (c, next) => {
    if (envVars) {
      c.env = { ...c.env, ...envVars };
    }
    const db = getDB(c.env);
    c.set('db', db);
    await next();
  });

  // Auth middleware for API routes
  app.use('/api/*', async (c, next) => {
    const db = c.get('db');
    const user = await authenticate(db, c.req.raw);
    c.set('user', user);
    await next();
  });

  app.use('/auth/*', async (c, next) => {
    const db = c.get('db');
    const user = await authenticate(db, c.req.raw);
    c.set('user', user);
    await next();
  });

  // Routes
  app.route('/auth', authRoutes);
  app.route('/api/users', userRoutes);
  app.route('/api/accounts', accountRoutes);
  app.route('/api/files', fileRoutes);
  app.route('/api/settings', settingsRoutes);
  app.route('/api/activity', activityRoutes);
  app.route('/api/logs', logsRoutes);

  return app;
}
