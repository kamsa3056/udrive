export async function selectAccount(db, fileSize) {
  const { results } = await db.prepare(
    'SELECT * FROM accounts WHERE is_primary = 0 ORDER BY (storage_limit - storage_used) DESC'
  ).all();

  for (const account of results) {
    const available = account.storage_limit - account.storage_used;
    if (available >= fileSize) {
      return account;
    }
  }

  return null;
}
