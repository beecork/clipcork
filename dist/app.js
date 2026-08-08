const $ = id => document.getElementById(id);

let snippets = [];
let history = [];
let scope = 'snippets';        // 'snippets' | 'history' — snippets is the main view
let query = '';
let filtered = [];             // the array the current DOM was built from
let selectedIndex = 0;
let editingId = null;
let settings = { history_limit: 20, enabled: true };

async function invoke(cmd, args) {
    if (window.__TAURI__) return window.__TAURI__.core.invoke(cmd, args);
    return null;
}
function tauriWindow() { return window.__TAURI__ ? window.__TAURI__.window.getCurrentWindow() : null; }
function hidePanel() { const w = tauriWindow(); if (w) w.hide(); }

// Quote-safe HTML escaper (hoisted map — no per-call allocation).
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(s) { return String(s).replace(/[&<>"']/g, c => ESC_MAP[c]); }

function truncate(s, n) { s = String(s); return s.length > n ? s.slice(0, n) + '…' : s; }

function ago(ts) {
    const m = Math.floor((Date.now() - ts) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    const d = Math.floor(h / 24);
    if (d < 30) return d + 'd ago';
    return new Date(ts).toLocaleDateString();
}
function fmtSize(n) { return n < 1000 ? n + ' chars' : (n / 1000).toFixed(1) + 'k chars'; }

let toastTimer = null;
function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1400);
}

// A small glyph derived from the content itself, so the list scans without reading.
function chipFor(text) {
    const t = (text || '').trim();
    if (/^https?:\/\//i.test(t)) return { g: '↗' };
    if (/^(\/|~\/|\.\/|[A-Za-z]:\\)/.test(t)) return { g: '/' };
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return { g: '@' };
    if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(t)) return { g: '◆', color: t };
    if (/[{};=]|=>|<\/?[a-z]|\b(function|const|let|SELECT|import|export)\b/.test(t)) return { g: '{}' };
    return { g: '¶' };
}

// ---- data ----
async function loadSnippets() { snippets = (await invoke('load_snippets')) || []; }
async function saveSnippets() { await invoke('save_snippets', { snippets }); }
async function loadHistory() { history = (await invoke('load_clipboard_history')) || []; }
async function loadSettings() {
    settings = (await invoke('get_settings')) || { history_limit: 20, enabled: true };
    updateSettingsUI();
}
async function saveSettings() { await invoke('save_settings_cmd', { settings }); }

async function copyRaw(text) { if (window.__TAURI__) return !!(await invoke('write_clipboard', { text })); return false; }

async function copyItem(it) {
    await copyRaw(scope === 'snippets' ? it.content : it.text);
    bumpUse(it);
    toast('Copied');
    hidePanel();
}
async function pasteItem(it) {
    const text = scope === 'snippets' ? it.content : it.text;
    bumpUse(it);
    if (window.__TAURI__) {
        const ok = await invoke('paste_and_hide', { text });
        if (ok === false) toast('Enable Accessibility to paste');
    }
}
function activate(it) { pasteItem(it); }

async function togglePinItem(it) {
    if (window.__TAURI__) it.pinned = await invoke('toggle_pin', { id: it.id });
    else it.pinned = !it.pinned;
    render();
}
async function saveAsSnippet(it) {
    if (window.__TAURI__) { const s = await invoke('pin_to_snippets', { content: it.text }); if (s) snippets.unshift(s); }
    toast('Saved as snippet');
}

// ---- icons ----
const IC_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
const IC_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
const IC_DEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>';
const IC_PIN = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 7.7l5.4-.8z"/></svg>';
const IC_BOOKMARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
const IC_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';
const IC_REVEAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>';

function isUrl(t) { return /^https?:\/\//i.test((t || '').trim()); }
function isPath(t) { t = (t || '').trim(); return /^(\/|~\/|[A-Za-z]:\\)/.test(t) && !t.includes('\n'); }
function snippetSort(a, b) { return (b.uses || 0) - (a.uses || 0) || (b.updated || 0) - (a.updated || 0); }
function isSnippetItem(it) { return it && it.content !== undefined; }
async function bumpUse(it) { if (isSnippetItem(it)) { it.uses = (it.uses || 0) + 1; it.last_used = Date.now(); await saveSnippets(); } }

function actBtn(action, icon, title, cls) {
    return '<button class="act-btn ' + (cls || '') + '" data-action="' + action + '" title="' + title + '">' + icon + '</button>';
}
function chipHTML(chip) {
    const style = chip.color ? ' style="color:' + esc(chip.color) + '"' : '';
    return '<span class="row-chip"' + style + '>' + esc(chip.g) + '</span>';
}
function rightSlot(btns) {
    return '<div class="row-right"><div class="row-actions">' + btns.join('') + '</div></div>';
}

function rowHTML(it, i, isSnip) {
    if (isSnip) {
        const tagOn = it.tag && it.tag.toLowerCase() === query.toLowerCase().trim();
        return '<div class="row" data-id="' + esc(it.id) + '" data-i="' + i + '">' +
            chipHTML(chipFor(it.content)) +
            '<div class="row-body">' +
                '<div class="row-title">' + esc(it.title) + '</div>' +
                '<div class="row-text">' + esc(truncate(it.content, 160)) + '</div>' +
                (it.tag ? '<div class="row-meta"><span class="row-tag' + (tagOn ? ' on' : '') + '">' + esc(it.tag) + '</span></div>' : '') +
            '</div>' +
            rightSlot([actBtn('copy', IC_COPY, 'Copy'), actBtn('edit', IC_EDIT, 'Edit'), actBtn('delete', IC_DEL, 'Delete', 'del')]) +
        '</div>';
    }
    return '<div class="row" data-id="' + esc(it.id) + '" data-i="' + i + '">' +
        chipHTML(chipFor(it.text)) +
        '<div class="row-body">' +
            '<div class="row-text">' + esc(truncate(it.text, 160)) + '</div>' +
            '<div class="row-meta"><span>' + ago(it.timestamp) + '</span><span>·</span><span>' + fmtSize(it.text.length) + '</span>' + (it.pinned ? '<span>·</span><span>pinned</span>' : '') + '</div>' +
        '</div>' +
        rightSlot([
            (isUrl(it.text) ? actBtn('open', IC_OPEN, 'Open in browser') :
                isPath(it.text) ? actBtn('reveal', IC_REVEAL, 'Reveal in Finder') : ''),
            actBtn('pin', IC_PIN, it.pinned ? 'Unpin' : 'Pin', it.pinned ? 'on' : ''),
            actBtn('snippet', IC_BOOKMARK, 'Save as snippet'),
            actBtn('copy', IC_COPY, 'Copy'),
        ].filter(Boolean)) +
    '</div>';
}

function matchesSnippet(s, q) { return !q || s.title.toLowerCase().includes(q) || s.content.toLowerCase().includes(q) || (s.tag && s.tag.toLowerCase().includes(q)); }
function matchesHistory(h, q) { return !q || h.text.toLowerCase().includes(q); }

function computeFiltered() {
    const q = query.toLowerCase().trim();
    const hCount = history.filter(h => matchesHistory(h, q)).length;
    const sCount = snippets.filter(s => matchesSnippet(s, q)).length;
    $('countHistory').textContent = hCount || '';
    $('countSnippets').textContent = sCount || '';
    filtered = scope === 'snippets'
        ? snippets.filter(s => matchesSnippet(s, q)).sort(snippetSort)   // most-used first
        : history.filter(h => matchesHistory(h, q));
    if (selectedIndex >= filtered.length) selectedIndex = Math.max(0, filtered.length - 1);
}

// When searching Snippets, offer to create a snippet from the query as the
// first thing in the list — "search, and if it's not there, just make it".
function createRowHTML() {
    const q = query.trim();
    if (scope !== 'snippets' || !q) return '';
    return '<div class="create-row" id="createRow">' +
        '<span class="create-plus">+</span>' +
        '<span class="create-label">Create snippet “' + esc(truncate(q, 40)) + '”</span>' +
        '<span class="kbd">⏎</span>' +
    '</div>';
}

function render() {
    computeFiltered();
    // The create affordance lives in its own slot above the list, so it never
    // offsets keyboard selection over the real rows.
    $('createSlot').innerHTML = createRowHTML();
    const cr = $('createRow');
    if (cr) cr.onclick = () => openAdd(query.trim());

    const isSnip = scope === 'snippets';
    // A "+ New snippet" bar at the end of the list is the in-context way to add,
    // so the header + doesn't have to carry the whole job.
    const addBar = isSnip ? '<div class="snippet-add" id="snippetAddBar"><span class="sa-plus">+</span>New snippet</div>' : '';

    if (!filtered.length) {
        $('list').innerHTML = isSnip && !query.trim() ? addBar : '';
        if (!(isSnip && !query.trim())) showEmpty();
        wireAddBar();
        return;
    }
    $('empty').classList.add('hidden');
    $('list').innerHTML = filtered.map((it, i) => rowHTML(it, i, isSnip)).join('') + addBar;
    wireAddBar();
    applySelection();
}
function wireAddBar() { const b = $('snippetAddBar'); if (b) b.onclick = () => openAdd(); }

function applySelection() {
    const rows = $('list').children;
    for (let i = 0; i < rows.length; i++) rows[i].classList.toggle('sel', i === selectedIndex);
}
function moveSel(d) {
    if (!filtered.length) return;
    selectedIndex = Math.max(0, Math.min(filtered.length - 1, selectedIndex + d));
    applySelection();
    const row = $('list').children[selectedIndex];
    if (row) row.scrollIntoView({ block: 'nearest' });
}

function showEmpty() {
    const q = query.trim();
    const empty = $('empty');
    empty.classList.remove('hidden');
    let glyph = '◇', title = 'Nothing copied yet', sub = 'Copy something and it shows up here.', btn = '';
    if (scope === 'snippets' && q) { glyph = '＋'; title = 'No snippet matches “' + q + '”'; sub = 'Press ⏎ or the button above to create it.'; }
    else if (q) { glyph = '⌕'; title = 'No matches for “' + q + '”'; sub = 'Search covers text, titles, and tags.'; }
    else if (scope === 'snippets') { glyph = '＋'; title = 'No saved snippets yet'; sub = 'Save anything you paste often — the + button, or ⌘N.'; btn = 'New snippet'; }
    else if (settings.enabled === false) { glyph = '⏻'; title = 'Clipboard recording is off'; sub = 'Turn it back on in Settings.'; btn = 'Open Settings'; }
    $('emptyGlyph').textContent = glyph;
    $('emptyTitle').textContent = title;
    $('emptySub').textContent = sub;
    const b = $('emptyBtn');
    if (btn) { b.textContent = btn; b.classList.remove('hidden'); b.onclick = () => (scope === 'snippets' ? openAdd() : openSettings()); }
    else b.classList.add('hidden');
}

function setSegActive() {
    document.querySelectorAll('.seg').forEach(s => s.classList.toggle('active', s.dataset.scope === scope));
}
function switchScope(s) {
    if (s === scope) return;
    scope = s; setSegActive(); selectedIndex = 0; render(); $('search').focus();
}

// ---- list interaction ----
$('list').addEventListener('click', e => {
    const row = e.target.closest('.row'); if (!row) return;
    const id = row.dataset.id;
    const actEl = e.target.closest('[data-action]');
    if (scope === 'snippets') {
        const it = snippets.find(s => s.id === id); if (!it) return;
        if (!actEl) { e.metaKey ? copyItem(it) : activate(it); return; }
        const a = actEl.dataset.action;
        if (a === 'copy') copyItem(it);
        else if (a === 'edit') openEdit(it);
        else if (a === 'delete') deleteSnippet(id);
    } else {
        const it = history.find(h => h.id === id); if (!it) return;
        if (!actEl) { e.metaKey ? copyItem(it) : activate(it); return; }
        const a = actEl.dataset.action;
        if (a === 'copy') copyItem(it);
        else if (a === 'pin') togglePinItem(it);
        else if (a === 'snippet') saveAsSnippet(it);
        else if (a === 'open') invoke('open_url', { url: it.text });
        else if (a === 'reveal') invoke('reveal_path', { path: it.text });
    }
});
$('list').addEventListener('mousemove', e => {
    const row = e.target.closest('.row'); if (!row) return;
    const i = parseInt(row.dataset.i, 10);
    if (i !== selectedIndex) { selectedIndex = i; applySelection(); }
});

$('segments').addEventListener('click', e => { const seg = e.target.closest('.seg'); if (seg) switchScope(seg.dataset.scope); });
$('gearBtn').onclick = openSettings;
$('addBtn').onclick = () => openAdd();

$('search').addEventListener('input', () => { query = $('search').value; selectedIndex = 0; render(); });

function onClipboardUpdate(entry) {
    history = history.filter(h => h.text !== entry.text);
    history.unshift(entry);
    if (history.length > 600) history.length = 600;   // session safety cap
    if (scope === 'history') render();
}

// ---- add / edit sheet ----
let titleEdited = false;
// A short title from the content's first line — the content is the snippet;
// the title is just a label, so it's generated unless the user overrides it.
function deriveTitle(text) {
    const first = String(text || '').split('\n')[0].trim();
    return first.length > 44 ? first.slice(0, 44).trim() + '…' : first;
}
function openAdd(prefillContent) {
    editingId = null;
    titleEdited = false;
    $('addTitle').textContent = 'New snippet';
    $('content').value = prefillContent || '';
    $('title').value = deriveTitle(prefillContent || '');
    $('tag').value = '';
    $('addSheet').classList.remove('hidden');
    // The text is the snippet — land the cursor there, not on the title.
    setTimeout(() => { const c = $('content'); c.focus(); c.setSelectionRange(c.value.length, c.value.length); }, 0);
}
$('content').addEventListener('input', () => { if (!titleEdited) $('title').value = deriveTitle($('content').value); });
$('title').addEventListener('input', () => { titleEdited = true; });
function openEdit(it) {
    editingId = it.id;
    titleEdited = true;   // existing snippet has a user-set title; don't auto-overwrite
    $('addTitle').textContent = 'Edit snippet';
    $('title').value = it.title; $('content').value = it.content; $('tag').value = it.tag || '';
    $('addSheet').classList.remove('hidden');
    setTimeout(() => $('content').focus(), 0);
}
function closeAdd() { $('addSheet').classList.add('hidden'); }
async function saveSnippet() {
    const content = $('content').value.trim();
    const tag = $('tag').value.trim();
    const title = $('title').value.trim() || deriveTitle(content);
    if (!content) { toast('Snippet text required'); return; }
    const now = Date.now();
    if (editingId) {
        const s = snippets.find(x => x.id === editingId);
        if (s) { s.title = title; s.content = content; s.tag = tag; s.updated = now; }
        toast('Updated');
    } else {
        snippets.unshift({ id: now.toString(36) + Math.random().toString(36).slice(2, 6), title, content, tag, created: now, updated: now, uses: 0, last_used: 0 });
        toast('Saved');
    }
    await saveSnippets();
    editingId = null;
    closeAdd();
    render();
}
async function deleteSnippet(id) {
    snippets = snippets.filter(s => s.id !== id);
    await saveSnippets();
    render();
    toast('Deleted');
}
$('saveBtn').onclick = saveSnippet;
$('addCancel').onclick = closeAdd;

// ---- settings sheet ----
function updateSettingsUI() {
    $('recordSwitch').setAttribute('aria-checked', settings.enabled !== false ? 'true' : 'false');
    document.querySelectorAll('#limitOptions .seg-opt').forEach(o => o.classList.toggle('active', parseInt(o.dataset.limit, 10) === settings.history_limit));
}
function updateFolderUI() {
    $('snippetsDir').textContent = settings.snippets_dir || 'Local (default)';
}
function openSettings() { $('settingsSheet').classList.remove('hidden'); updateSettingsUI(); updateFolderUI(); }

$('chooseFolder').onclick = async () => {
    if (!window.__TAURI__) return;
    const dir = await window.__TAURI__.dialog.open({ directory: true, title: 'Choose a folder to sync snippets' });
    if (!dir) return;
    snippets = (await invoke('set_snippets_dir', { dir })) || [];
    settings.snippets_dir = dir;
    updateFolderUI(); render();
    toast('Snippets folder set');
};
$('resetFolder').onclick = async () => {
    if (!window.__TAURI__ || !settings.snippets_dir) return;
    snippets = (await invoke('set_snippets_dir', { dir: null })) || [];
    settings.snippets_dir = null;
    updateFolderUI(); render();
    toast('Using default folder');
};
$('exportBtn').onclick = async () => {
    if (!window.__TAURI__) return;
    const path = await window.__TAURI__.dialog.save({ defaultPath: 'clipcork-snippets.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!path) return;
    const ok = await invoke('export_snippets_to', { path });
    toast(ok ? 'Snippets exported' : 'Export failed');
};
$('importBtn').onclick = async () => {
    if (!window.__TAURI__) return;
    const path = await window.__TAURI__.dialog.open({ filters: [{ name: 'JSON', extensions: ['json'] }], title: 'Import snippets' });
    if (!path) return;
    const imported = (await invoke('import_snippets_from', { path })) || [];
    const seen = new Set(snippets.map(s => s.content));
    let added = 0;
    for (const s of imported) {
        if (s && s.content && !seen.has(s.content)) {
            s.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            snippets.push(s); seen.add(s.content); added++;
        }
    }
    if (added) await saveSnippets();
    render();
    toast(added ? `Imported ${added} snippet${added > 1 ? 's' : ''}` : 'Nothing new to import');
};
function closeSettings() { $('settingsSheet').classList.add('hidden'); resetClearBtn(); }
$('settingsDone').onclick = closeSettings;

$('recordSwitch').onclick = async () => {
    settings.enabled = !(settings.enabled !== false);
    updateSettingsUI(); await saveSettings();
    toast(settings.enabled ? 'Recording on' : 'Recording off');
};
$('limitOptions').addEventListener('click', async e => {
    const o = e.target.closest('.seg-opt'); if (!o) return;
    settings.history_limit = parseInt(o.dataset.limit, 10);
    updateSettingsUI(); await saveSettings(); toast('Saved');
});

let clearArmed = false;
function resetClearBtn() { clearArmed = false; $('clearHistory').textContent = 'Clear clipboard history'; }
$('clearHistory').onclick = async () => {
    if (!clearArmed) { clearArmed = true; $('clearHistory').textContent = 'Click again to clear ' + history.length + ' items'; return; }
    await invoke('clear_clipboard_history');
    history = [];
    resetClearBtn();
    render();
    toast('History cleared');
};
$('quitApp').onclick = async () => { try { await invoke('plugin:process|exit', { code: 0 }); } catch (e) { console.error('quit failed', e); } };

// ---- keyboard ----
document.addEventListener('keydown', e => {
    const addOpen = !$('addSheet').classList.contains('hidden');
    const setOpen = !$('settingsSheet').classList.contains('hidden');
    if (addOpen || setOpen) {
        if (e.key === 'Escape') { closeAdd(); closeSettings(); e.preventDefault(); }
        else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && addOpen) { saveSnippet(); e.preventDefault(); }
        return;
    }
    const meta = e.metaKey || e.ctrlKey;
    if (e.key === 'ArrowDown') { moveSel(1); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { moveSel(-1); e.preventDefault(); }
    else if (e.key === 'Enter') {
        if (scope === 'snippets' && query.trim() && !filtered.length) openAdd(query.trim());
        else { const it = filtered[selectedIndex]; if (it) (e.metaKey ? copyItem(it) : activate(it)); }
        e.preventDefault();
    }
    else if (meta && e.key >= '1' && e.key <= '9') { const it = filtered[+e.key - 1]; if (it) activate(it); e.preventDefault(); }
    else if ((meta && (e.key === 'k' || e.key === 'K')) || e.key === 'Tab') { switchScope(scope === 'recent' ? 'snippets' : 'recent'); e.preventDefault(); }
    else if (meta && (e.key === 'n' || e.key === 'N')) { openAdd(); e.preventDefault(); }
    else if (meta && e.key === ',') { openSettings(); e.preventDefault(); }
    else if (meta && e.key === 'Backspace') { const it = filtered[selectedIndex]; if (it && scope === 'snippets') deleteSnippet(it.id); e.preventDefault(); }
    else if (e.key === 'Escape') { if ($('search').value) { $('search').value = ''; query = ''; selectedIndex = 0; render(); } else hidePanel(); e.preventDefault(); }
});

function resetUI() {
    query = ''; $('search').value = ''; scope = 'snippets'; setSegActive();
    selectedIndex = 0; closeAdd(); closeSettings();
    render();
    $('search').focus();
    $('list').scrollTop = 0;
}

// ---- auto-update (raw plugin invoke; matches beecork-terminal) ----
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
let pendingUpdate = null, dismissedVersion = null, updateBusy = false;
async function checkForUpdate() {
    if (!window.__TAURI__ || updateBusy) return;
    try {
        const meta = await window.__TAURI__.core.invoke('plugin:updater|check', {});
        if (updateBusy) return;
        if (meta && meta.version && meta.version !== dismissedVersion) {
            pendingUpdate = meta;
            $('updateText').textContent = 'ClipCork ' + meta.version + ' is ready.';
            $('updateInstall').textContent = 'Update & Restart'; $('updateInstall').disabled = false;
            $('updatePill').classList.remove('hidden');
        }
    } catch (e) { console.error('update check failed', e); }
}
$('updateInstall').onclick = async () => {
    if (!pendingUpdate || updateBusy) return;
    updateBusy = true;
    const btn = $('updateInstall'); btn.disabled = true; btn.textContent = 'Installing…';
    try {
        const core = window.__TAURI__.core;
        await core.invoke('plugin:updater|download_and_install', { onEvent: new core.Channel(), rid: pendingUpdate.rid });
        await core.invoke('plugin:process|restart');
    } catch (e) {
        console.error('update install failed', e);
        $('updateText').textContent = "Couldn't download the update. Check your connection.";
        btn.textContent = 'Retry'; btn.disabled = false; updateBusy = false;
    }
};
$('updateDismiss').onclick = () => { dismissedVersion = pendingUpdate ? pendingUpdate.version : null; pendingUpdate = null; $('updatePill').classList.add('hidden'); };

// ---- boot ----
document.addEventListener('DOMContentLoaded', async () => {
    await loadSnippets();
    await loadHistory();
    await loadSettings();
    setSegActive();
    render();

    if (window.__TAURI__) {
        const win = tauriWindow();
        win.onCloseRequested(async (e) => { e.preventDefault(); win.hide(); });

        try { $('dataPath').textContent = (await invoke('get_data_path')) || ''; } catch (e) { console.error('get_data_path failed', e); }

        const { listen } = window.__TAURI__.event;
        try { await listen('clipboard-update', ev => onClipboardUpdate(ev.payload)); } catch (e) { console.error('clipboard-update listener failed', e); }
        try { await listen('panel-shown', resetUI); } catch (e) { console.error('panel-shown listener failed', e); }
        try { await listen('open-settings', openSettings); } catch (e) { console.error('open-settings listener failed', e); }

        checkForUpdate();
        setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
    }
});
