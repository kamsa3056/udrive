import { refreshTokenIfNeeded } from './token-manager.js';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

export async function runKeepAlive(env, db) {
  const { results: accounts } = await db.prepare('SELECT * FROM accounts').all();
  const results = [];

  for (const account of accounts) {
    try {
      const refreshed = await refreshTokenIfNeeded(env, db, account);
      const headers = { Authorization: `Bearer ${refreshed.access_token}` };

      const content = `GOOGLE ACTIVITY - Keep Alive\nGenerated at: ${new Date().toISOString()}`;
      const boundary = 'keepalive_boundary';
      const metadata = JSON.stringify({ name: `.udrive_keepalive_${Date.now()}.txt`, parents: ['root'] });
      const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: text/plain\r\n\r\n${content}\r\n--${boundary}--`;

      const uploadRes = await fetch(`${UPLOAD_API}/files?uploadType=multipart&fields=id`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': `multipart/related; boundary=${boundary}` },
        body
      });

      if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`);
      const file = await uploadRes.json();

      await fetch(`${DRIVE_API}/files/${file.id}`, { method: 'DELETE', headers });

      results.push({ email: account.email, success: true });
    } catch (err) {
      results.push({ email: account.email, success: false, error: err.message });
    }
  }

  await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_keepalive', ?)")
    .bind(new Date().toISOString()).run();

  return results;
}
