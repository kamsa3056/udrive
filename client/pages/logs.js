import { api } from '../api.js';
import { showToast } from '../components/toast.js';

export async function renderLogsPage() {
  const main = document.getElementById('main-content');

  // Check if logs are enabled
  try {
    const settings = await api('/api/settings');
    if (settings.logs_enabled === '0') {
      main.innerHTML = `
        <div class="flex flex-col items-center justify-center h-[calc(100vh-8rem)] text-gray-500 dark:text-gray-400">
          <span class="material-icons-outlined text-6xl mb-4">block</span>
          <p class="text-xl font-medium">System Logs Disabled</p>
          <p class="text-sm mt-2">Enable it in Settings to start tracking system events.</p>
        </div>
      `;
      return;
    }
  } catch {}

  main.innerHTML = `
    <div class="p-3 md:p-6">
      <div class="sticky top-0 z-10 bg-white dark:bg-gray-900 pb-4">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 class="text-xl md:text-2xl font-semibold">System Logs</h2>
          <div class="flex items-center gap-2">
            <select id="filter-level" class="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm">
              <option value="">All Levels</option>
              <option value="info">Info</option>
              <option value="warn">Warning</option>
              <option value="error">Error</option>
            </select>
            <button id="btn-clear-logs" class="btn-secondary text-sm">
              <span class="material-icons-outlined text-base">delete_sweep</span>
              <span class="hidden sm:inline">Clear</span>
            </button>
          </div>
        </div>
      </div>
      <div id="logs-list">
        <div class="flex items-center justify-center h-32">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    </div>
  `;

  loadLogs();

  main.querySelector('#filter-level').addEventListener('change', loadLogs);

  main.querySelector('#btn-clear-logs').addEventListener('click', async () => {
    if (!confirm('Clear all system logs?')) return;
    try {
      await api('/api/logs', { method: 'DELETE' });
      showToast('Logs cleared', 'success');
      loadLogs();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

async function loadLogs() {
  const container = document.getElementById('logs-list');
  const filterLevel = document.getElementById('filter-level').value;

  let url = '/api/logs?limit=200';
  if (filterLevel) url += `&level=${encodeURIComponent(filterLevel)}`;

  try {
    const { results } = await api(url);

    if (results.length === 0) {
      container.innerHTML = `
        <div class="flex flex-col items-center justify-center h-48 text-gray-500 dark:text-gray-400">
          <span class="material-icons-outlined text-5xl mb-3">terminal</span>
          <p class="text-lg font-medium">No logs</p>
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
              <th class="pb-3 pt-2">Level</th>
              <th class="pb-3 pt-2">Message</th>
              <th class="pb-3 pt-2 hidden md:table-cell">Detail</th>
            </tr>
          </thead>
          <tbody>
            ${results.map(row => `
              <tr class="border-b border-gray-100 dark:border-gray-800">
                <td class="py-2 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">${formatTime(row.created_at)}</td>
                <td class="py-2"><span class="px-2 py-0.5 text-xs font-medium rounded-full ${getLevelColor(row.level)}">${row.level}</span></td>
                <td class="py-2 text-sm">${escapeHtml(row.message)}</td>
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

function getLevelColor(level) {
  const colors = {
    info: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
    warn: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
    error: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
  };
  return colors[level] || colors.info;
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
