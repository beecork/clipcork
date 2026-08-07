const $ = id => document.getElementById(id);

let snippets = [];
let clipboardHistory = [];
let editingId = null;
let currentFilter = 'all';
let currentTab = 'snippets';
let settings = { history_limit: 20, enabled: true };

async function invoke(cmd, args) {
    if (window.__TAURI__) {
        const { invoke: tauriInvoke } = window.__TAURI__.core;
        return tauriInvoke(cmd, args);
    }
    return null;
}

// Escapes every character that is unsafe in either an element-text or a quoted
// attribute context. Unlike the textContent/innerHTML trick, this also escapes
// quotes, so values placed inside attributes cannot break out.
function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

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

function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 1500);
}

async function loadData() {
    if (window.__TAURI__) {
        try { snippets = await invoke('load_snippets') || []; }
        catch (e) { console.error('load_snippets failed', e); snippets = []; }
    } else {
        try { snippets = JSON.parse(localStorage.getItem('clipcork') || '[]'); } catch { snippets = []; }
    }
}

async function saveData() {
    if (window.__TAURI__) {
        try { await invoke('save_snippets', { snippets }); }
        catch (e) { console.error('save_snippets failed', e); }
    } else {
        localStorage.setItem('clipcork', JSON.stringify(snippets));
    }
}

async function loadHistory() {
    if (window.__TAURI__) {
        try { clipboardHistory = await invoke('load_clipboard_history') || []; }
        catch (e) { console.error('load_clipboard_history failed', e); clipboardHistory = []; }
    } else {
        try { clipboardHistory = JSON.parse(localStorage.getItem('clipcork_history') || '[]'); } catch { clipboardHistory = []; }
    }
}

async function loadSettings() {
    if (window.__TAURI__) {
        try { settings = await invoke('get_settings') || { history_limit: 20, enabled: true }; }
        catch (e) { console.error('get_settings failed', e); settings = { history_limit: 20, enabled: true }; }
    } else {
        try { settings = JSON.parse(localStorage.getItem('clipcork_settings') || '{"history_limit":20,"enabled":true}'); } catch { settings = { history_limit: 20, enabled: true }; }
    }
    updateSettingsUI();
}

async function saveSettings() {
    if (window.__TAURI__) {
        try { await invoke('save_settings_cmd', { settings }); }
        catch (e) { console.error('save_settings_cmd failed', e); }
    } else {
        localStorage.setItem('clipcork_settings', JSON.stringify(settings));
    }
}

async function copyText(text) {
    if (window.__TAURI__) {
        const ok = await invoke('write_clipboard', { text });
        if (ok) { toast('Copied!'); return; }
    }
    navigator.clipboard.writeText(text).then(() => toast('Copied!')).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        toast('Copied!');
    });
}

async function pasteText(text) {
    if (window.__TAURI__) {
        const ok = await invoke('paste_and_hide', { text });
        if (ok === false) toast('Enable Accessibility to paste');
    }
}

function getTags() {
    const tags = new Set();
    snippets.forEach(s => { if (s.tag) tags.add(s.tag.toLowerCase()); });
    return [...tags].sort();
}

function renderFilters() {
    const tags = getTags();
    if (tags.length < 2) { $('filters').classList.add('hidden'); return; }
    $('filters').classList.remove('hidden');
    $('filters').innerHTML = '<button class="filter-btn ' + (currentFilter === 'all' ? 'active' : '') + '" data-f="all">All</button>' +
        tags.map(t => '<button class="filter-btn ' + (currentFilter === t ? 'active' : '') + '" data-f="' + esc(t) + '">' + esc(t) + '</button>').join('');
}

// Icon markup lives in constants so the render functions stay readable and the
// SVGs aren't duplicated across the two lists.
const IC_EXPAND = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/></svg>';
const IC_COPY = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
const IC_EDIT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
const IC_DEL = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>';
const IC_PIN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76z"/></svg>';
const IC_PASTE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1z"/><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></svg>';

function actBtn(action, icon, title) {
    return '<button class="act-btn ' + action + '" data-action="' + action + '" title="' + title + '">' + icon + '</button>';
}

function render() {
    const q = $('search').value.toLowerCase().trim();
    let list = snippets;
    if (currentFilter !== 'all') list = list.filter(s => s.tag && s.tag.toLowerCase() === currentFilter);
    if (q) list = list.filter(s => s.title.toLowerCase().includes(q) || s.content.toLowerCase().includes(q) || (s.tag && s.tag.toLowerCase().includes(q)));

    renderFilters();

    if (list.length === 0) {
        $('list').classList.add('hidden');
        $('empty').classList.remove('hidden');
        $('empty').querySelector('p').textContent = q || currentFilter !== 'all' ? 'No matches' : 'No snippets yet';
        $('empty').querySelector('.sub').textContent = q ? 'Try a different search' : 'Press + to add one';
        return;
    }

    $('empty').classList.add('hidden');
    $('list').classList.remove('hidden');
    $('list').innerHTML = list.map(s => {
        const isLong = s.content.length > 80;
        return '<div class="item" data-id="' + esc(s.id) + '">' +
            '<div class="item-body" data-action="copy">' +
                '<div class="item-title">' + esc(s.title) + '</div>' +
                '<div class="item-preview">' + esc(s.content) + '</div>' +
                '<div class="item-meta">' +
                    (s.tag ? '<span class="item-tag">' + esc(s.tag) + '</span>' : '') +
                    '<span class="item-age">' + ago(s.created) + '</span>' +
                '</div>' +
            '</div>' +
            '<div class="item-actions">' +
                (isLong ? actBtn('expand', IC_EXPAND, 'Expand') : '') +
                actBtn('copy', IC_COPY, 'Copy') +
                actBtn('edit', IC_EDIT, 'Edit') +
                actBtn('delete', IC_DEL, 'Delete') +
            '</div>' +
        '</div>';
    }).join('');
}

function renderHistory() {
    if (clipboardHistory.length === 0) {
        $('historyList').classList.add('hidden');
        $('historyEmpty').classList.remove('hidden');
        return;
    }

    $('historyEmpty').classList.add('hidden');
    $('historyList').classList.remove('hidden');
    $('historyList').innerHTML = clipboardHistory.map(h => {
        const isLong = h.text.length > 100;
        return '<div class="history-item" data-id="' + esc(h.id) + '">' +
            '<div class="history-body" data-action="copy">' +
                '<div class="history-text">' + esc(h.text) + '</div>' +
                '<div class="history-time">' + ago(h.timestamp) + '</div>' +
            '</div>' +
            '<div class="history-actions">' +
                (isLong ? actBtn('expand', IC_EXPAND, 'Expand') : '') +
                actBtn('pin', IC_PIN, 'Save as snippet') +
                actBtn('paste', IC_PASTE, 'Paste') +
                actBtn('copy', IC_COPY, 'Copy') +
            '</div>' +
        '</div>';
    }).join('');
}

// One delegated handler per list — no inline onclick, so the strict CSP holds
// and no id is ever interpolated into an executable context.
$('list').addEventListener('click', e => {
    const item = e.target.closest('.item');
    if (!item) return;
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    const id = item.dataset.id;
    const s = snippets.find(x => x.id === id);
    if (!s) return;
    switch (actionEl.dataset.action) {
        case 'copy': copyText(s.content); break;
        case 'edit': editItem(id); break;
        case 'delete': deleteItem(id); break;
        case 'expand': { const p = item.querySelector('.item-preview'); if (p) p.classList.toggle('expanded'); break; }
    }
});

$('historyList').addEventListener('click', e => {
    const item = e.target.closest('.history-item');
    if (!item) return;
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    const id = item.dataset.id;
    const h = clipboardHistory.find(x => x.id === id);
    if (!h) return;
    switch (actionEl.dataset.action) {
        case 'copy': copyText(h.text); break;
        case 'paste': pasteText(h.text); break;
        case 'pin': pinItem(id); break;
        case 'expand': { const t = item.querySelector('.history-text'); if (t) t.classList.toggle('expanded'); break; }
    }
});

function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    const targetId = 'tab' + tab.charAt(0).toUpperCase() + tab.slice(1);
    document.querySelectorAll('.tab-content').forEach(tc => tc.classList.toggle('active', tc.id === targetId));

    if (tab === 'history') {
        loadHistory().then(renderHistory);
    }
    if (tab === 'snippets') {
        loadData().then(render);
    }
}

function updateSettingsUI() {
    document.querySelectorAll('#limitOptions .setting-opt').forEach(opt => {
        opt.classList.toggle('active', parseInt(opt.dataset.limit) === settings.history_limit);
    });
    document.querySelectorAll('#recordOptions .setting-opt').forEach(opt => {
        opt.classList.toggle('active', (opt.dataset.rec === 'on') === (settings.enabled !== false));
    });
}

function togglePanel(panelId, btnId) {
    const panel = $(panelId);
    const btn = $(btnId);
    const isHidden = panel.classList.contains('hidden');
    panel.classList.toggle('hidden');
    btn.classList.toggle('active', isHidden);
    if (isHidden && panelId === 'addPanel') {
        $('searchBar').classList.add('hidden');
        $('searchToggle').classList.remove('active');
    }
    if (isHidden && panelId === 'searchBar') {
        $('addPanel').classList.add('hidden');
        $('addToggle').classList.remove('active');
    }
}

function onClipboardUpdate(entry) {
    // A focus/tab reload can read the file after the watcher wrote it but before
    // this event arrives, so guard against inserting the same entry twice.
    if (clipboardHistory.some(h => h.id === entry.id)) return;
    clipboardHistory.unshift(entry);
    if (clipboardHistory.length > settings.history_limit) {
        clipboardHistory = clipboardHistory.slice(0, settings.history_limit);
    }
    if (currentTab === 'history') renderHistory();
}

$('searchToggle').onclick = () => togglePanel('searchBar', 'searchToggle');
$('addToggle').onclick = () => togglePanel('addPanel', 'addToggle');
$('search').oninput = render;

$('filters').onclick = e => {
    if (e.target.classList.contains('filter-btn')) {
        currentFilter = e.target.dataset.f;
        render();
    }
};

document.querySelectorAll('.tab').forEach(tab => {
    tab.onclick = () => switchTab(tab.dataset.tab);
});

$('limitOptions').onclick = async e => {
    const opt = e.target.closest('.setting-opt');
    if (!opt) return;
    settings.history_limit = parseInt(opt.dataset.limit);
    await saveSettings();
    updateSettingsUI();
    toast('Saved');
};

$('recordOptions').onclick = async e => {
    const opt = e.target.closest('.setting-opt');
    if (!opt) return;
    settings.enabled = opt.dataset.rec === 'on';
    await saveSettings();
    updateSettingsUI();
    toast(settings.enabled ? 'Recording on' : 'Recording off');
};

$('clearHistory').onclick = async () => {
    if (window.__TAURI__) {
        try { await invoke('clear_clipboard_history'); }
        catch (e) { console.error('clear_clipboard_history failed', e); }
    }
    clipboardHistory = [];
    renderHistory();
    toast('History cleared');
};

async function saveItem() {
    const title = $('title').value.trim();
    const content = $('content').value.trim();
    const tag = $('tag').value.trim();
    if (!title || !content) { toast('Title & content required'); return; }

    const now = Date.now();
    if (editingId) {
        const idx = snippets.findIndex(s => s.id === editingId);
        if (idx !== -1) { snippets[idx].title = title; snippets[idx].content = content; snippets[idx].tag = tag; snippets[idx].updated = now; }
        editingId = null;
        $('saveBtn').textContent = 'Save';
        toast('Updated');
    } else {
        snippets.unshift({ id: now.toString(36) + Math.random().toString(36).slice(2, 6), title, content, tag, created: now, updated: now });
        toast('Saved');
    }

    await saveData();
    $('title').value = ''; $('content').value = ''; $('tag').value = '';
    $('addPanel').classList.add('hidden');
    $('addToggle').classList.remove('active');
    render();
}

$('saveBtn').onclick = saveItem;
$('content').onkeydown = e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveItem(); };

function editItem(id) {
    const s = snippets.find(x => x.id === id);
    if (!s) return;
    $('title').value = s.title;
    $('content').value = s.content;
    $('tag').value = s.tag || '';
    editingId = id;
    $('saveBtn').textContent = 'Update';
    $('addPanel').classList.remove('hidden');
    $('addToggle').classList.add('active');
    switchTab('snippets');
    $('title').focus();
}

async function deleteItem(id) {
    snippets = snippets.filter(s => s.id !== id);
    await saveData();
    if (editingId === id) { editingId = null; $('saveBtn').textContent = 'Save'; $('title').value = ''; $('content').value = ''; $('tag').value = ''; }
    render();
    toast('Deleted');
}

async function pinItem(id) {
    const entry = clipboardHistory.find(x => x.id === id);
    if (!entry) return;

    if (window.__TAURI__) {
        try {
            const snippet = await invoke('pin_to_snippets', { content: entry.text });
            snippets.unshift(snippet);
        } catch (e) { console.error('pin_to_snippets failed', e); return; }
    } else {
        const now = Date.now();
        const preview = [...entry.text].slice(0, 50).join('');
        snippets.unshift({
            id: now.toString(36) + Math.random().toString(36).slice(2, 6),
            title: [...entry.text].length > 50 ? preview + '...' : preview,
            content: entry.text,
            tag: '',
            created: now,
            updated: now,
        });
        await saveData();
    }

    toast('Pinned as snippet');
}

// ---- Auto-update (mirrors beecork-terminal's UpdateBanner) -----------------
// The no-bundler frontend drives the updater/process plugins through the
// guaranteed-global core.invoke + Channel, rather than the npm ESM wrappers.
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
let pendingUpdate = null;   // { rid, version, ... } from plugin:updater|check
let dismissedVersion = null;
let updateBusy = false;

async function checkForUpdate() {
    if (!window.__TAURI__) return;
    if (updateBusy) return;
    try {
        // Returns null when up to date, else update metadata (with a `rid`).
        const meta = await window.__TAURI__.core.invoke('plugin:updater|check', {});
        if (updateBusy) return;
        if (meta && meta.version && meta.version !== dismissedVersion) {
            pendingUpdate = meta;
            $('updateText').textContent = 'ClipCork ' + meta.version + ' is available.';
            $('updateInstall').textContent = 'Update & Restart';
            $('updateInstall').disabled = false;
            $('updateBanner').classList.remove('hidden');
        }
    } catch (e) {
        // Offline, no release yet, or endpoint unreachable — stay quiet.
        console.error('update check failed', e);
    }
}

async function installUpdate() {
    if (!pendingUpdate || updateBusy) return;
    updateBusy = true;
    const btn = $('updateInstall');
    btn.disabled = true;
    btn.textContent = 'Installing…';
    try {
        const core = window.__TAURI__.core;
        const onEvent = new core.Channel();
        await core.invoke('plugin:updater|download_and_install', {
            onEvent,
            rid: pendingUpdate.rid,
        });
        await core.invoke('plugin:process|restart');
    } catch (e) {
        console.error('update install failed', e);
        $('updateText').textContent = 'Update failed.';
        btn.textContent = 'Retry';
        btn.disabled = false;
        updateBusy = false;
    }
}

$('updateInstall').onclick = installUpdate;
$('updateDismiss').onclick = () => {
    dismissedVersion = pendingUpdate ? pendingUpdate.version : null;
    pendingUpdate = null;
    $('updateBanner').classList.add('hidden');
};

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        if (window.__TAURI__) {
            const { getCurrentWindow } = window.__TAURI__.window;
            getCurrentWindow().hide();
        }
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    await loadData();
    await loadHistory();
    await loadSettings();

    switchTab('snippets');

    if (window.__TAURI__) {
        const { getCurrentWindow } = window.__TAURI__.window;
        getCurrentWindow().onCloseRequested(async (e) => {
            e.preventDefault();
            getCurrentWindow().hide();
        });

        const win = getCurrentWindow();
        win.onFocusChanged(async ({ payload: focused }) => {
            if (focused) {
                await loadHistory();
                await loadData();
                if (currentTab === 'history') renderHistory();
                render();
            }
        });

        try {
            const dataPath = await invoke('get_data_path');
            $('dataPath').textContent = dataPath;
        } catch (e) { console.error('get_data_path failed', e); }

        try {
            const { listen } = window.__TAURI__.event;
            await listen('clipboard-update', (event) => {
                onClipboardUpdate(event.payload);
            });
        } catch (e) {
            console.error('clipboard-update listener failed to register', e);
        }

        // Check for updates on launch, then periodically while the panel lives.
        checkForUpdate();
        setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
    }
});
