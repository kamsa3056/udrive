import { api } from '../api.js';
import { showToast } from '../components/toast.js';

export async function renderActivityPage() {
  const main = document.getElementById('main-content');

  // Check if activity is enabled
  try {
    const settings = await api('/api/settings');
    if (settings.activity_enabled === '0') {
      main.innerHTML = `
        <div class="flex flex-col items-center justify-center h-[calc(100vh-8rem)] text-gray-500 dark:text-gray-400">
          <span class="material-icons-outlined text-6xl mb-4">history_toggle_off</span>
          <p class="text-xl font-medium">Activity Log Disabled</p>
          <p class="text-sm mt-2">Enable it in Settings to start tracking user actions.</p>
        </div>
      `;
      return;
    }
  } catch {}

  main.innerHTML = `
    <div class="p-3 md:p-6">
      <div class="sticky top-0 z-10 bg-white dark:bg-gray-900 pb-4">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 class="text-xl md:text-2xl font-semibold">Activity</h2>
          <div class="flex items-center gap-2">
            <select id="filter-user" class="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm">
              <option value="">All Users</option>
            </select>
            <select id="filter-action" class="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm">
              <option value="">All Actions</option>
              <option value="login">Login</option>
              <option value="logout">Logout</option>
              <option value="upload">Upload</option>
              <option value="download">Download</option>
              <option value="delete">Delete</option>
              <option value="rename">Rename</option>
              <option value="create_folder">Create Folder</option>
              <option value="move">Move</option>
              <option value="copy">Copy</option>
              <option value="restore">Restore</option>
              <option value="permanent_delete">Permanent Delete</option>
            </select>
            <button id="btn-clear-activity" class="btn-secondary text-sm">
              <span class="material-icons-outlined text-base">delete_sweep</span>
              <span class="hidden sm:inline">Clear</span>
            </button>
          </div>
        </div>
      </div>
      <div id="activity-list">
        <div class="flex items-center justify-center h-32">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    </div>
  `;

  loadActivity();

  main.querySelector('#filter-user').addEventListener('change', loadActivity);
  main.querySelector('#filter-action').addEventListener('change', loadActivity);

  main.querySelector('#btn-clear-activity').addEventListener('click', async () => {
    if (!confirm('Clear all activity logs?')) return;
    try {
      await api('/api/activity', { method: 'DELETE' });
      showToast('Activity cleared', 'success');
      loadActivity();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

async function loadActivity() {
  const container = document.getElementById('activity-list');
  const filterUser = document.getElementById('filter-user').value;
  const filterAction = document.getElementById('filter-action').value;

  let url = '/api/activity?limit=200';
  if (filterUser) url += `&user=${encodeURIComponent(filterUser)}`;
  if (filterAction) url += `&action=${encodeURIComponent(filterAction)}`;

  try {
    const { results } = await api(url);

    // Populate user filter
    const userSelect = document.getElementById('filter-user');
    if (userSelect.options.length <= 1) {
      const users = [...new Set(results.map(r => r.username).filter(Boolean))];
      users.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u;
        opt.textContent = u;
        if (u === filterUser) opt.selected = true;
        userSelect.appendChild(opt);
      });
    }

    if (results.length === 0) {
      container.innerHTML = `
        <div class="flex flex-col items-center justify-center h-48 text-gray-500 dark:text-gray-400">
          <span class="material-icons-outlined text-5xl mb-3">history</span>
          <p class="text-lg font-medium">No activity</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">
              <th class="pb-3 pt-2">Time</th>
              <th class="pb-3 pt-2">User</th>
              <th class="pb-3 pt-2">Action</th>
              <th class="pb-3 pt-2 hidden md:table-cell">Detail</th>
            </tr>
          </thead>
          <tbody>
            ${results.map(row => `
              <tr class="border-b border-gray-100 dark:border-gray-800">
                <td class="py-2 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">${formatTime(row.created_at)}</td>
                <td class="py-2 text-sm font-medium">${escapeHtml(row.username || '—')}</td>
                <td class="py-2"><span class="px-2 py-0.5 text-xs font-medium rounded-full ${getActionColor(row.action)}">${row.action}</span></td>
                <td class="py-2 text-xs text-gray-500 dark:text-gray-400 truncate max-w-[200px] hidden md:table-cell">${escapeHtml(row.detail || '—')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<p class="text-red-500">${err.message}</p>`;
  }
}

function getActionColor(action) {
  const colors = {
    login: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
    logout: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300',
    upload: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
    download: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
    delete: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
    permanent_delete: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
    rename: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
    create_folder: 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300',
    move: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
    copy: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300',
    restore: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
  };
  return colors[action] || 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300';
}

function formatTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
