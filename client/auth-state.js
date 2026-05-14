let currentUser = null;

const PERMISSION_GROUPS = {
  drive: ['drive:view', 'drive:upload', 'drive:download', 'drive:delete', 'drive:rename', 'drive:create_folder', 'drive:move', 'drive:copy', 'drive:preview', 'drive:view_uploader'],
  trash: ['trash:view', 'trash:restore', 'trash:permanent_delete', 'trash:empty'],
  accounts: ['accounts:view', 'accounts:add', 'accounts:remove', 'accounts:set_primary', 'accounts:refresh', 'accounts:import_export', 'accounts:color'],
  settings: ['settings:view', 'settings:edit', 'settings:keepalive', 'settings:database']
};

export function setCurrentUser(user) {
  currentUser = user;
}

export function getCurrentUser() {
  return currentUser;
}

export function hasPermission(perm) {
  if (!currentUser) return false;
  if (currentUser.role === 'master') return true;
  return currentUser.permissions.includes(perm);
}

export function hasPageAccess(page) {
  if (!currentUser) return false;
  if (currentUser.role === 'master') return true;
  const group = PERMISSION_GROUPS[page];
  if (!group) return false;
  return group.some(p => currentUser.permissions.includes(p));
}

export { PERMISSION_GROUPS };
