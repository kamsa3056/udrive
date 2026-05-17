const API_PERMISSIONS = [
  'api:files:read',
  'api:files:download',
  'api:files:upload',
  'api:files:write',
  'api:files:transfer',
  'api:accounts:read'
];

async function hashKey(key) {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function authenticateApiKey(db, request) {
  const authHeader = request.headers.get('Authorization') || '';
  const key = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!key || !key.startsWith('udrive_')) return null;

  const keyHash = await hashKey(key);
  const apiKey = await db.prepare('SELECT * FROM api_keys WHERE key_hash = ?').bind(keyHash).first();
  if (!apiKey) return null;

  // Check expiry
  if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) return null;

  // Check global API enabled
  const apiEnabled = await db.prepare("SELECT value FROM settings WHERE key = 'api_enabled'").first();
  if (apiEnabled && apiEnabled.value === '0') return null;

  // Update last used
  await db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").bind(apiKey.id).run();

  return {
    id: apiKey.id,
    name: apiKey.name,
    keyHash,
    userId: apiKey.user_id,
    permissions: JSON.parse(apiKey.permissions || '[]'),
    rateLimit: apiKey.rate_limit || 60
  };
}

export async function checkRateLimit(db, keyHash, limit) {
  const now = Math.floor(Date.now() / 60000); // current minute window

  const row = await db.prepare('SELECT request_count FROM api_rate_limits WHERE key_hash = ? AND window_start = ?')
    .bind(keyHash, now).first();

  if (row && row.request_count >= limit) {
    return { allowed: false, remaining: 0, resetIn: 60 - (Math.floor(Date.now() / 1000) % 60) };
  }

  if (row) {
    await db.prepare('UPDATE api_rate_limits SET request_count = request_count + 1 WHERE key_hash = ? AND window_start = ?')
      .bind(keyHash, now).run();
  } else {
    await db.prepare('INSERT INTO api_rate_limits (key_hash, window_start, request_count) VALUES (?, ?, 1)')
      .bind(keyHash, now).run();
    // Clean old windows
    await db.prepare('DELETE FROM api_rate_limits WHERE window_start < ?').bind(now - 5).run();
  }

  const count = row ? row.request_count + 1 : 1;
  return { allowed: true, remaining: limit - count, resetIn: 60 - (Math.floor(Date.now() / 1000) % 60) };
}

export function requireApiPermission(apiKey, perm) {
  if (!apiKey) return { error: 'API key required', status: 401 };
  if (!apiKey.permissions.includes(perm)) return { error: `Permission denied: ${perm}`, status: 403 };
  return null;
}

export async function generateApiKey() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const raw = 'udrive_' + Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
  const keyHash = await hashKey(raw);
  const keyPrefix = raw.slice(0, 15) + '...';
  return { raw, keyHash, keyPrefix };
}

export { API_PERMISSIONS, hashKey };
