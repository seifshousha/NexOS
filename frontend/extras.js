/**
 * extras.js — VirtOS supplemental systems
 * Loads after app.js. Waits for Desktop to be ready before binding anything.
 */
'use strict';

// ═══════════════════════════════════════════
// EVENT LOG
// ═══════════════════════════════════════════
const EventLog = (() => {
  const entries = [];
  function log(l,s,m){ entries.unshift({level:l,source:s,message:m,time:new Date().toLocaleTimeString()}); if(entries.length>300)entries.pop(); }
  function clear(){ entries.length = 0; }
  return { log, getAll:()=>[...entries], clear, info:(s,m)=>log('info',s,m), warn:(s,m)=>log('warning',s,m), error:(s,m)=>log('error',s,m) };
})();

// ═══════════════════════════════════════════
// THEME MANAGER
// ═══════════════════════════════════════════
const ThemeManager = (() => {
  const THEMES = {
    dark:  {'--bg-desktop':'#0d1117','--bg-window':'#161b22','--bg-titlebar':'#21262d','--bg-input':'#0d1117','--bg-hover':'#1f2937','--bg-active':'#1c2333','--bg-panel':'#1a1f2e','--border':'#30363d','--text-primary':'#e6edf3','--text-secondary':'#8b949e','--text-muted':'#484f58'},
    light: {'--bg-desktop':'#f0f2f5','--bg-window':'#ffffff','--bg-titlebar':'#e8eaed','--bg-input':'#f8f9fa','--bg-hover':'#e4e6e9','--bg-active':'#d8dadd','--bg-panel':'#f4f5f7','--border':'#d0d3d8','--text-primary':'#1a1a2e','--text-secondary':'#5f6368','--text-muted':'#9aa0a6'},
    cyber: {'--bg-desktop':'#050a0e','--bg-window':'#0a1628','--bg-titlebar':'#0d1f3c','--bg-input':'#050a0e','--bg-hover':'#112240','--bg-active':'#0f1e38','--bg-panel':'#080f1e','--border':'#1a3a6c','--text-primary':'#00f5ff','--text-secondary':'#4d9fec','--text-muted':'#1a4a7a'},
    sunset:{'--bg-desktop':'#1a0a00','--bg-window':'#2d0f0f','--bg-titlebar':'#3d1515','--bg-input':'#1a0a00','--bg-hover':'#4a1a1a','--bg-active':'#3a1212','--bg-panel':'#250d0d','--border':'#5c2020','--text-primary':'#ffe4cc','--text-secondary':'#cc8866','--text-muted':'#8b4433'},
  };
  const ACCENTS = {blue:'#388bfd',purple:'#a371f7',green:'#3fb950',amber:'#d29922',red:'#f85149',teal:'#2ea7b4',pink:'#f778ba',orange:'#fb8f44'};
  const WALLPAPERS = {
    default:'radial-gradient(ellipse 80% 50% at 20% 30%,rgba(56,139,253,0.08) 0%,transparent 60%),radial-gradient(ellipse 60% 40% at 80% 70%,rgba(163,113,247,0.06) 0%,transparent 50%),var(--bg-desktop)',
    space:'radial-gradient(ellipse at 20% 20%,#0d2b4e 0%,#050a0e 50%),radial-gradient(circle at 80% 80%,#1a0a3e 0%,transparent 50%)',
    forest:'linear-gradient(135deg,#0a1e0a 0%,#0d2d0d 40%,#061206 100%)',
    ocean:'linear-gradient(180deg,#001a33 0%,#003366 50%,#001a33 100%)',
    aurora:'linear-gradient(135deg,#0d1117 0%,#0a2040 30%,#1a0a30 60%,#0d1117 100%)',
    midnight:'linear-gradient(135deg,#090909 0%,#0f0f1a 50%,#090909 100%)',
    sunset2:'linear-gradient(135deg,#1a0000 0%,#3d0d00 40%,#1a0820 100%)',
    matrix:'linear-gradient(180deg,#000800 0%,#001200 100%)',
  };
  let cur = {theme:'dark',accent:'blue',wallpaper:'default'};

  function _applyToDOM(){
    const r=document.documentElement, t=THEMES[cur.theme]||THEMES.dark;
    Object.entries(t).forEach(([k,v])=>r.style.setProperty(k,v));
    r.style.setProperty('--accent',ACCENTS[cur.accent]||ACCENTS.blue);
    const d=document.getElementById('desktop');
    if(d) d.style.background=WALLPAPERS[cur.wallpaper]||WALLPAPERS.default;
  }
  function load(){ try{Object.assign(cur,JSON.parse(localStorage.getItem('pyos_theme')||'{}'));}catch(e){} _applyToDOM(); }
  function setTheme(n){if(!THEMES[n])return; cur.theme=n;_save();_applyToDOM();EventLog.info('Theme',`theme=${n}`);}
  function setAccent(n){if(!ACCENTS[n])return; cur.accent=n;_save();_applyToDOM();}
  function setWallpaper(n){if(!WALLPAPERS[n])return; cur.wallpaper=n;_save();_applyToDOM();}
  function _save(){try{localStorage.setItem('pyos_theme',JSON.stringify(cur));}catch(e){}}
  function getCurrent(){return{...cur};}
  return{load,setTheme,setAccent,setWallpaper,getCurrent,THEMES,ACCENTS,WALLPAPERS};
})();

// ═══════════════════════════════════════════
// POWER MANAGER
// ═══════════════════════════════════════════
const PowerManager = (() => {
  localStorage.removeItem('pyos_power_state'); // never persist shutdown state
  const overlay=document.getElementById('power-overlay');
  const sleepOv=document.getElementById('sleep-overlay');
  const msgEl=document.getElementById('power-msg');
  function _show(msg){if(overlay){overlay.style.display='flex';if(msgEl)msgEl.textContent=msg;}}
  function shutdown(){_show('Shutting down...');EventLog.info('Power','Shutdown');setTimeout(()=>location.reload(),2500);}
  function restart(){_show('Restarting...');EventLog.info('Power','Restart');setTimeout(()=>location.reload(),1800);}
  function sleep(){if(sleepOv){sleepOv.style.display='flex';sleepOv.addEventListener('click',()=>{sleepOv.style.display='none';},{once:true});}}
  return{shutdown,restart,sleep};
})();

// ═══════════════════════════════════════════
// SETTINGS APP (full control center)
// ═══════════════════════════════════════════
const SettingsApp = {
  mount(container){
    const c=ThemeManager.getCurrent();
    container.innerHTML=`
    <div class="settings-app">
      <div class="settings-sidebar">
        <div class="settings-tab active" data-tab="personalization">Personalization</div>
        <div class="settings-tab" data-tab="appearance">Appearance</div>
        <div class="settings-tab" data-tab="system">System</div>
        <div class="settings-tab" data-tab="about">About</div>
      </div>
      <div class="settings-body" id="s-body"></div>
    </div>`;
    const body=container.querySelector('#s-body');
    const tabs=container.querySelectorAll('.settings-tab');
    tabs.forEach(t=>t.addEventListener('click',()=>{tabs.forEach(x=>x.classList.remove('active'));t.classList.add('active');show(t.dataset.tab);}));

    function show(tab){
      const c=ThemeManager.getCurrent();
      if(tab==='personalization') body.innerHTML=`
        <div class="settings-section">
          <div class="settings-label">Wallpaper</div>
          <div class="wp-grid">${Object.entries(ThemeManager.WALLPAPERS).map(([k,v])=>`
            <button class="wp-btn ${c.wallpaper===k?'active':''}" data-wp="${k}"
              style="background:${v};position:relative;overflow:hidden">
              <span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff;text-shadow:0 1px 4px #000;background:rgba(0,0,0,0.3)">${k}</span>
            </button>`).join('')}
          </div>
        </div>`;
      else if(tab==='appearance') body.innerHTML=`
        <div class="settings-section">
          <div class="settings-label">Color Theme</div>
          <div class="theme-grid">${Object.keys(ThemeManager.THEMES).map(t=>`
            <button class="theme-btn ${c.theme===t?'active':''}" data-theme="${t}">${t}</button>`).join('')}
          </div>
        </div>
        <div class="settings-section" style="margin-top:16px">
          <div class="settings-label">Accent Color</div>
          <div class="accent-row">${Object.entries(ThemeManager.ACCENTS).map(([n,v])=>`
            <div class="accent-swatch ${c.accent===n?'active':''}" data-accent="${n}"
              style="background:${v}" title="${n}"></div>`).join('')}
          </div>
        </div>`;
      else if(tab==='system') body.innerHTML=`
        <div class="settings-section">
          <div class="settings-label">Power</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="theme-btn" id="s-sleep">💤 Sleep</button>
            <button class="theme-btn" id="s-restart">🔄 Restart</button>
            <button class="theme-btn" style="color:var(--accent-red)" id="s-shutdown">⏻ Shut Down</button>
          </div>
        </div>
        <div class="settings-section" style="margin-top:16px">
          <div class="settings-label">Display</div>
          <div style="color:var(--text-secondary);font-size:12px;line-height:1.8">
            Resolution: ${window.innerWidth} × ${window.innerHeight}<br>
            Device Pixel Ratio: ${window.devicePixelRatio}
          </div>
        </div>`;
      else body.innerHTML=`
        <div class="settings-section">
          <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
            <div style="font-size:48px">🖥</div>
            <div><div style="font-size:22px;font-weight:700;color:var(--accent)">VirtOS</div>
            <div style="color:var(--text-secondary);margin-top:2px">Version 1.0 · Web Edition</div></div>
          </div>
          <table class="sysinfo-table"><tbody>
            <tr><td>Runtime</td><td>Browser + FastAPI</td></tr>
            <tr><td>Architecture</td><td>Single-Server (port 8000)</td></tr>
            <tr><td>API Base</td><td>/api/*</td></tr>
            <tr><td>Frontend</td><td>/static/*</td></tr>
          </tbody></table>
        </div>`;

      // bind after render
      body.querySelectorAll('[data-wp]').forEach(b=>b.addEventListener('click',()=>{ThemeManager.setWallpaper(b.dataset.wp);show('personalization');}));
      body.querySelectorAll('[data-theme]').forEach(b=>b.addEventListener('click',()=>{ThemeManager.setTheme(b.dataset.theme);show('appearance');}));
      body.querySelectorAll('[data-accent]').forEach(b=>b.addEventListener('click',()=>{ThemeManager.setAccent(b.dataset.accent);show('appearance');}));
      body.querySelector('#s-sleep')?.addEventListener('click',()=>PowerManager.sleep());
      body.querySelector('#s-restart')?.addEventListener('click',()=>PowerManager.restart());
      body.querySelector('#s-shutdown')?.addEventListener('click',()=>PowerManager.shutdown());
    }
    show('personalization');
  }
};

// ═══════════════════════════════════════════
// CALCULATOR APP
// ═══════════════════════════════════════════
const CalculatorApp = {
  mount(container){
    container.innerHTML=`<div class="calc-app">
      <div class="calc-display"><div class="calc-expr" id="c-e">0</div><div class="calc-result" id="c-r"></div></div>
      <div class="calc-grid">${['C','±','%','÷','7','8','9','×','4','5','6','−','1','2','3','+','0','.','⌫','='].map(k=>{
        let cls='calc-btn';if(k==='=')cls+=' calc-btn-eq';if(k==='C')cls+=' calc-btn-clear';
        return`<button class="${cls}" data-key="${k}">${k}</button>`;
      }).join('')}</div></div>`;
    const eEl=container.querySelector('#c-e'), rEl=container.querySelector('#c-r');
    let expr='0', history='';
    container.querySelectorAll('.calc-btn').forEach(btn=>btn.addEventListener('click',()=>{
      const k=btn.dataset.key;
      if(k==='C'){expr='0';history='';}
      else if(k==='±'){expr=expr.startsWith('-')?expr.slice(1):expr==='0'?'0':'-'+expr;}
      else if(k==='%'){try{expr=String(parseFloat(expr)/100);}catch(e){}}
      else if(k==='⌫'){expr=expr.length>1?expr.slice(0,-1):'0';}
      else if(k==='='){
        try{const e=expr.replace(/÷/g,'/').replace(/×/g,'*').replace(/−/g,'-');
        history=expr+'=';expr=String(new Function('return '+e)());}catch(e){expr='Error';history='';}
      }
      else if('÷×−+'.includes(k)){if(expr!=='Error')expr+=` ${k} `;}
      else{if(expr==='0'||expr==='Error')expr=k;else expr+=k;}
      eEl.textContent=expr; rEl.textContent=history;
    }));
  }
};

// ═══════════════════════════════════════════
// LOG VIEWER APP
// ═══════════════════════════════════════════
const LogViewerApp = {
  mount(container){
    container.innerHTML=`<div class="logviewer-app">
      <div class="lv-toolbar">
        <span class="lv-title">System Log</span>
        <select class="lv-filter" id="lv-f"><option value="">All Levels</option>
          <option value="info">Info</option><option value="warning">Warning</option><option value="error">Error</option></select>
        <input type="text" class="lv-filter" id="lv-s" placeholder="Filter..." style="width:140px">
        <button class="fm-btn" id="lv-r">↻ Refresh</button>
        <button class="fm-btn" id="lv-c">🗑 Clear</button>
      </div>
      <div class="lv-table-wrap">
        <table class="pm-table" style="width:100%">
          <thead><tr><th>Time</th><th>Level</th><th>Source</th><th>Message</th></tr></thead>
          <tbody id="lv-b"></tbody>
        </table>
      </div>
    </div>`;
    const tbody=container.querySelector('#lv-b');
    const filtEl=container.querySelector('#lv-f');
    const searchEl=container.querySelector('#lv-s');
    function render(){
      const f=filtEl.value, q=searchEl.value.toLowerCase();
      const logs=EventLog.getAll().filter(e=>(!f||e.level===f)&&(!q||e.message.toLowerCase().includes(q)||e.source.toLowerCase().includes(q)));
      tbody.innerHTML=logs.length?logs.map(e=>`<tr>
        <td style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);white-space:nowrap">${e.time}</td>
        <td><span class="lv-badge lv-${e.level}">${e.level}</span></td>
        <td style="color:var(--text-secondary);font-size:12px">${e.source}</td>
        <td style="font-size:12px">${e.message}</td></tr>`).join('')
        :`<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--text-muted)">No log entries</td></tr>`;
    }
    render();
    filtEl.addEventListener('change',render);
    searchEl.addEventListener('input',render);
    container.querySelector('#lv-r').addEventListener('click',render);
    container.querySelector('#lv-c').addEventListener('click',()=>{EventLog.clear();render();});
    const iv=setInterval(render,2000);
    new MutationObserver(()=>{if(!container.isConnected)clearInterval(iv);}).observe(container,{childList:true});
  }
};

// ═══════════════════════════════════════════
// ICON DRAG — shared drag system for ALL desktop icons
// Works for both system app icons and VFS file/folder icons
// ═══════════════════════════════════════════
const IconDrag = (() => {
  const STORE_KEY = 'virtos_icon_pos';
  const ICON_W = 80, ICON_H = 96, PAD_X = 20, PAD_Y = 16;

  function load()    { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch(_) { return {}; } }
  function save(pos) { try { localStorage.setItem(STORE_KEY, JSON.stringify(pos)); } catch(_) {} }

  /** Default column position for a system icon at index idx (left column) */
  function defaultSysPos(idx) {
    return { x: PAD_X, y: PAD_Y + idx * ICON_H };
  }

  /** Default position for a VFS icon (columns starting right of system icons) */
  function defaultVfsPos(idx) {
    const desktopH = window.innerHeight - 70;
    const maxRows  = Math.max(1, Math.floor(desktopH / ICON_H));
    const col = Math.floor(idx / maxRows);
    const row = idx % maxRows;
    return { x: PAD_X + (ICON_W + PAD_X) + col * (ICON_W + PAD_X), y: PAD_Y + row * ICON_H };
  }

  /** Set absolute position on element */
  function setPos(el, p) {
    el.style.position = 'absolute';
    el.style.left = p.x + 'px';
    el.style.top  = p.y + 'px';
  }

  /**
   * Make element draggable. Returns a getter fn () => bool (true = was dragged).
   * Persists position under `key` in localStorage.
   */
  function make(el, key) {
    let dragging = false, startX, startY, origX, origY, _didDrag = false;

    el.classList.add('draggable-icon');

    el.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      dragging = true;
      _didDrag = false;
      startX = e.clientX;
      startY = e.clientY;
      origX  = parseInt(el.style.left)  || 0;
      origY  = parseInt(el.style.top)   || 0;
      el.style.zIndex     = '999';
      el.style.transition = 'none';
      el.style.willChange = 'left, top';
      e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) _didDrag = true;
      if (_didDrag) {
        el.style.left = Math.max(0, origX + dx) + 'px';
        el.style.top  = Math.max(0, origY + dy) + 'px';
      }
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      el.style.zIndex     = '';
      el.style.transition = '';
      el.style.willChange = '';
      if (_didDrag) {
        const pos = load();
        pos[key] = { x: parseInt(el.style.left), y: parseInt(el.style.top) };
        save(pos);
      }
    });

    // Returns true if the last interaction was a drag (not a click)
    return () => _didDrag;
  }

  return { load, save, make, setPos, defaultSysPos, defaultVfsPos };
})();

// ═══════════════════════════════════════════
// WAIT FOR DESKTOP — safe lifecycle init
// ═══════════════════════════════════════════
function waitForDesktop(cb, attempts=0){
  if(typeof Desktop !== 'undefined' && Desktop.launch){
    cb();
  } else if(attempts < 50){
    setTimeout(()=>waitForDesktop(cb, attempts+1), 100);
  } else {
    console.error('[extras] Desktop never became ready');
  }
}

// ═══════════════════════════════════════════
// MAIN INIT — runs after Desktop is ready
// ═══════════════════════════════════════════
waitForDesktop(() => {
  // Register extra apps into Desktop
  if(Desktop._registerApps){
    Desktop._registerApps({
      calculator: { title:'Calculator', icon:PyOSIcons.calculator, w:320, h:420, mount:b=>CalculatorApp.mount(b) },
      logs:       { title:'Log Viewer', icon:PyOSIcons.logs,       w:720, h:440, mount:b=>LogViewerApp.mount(b) },
      settings:   { title:'Settings',   icon:PyOSIcons.settings,   w:640, h:480, mount:b=>SettingsApp.mount(b) },
    });
  }

  ThemeManager.load();

  // ─── START MENU ───────────────────────────────────────────────────────
  const startBtn  = document.getElementById('start-btn');
  const startMenu = document.getElementById('start-menu');
  const smGrid    = document.getElementById('sm-apps-grid');
  const smSearch  = document.getElementById('sm-search');
  const powerDrop = document.getElementById('power-dropdown');

  function closeAll(){ startMenu?.classList.remove('open'); powerDrop?.classList.add('hidden'); }

  if(startBtn){
    startBtn.addEventListener('click', e=>{ e.stopPropagation(); startMenu?.classList.toggle('open'); if(startMenu?.classList.contains('open')) populateGrid(); });
  }
  document.addEventListener('click', e=>{
    if(!startMenu?.contains(e.target) && e.target!==startBtn) startMenu?.classList.remove('open');
    if(!powerDrop?.contains(e.target)) powerDrop?.classList.add('hidden');
  });

  function populateGrid(filter=''){
    if(!smGrid) return;
    smGrid.innerHTML='';
    const apps = Desktop.getApps ? Desktop.getApps() : {};
    Object.entries(apps).filter(([,a])=>!filter||a.title.toLowerCase().includes(filter)).forEach(([key,app])=>{
      const btn=document.createElement('button');
      btn.className='sm-app-btn';
      btn.innerHTML=`<span class="sm-app-icon">${app.icon}</span><span class="sm-app-name">${app.title}</span>`;
      btn.addEventListener('click',()=>{ Desktop.launch(key); closeAll(); });
      smGrid.appendChild(btn);
    });
  }
  smSearch?.addEventListener('input',()=>populateGrid(smSearch.value.toLowerCase().trim()));

  // Start menu quick-access
  document.querySelectorAll('.sm-pin-btn[data-app]').forEach(btn=>
    btn.addEventListener('click',()=>{ Desktop.launch(btn.dataset.app); closeAll(); })
  );

  // Power controls
  function showPower(anchor){
    if(!powerDrop) return;
    if(anchor){const r=anchor.getBoundingClientRect();powerDrop.style.right=(window.innerWidth-r.right)+'px';powerDrop.style.bottom='50px';powerDrop.style.left='auto';}
    else{powerDrop.style.left='8px';powerDrop.style.bottom='50px';powerDrop.style.right='auto';}
    powerDrop.classList.toggle('hidden');
  }
  document.getElementById('sm-power-btn')?.addEventListener('click',e=>{e.stopPropagation();showPower(null);});
  document.getElementById('tray-power')?.addEventListener('click',e=>{e.stopPropagation();showPower(e.currentTarget);});
  document.getElementById('pw-shutdown')?.addEventListener('click',()=>{closeAll();PowerManager.shutdown();});
  document.getElementById('pw-restart')?.addEventListener('click',()=>{closeAll();PowerManager.restart();});
  document.getElementById('pw-sleep')?.addEventListener('click',()=>{closeAll();PowerManager.sleep();});

  // ─── TEXT EDITOR APP ─────────────────────────────────────────────────────
  // Opened by: nano <file> from terminal, double-click on .txt/.sh/.md files,
  //            right-click → Edit on any VFS file.
  // ─────────────────────────────────────────────────────────────────────────

  const TextEditorApp = (() => {
    const EDITABLE_EXT = ['.txt', '.sh', '.md', '.json', '.log', '.conf', '.py', '.js', '.css', '.html'];

    function _ext(name) {
      const i = name.lastIndexOf('.');
      return i >= 0 ? name.slice(i).toLowerCase() : '';
    }

    function _isEditable(name) {
      return EDITABLE_EXT.includes(_ext(name)) || !name.includes('.');
    }

    function _highlight(code, ext) {
      // Basic syntax hints via CSS classes — just colour keywords for .sh
      if (ext === '.sh') {
        return code
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/(^|\n)(#[^\n]*)/g, '$1<span class="ed-comment">$2</span>')
          .replace(/\b(echo|cd|ls|mkdir|rm|mv|cp|if|then|else|fi|for|do|done|exit|export|source)\b/g,
                   '<span class="ed-kw">$1</span>')
          .replace(/(".*?"|'.*?')/g, '<span class="ed-str">$1</span>');
      }
      return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function mount(body, filePath) {
      const fileName = filePath.split('/').pop();
      const ext      = _ext(fileName);
      let   original = '';
      let   saved    = true;

      body.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;background:var(--bg-window)';
      body.innerHTML = `
        <div class="ed-toolbar">
          <span class="ed-filename" id="ed-filename">${_esc(fileName)}</span>
          <span class="ed-badge" id="ed-badge" style="display:none">● unsaved</span>
          <span style="flex:1"></span>
          <span class="ed-info" id="ed-info">Ln 1, Col 1</span>
          <button class="ed-btn" id="ed-save" title="Save (Ctrl+S)">💾 Save</button>
        </div>
        <textarea class="ed-area" id="ed-area" spellcheck="false" autocorrect="off"
          autocapitalize="off" placeholder="Loading..."></textarea>
        <div class="ed-statusbar">
          <span id="ed-path">${_esc(filePath)}</span>
          <span id="ed-lines">0 lines</span>
          <span id="ed-enc">UTF-8</span>
        </div>`;

      const area   = body.querySelector('#ed-area');
      const badge  = body.querySelector('#ed-badge');
      const info   = body.querySelector('#ed-info');
      const lines  = body.querySelector('#ed-lines');
      const saveBtn= body.querySelector('#ed-save');

      function markDirty() {
        if (saved) { saved = false; badge.style.display = ''; }
      }
      function markClean() {
        saved = true; badge.style.display = 'none';
      }

      function updateInfo() {
        const txt = area.value;
        const pos = area.selectionStart;
        const before = txt.slice(0, pos);
        const ln = (before.match(/\n/g) || []).length + 1;
        const col = pos - before.lastIndexOf('\n');
        const lc  = (txt.match(/\n/g) || []).length + 1;
        info.textContent  = `Ln ${ln}, Col ${col}`;
        lines.textContent = `${lc} line${lc !== 1 ? 's' : ''}`;
      }

      async function doSave() {
        try {
          saveBtn.disabled = true;
          saveBtn.textContent = '⏳ Saving...';
          await API.write(filePath, area.value);
          original = area.value;
          markClean();
          Notify.show('Saved', fileName, 'success', 1500);
          EventLog.info('Editor', `Saved: ${filePath}`);
        } catch(err) {
          Notify.show('Save failed', err.message, 'error');
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = '💾 Save';
        }
      }

      // Load file content
      (async () => {
        try {
          const res = await API.read(filePath);
          original = res.content || '';
          area.value = original;
          area.placeholder = '';
          updateInfo();
        } catch(err) {
          area.value = '';
          area.placeholder = `New file: ${fileName}`;
        }
      })();

      // Events
      area.addEventListener('input',   () => { markDirty(); updateInfo(); });
      area.addEventListener('keyup',   updateInfo);
      area.addEventListener('click',   updateInfo);
      area.addEventListener('keydown', e => {
        // Tab → 2 spaces
        if (e.key === 'Tab') {
          e.preventDefault();
          const s = area.selectionStart, end = area.selectionEnd;
          area.value = area.value.slice(0, s) + '  ' + area.value.slice(end);
          area.selectionStart = area.selectionEnd = s + 2;
          markDirty();
        }
        // Ctrl+S
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
          e.preventDefault();
          doSave();
        }
      });

      saveBtn.addEventListener('click', doSave);

      // Focus the editor
      requestAnimationFrame(() => area.focus());
    }

    /** Open a file in the editor — callable from anywhere */
    function open(filePath) {
      const fileName = filePath.split('/').pop();
      WM.open({
        title: `✏️ ${fileName}`,
        icon:  PyOSIcons.file,
        width: 680, height: 500,
        onMount(body) { mount(body, filePath); }
      });
    }

    return { mount, open, isEditable: (name) => _isEditable(name) };
  })();

  // Expose globally so terminal action handler can reach it
  window.TextEditorApp = TextEditorApp;

  // ─── DESKTOP SURFACE ────────────────────────────────────────────────────
  // Direct visual layer over VFS /home/user/Desktop.
  // Two-way sync: Terminal mkdir → shows on desktop. UI create → shows in terminal.
  // Polls every 3s to keep in sync. No localStorage. Pure VFS-backed.
  // ────────────────────────────────────────────────────────────────────────

  const DesktopSurface = (() => {
    const VFS_PATH   = '/home/user/Desktop';
    const iconsEl    = document.getElementById('desktop-icons');
    let _entries     = [];
    let _pollTimer   = null;
    let _creating    = false;
    let _selected    = null;

    async function _fetch() {
      try {
        const res = await API.ls(VFS_PATH);
        return res.entries || [];
      } catch(e) {
        try { await API.mkdir(VFS_PATH); } catch(_) {}
        return [];
      }
    }

    function _hasChanged(newEntries) {
      if (newEntries.length !== _entries.length) return true;
      const oldKey = _entries.map(e => `${e.name}:${e.type}`).sort().join('|');
      const newKey = newEntries.map(e => `${e.name}:${e.type}`).sort().join('|');
      return oldKey !== newKey;
    }

    function render() {
      iconsEl?.querySelectorAll('.vfs-item').forEach(el => el.remove());
      if (!iconsEl) return;
      const pos = IconDrag.load();

      _entries.forEach((entry, idx) => {
        const isDir = entry.type === 'dir';
        const icon  = isDir ? PyOSIcons.folder : PyOSIcons.file;
        const el    = document.createElement('div');
        el.className = 'desktop-icon vfs-item';
        el.dataset.entryName = entry.name;
        el.dataset.entryType = entry.type;
        el.innerHTML = `<div class="icon-glyph">${icon}</div><span>${_esc(entry.name)}</span>`;

        // Position: saved position or auto-grid (VFS column)
        const p = pos['vfs_' + entry.name] || IconDrag.defaultVfsPos(idx);
        IconDrag.setPos(el, p);
        const getDragged = IconDrag.make(el, 'vfs_' + entry.name);

        el.addEventListener('click', e => {
          e.stopPropagation();
          if (getDragged()) return;   // was a drag, not a click
          _deselectAll();
          el.style.outline = '2px solid rgba(56,139,253,0.6)';
          el.style.background = 'rgba(56,139,253,0.12)';
          _selected = entry.name;
        });

        el.addEventListener('dblclick', e => {
          e.stopPropagation();
          if (getDragged()) return;
          _openEntry(entry);
        });

        el.addEventListener('contextmenu', e => {
          e.preventDefault(); e.stopPropagation();
          _deselectAll();
          el.style.outline = '2px solid rgba(56,139,253,0.6)';
          _selected = entry.name;
          _showEntryMenu(e, entry, el);
        });

        iconsEl.appendChild(el);
      });
    }

    function _openEntry(entry) {
      const fullPath = `${VFS_PATH}/${entry.name}`;
      if (entry.type === 'dir') {
        WM.open({
          title: entry.name,
          icon: PyOSIcons.folder,
          width: 660, height: 440,
          onMount(body) { FileManagerApp.mount(body, fullPath); }
        });
      } else if (TextEditorApp.isEditable(entry.name)) {
        // Open editable files in the Text Editor
        TextEditorApp.open(fullPath);
      } else {
        // Fallback read-only viewer for binary/unknown files
        WM.open({
          title: entry.name,
          icon: PyOSIcons.file,
          width: 520, height: 380,
          async onMount(body) {
            try {
              const res = await API.read(fullPath);
              body.innerHTML = `<div style="padding:16px;font-family:var(--font-mono);font-size:13px;white-space:pre-wrap;overflow:auto;height:100%;color:var(--text-primary);background:var(--bg-window)">${_esc(res.content || '(empty)')}</div>`;
            } catch(err) {
              body.innerHTML = `<div style="padding:20px;color:var(--accent-red)">Error: ${err.message}</div>`;
            }
          }
        });
      }
    }

    async function createFolder() {
      if (_creating) return;
      _creating = true;
      try {
        const name = _uniqueName('New Folder');
        await API.mkdir(`${VFS_PATH}/${name}`);
        await refresh();
        requestAnimationFrame(() => {
          const el = iconsEl?.querySelector(`[data-entry-name="${CSS.escape(name)}"]`);
          if (el) { _deselectAll(); el.classList.add('selected'); _startRename(el, name); }
          _creating = false;
        });
        EventLog.info('Desktop', `Folder created: ${name}`);
        Notify.show('Folder created', name, 'success', 2000);
      } catch(err) {
        Notify.show('Error', err.message, 'error');
        _creating = false;
      }
    }

    async function createFile() {
      if (_creating) return;
      _creating = true;
      try {
        const name = _uniqueName('New File.txt', false);
        await API.touch(`${VFS_PATH}/${name}`, '');
        await refresh();
        requestAnimationFrame(() => {
          const el = iconsEl?.querySelector(`[data-entry-name="${CSS.escape(name)}"]`);
          if (el) { _deselectAll(); el.classList.add('selected'); _startRename(el, name); }
          _creating = false;
        });
        EventLog.info('Desktop', `File created: ${name}`);
        Notify.show('File created', name, 'success', 2000);
      } catch(err) {
        Notify.show('Error', err.message, 'error');
        _creating = false;
      }
    }

    function _uniqueName(base, isDir = true) {
      const names = new Set(_entries.map(e => e.name));
      if (!names.has(base)) return base;
      let stem = base, ext = '';
      if (!isDir) {
        const dot = base.lastIndexOf('.');
        if (dot > 0) { stem = base.slice(0, dot); ext = base.slice(dot); }
      }
      let n = 2;
      while (names.has(`${stem} (${n})${ext}`)) n++;
      return `${stem} (${n})${ext}`;
    }

    function _startRename(el, currentName) {
      const labelEl = el.querySelector('span');
      if (!labelEl) return;

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'folder-rename-input';
      input.value = currentName;
      input.spellcheck = false;
      input.autocomplete = 'off';

      labelEl.replaceWith(input);
      input.focus();
      input.select();

      let committed = false;
      async function commit() {
        if (committed) return;
        committed = true;
        const newName = input.value.trim();
        if (newName && newName !== currentName) {
          try { await API.rename(`${VFS_PATH}/${currentName}`, newName); } catch(err) { Notify.show('Rename failed', err.message, 'error'); }
        }
        await refresh();
      }

      input.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); input.value = currentName; commit(); }
      });
      input.addEventListener('blur', commit);
    }

    function _showEntryMenu(e, entry, entryEl) {
      _removeMenus();
      const menu = document.createElement('div');
      menu.className = 'context-menu ctx-folder';
      menu.style.cssText = `position:fixed;left:${Math.min(e.clientX, window.innerWidth - 160)}px;top:${Math.min(e.clientY, window.innerHeight - 160)}px`;

      const isDir = entry.type === 'dir';
      [
        [`${isDir ? '📂' : '📄'}  Open`, () => _openEntry(entry)],
        ['✏️  Rename', () => _startRename(entryEl, entry.name)],
        null,
        ['🗑  Delete', () => _deleteEntry(entry), 'danger'],
      ].forEach(item => {
        if (!item) { const s = document.createElement('div'); s.className = 'ctx-separator'; menu.appendChild(s); return; }
        const el = document.createElement('div');
        el.className = `ctx-item ${item[2] || ''}`;
        el.innerHTML = item[0];
        el.addEventListener('click', () => { item[1](); menu.remove(); });
        menu.appendChild(el);
      });

      document.body.appendChild(menu);
      setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
    }

    async function _deleteEntry(entry) {
      if (!confirm(`Delete "${entry.name}"?`)) return;
      try {
        await API.delete(`${VFS_PATH}/${entry.name}`, entry.type === 'dir');
        await refresh();
        EventLog.info('Desktop', `Deleted: ${entry.name}`);
        Notify.show('Deleted', entry.name, 'warning', 2000);
      } catch(err) { Notify.show('Delete failed', err.message, 'error'); }
    }

    function _deselectAll() {
      document.querySelectorAll('.desktop-icon').forEach(i => i.style.outline = '');
      _selected = null;
    }

    function _removeMenus() {
      document.querySelectorAll('.ctx-desktop,.ctx-folder').forEach(m => m.remove());
    }

    function _esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    async function refresh() {
      const newEntries = await _fetch();
      _entries = newEntries;
      render();
    }

    function _startPolling() {
      _pollTimer = setInterval(async () => {
        try {
          const newEntries = await _fetch();
          if (_hasChanged(newEntries)) { _entries = newEntries; render(); }
        } catch(_) {}
      }, 3000);
    }

    async function init() {
      await refresh();
      _startPolling();
    }

    document.getElementById('desktop')?.addEventListener('click', e => {
      if (e.target.closest('.desktop-icon,.window,#taskbar,.start-menu')) return;
      _deselectAll();
    });

    return { init, refresh, createFolder, createFile };
  })();

  DesktopSurface.init();

  // ─── DESKTOP RIGHT-CLICK ───────────────────────────────────────────────
  const desktopEl = document.getElementById('desktop');
  desktopEl?.addEventListener('contextmenu', e => {
    if (e.target.closest('.window,.taskbar-btn,#taskbar,.start-menu,.vfs-item')) return;
    e.preventDefault();
    document.querySelectorAll('.ctx-desktop,.ctx-folder').forEach(m => m.remove());
    document.querySelectorAll('.desktop-icon').forEach(i => i.style.outline = '');

    const menu = document.createElement('div');
    menu.className = 'context-menu ctx-desktop';
    menu.style.cssText = `position:fixed;left:${Math.min(e.clientX, window.innerWidth - 170)}px;top:${Math.min(e.clientY, window.innerHeight - 300)}px`;

    // "New >" submenu
    const newWrap = document.createElement('div');
    newWrap.className = 'ctx-submenu-wrap';
    const newItem = document.createElement('div');
    newItem.className = 'ctx-item';
    newItem.innerHTML = '📁  New';
    newWrap.appendChild(newItem);

    const subMenu = document.createElement('div');
    subMenu.className = 'ctx-submenu';
    const folderBtn = document.createElement('div');
    folderBtn.className = 'ctx-item';
    folderBtn.innerHTML = '📂  Folder';
    folderBtn.addEventListener('click', () => { DesktopSurface.createFolder(); menu.remove(); });
    subMenu.appendChild(folderBtn);
    const fileBtn = document.createElement('div');
    fileBtn.className = 'ctx-item';
    fileBtn.innerHTML = '📄  File';
    fileBtn.addEventListener('click', () => { DesktopSurface.createFile(); menu.remove(); });
    subMenu.appendChild(fileBtn);
    newWrap.appendChild(subMenu);
    menu.appendChild(newWrap);

    const sep1 = document.createElement('div'); sep1.className = 'ctx-separator'; menu.appendChild(sep1);

    // Refresh desktop
    const refreshBtn = document.createElement('div');
    refreshBtn.className = 'ctx-item';
    refreshBtn.innerHTML = '🔄  Refresh Desktop';
    refreshBtn.addEventListener('click', () => { DesktopSurface.refresh(); menu.remove(); });
    menu.appendChild(refreshBtn);

    const sep2 = document.createElement('div'); sep2.className = 'ctx-separator'; menu.appendChild(sep2);

    // Standard items
    [
      ['Terminal', () => Desktop.launch('terminal')],
      ['File Manager', () => Desktop.launch('files')],
      null,
      ['Settings', () => Desktop.launch('settings')],
      null,
      ['Refresh Page', () => location.reload()],
    ].forEach(item => {
      if (!item) { const s = document.createElement('div'); s.className = 'ctx-separator'; menu.appendChild(s); return; }
      const el = document.createElement('div'); el.className = 'ctx-item'; el.innerHTML = item[0];
      el.addEventListener('click', () => { item[1](); menu.remove(); }); menu.appendChild(el);
    });

    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
  });

  // ─── SYSTEM ICONS DRAG ───────────────────────────────────────────────────
  (function _initSystemIconsDrag() {
    const iconsEl = document.getElementById('desktop-icons');
    if (!iconsEl) return;
    const savedPos = IconDrag.load();
    iconsEl.querySelectorAll('.desktop-icon:not(.vfs-item)').forEach((el, idx) => {
      const storeKey = 'sys_' + (el.dataset.app || idx);
      const p = savedPos[storeKey] || IconDrag.defaultSysPos(idx);
      IconDrag.setPos(el, p);    // absolute position in desktop
      IconDrag.make(el, storeKey); // attach drag + persist on drop
    });
    EventLog.info('Desktop', 'System icons drag enabled');
  })();

  EventLog.info('extras', 'All systems ready');
});

// ═══════════════════════════════════════════
// BOOT SEQUENCE
// ═══════════════════════════════════════════
(() => {
  const bootScreen = document.getElementById('boot-screen');
  const desktopEl  = document.getElementById('desktop');
  const stepsEl    = document.getElementById('boot-steps');
  const fillEl     = document.getElementById('boot-fill');
  if(!bootScreen||!desktopEl) return;

  const steps = [
    'Initializing VirtOS kernel...',
    'Mounting virtual filesystem...',
    'Starting process scheduler...',
    'Loading device drivers...',
    'Connecting to API server...',
    'Initializing desktop environment...',
    'Loading user profile...',
    'VirtOS ready.',
  ];

  let i=0;
  function next(){
    if(i>=steps.length){
      bootScreen.style.transition='opacity 0.5s ease';
      bootScreen.style.opacity='0';
      setTimeout(()=>{ bootScreen.remove(); desktopEl.style.display=''; }, 500);
      return;
    }
    if(stepsEl){ const s=document.createElement('div'); s.className='boot-step'; s.textContent='> '+steps[i]; stepsEl.appendChild(s); stepsEl.scrollTop=stepsEl.scrollHeight; }
    if(fillEl) fillEl.style.width=((i+1)/steps.length*100)+'%';
    i++;
    setTimeout(next, 180+Math.random()*120);
  }
  setTimeout(next, 300);
})();
