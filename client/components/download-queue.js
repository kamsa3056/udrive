let queue = [];
let panelEl = null;
let isMinimized = false;

export function downloadBackground(fileId, fileName) {
  const item = {
    id: Date.now() + Math.random(),
    fileId,
    fileName,
    status: 'downloading',
    progress: 0
  };
  queue.push(item);
  renderPanel();
  startDownload(item);
}

async function startDownload(item) {
  try {
    const res = await fetch(`/api/files/${item.fileId}/download`);
    if (!res.ok) throw new Error('Download failed');

    const total = parseInt(res.headers.get('content-length') || '0');
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      item.progress = total > 0 ? Math.round((received / total) * 100) : 0;
      renderPanel();
    }

    const blob = new Blob(chunks);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.fileName;
    a.click();
    URL.revokeObjectURL(url);

    item.status = 'done';
    item.progress = 100;
  } catch (err) {
    item.status = 'failed';
    item.error = err.message;
  }
  renderPanel();
}

export async function downloadViaBrowser(fileId, fileName) {
  try {
    const res = await fetch(`/api/files/${fileId}/download-token`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    if (!res.ok) throw new Error('Failed to generate download link');
    const { token } = await res.json();
    const a = document.createElement('a');
    a.href = `/dlink/${token}`;
    a.download = fileName;
    a.click();
  } catch (err) {
    throw err;
  }
}

function renderPanel() {
  if (queue.length === 0) return;

  if (!panelEl) {
    panelEl = document.createElement('div');
    panelEl.id = 'download-queue-panel';
    panelEl.className = 'fixed bottom-4 left-4 z-40 w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl overflow-hidden flex flex-col';
    document.body.appendChild(panelEl);
  }

  const completedCount = queue.filter(i => i.status === 'done').length;
  const totalCount = queue.length;
  const isAllDone = queue.every(i => i.status === 'done' || i.status === 'failed');

  let headerText = '';
  if (isAllDone) {
    const failedCount = queue.filter(i => i.status === 'failed').length;
    headerText = failedCount > 0
      ? `${completedCount} downloaded, ${failedCount} failed`
      : `${completedCount} download${completedCount > 1 ? 's' : ''} complete`;
  } else {
    headerText = `Downloading ${completedCount + 1} of ${totalCount}`;
  }

  panelEl.innerHTML = `
    <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 cursor-pointer select-none" id="dl-panel-header">
      <span class="text-sm font-medium">${headerText}</span>
      <div class="flex items-center gap-1">
        <button id="dl-panel-toggle" class="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
          <span class="material-icons-outlined text-base">${isMinimized ? 'expand_less' : 'expand_more'}</span>
        </button>
        <button id="dl-panel-close" class="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
          <span class="material-icons-outlined text-base">close</span>
        </button>
      </div>
    </div>
    ${isMinimized ? '' : `
      <div class="max-h-60 overflow-auto">
        ${queue.map(item => renderItem(item)).join('')}
      </div>
    `}
  `;

  panelEl.querySelector('#dl-panel-toggle').addEventListener('click', (e) => {
    e.stopPropagation();
    isMinimized = !isMinimized;
    renderPanel();
  });

  panelEl.querySelector('#dl-panel-header').addEventListener('click', () => {
    isMinimized = !isMinimized;
    renderPanel();
  });

  panelEl.querySelector('#dl-panel-close').addEventListener('click', (e) => {
    e.stopPropagation();
    queue = [];
    panelEl.remove();
    panelEl = null;
  });
}

function renderItem(item) {
  let statusIcon = '';
  let statusColor = '';

  switch (item.status) {
    case 'downloading':
      statusIcon = 'download';
      statusColor = 'text-blue-500';
      break;
    case 'done':
      statusIcon = 'check_circle';
      statusColor = 'text-green-500';
      break;
    case 'failed':
      statusIcon = 'error';
      statusColor = 'text-red-500';
      break;
  }

  const progressHtml = item.status === 'downloading' ? `
    <div class="mt-1 relative h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
      <div class="absolute inset-0 h-full rounded-full bg-blue-500 transition-all duration-200" style="width: ${item.progress}%"></div>
    </div>
  ` : '';

  return `
    <div class="px-4 py-2 flex items-center gap-3 border-b border-gray-100 dark:border-gray-700 last:border-0">
      <span class="material-icons-outlined text-lg ${statusColor}">${statusIcon}</span>
      <div class="flex-1 min-w-0">
        <p class="text-xs font-medium truncate">${escapeHtml(item.fileName)}</p>
        ${progressHtml}
        ${item.status === 'failed' ? `<p class="text-xs text-red-500 mt-0.5">${escapeHtml(item.error)}</p>` : ''}
      </div>
      ${item.status === 'downloading' ? `<span class="text-xs text-gray-400 shrink-0">${item.progress}%</span>` : ''}
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
