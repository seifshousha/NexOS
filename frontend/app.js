/**
 * VirtOS Desktop — app.js
 * =====================
 * Modular Vanilla JS OS desktop. Sections:
 *   1. API Client        — fetch() wrappers for all backend endpoints
 *   2. Notification      — toast system (top-right, auto-dismiss)
 *   3. WindowManager     — open/close/drag/resize/minimize/maximize + z-order
 *   4. Taskbar           — clock, window buttons, tray stats
 *   5. Desktop           — icons, persistence (localStorage)
 *   6. Apps              — Terminal, FileManager, ProcessManager, Monitor, SysInfo
 *   7. Boot              — initialise everything
 */

'use strict';

// ══════════════════════════════════════════════════════════════════════
// 1. API CLIENT
// ══════════════════════════════════════════════════════════════════════

// API_BASE is empty — same origin as the page (FastAPI serves both UI and API).
// Change to 'http://other-host:8000' only if you split servers again.
const API_BASE = '';


// ══════════════════════════════════════════════════════════════════════
// 1b. CENTRALIZED ICON SYSTEM
// ══════════════════════════════════════════════════════════════════════
// Single source of truth for all app icons across the entire UI:
// desktop, start menu, taskbar, window titlebar.
// CSS controls sizing per context (.window-icon, .taskbar-btn-icon, etc.)
// ──────────────────────────────────────────────────────────────────────

const PyOSIcons = (() => {
  const BASE = '/static/assets/icons/';
  /**
   * Build an <img> tag for an icon. The class `pyos-icon` lets CSS
   * resize it per-container without touching HTML attributes.
   * @param {string} name  — SVG filename without extension
   * @returns {string}     — HTML string ready for innerHTML
   */
  function mk(name) {
    return `<img class="pyos-icon" src="${BASE}${name}.svg" alt="${name}" draggable="false">`;
  }
  return {
    terminal  : mk('terminal'),
    files     : mk('files'),
    processes : mk('processes'),
    monitor   : mk('monitor'),
    sysinfo   : mk('sysinfo'),
    calculator: mk('calculator'),
    logs      : mk('logs'),
    settings  : mk('settings'),
    file      : mk('file'),      // generic file viewer
    folder    : mk('folder'),    // desktop user folder
  };
})();

const API = {
  async _req(method, path, body = null) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${API_BASE}${path}`, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
  },

  // Filesystem
  ls      : (path = '/')         => API._req('GET',    `/api/fs/ls?path=${encodeURIComponent(path)}`),
  read    : (path)               => API._req('GET',    `/api/fs/read?path=${encodeURIComponent(path)}`),
  stat    : (path)               => API._req('GET',    `/api/fs/stat?path=${encodeURIComponent(path)}`),
  mkdir   : (path)               => API._req('POST',   '/api/fs/mkdir',  { path }),
  touch   : (path, content = '') => API._req('POST',   '/api/fs/touch',  { path, content }),
  write   : (path, content)      => API._req('POST',   '/api/fs/write',  { path, content }),
  delete  : (path, recursive)    => API._req('DELETE', '/api/fs/delete', { path, recursive }),
  rename  : (path, new_name)     => API._req('POST',   '/api/fs/rename', { path, new_name }),
  move    : (src, dest_dir)      => API._req('POST',   '/api/fs/move',   { src, dest_dir }),

  // Terminal
  execute : (command)            => API._req('POST',   '/api/terminal/execute', { command }),
  prompt  : ()                   => API._req('GET',    '/api/terminal/prompt'),
  history : ()                   => API._req('GET',    '/api/terminal/history'),

  // Processes
  processes: ()                  => API._req('GET',    '/api/system/processes'),
  kill     : (pid)               => API._req('DELETE', `/api/system/processes/${pid}`),
  spawn    : (name, user = 'user')=> API._req('POST',  '/api/system/processes/spawn', { name, user }),

  // System
  sysinfo : ()                   => API._req('GET',    '/api/system/info'),
  uptime  : ()                   => API._req('GET',    '/api/system/uptime'),
  status  : ()                   => API._req('GET',    '/api/system/status'),
};


// ══════════════════════════════════════════════════════════════════════
// 2. NOTIFICATION SYSTEM
// ══════════════════════════════════════════════════════════════════════

const Notify = (() => {
  const container = document.getElementById('notification-container');

  const ICONS = {
    info   : 'ℹ️',
    success: '✅',
    error  : '❌',
    warning: '⚠️',
  };

  /**
   * Show a toast notification.
   * @param {string} title
   * @param {string} message
   * @param {'info'|'success'|'error'|'warning'} type
   * @param {number} duration  ms before auto-dismiss (0 = sticky)
   */
  function show(title, message = '', type = 'info', duration = 3500) {
    const el = document.createElement('div');
    el.className = `notification ${type}`;
    el.style.position = 'relative';
    el.innerHTML = `
      <span class="notif-icon">${ICONS[type]}</span>
      <div class="notif-body">
        <div class="notif-title">${title}</div>
        ${message ? `<div class="notif-msg">${message}</div>` : ''}
      </div>
    `;

    // Progress bar
    if (duration > 0) {
      const bar = document.createElement('div');
      bar.className = 'notif-progress';
      bar.style.width = '100%';
      el.appendChild(bar);
      // Animate shrink
      requestAnimationFrame(() => {
        bar.style.transition = `width ${duration}ms linear`;
        bar.style.width = '0%';
      });
    }

    // Click to dismiss
    el.addEventListener('click', () => dismiss(el));

    container.appendChild(el);

    if (duration > 0) {
      setTimeout(() => dismiss(el), duration);
    }
    return el;
  }

  function dismiss(el) {
    if (!el.isConnected) return;
    el.classList.add('closing');
    setTimeout(() => el.remove(), 300);
  }

  return { show, dismiss };
})();


// ══════════════════════════════════════════════════════════════════════
// 3. WINDOW MANAGER
// ══════════════════════════════════════════════════════════════════════

const WM = (() => {
  const layer       = document.getElementById('window-layer');
  const template    = document.getElementById('window-template');
  let   nextZIndex  = 100;
  let   nextWid     = 1;
  const windows     = {};   // wid → { el, meta }

  /** Open a new window.
   * @param {object} opts
   *   title, icon, width, height, x, y,
   *   onMount: (bodyEl) => void   — app renders into bodyEl
   */
  function open(opts) {
    const wid   = nextWid++;
    const w     = opts.width  || 680;
    const h     = opts.height || 460;
    const x     = opts.x      || 60 + (wid % 8) * 30;
    const y     = opts.y      || 40 + (wid % 6) * 25;

    // Clone template
    const frag  = template.content.cloneNode(true);
    const el    = frag.querySelector('.window');

    el.dataset.wid = wid;
    el.style.cssText = `left:${x}px; top:${y}px; width:${w}px; height:${h}px;`;

    // Populate title bar
    el.querySelector('.window-icon').innerHTML  = opts.icon || PyOSIcons.file;
    el.querySelector('.window-title').textContent = opts.title || 'Window';

    // Control buttons
    el.querySelector('.win-close').addEventListener('click',    () => close(wid));
    el.querySelector('.win-minimize').addEventListener('click', () => minimize(wid));
    el.querySelector('.win-maximize').addEventListener('click', () => maximize(wid));

    // Resize handle
    const rh = document.createElement('div');
    rh.className = 'window-resize';
    el.appendChild(rh);

    // Focus on click
    el.addEventListener('mousedown', () => focus(wid), true);

    layer.appendChild(el);

    const record = {
      el,
      title    : opts.title || 'Window',
      icon     : opts.icon  || '🖥',
      minimized: false,
      maximized: false,
      prevGeom : null,
      appKey   : opts.appKey || null,
    };
    windows[wid] = record;

    // Mount app
    const body = el.querySelector('.window-body');
    if (opts.onMount) opts.onMount(body);

    // Drag
    _initDrag(el, wid);

    // Resize
    _initResize(rh, el, wid);

    // Focus
    focus(wid);

    // Taskbar
    Taskbar.addWindow(wid, opts.icon, opts.title);

    // Persist
    _saveState();

    return wid;
  }

  function close(wid) {
    const rec = windows[wid];
    if (!rec) return;

    // Animate out
    rec.el.style.transition = 'transform 0.15s ease, opacity 0.15s ease';
    rec.el.style.transform  = 'scale(0.9)';
    rec.el.style.opacity    = '0';
    setTimeout(() => {
      rec.el.remove();
      delete windows[wid];
      Taskbar.removeWindow(wid);
      _saveState();
    }, 150);
  }

  function minimize(wid) {
    const rec = windows[wid];
    if (!rec) return;
    rec.minimized = !rec.minimized;
    rec.el.classList.toggle('minimized', rec.minimized);
    Taskbar.setMinimized(wid, rec.minimized);
    _saveState();
  }

  function maximize(wid) {
    const rec = windows[wid];
    if (!rec) return;
    if (!rec.maximized) {
      rec.prevGeom = {
        left  : rec.el.style.left,
        top   : rec.el.style.top,
        width : rec.el.style.width,
        height: rec.el.style.height,
      };
      rec.el.classList.add('maximized');
      rec.maximized = true;
    } else {
      rec.el.classList.remove('maximized');
      if (rec.prevGeom) {
        Object.assign(rec.el.style, rec.prevGeom);
      }
      rec.maximized = false;
    }
    _saveState();
  }

  function focus(wid) {
    const rec = windows[wid];
    if (!rec) return;

    // Unfocus all
    Object.values(windows).forEach(r => r.el.classList.remove('focused'));

    rec.el.style.zIndex = ++nextZIndex;
    rec.el.classList.add('focused');

    // Un-minimize on focus click
    if (rec.minimized) {
      rec.minimized = false;
      rec.el.classList.remove('minimized');
      Taskbar.setMinimized(wid, false);
    }

    Taskbar.setFocused(wid);
  }

  function getAll() { return windows; }

  // ── Drag ──────────────────────────────────────────────────────────

  function _initDrag(el, wid) {
    const titlebar = el.querySelector('.window-titlebar');
    let ox = 0, oy = 0;

    titlebar.addEventListener('mousedown', (e) => {
      if (e.target.closest('.window-controls')) return;
      if (windows[wid]?.maximized) return;

      const rect = el.getBoundingClientRect();
      ox = e.clientX - rect.left;
      oy = e.clientY - rect.top;
      titlebar.classList.add('dragging');

      const onMove = (e) => {
        const nx = Math.max(0, e.clientX - ox);
        const ny = Math.max(0, e.clientY - oy);
        el.style.left = nx + 'px';
        el.style.top  = ny + 'px';
      };
      const onUp = () => {
        titlebar.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
        _saveState();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    });
  }

  // ── Resize ────────────────────────────────────────────────────────

  function _initResize(handle, el, wid) {
    handle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      const startW = el.offsetWidth;
      const startH = el.offsetHeight;
      const startX = e.clientX;
      const startY = e.clientY;

      const onMove = (e) => {
        el.style.width  = Math.max(320, startW + e.clientX - startX) + 'px';
        el.style.height = Math.max(200, startH + e.clientY - startY) + 'px';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
        _saveState();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    });
  }

  // ── Persistence ───────────────────────────────────────────────────

  const STORE_KEY = 'pyos_windows';

  function _saveState() {
    const state = Object.entries(windows).map(([wid, rec]) => ({
      wid      : Number(wid),
      appKey   : rec.appKey,
      title    : rec.title,
      icon     : rec.icon,
      minimized: rec.minimized,
      maximized: rec.maximized,
      left     : rec.el.style.left,
      top      : rec.el.style.top,
      width    : rec.el.style.width,
      height   : rec.el.style.height,
    }));
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch(e) {}
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch(e) { return []; }
  }

  return { open, close, minimize, maximize, focus, getAll, loadState };
})();


// ══════════════════════════════════════════════════════════════════════
// 4. TASKBAR
// ══════════════════════════════════════════════════════════════════════

const Taskbar = (() => {
  const winArea    = document.getElementById('taskbar-windows');
  const clockEl    = document.getElementById('taskbar-clock');
  const cpuEl      = document.getElementById('tray-cpu');
  const memEl      = document.getElementById('tray-mem');
  const btns       = {};

  // Clock
  function _tick() {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString('en-US', {
      hour12: false, hour:'2-digit', minute:'2-digit', second:'2-digit'
    }) + '  ' + now.toLocaleDateString('en-US', {
      weekday:'short', month:'short', day:'numeric'
    });
  }
  setInterval(_tick, 1000);
  _tick();

  // Tray stats (update every 3s from /system/info)
  async function _refreshTray() {
    try {
      const d = await API.sysinfo();
      cpuEl.textContent = `CPU ${d.cpu.percent}%`;
      memEl.textContent = `MEM ${d.memory.percent}%`;
    } catch(e) {}
  }
  setInterval(_refreshTray, 3000);
  _refreshTray();

  function addWindow(wid, icon, title) {
    const btn = document.createElement('button');
    btn.className   = 'taskbar-btn';
    btn.dataset.wid = wid;
    btn.innerHTML   = `<span class="taskbar-btn-icon">${icon}</span>
                       <span>${title.slice(0, 16)}</span>`;
    btn.addEventListener('click', () => WM.focus(wid));
    winArea.appendChild(btn);
    btns[wid] = btn;
  }

  function removeWindow(wid) {
    btns[wid]?.remove();
    delete btns[wid];
  }

  function setFocused(wid) {
    Object.values(btns).forEach(b => b.classList.remove('focused'));
    btns[wid]?.classList.add('focused');
  }

  function setMinimized(wid, on) {
    btns[wid]?.classList.toggle('minimized', on);
  }

  return { addWindow, removeWindow, setFocused, setMinimized };
})();

// ══════════════════════════════════════════════════════════════════════
// 5. APPS
// ══════════════════════════════════════════════════════════════════════

// ── 5.1  TERMINAL APP ──────────────────────────────────────────────────

const TerminalApp = {
  mount(container) {
    container.innerHTML = `
      <div class="terminal-app">
        <div class="terminal-output" id="term-out-${Date.now()}"></div>
        <div class="terminal-input-row">
          <span class="terminal-prompt-label" id="term-prompt-${Date.now()}">user@pyos:~$&nbsp;</span>
          <input type="text" class="terminal-input" spellcheck="false" autocomplete="off"
                 placeholder="type a command…">
        </div>
      </div>`;

    const app       = container.querySelector('.terminal-app');
    const out       = app.querySelector('.terminal-output');
    const promptLbl = app.querySelector('.terminal-prompt-label');
    const input     = app.querySelector('.terminal-input');
    let   histIdx   = -1;
    let   cmdHistory= [];

    function write(text, cls = 'term-stdout') {
      if (!text) return;
      text.split('\n').forEach(line => {
        const d = document.createElement('div');
        d.className = `term-line ${cls}`;
        d.textContent = line;
        out.appendChild(d);
      });
      out.scrollTop = out.scrollHeight;
    }

    function banner() {
      write('VirtOS Terminal  — type \'help\' for commands', 'term-banner');
      write('─'.repeat(44), 'term-banner');
    }
    banner();

    async function updatePrompt() {
      try {
        const d = await API.prompt();
        promptLbl.textContent = d.prompt + '\u00A0';
      } catch(e) {}
    }

    async function runCommand(raw) {
      raw = raw.trim();
      if (!raw) return;

      cmdHistory.unshift(raw);
      histIdx = -1;
      write(`${promptLbl.textContent.trim()} ${raw}`, 'term-prompt');

      try {
        const res = await API.execute(raw);

        if (res.clear) {
          out.innerHTML = '';
          banner();
        } else {
          if (res.stdout) write(res.stdout, 'term-stdout');
          if (res.stderr) write(res.stderr, 'term-stderr');
        }

        // Handle GUI actions from backend (e.g. nano → open editor)
        if (res.action) {
          const act = res.action;
          if (act.type === 'open_editor') {
            setTimeout(() => {
              if (typeof window.TextEditorApp !== 'undefined') {
                window.TextEditorApp.open(act.path);
              } else {
                write(`[editor] TextEditorApp not ready`, 'term-stderr');
              }
            }, 100);
          }
        }

        await updatePrompt();

        // Notifications for file ops
        const cmd = raw.split(' ')[0];
        if (['mkdir','touch','rm','mv','rename','write','nano'].includes(cmd)) {
          const nmap = {
            mkdir:  ['success', 'Directory created'],
            touch:  ['success', 'File created'],
            rm:     ['warning', 'Item deleted'],
            mv:     ['info',    'Item moved'],
            rename: ['info',    'Item renamed'],
            write:  ['success', 'File written'],
            nano:   ['info',    'Opened in editor'],
          };
          const entry = nmap[cmd];
          if (entry) {
            const [type, title] = entry;
            if (res.ok) Notify.show(title, raw.split(' ').slice(1).join(' '), type, 2000);
            else        Notify.show('Command failed', res.stderr, 'error', 3500);
          }
        }
      } catch(err) {
        write(`Error: ${err.message}`, 'term-stderr');
        Notify.show('Terminal error', err.message, 'error');
      }
    }

    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        const v = input.value;
        input.value = '';
        await runCommand(v);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (histIdx < cmdHistory.length - 1) histIdx++;
        input.value = cmdHistory[histIdx] || '';
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (histIdx > 0) histIdx--;
        else { histIdx = -1; input.value = ''; return; }
        input.value = cmdHistory[histIdx] || '';
      } else if (e.key === 'l' && e.ctrlKey) {
        e.preventDefault();
        out.innerHTML = '';
        banner();
      }
    });

    // Focus input when clicking anywhere in terminal
    app.addEventListener('click', () => input.focus());
    updatePrompt();
    setTimeout(() => input.focus(), 50);
  }
};


// ── 5.2  FILE MANAGER APP ──────────────────────────────────────────────

const FileManagerApp = {
  mount(container, startPath) {
    let cwd      = startPath || '/home/user';
    let history  = [];
    let selected = null;

    container.innerHTML = `
      <div class="filemanager-app">
        <div class="fm-toolbar">
          <button class="fm-btn" id="fm-back">← Back</button>
          <button class="fm-btn" id="fm-up">↑ Up</button>
          <input  class="fm-path" id="fm-path" value="${cwd}" spellcheck="false">
          <button class="fm-btn" id="fm-refresh">↻</button>
          <button class="fm-btn" id="fm-mkdir">+ Folder</button>
          <button class="fm-btn" id="fm-touch">+ File</button>
        </div>
        <div class="fm-list" id="fm-list"></div>
        <div class="fm-statusbar" id="fm-status">Loading…</div>
      </div>`;

    const app     = container.querySelector('.filemanager-app');
    const listEl  = app.querySelector('#fm-list');
    const statusEl= app.querySelector('#fm-status');
    const pathEl  = app.querySelector('#fm-path');

    async function refresh() {
      listEl.innerHTML = '<div style="padding:20px;color:var(--text-muted)">Loading…</div>';
      try {
        const { entries } = await API.ls(cwd);
        listEl.innerHTML = '';
        pathEl.value = cwd;
        selected = null;

        // Parent row
        if (cwd !== '/') {
          listEl.appendChild(_makeRow({ name:'..', type:'dir' }, true));
        }

        entries.forEach(e => listEl.appendChild(_makeRow(e)));
        statusEl.textContent = `${entries.length} item(s)  ·  ${cwd}`;
      } catch(err) {
        listEl.innerHTML = `<div style="padding:20px;color:var(--accent-red)">Error: ${err.message}</div>`;
        Notify.show('File Manager error', err.message, 'error');
      }
    }

    function _makeRow(entry, isParent = false) {
      const isDir  = entry.type === 'dir';
      const icon   = isDir ? '📂' : _fileIcon(entry.name);
      const sizeStr= isDir ? '—' : (entry.size != null ? _fmtSize(entry.size) : '');

      const row = document.createElement('div');
      row.className = `fm-item ${isDir ? 'dir' : 'file'}`;
      row.dataset.name = entry.name;
      row.dataset.type = entry.type;
      row.innerHTML = `
        <div class="fm-item-icon">${icon}</div>
        <div class="fm-item-name">${entry.name}</div>
        <div class="fm-item-type">${isParent ? '' : entry.type}</div>
        <div class="fm-item-size">${sizeStr}</div>`;

      // Single click = select
      row.addEventListener('click', (e) => {
        listEl.querySelectorAll('.fm-item').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');
        selected = entry.name;
        if (!isDir) statusEl.textContent = `Selected: ${entry.name}  ${sizeStr}`;
      });

      // Double click = navigate or view
      row.addEventListener('dblclick', async () => {
        if (isParent) { goUp(); return; }
        if (isDir) {
          history.push(cwd);
          cwd = (cwd === '/' ? '' : cwd) + '/' + entry.name;
          await refresh();
        } else {
          await viewFile(entry.name);
        }
      });

      // Right click = context menu
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e, entry);
      });

      return row;
    }

    function goUp() {
      if (cwd === '/') return;
      history.push(cwd);
      cwd = parentOf(cwd);
      refresh();
    }

    function parentOf(p) {
      const parts = p.split('/');
      parts.pop();
      return parts.join('/') || '/';
    }

    // Toolbar buttons
    app.querySelector('#fm-back').addEventListener('click', () => {
      if (history.length) { cwd = history.pop(); refresh(); }
    });
    app.querySelector('#fm-up').addEventListener('click', goUp);
    app.querySelector('#fm-refresh').addEventListener('click', refresh);
    pathEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { cwd = pathEl.value.trim() || '/'; refresh(); }
    });

    app.querySelector('#fm-mkdir').addEventListener('click', async () => {
      const name = prompt('New folder name:');
      if (!name) return;
      try {
        await API.mkdir(`${cwd}/${name}`);
        Notify.show('Folder created', name, 'success', 2500);
        refresh();
      } catch(err) { Notify.show('Create failed', err.message, 'error'); }
    });

    app.querySelector('#fm-touch').addEventListener('click', async () => {
      const name = prompt('New file name:');
      if (!name) return;
      try {
        await API.touch(`${cwd}/${name}`);
        Notify.show('File created', name, 'success', 2500);
        refresh();
      } catch(err) { Notify.show('Create failed', err.message, 'error'); }
    });

    // Context menu
    function showContextMenu(e, entry) {
      document.querySelectorAll('.context-menu').forEach(el => el.remove());
      const menu = document.createElement('div');
      menu.className = 'context-menu';

      const items = entry.type === 'file'
        ? [
            { label: '👁  View',   action: () => viewFile(entry.name) },
            { label: '✏️  Rename', action: () => renameItem(entry) },
            null,
            { label: '🗑  Delete', action: () => deleteItem(entry), cls: 'danger' },
          ]
        : [
            { label: '📂  Open',   action: () => { history.push(cwd); cwd += '/' + entry.name; refresh(); } },
            { label: '✏️  Rename', action: () => renameItem(entry) },
            null,
            { label: '🗑  Delete', action: () => deleteItem(entry), cls: 'danger' },
          ];

      items.forEach(item => {
        if (!item) { const sep = document.createElement('div'); sep.className = 'ctx-separator'; menu.appendChild(sep); return; }
        const el = document.createElement('div');
        el.className = `ctx-item ${item.cls || ''}`;
        el.textContent = item.label;
        el.addEventListener('click', () => { item.action(); menu.remove(); });
        menu.appendChild(el);
      });

      menu.style.left = e.clientX + 'px';
      menu.style.top  = e.clientY + 'px';
      document.body.appendChild(menu);
      setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
    }

    async function viewFile(name) {
      try {
        const { content } = await API.read(`${cwd}/${name}`);
        WM.open({
          title: name, icon: PyOSIcons.file,
          width: 500, height: 380,
          onMount(body) {
            body.innerHTML = `<div style="padding:12px;height:100%;overflow:auto;background:#0d1117">
              <pre style="font-family:var(--font-mono);font-size:12px;color:#c9d1d9;
                          white-space:pre-wrap;word-break:break-word">${_esc(content || '(empty file)')}</pre>
            </div>`;
          }
        });
      } catch(err) { Notify.show('Read error', err.message, 'error'); }
    }

    async function renameItem(entry) {
      const newName = prompt(`Rename "${entry.name}" to:`, entry.name);
      if (!newName || newName === entry.name) return;
      try {
        await API.rename(`${cwd}/${entry.name}`, newName);
        Notify.show('Renamed', `${entry.name} → ${newName}`, 'info', 2500);
        refresh();
      } catch(err) { Notify.show('Rename failed', err.message, 'error'); }
    }

    async function deleteItem(entry) {
      if (!confirm(`Delete "${entry.name}"?`)) return;
      try {
        await API.delete(`${cwd}/${entry.name}`, entry.type === 'dir');
        Notify.show('Deleted', entry.name, 'warning', 2500);
        refresh();
      } catch(err) { Notify.show('Delete failed', err.message, 'error'); }
    }

    refresh();

    function _esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function _fmtSize(b) { return b > 1024 ? (b/1024).toFixed(1)+'KB' : b+'B'; }
    function _fileIcon(n) {
      const ext = n.split('.').pop().toLowerCase();
      return { py:'🐍', js:'📜', html:'🌐', css:'🎨', json:'📋', md:'📝',
               txt:'📄', log:'📋', sh:'⚡', png:'🖼', jpg:'🖼', gif:'🖼' }[ext] || '📄';
    }
  }
};

// ── 5.3  PROCESS MANAGER APP ──────────────────────────────────────────

const ProcessManagerApp = {
  mount(container) {
    let sortCol    = 'cpu';
    let sortAsc    = false;
    let filterText = '';
    let refreshTimer;
    let lastData   = [];

    container.innerHTML = `
      <div class="procmanager-app">
        <div class="pm-toolbar">
          <input class="pm-search" id="pm-search" placeholder="🔍 Filter processes…">
          <button class="fm-btn" id="pm-spawn">+ Spawn</button>
          <button class="fm-btn" id="pm-refresh-btn">↻ Refresh</button>
        </div>
        <div class="pm-table-wrap">
          <table class="pm-table">
            <thead>
              <tr>
                <th data-col="pid"    class="pm-pid">PID</th>
                <th data-col="name"   class="pm-name">Name</th>
                <th data-col="user"   class="pm-user">User</th>
                <th data-col="cpu"    class="pm-cpu">CPU%</th>
                <th data-col="memory" class="pm-mem">MEM</th>
                <th data-col="state"  class="pm-state">State</th>
                <th data-col="uptime" class="pm-uptime">Uptime</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody id="pm-tbody"></tbody>
          </table>
        </div>
        <div class="pm-stats-bar">
          <span class="pm-stat">Processes: <b id="pm-count">—</b></span>
          <span class="pm-stat">Running: <b id="pm-running">—</b></span>
          <span class="pm-stat">CPU: <b id="pm-cpu-total">—</b></span>
          <span class="pm-stat">Memory: <b id="pm-mem-total">—</b></span>
        </div>
      </div>`;

    const app    = container.querySelector('.procmanager-app');
    const tbody  = app.querySelector('#pm-tbody');
    const search = app.querySelector('#pm-search');

    // Sort headers
    app.querySelectorAll('th[data-col]').forEach(th => {
      th.addEventListener('click', () => {
        if (sortCol === th.dataset.col) sortAsc = !sortAsc;
        else { sortCol = th.dataset.col; sortAsc = false; }
        render(lastData);
      });
    });

    search.addEventListener('input', () => {
      filterText = search.value.toLowerCase();
      render(lastData);
    });

    app.querySelector('#pm-spawn').addEventListener('click', async () => {
      const name = prompt('Process name:');
      if (!name) return;
      try {
        const { process: p } = await API.spawn(name);
        Notify.show('Process spawned', `${p.name} [PID ${p.pid}]`, 'success', 2500);
        await loadData();
      } catch(err) { Notify.show('Spawn failed', err.message, 'error'); }
    });

    app.querySelector('#pm-refresh-btn').addEventListener('click', loadData);

    async function loadData() {
      try {
        const data = await API.processes();
        lastData = data.processes;
        render(lastData);

        // Stats bar
        app.querySelector('#pm-count').textContent   = data.cpu.process_count;
        app.querySelector('#pm-running').textContent = data.cpu.running;
        app.querySelector('#pm-cpu-total').textContent = data.cpu.percent + '%';
        app.querySelector('#pm-mem-total').textContent =
          `${data.memory.used_mb}/${data.memory.total_mb} MB (${data.memory.percent}%)`;
      } catch(err) {
        tbody.innerHTML = `<tr><td colspan="8" style="padding:20px;color:var(--accent-red)">
          Cannot connect to API: ${err.message}</td></tr>`;
      }
    }

    function render(procs) {
      let filtered = procs;
      if (filterText) {
        filtered = procs.filter(p =>
          p.name.toLowerCase().includes(filterText) ||
          String(p.pid).includes(filterText) ||
          p.user.toLowerCase().includes(filterText)
        );
      }

      filtered = [...filtered].sort((a, b) => {
        let va = a[sortCol] ?? 0, vb = b[sortCol] ?? 0;
        if (typeof va === 'string') va = va.toLowerCase();
        if (typeof vb === 'string') vb = vb.toLowerCase();
        return sortAsc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
      });

      tbody.innerHTML = '';
      filtered.forEach(p => {
        const tr = document.createElement('tr');
        const cpuW = Math.min(100, p.cpu).toFixed(0);
        const uptimeStr = _fmtUptime(p.uptime);
        const isProtected = p.pid <= 2;

        tr.innerHTML = `
          <td class="pm-pid mono">${p.pid}</td>
          <td class="pm-name">${p.name}</td>
          <td class="pm-user muted">${p.user}</td>
          <td class="pm-cpu">
            ${p.cpu.toFixed(1)}%
            <span class="cpu-bar"><span class="cpu-bar-fill" style="width:${cpuW}%"></span></span>
          </td>
          <td class="pm-mem">${p.memory} MB</td>
          <td class="pm-state"><span class="pm-state-badge state-${p.state}">${p.state}</span></td>
          <td class="pm-uptime muted">${uptimeStr}</td>
          <td>
            ${isProtected ? '<span style="font-size:10px;color:var(--text-muted)">protected</span>'
                          : `<button class="pm-kill-btn" data-pid="${p.pid}">Kill</button>`}
          </td>`;

        // Kill button
        const killBtn = tr.querySelector('.pm-kill-btn');
        if (killBtn) {
          killBtn.addEventListener('click', async () => {
            const pid = Number(killBtn.dataset.pid);
            if (!confirm(`Kill process ${p.name} [PID ${pid}]?`)) return;
            try {
              await API.kill(pid);
              Notify.show('Process killed', `${p.name} [PID ${pid}]`, 'warning', 2500);
              await loadData();
            } catch(err) { Notify.show('Kill failed', err.message, 'error'); }
          });
        }
        tbody.appendChild(tr);
      });

      if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="8" style="padding:20px;color:var(--text-muted);text-align:center">
          No matching processes</td></tr>`;
      }
    }

    function _fmtUptime(secs) {
      if (secs < 60)   return secs + 's';
      if (secs < 3600) return Math.floor(secs/60) + 'm';
      return Math.floor(secs/3600) + 'h ' + Math.floor((secs%3600)/60) + 'm';
    }

    // Auto-refresh every 2.5s
    loadData();
    refreshTimer = setInterval(loadData, 2500);

    // Cleanup on close
    const obs = new MutationObserver(() => {
      if (!container.isConnected) { clearInterval(refreshTimer); obs.disconnect(); }
    });
    obs.observe(container, { childList: true });
  }
};


// ── 5.4  SYSTEM MONITOR APP ───────────────────────────────────────────

const SystemMonitorApp = {
  mount(container) {
    let cpuHistory  = new Array(20).fill(0);
    let memHistory  = new Array(20).fill(0);
    let timer;

    container.innerHTML = `
      <div class="monitor-app">
        <div class="monitor-grid">
          <div class="metric-card">
            <div class="metric-label">CPU Usage</div>
            <div class="metric-value" id="mon-cpu-val">—</div>
            <div class="metric-sub"  id="mon-cpu-sub">— processes running</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Memory</div>
            <div class="metric-value" id="mon-mem-val">—</div>
            <div class="metric-sub"  id="mon-mem-sub">— / — MB</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Uptime</div>
            <div class="metric-value" id="mon-uptime" style="font-size:18px">—</div>
            <div class="metric-sub"  id="mon-boot">booted —</div>
          </div>
        </div>

        <div class="chart-card">
          <div class="chart-card-title">CPU Usage (last 20 readings)</div>
          <canvas class="mini-chart" id="mon-cpu-chart"></canvas>
        </div>

        <div class="chart-card">
          <div class="chart-card-title">Memory Usage (last 20 readings)</div>
          <canvas class="mini-chart" id="mon-mem-chart"></canvas>
        </div>

        <div class="chart-card">
          <div class="chart-card-title">Resource Overview</div>
          <div style="display:flex;flex-direction:column;gap:10px;margin-top:6px">
            <div>
              <div style="display:flex;justify-content:space-between;margin-bottom:4px">
                <span style="font-size:12px;color:var(--text-secondary)">CPU</span>
                <span style="font-size:12px;font-family:var(--font-mono)" id="mon-bar-cpu-lbl">0%</span>
              </div>
              <div class="progress-bar"><div class="progress-fill fill-cpu" id="mon-bar-cpu" style="width:0%"></div></div>
            </div>
            <div>
              <div style="display:flex;justify-content:space-between;margin-bottom:4px">
                <span style="font-size:12px;color:var(--text-secondary)">Memory</span>
                <span style="font-size:12px;font-family:var(--font-mono)" id="mon-bar-mem-lbl">0%</span>
              </div>
              <div class="progress-bar"><div class="progress-fill fill-mem" id="mon-bar-mem" style="width:0%"></div></div>
            </div>
          </div>
        </div>
      </div>`;

    const cpuCanvas = container.querySelector('#mon-cpu-chart');
    const memCanvas = container.querySelector('#mon-mem-chart');

    function drawChart(canvas, data, color) {
      const ctx  = canvas.getContext('2d');
      const W    = canvas.width  = canvas.offsetWidth  || 400;
      const H    = canvas.height = canvas.offsetHeight || 70;
      const max  = Math.max(100, ...data);
      const step = W / (data.length - 1);

      ctx.clearRect(0, 0, W, H);

      // Grid lines
      ctx.strokeStyle = '#30363d';
      ctx.lineWidth   = 0.5;
      [25, 50, 75].forEach(pct => {
        const y = H - (pct / max * H);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      });

      // Fill
      ctx.beginPath();
      ctx.moveTo(0, H);
      data.forEach((v, i) => ctx.lineTo(i * step, H - (v / max * H)));
      ctx.lineTo((data.length - 1) * step, H);
      ctx.closePath();
      ctx.fillStyle = color + '33';
      ctx.fill();

      // Line
      ctx.beginPath();
      data.forEach((v, i) => {
        const x = i * step, y = H - (v / max * H);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth   = 2;
      ctx.stroke();
    }

    async function refresh() {
      try {
        const data = await API.sysinfo();

        // Update history
        cpuHistory.push(data.cpu.percent);
        memHistory.push(data.memory.percent);
        if (cpuHistory.length > 20) cpuHistory.shift();
        if (memHistory.length > 20) memHistory.shift();

        // Metric cards
        container.querySelector('#mon-cpu-val').textContent = data.cpu.percent + '%';
        container.querySelector('#mon-cpu-sub').textContent = `${data.cpu.running} running, ${data.cpu.sleeping} sleeping`;
        container.querySelector('#mon-mem-val').textContent = data.memory.percent + '%';
        container.querySelector('#mon-mem-sub').textContent = `${data.memory.used_mb} / ${data.memory.total_mb} MB`;
        container.querySelector('#mon-uptime').textContent  = data.uptime;

        // Progress bars
        container.querySelector('#mon-bar-cpu').style.width   = data.cpu.percent + '%';
        container.querySelector('#mon-bar-cpu-lbl').textContent= data.cpu.percent + '%';
        container.querySelector('#mon-bar-mem').style.width   = data.memory.percent + '%';
        container.querySelector('#mon-bar-mem-lbl').textContent= data.memory.percent + '%';

        // Charts
        drawChart(cpuCanvas, cpuHistory, '#388bfd');
        drawChart(memCanvas, memHistory, '#3fb950');
      } catch(err) {
        console.warn('Monitor fetch error:', err);
      }
    }

    // Load uptime once
    API.uptime().then(d => {
      const el = container.querySelector('#mon-boot');
      if (el && d.boot_time) el.textContent = 'booted ' + d.boot_time;
    }).catch(() => {});

    refresh();
    timer = setInterval(refresh, 2000);

    const obs = new MutationObserver(() => {
      if (!container.isConnected) { clearInterval(timer); obs.disconnect(); }
    });
    obs.observe(container, { childList: true });
  }
};


// ── 5.5  SYSTEM INFO APP ──────────────────────────────────────────────

const SystemInfoApp = {
  async mount(container) {
    container.innerHTML = `<div class="sysinfo-app">
      <div class="sysinfo-header">
        <div class="sysinfo-logo">🖥️</div>
        <div>
          <div class="sysinfo-title">VirtOS</div>
          <div class="sysinfo-sub" id="si-version">Loading…</div>
        </div>
      </div>
      <table class="sysinfo-table" id="si-table">
        <tr><td>Status</td><td><span class="success">● Running</span></td></tr>
      </table>
    </div>`;

    try {
      const [info, up] = await Promise.all([API.sysinfo(), API.uptime()]);
      container.querySelector('#si-version').textContent = info.version;
      container.querySelector('#si-table').innerHTML = `
        <tr><td>Version</td><td>${info.version}</td></tr>
        <tr><td>Status</td><td><span class="success">● Running</span></td></tr>
        <tr><td>Uptime</td><td>${up.formatted}</td></tr>
        <tr><td>Boot Time</td><td>${up.boot_time}</td></tr>
        <tr><td>CPU Usage</td><td>${info.cpu.percent}%</td></tr>
        <tr><td>Processes</td><td>${info.cpu.process_count} (${info.cpu.running} running)</td></tr>
        <tr><td>Memory Used</td><td>${info.memory.used_mb} MB / ${info.memory.total_mb} MB</td></tr>
        <tr><td>Memory Free</td><td>${info.memory.free_mb} MB</td></tr>
        <tr><td>FS Storage</td><td>${info.fs_path}</td></tr>
        <tr><td>Shell</td><td>/bin/pysh</td></tr>
        <tr><td>User</td><td>user@virtos</td></tr>`;
    } catch(err) {
      container.querySelector('#si-table').innerHTML =
        `<tr><td colspan="2" class="danger">Cannot connect: ${err.message}</td></tr>`;
    }
  }
};

// ══════════════════════════════════════════════════════════════════════
// 6. DESKTOP — icons, persistence, app launcher
// ══════════════════════════════════════════════════════════════════════

const Desktop = (() => {

  // App registry — maps appKey → { title, icon, width, height, mount }
  const APPS = {
    terminal  : { title: 'Terminal',        icon: PyOSIcons.terminal,   w: 680, h: 460, mount: (b) => TerminalApp.mount(b) },
    files     : { title: 'File Manager',    icon: PyOSIcons.files,      w: 660, h: 440, mount: (b) => FileManagerApp.mount(b) },
    processes : { title: 'Process Manager', icon: PyOSIcons.processes,  w: 740, h: 480, mount: (b) => ProcessManagerApp.mount(b) },
    monitor   : { title: 'System Monitor',  icon: PyOSIcons.monitor,    w: 600, h: 520, mount: (b) => SystemMonitorApp.mount(b) },
    sysinfo   : { title: 'System Info',     icon: PyOSIcons.sysinfo,    w: 420, h: 380, mount: (b) => SystemInfoApp.mount(b) },
    calculator: { title: 'Calculator',      icon: PyOSIcons.calculator, w: 320, h: 420, mount: (b) => { if(typeof CalculatorApp!=='undefined') CalculatorApp.mount(b); } },
    logs      : { title: 'Log Viewer',      icon: PyOSIcons.logs,       w: 700, h: 420, mount: (b) => { if(typeof LogViewerApp!=='undefined') LogViewerApp.mount(b); } },
    settings  : { title: 'Settings',        icon: PyOSIcons.settings,   w: 600, h: 440, mount: (b) => { if(typeof SettingsApp!=='undefined') SettingsApp.mount(b); } },
  };

  let _initialized = false;

  function launch(appKey, opts = {}) {
    const app = APPS[appKey];
    if (!app) { Notify.show('Unknown app', appKey, 'error'); return; }

    // Single-instance: if already open, focus it instead of duplicating
    const existing = Object.entries(WM.getAll()).find(([, r]) => r.appKey === appKey);
    if (existing) {
      WM.focus(Number(existing[0]));
      return Number(existing[0]);
    }

    const wid = WM.open({
      title  : app.title,
      icon   : app.icon,
      width  : opts.w || app.w,
      height : opts.h || app.h,
      x      : opts.x,
      y      : opts.y,
      appKey,
      onMount: app.mount,
    });
    return wid;
  }

  function init() {
    if (_initialized) return;   // guard: never run twice
    _initialized = true;

    // Bind desktop icons — use named handler so no duplicates possible
    document.querySelectorAll('.desktop-icon').forEach(icon => {
      icon.addEventListener('dblclick', () => launch(icon.dataset.app));
      icon.addEventListener('click', () => {
        document.querySelectorAll('.desktop-icon').forEach(i => i.style.outline = '');
        icon.style.outline = '1px solid rgba(56,139,253,0.5)';
      });
    });

    // Restore persisted windows
    _restore();

    // Check API connectivity
    _checkAPI();
  }

  async function _checkAPI() {
    try {
      await API.status();
      Notify.show('VirtOS Ready', 'All systems operational', 'success', 2500);
    } catch(err) {
      Notify.show('API Offline', 'Start the server: python run_server.py', 'error', 0);
    }
  }

  function _restore() {
    // Always clear stale window state — we never restore across page loads
    // (Restoring creates ghost windows with mounted apps that have lost their
    //  internal state, causing confusing duplicates and broken UIs.)
    try { localStorage.removeItem('pyos_windows'); } catch(e) {}

    // Open terminal by default on every fresh boot
    setTimeout(() => launch('terminal'), 300);
  }

  // Save last-used directory for file manager
  const FM_KEY = 'pyos_fm_lastdir';
  function saveFMDir(path) { try { localStorage.setItem(FM_KEY, path); } catch(e) {} }
  function loadFMDir()     { try { return localStorage.getItem(FM_KEY) || '/home/user'; } catch(e) { return '/home/user'; } }

  // Expose app registry for extras.js
  function getApps() { return APPS; }
  function _registerApps(map) { Object.assign(APPS, map); }

  return { init, launch, saveFMDir, loadFMDir, getApps, _registerApps };
})();


// ══════════════════════════════════════════════════════════════════════
// 7. BOOT
// ══════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  // If boot screen exists, extras.js handles the animated boot and calls Desktop.init().
  // Otherwise init immediately (fallback if extras.js is missing).
  const bootScreen = document.getElementById('boot-screen');
  if (bootScreen) {
    // extras.js boot sequence will remove boot-screen, show #desktop, then call Desktop.init()
    // Wait for it via a MutationObserver
    const obs = new MutationObserver(() => {
      if (!document.getElementById('boot-screen')) {
        obs.disconnect();
        Desktop.init();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    // Safety timeout: if boot screen doesn't clear in 10s, force init
    setTimeout(() => {
      obs.disconnect();
      const bs = document.getElementById('boot-screen');
      if (bs) { bs.remove(); document.getElementById('desktop').style.display = ''; }
      Desktop.init();
    }, 10000);
  } else {
    Desktop.init();
  }
});
