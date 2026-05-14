export async function logActivity(db, userId, username, action, detail = null) {
  const setting = await db.prepare("SELECT value FROM settings WHERE key = 'activity_enabled'").first();
  if (setting && setting.value === '0') return;

  await db.prepare('INSERT INTO activity_log (user_id, username, action, detail) VALUES (?, ?, ?, ?)')
    .bind(userId, username, action, detail).run();
}

export async function logSystem(db, level, message, detail = null) {
  const setting = await db.prepare("SELECT value FROM settings WHERE key = 'logs_enabled'").first();
  if (setting && setting.value === '0') return;

  await db.prepare('INSERT INTO system_log (level, message, detail) VALUES (?, ?, ?)')
    .bind(level, message, detail).run();
}
