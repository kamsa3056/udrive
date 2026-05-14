export async function refreshTokenIfNeeded(env, db, account) {
  if (Date.now() < account.token_expiry - 60000) return account;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: account.refresh_token,
      grant_type: 'refresh_token'
    })
  });

  if (!res.ok) throw new Error('Token refresh failed');

  const tokens = await res.json();
  const newExpiry = Date.now() + (tokens.expires_in * 1000);

  await db.prepare("UPDATE accounts SET access_token = ?, token_expiry = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(tokens.access_token, newExpiry, account.id).run();

  return { ...account, access_token: tokens.access_token, token_expiry: newExpiry };
}
