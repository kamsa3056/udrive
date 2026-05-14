import { Hono } from 'hono';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { selectAccount } from '../services/account-selector.js';
import { logActivity } from '../services/logger.js';
import * as drive from '../services/google-drive.js';

const files = new Hono();

async function getSharedFolderId(db) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'shared_folder_id'").first();
  return row?.value || null;
}

async function getPrimaryAccountId(db) {
  const row = await db.prepare('SELECT id FROM accounts WHERE is_primary = 1').first();
  return row?.id || null;
}

files.get('/trash/list', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'trash:view');
  if (err) return err;

  const db = c.get("db");
  const { results: accounts } = await db.prepare('SELECT id, email, display_name FROM accounts').all();
  const allTrash = [];

  for (const acc of accounts) {
    try {
      const trashed = await drive.listTrash(c.env, db, acc.id);
      for (const file of trashed) {
        allTrash.push({ ...file, ownerEmail: acc.email, ownerName: acc.display_name, accountId: acc.id });
      }
    } catch {}
  }

  allTrash.sort((a, b) => new Date(b.trashedTime || 0) - new Date(a.trashedTime || 0));
  return c.json(allTrash);
});

files.get('/', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'drive:view');
  if (err) return err;

  const db = c.get("db");
  const folderId = c.req.query('folderId') || await getSharedFolderId(db);
  if (!folderId) return c.json({ error: 'No shared folder configured' }, 400);

  const accountId = await getPrimaryAccountId(db);
  if (!accountId) return c.json({ error: 'No primary account set' }, 400);

  const result = await drive.listFiles(c.env, db, accountId, folderId);
  return c.json(result);
});

files.post('/upload', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'drive:upload');
  if (err) return err;

  const db = c.get("db");
  const formData = await c.req.formData();
  const file = formData.get('file');
  const folderId = formData.get('folderId') || await getSharedFolderId(db);
  if (!file) return c.json({ error: 'No file provided' }, 400);
  if (!folderId) return c.json({ error: 'No shared folder configured' }, 400);

  const buffer = await file.arrayBuffer();
  const account = await selectAccount(db, buffer.byteLength);
  if (!account) return c.json({ error: 'Insufficient storage across all accounts' }, 507);

  const result = await drive.uploadFile(c.env, db, account.id, folderId, buffer, { name: file.name, type: file.type });

  await db.prepare("UPDATE accounts SET storage_used = storage_used + ?, updated_at = datetime('now') WHERE id = ?")
    .bind(buffer.byteLength, account.id).run();
  await db.prepare('INSERT OR REPLACE INTO file_owners (file_id, account_id) VALUES (?, ?)')
    .bind(result.id, account.id).run();

  await logActivity(db, user.id, user.username, 'upload', `${file.name} (${account.email})`);
  return c.json(result);
});

files.get('/:fileId/info', async (c) => {
  const user = c.get('user');
  const err = requireAuth(c, user);
  if (err) return err;

  const db = c.get("db");
  const fileId = c.req.param('fileId');
  const primaryId = await getPrimaryAccountId(db);
  if (!primaryId) return c.json({ error: 'No primary account set' }, 400);

  const fileInfo = await drive.getFileInfo(c.env, db, primaryId, fileId);

  let uploaderEmail = null;
  let uploaderName = null;

  const owner = await db.prepare('SELECT account_id FROM file_owners WHERE file_id = ?').bind(fileId).first();
  if (owner) {
    const acc = await db.prepare('SELECT email, display_name FROM accounts WHERE id = ?').bind(owner.account_id).first();
    if (acc) { uploaderEmail = acc.email; uploaderName = acc.display_name; }
  } else {
    const ownerEmail = await drive.getFileOwnerEmail(c.env, db, primaryId, fileId);
    if (ownerEmail) {
      uploaderEmail = ownerEmail;
      const acc = await db.prepare('SELECT display_name FROM accounts WHERE email = ?').bind(ownerEmail).first();
      if (acc) uploaderName = acc.display_name;
    }
  }

  return c.json({ ...fileInfo, uploaderEmail, uploaderName });
});

files.get('/:fileId/download', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'drive:download');
  if (err) return err;

  const db = c.get("db");
  const fileId = c.req.param('fileId');
  const accountId = await getPrimaryAccountId(db);
  if (!accountId) return c.json({ error: 'No primary account set' }, 400);

  const { metadata, body } = await drive.downloadFile(c.env, db, accountId, fileId);

  await logActivity(db, user.id, user.username, 'download', metadata.name);
  return new Response(body, {
    headers: {
      'Content-Type': metadata.mimeType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(metadata.name)}"`,
      ...(metadata.size ? { 'Content-Length': metadata.size } : {})
    }
  });
});

files.get('/:fileId/thumbnail', async (c) => {
  const user = c.get('user');
  const err = requireAuth(c, user);
  if (err) return err;

  const db = c.get("db");
  const fileId = c.req.param('fileId');
  const size = parseInt(c.req.query('size') || '200');
  const accountId = await getPrimaryAccountId(db);
  if (!accountId) return c.json({ error: 'No primary account set' }, 400);

  const result = await drive.getThumbnail(c.env, db, accountId, fileId, size);
  if (!result) return c.json({ error: 'No thumbnail available' }, 404);

  return new Response(result.body, {
    headers: {
      'Content-Type': result.contentType || 'image/png',
      'Cache-Control': 'public, max-age=3600',
      ...(result.contentLength ? { 'Content-Length': result.contentLength } : {})
    }
  });
});

files.get('/:fileId/preview', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'drive:preview');
  if (err) return err;

  const db = c.get("db");
  const fileId = c.req.param('fileId');
  const accountId = await getPrimaryAccountId(db);
  if (!accountId) return c.json({ error: 'No primary account set' }, 400);

  const rangeHeader = c.req.header('Range');

  if (rangeHeader) {
    const { metadata, body } = await drive.downloadFileRange(c.env, db, accountId, fileId, rangeHeader);
    const totalSize = parseInt(metadata.size);
    const parts = rangeHeader.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0]);
    const end = parts[1] ? parseInt(parts[1]) : totalSize - 1;
    const chunkSize = end - start + 1;

    return new Response(body, {
      status: 206,
      headers: {
        'Content-Type': metadata.mimeType || 'application/octet-stream',
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(chunkSize),
        'Content-Disposition': `inline; filename="${encodeURIComponent(metadata.name)}"`
      }
    });
  }

  const { metadata, body } = await drive.downloadFile(c.env, db, accountId, fileId);
  return new Response(body, {
    headers: {
      'Content-Type': metadata.mimeType || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${encodeURIComponent(metadata.name)}"`,
      'Accept-Ranges': 'bytes',
      ...(metadata.size ? { 'Content-Length': metadata.size } : {})
    }
  });
});

files.post('/folder', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'drive:create_folder');
  if (err) return err;

  const db = c.get("db");
  const { name, parentId } = await c.req.json();
  const folderId = parentId || await getSharedFolderId(db);
  if (!folderId) return c.json({ error: 'No shared folder configured' }, 400);

  const accountId = await getPrimaryAccountId(db);
  if (!accountId) return c.json({ error: 'No primary account set' }, 400);

  const result = await drive.createFolder(c.env, db, accountId, folderId, name);
  await logActivity(db, user.id, user.username, 'create_folder', name);
  return c.json(result);
});

files.patch('/:fileId', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'drive:rename');
  if (err) return err;

  const db = c.get("db");
  const fileId = c.req.param('fileId');
  const { name } = await c.req.json();
  const accountId = await getPrimaryAccountId(db);
  if (!accountId) return c.json({ error: 'No primary account set' }, 400);

  const result = await drive.renameFile(c.env, db, accountId, fileId, name);
  await logActivity(db, user.id, user.username, 'rename', name);
  return c.json(result);
});

files.delete('/:fileId', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'drive:delete');
  if (err) return err;

  const db = c.get("db");
  const fileId = c.req.param('fileId');

  let accountId;
  const owner = await db.prepare('SELECT account_id FROM file_owners WHERE file_id = ?').bind(fileId).first();

  if (owner) {
    accountId = owner.account_id;
  } else {
    const primaryId = await getPrimaryAccountId(db);
    if (!primaryId) return c.json({ error: 'No primary account set' }, 400);

    const ownerEmail = await drive.getFileOwnerEmail(c.env, db, primaryId, fileId);
    if (ownerEmail) {
      const matchedAccount = await db.prepare('SELECT id FROM accounts WHERE email = ?').bind(ownerEmail).first();
      if (matchedAccount) {
        accountId = matchedAccount.id;
        await db.prepare('INSERT OR REPLACE INTO file_owners (file_id, account_id) VALUES (?, ?)').bind(fileId, accountId).run();
      }
    }
    if (!accountId) accountId = primaryId;
  }

  await drive.deleteFile(c.env, db, accountId, fileId);
  await db.prepare('DELETE FROM file_owners WHERE file_id = ?').bind(fileId).run();
  await logActivity(db, user.id, user.username, 'delete', fileId);
  return c.json({ success: true });
});

files.post('/:fileId/move', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'drive:move');
  if (err) return err;

  const db = c.get("db");
  const fileId = c.req.param('fileId');
  const { newParentId, oldParentId } = await c.req.json();
  const accountId = await getPrimaryAccountId(db);
  if (!accountId) return c.json({ error: 'No primary account set' }, 400);

  const result = await drive.moveFile(c.env, db, accountId, fileId, newParentId, oldParentId);
  await logActivity(db, user.id, user.username, 'move', fileId);
  return c.json(result);
});

files.post('/:fileId/copy', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'drive:copy');
  if (err) return err;

  const db = c.get("db");
  const fileId = c.req.param('fileId');
  const { destinationId } = await c.req.json();
  const accountId = await getPrimaryAccountId(db);
  if (!accountId) return c.json({ error: 'No primary account set' }, 400);

  const result = await drive.copyFile(c.env, db, accountId, fileId, destinationId);
  await logActivity(db, user.id, user.username, 'copy', fileId);
  return c.json(result);
});

files.post('/:fileId/restore', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'trash:restore');
  if (err) return err;

  const db = c.get("db");
  const fileId = c.req.param('fileId');
  const { accountId } = await c.req.json();
  if (!accountId) return c.json({ error: 'No accountId provided' }, 400);

  await drive.restoreFile(c.env, db, accountId, fileId);
  await logActivity(db, user.id, user.username, 'restore', fileId);
  return c.json({ success: true });
});

files.post('/:fileId/permanent-delete', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'trash:permanent_delete');
  if (err) return err;

  const db = c.get("db");
  const fileId = c.req.param('fileId');
  const { accountId } = await c.req.json();
  if (!accountId) return c.json({ error: 'No accountId provided' }, 400);

  await drive.permanentDeleteFile(c.env, db, accountId, fileId);
  await logActivity(db, user.id, user.username, 'permanent_delete', fileId);
  return c.json({ success: true });
});

export default files;
