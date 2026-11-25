'use strict';
/*
 * Cutroom — personal video review on top of Google Drive.
 * Videos stream from Drive (via sw.js); review data lives in one JSON file
 * in your Drive. No backend.
 */

// ───────────────────────── helpers ─────────────────────────
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value' && (tag === 'textarea' || tag === 'input')) el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
function readJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
function writeJSON(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch { return false; }
}
function timeAgo(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 604800) return Math.floor(s / 86400) + 'd ago';
  return new Date(ts).toLocaleDateString();
}
function fmtTC(t, fps) {
  if (!isFinite(t) || t < 0) t = 0;
  const base = Math.round(fps);
  const total = Math.floor(t * fps + 1e-4);
  const ff = total % base, s = Math.floor(total / base);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60, ff].map((n) => String(n).padStart(2, '0')).join(':');
}
function fmtDur(sec) {
  if (!isFinite(sec)) return '';
  sec = Math.round(sec);
  const m = Math.floor(sec / 60), s = sec % 60, hr = Math.floor(m / 60);
  return hr ? `${hr}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
const stripExt = (n) => n.replace(/\.[a-z0-9]{2,5}$/i, '');
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3600);
}

const ICONS = {
  play: '<polygon points="7 4 20 12 7 20 7 4" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/>',
  stepBack: '<polygon points="18 19 9 12 18 5" fill="currentColor" stroke="none"/><path d="M6 5v14"/>',
  stepFwd: '<polygon points="6 5 15 12 6 19" fill="currentColor" stroke="none"/><path d="M18 5v14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  arrow: '<path d="M5 19 19 5M9 5h10v10"/>',
  box: '<rect x="4" y="5" width="16" height="14" rx="1.5"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  film: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4M3 12h18"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  mute: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="m22 9-6 6M16 9l6 6"/>',
  expand: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  external: '<path d="M14 3h7v7M10 14 21 3M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  comment: '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12Z"/>',
  more: '<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  loop: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
};
function icon(name) {
  return h('span', { class: 'ic', 'aria-hidden': 'true', html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>` });
}

const STATUSES = {
  review: { label: 'In review', cls: 'st-review' },
  changes: { label: 'Needs changes', cls: 'st-changes' },
  approved: { label: 'Approved', cls: 'st-approved' },
};
const statusPill = (s) => s && STATUSES[s]
  ? h('span', { class: 'pill ' + STATUSES[s].cls }, STATUSES[s].label)
  : h('span', { class: 'pill st-new' }, 'New');

const FPS_OPTIONS = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
const INK_COLORS = ['#ff4d5e', '#ffd43b', '#3ee08f', '#4dabff', '#ffffff'];

// ───────────────────────── settings ─────────────────────────
const SETTINGS_KEY = 'cutroom:settings';
// OAuth client IDs are public identifiers (not secrets). This one belongs to the
// "Cutroom" Google Cloud project and allows http://localhost:8080 and
// https://midnghtco-create.github.io. Settings can override it.
const DEFAULT_CLIENT_ID = '557904981340-ug5gb6fov965566pfgkat1hnmn330jku.apps.googleusercontent.com';
const settings = Object.assign({ clientId: DEFAULT_CLIENT_ID, name: '', fps: 24, backend: null }, readJSON(SETTINGS_KEY, {}));
if (!settings.clientId) settings.clientId = DEFAULT_CLIENT_ID;
const saveSettings = () => writeJSON(SETTINGS_KEY, settings);

// ───────────────────────── Google Drive ─────────────────────────
const SCOPES = 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file';
const DATA_FILE = 'cutroom-data.json';
const PROXY_FOLDER = 'Cutroom proxies';
const HELPER_URL = 'http://127.0.0.1:8765';
const TOKEN_KEY = 'cutroom:token';

const Drive = {
  token: null, expiresAt: 0, client: null, clientFor: null, pending: null, user: null, dataFileId: null,

  restoreToken() {
    try {
      const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY));
      if (t && t.exp > Date.now() + 60000) { this.token = t.token; this.expiresAt = t.exp; postTokenToSW(t.token); return true; }
    } catch { /* ignore */ }
    return false;
  },
  validToken() { return this.token && Date.now() < this.expiresAt; },
  init() {
    if (!window.google?.accounts?.oauth2) throw new Error('Google sign-in did not load. Check your connection and reload.');
    if (!settings.clientId) throw new Error('Add your OAuth client ID first.');
    if (this.client && this.clientFor === settings.clientId) return;
    this.client = google.accounts.oauth2.initTokenClient({ client_id: settings.clientId, scope: SCOPES, callback: () => {} });
    this.clientFor = settings.clientId;
  },
  requestToken(prompt = '') {
    return new Promise((resolve, reject) => {
      try { this.init(); } catch (e) { reject(e); return; }
      this.client.callback = (resp) => {
        if (resp.error) { reject(new Error(resp.error_description || resp.error)); return; }
        this.token = resp.access_token;
        this.expiresAt = Date.now() + (Number(resp.expires_in || 3600) - 60) * 1000;
        // Google lets people untick individual permissions. Cutroom needs both.
        this.missingScopes = !google.accounts.oauth2.hasGrantedAllScopes(resp, ...SCOPES.split(' '));
        try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token: this.token, exp: this.expiresAt })); } catch { /* ignore */ }
        postTokenToSW(this.token);
        resolve(this.token);
      };
      this.client.error_callback = (err) => reject(new Error(err?.type === 'popup_closed' ? 'Sign-in window was closed' : (err?.message || 'Sign-in failed')));
      this.client.requestAccessToken({ prompt });
    });
  },
  async getToken() {
    if (this.validToken()) return this.token;
    if (!this.pending) this.pending = this.requestToken('').finally(() => { this.pending = null; });
    return this.pending;
  },
  async api(path, opts = {}) {
    const url = path.startsWith('http') ? path : 'https://www.googleapis.com/drive/v3/' + path;
    const go = async () => fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + (await this.getToken()) } });
    let r = await go();
    if (r.status === 401) { this.token = null; r = await go(); }
    if (!r.ok) {
      let msg = r.status + ' ' + r.statusText;
      try { const j = await r.json(); msg = j.error?.message || msg; } catch { /* ignore */ }
      throw new Error(msg);
    }
    return r;
  },
  async list(q, fields, orderBy = 'name') {
    const files = [];
    let pageToken;
    do {
      const p = new URLSearchParams({ q, fields: `nextPageToken,files(${fields})`, pageSize: '200', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' });
      if (orderBy) p.set('orderBy', orderBy);
      if (pageToken) p.set('pageToken', pageToken);
      const j = await (await this.api('files?' + p)).json();
      files.push(...(j.files || []));
      pageToken = j.nextPageToken;
    } while (pageToken);
    return files;
  },
  folders(parent) { return this.list(`'${parent}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`, 'id,name'); },
  sharedFolders() { return this.list(`sharedWithMe and mimeType='application/vnd.google-apps.folder' and trashed=false`, 'id,name'); },
  videos(folder) {
    return this.list(`'${folder}' in parents and mimeType contains 'video/' and trashed=false`,
      'id,name,mimeType,size,thumbnailLink,videoMediaMetadata,modifiedTime,createdTime');
  },
  // Proxies live in a "Cutroom proxies" subfolder; each is tagged with the original's file id.
  async proxies(folderId) {
    const map = new Map();
    const subs = await this.list(`'${folderId}' in parents and name='${PROXY_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`, 'id', null);
    for (const s of subs) {
      const files = await this.list(`'${s.id}' in parents and trashed=false and mimeType contains 'video/'`, 'id,name,size,appProperties,thumbnailLink,modifiedTime', null);
      for (const f of files) {
        const of = f.appProperties?.cutroomProxyOf;
        if (of && (!map.has(of) || (f.modifiedTime || '') > (map.get(of).modifiedTime || ''))) map.set(of, f);
      }
    }
    return map;
  },
  async meta(id) { return (await this.api(`files/${id}?fields=id,name,mimeType&supportsAllDrives=true`)).json(); },
  async about() { return (await this.api('about?fields=user(displayName,emailAddress)')).json(); },

  async loadData() {
    const files = await this.list(`name='${DATA_FILE}' and trashed=false and 'me' in owners`, 'id,modifiedTime', 'modifiedTime desc');
    if (!files.length) { this.dataFileId = null; return emptyData(); }
    this.dataFileId = files[0].id;
    const r = await this.api(`files/${this.dataFileId}?alt=media`);
    try { return normalizeData(await r.json()); } catch { return emptyData(); }
  },
  async saveData(data) {
    const body = JSON.stringify(data);
    if (this.dataFileId) {
      await this.api(`https://www.googleapis.com/upload/drive/v3/files/${this.dataFileId}?uploadType=media`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
      return;
    }
    const boundary = 'cutroom' + uid();
    const meta = { name: DATA_FILE, mimeType: 'application/json', description: 'Cutroom review notes (comments, drawings, versions, approvals).' };
    const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
    const r = await this.api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
      { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body: multipart });
    this.dataFileId = (await r.json()).id;
  },
  signOut() {
    if (this.token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(this.token, () => {});
    this.token = null; this.expiresAt = 0; this.user = null; this.dataFileId = null;
    try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
    postTokenToSW(null);
  },
};

function waitForGIS(ms = 10000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function poll() {
      if (window.google?.accounts?.oauth2) return resolve();
      if (Date.now() - start > ms) return reject(new Error('Google sign-in did not load. Check your connection and reload.'));
      setTimeout(poll, 100);
    })();
  });
}

// ───────────────────────── service worker ─────────────────────────
let swReady = false;
function postTokenToSW(token) {
  navigator.serviceWorker?.controller?.postMessage({ type: 'token', token });
}
async function setupSW() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return false;
  navigator.serviceWorker.addEventListener('message', async (e) => {
    if (e.data?.type !== 'need-token' || !e.ports[0]) return;
    try { e.ports[0].postMessage(Store.backend === 'drive' ? await Drive.getToken() : null); }
    catch { e.ports[0].postMessage(null); }
  });
  try {
    await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((r) => { navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }); setTimeout(r, 3000); });
    }
    return !!navigator.serviceWorker.controller;
  } catch (err) {
    console.warn('Service worker unavailable, falling back to full downloads', err);
    return false;
  }
}

// ───────────────────────── data store ─────────────────────────
const emptyData = () => ({ version: 1, projects: [], assets: {} });
function normalizeData(d) {
  const out = Object.assign(emptyData(), d || {});
  if (!Array.isArray(out.projects)) out.projects = [];
  if (!out.assets || typeof out.assets !== 'object') out.assets = {};
  for (const a of Object.values(out.assets)) { a.versions ||= []; a.comments ||= []; for (const c of a.comments) c.replies ||= []; }
  return out;
}
const LOCAL_DATA_KEY = 'cutroom:local-data';

const Store = {
  backend: null, data: emptyData(), timer: null, dirty: false, chain: Promise.resolve(),
  async load(backend) {
    this.backend = backend;
    this.data = backend === 'local' ? normalizeData(readJSON(LOCAL_DATA_KEY, null)) : await Drive.loadData();
  },
  onSave: null,
  save(opts) {
    if (!opts?.quiet) this.onSave?.();
    this.dirty = true;
    setSaveState('saving');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.backend === 'local' ? 150 : 900);
  },
  flush() {
    clearTimeout(this.timer);
    this.chain = this.chain.then(async () => {
      if (!this.dirty) return;
      this.dirty = false;
      try {
        if (this.backend === 'local') {
          if (!writeJSON(LOCAL_DATA_KEY, this.data)) throw new Error('Browser storage is full or blocked');
        } else {
          await Drive.saveData(this.data);
        }
        setSaveState(this.dirty ? 'saving' : 'saved');
      } catch (e) {
        this.dirty = true;
        setSaveState('error');
        if (/insufficient.*scope|insufficientPermissions/i.test(e.message)) askForMissingScopes();
        else toast('Could not save: ' + e.message);
      }
    });
    return this.chain;
  },
};
window.addEventListener('beforeunload', (e) => { if (Store.dirty) { Store.flush(); e.preventDefault(); e.returnValue = ''; } });

let scopeModalOpen = false;
function askForMissingScopes() {
  if (scopeModalOpen) return;
  scopeModalOpen = true;
  const m = modal({
    title: 'Cutroom needs one more permission',
    onClose: () => { scopeModalOpen = false; },
    body: [
      h('p', {}, 'Cutroom can read your Drive, but it isn’t allowed to save your notes yet. Google lists each permission with its own checkbox, and the one that lets Cutroom ',
        h('b', {}, 'create and edit its own files'), ' wasn’t ticked.'),
      h('p', { class: 'muted small' }, 'That permission only covers the notes file Cutroom makes (', h('code', {}, DATA_FILE), '). It can’t change your videos or any other file.'),
      h('p', { class: 'muted small' }, 'In the next Google window, make sure every checkbox is ticked.'),
    ],
    foot: [
      h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Not now'),
      h('button', { class: 'btn primary', onclick: async () => {
        try {
          await Drive.requestToken('consent');
          if (Drive.missingScopes) { toast('That permission is still unticked, so notes can’t be saved yet'); return; }
          m.close();
          Store.dirty = true;
          await Store.flush();
          toast('Thanks! Your notes are saving to Drive again');
        } catch (e) { toast(e.message); }
      } }, 'Grant permission'),
    ],
  });
}

function setSaveState(s) {
  const el = $('#save-state');
  if (!el) return;
  el.dataset.state = s;
  el.textContent = { saving: 'Saving…', saved: Store.backend === 'drive' ? 'Saved to Drive' : 'Saved', error: 'Not saved — retrying on next change' }[s] || '';
}

const findProject = (id) => Store.data.projects.find((p) => p.id === id);
const projectAssets = (pid) => Object.values(Store.data.assets).filter((a) => a.projectId === pid);
const authorName = () => settings.name || Drive.user?.displayName || 'Me';

function createAsset(project, v, id) {
  const a = {
    id: id || (v.fileId ? 'd_' + v.fileId : 'l_' + uid()),
    projectId: project.id, name: stripExt(v.name), status: 'review', createdAt: Date.now(),
    versions: [{ id: uid(), fileId: v.fileId || null, localKey: v.localKey || null, name: v.name, addedAt: Date.now() }],
    comments: [],
  };
  Store.data.assets[a.id] = a;
  Store.save();
  return a;
}

// Local files: object URLs live only in this tab. Notes are keyed by name+size,
// so re-opening the same file later brings its notes back.
const localFiles = new Map();
const fileKey = (f) => `${f.name}|${f.size}`;

function pickFiles({ multiple = true } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'video/*,.mov,.mkv,.m4v', multiple, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

function addLocalFiles(project, files) {
  let added = 0;
  for (const f of files) {
    if (!f.type.startsWith('video/') && !/\.(mov|mkv|m4v|mp4|webm)$/i.test(f.name)) continue;
    const key = fileKey(f);
    if (!localFiles.has(key)) localFiles.set(key, URL.createObjectURL(f));
    const existing = projectAssets(project.id).some((a) => a.versions.some((v) => v.localKey === key));
    if (!existing) { createAsset(project, { localKey: key, name: f.name }); added++; }
  }
  return added;
}

// ───────────────────────── UI primitives ─────────────────────────
function modal({ title, body, foot, wide, onClose }) {
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onEsc, true); onClose?.(); };
  const onEsc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const wrap = h('div', { class: 'modal-wrap', onpointerdown: (e) => { if (e.target === wrap) close(); } },
    h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'modal-head' }, h('h3', {}, title), h('button', { class: 'icon-btn', title: 'Close', onclick: close }, icon('x'))),
      h('div', { class: 'modal-body' }, body),
      foot ? h('div', { class: 'modal-foot' }, foot) : null));
  $('#modal-root').append(wrap);
  document.addEventListener('keydown', onEsc, true);
  setTimeout(() => wrap.querySelector('input,textarea')?.focus(), 30);
  return { close, el: wrap };
}

function promptModal(title, label, value, onOk) {
  const input = h('input', { class: 'input', value: value || '' });
  const ok = () => { const v = input.value.trim(); if (!v) return; m.close(); onOk(v); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
  const m = modal({
    title,
    body: h('label', { class: 'field' }, h('span', {}, label), input),
    foot: [h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onclick: ok }, 'Save')],
  });
}

function popMenu(anchor, items) {
  closeMenus();
  const r = anchor.getBoundingClientRect();
  const m = h('div', { class: 'menu', role: 'menu' }, items.filter(Boolean).map((it) =>
    it.sep ? h('div', { class: 'menu-sep' }) :
      h('button', { class: 'menu-item' + (it.danger ? ' danger' : ''), role: 'menuitem', onclick: () => { closeMenus(); it.onclick(); } }, it.icon ? icon(it.icon) : null, it.label)));
  document.body.append(m);
  const mw = m.offsetWidth, mh = m.offsetHeight;
  const left = Math.max(8, Math.min(r.right - mw, innerWidth - mw - 8));
  let top = r.bottom + 6;
  if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 6);
  Object.assign(m.style, { left: left + 'px', top: top + 'px' });
  const onDoc = (e) => { if (!m.contains(e.target)) closeMenus(); };
  setTimeout(() => document.addEventListener('pointerdown', onDoc), 0);
  m._off = () => document.removeEventListener('pointerdown', onDoc);
}
function closeMenus() { $$('.menu').forEach((m) => { m._off?.(); m.remove(); }); }

function renderTopbar(crumbs = []) {
  $('#topbar').replaceChildren(...[
    h('a', { class: 'brand', href: '#/' }, h('span', { class: 'brand-mark' }, icon('play')), h('span', {}, 'Cutroom')),
    h('nav', { class: 'crumbs' }, crumbs.map((c) => [h('span', { class: 'sep' }, '/'), c.href ? h('a', { href: c.href }, c.label) : h('span', { class: 'cur' }, c.label)])),
    h('div', { class: 'grow' }),
    h('span', { id: 'save-state', class: 'save-state' }),
    Store.backend ? h('span', { class: 'backend-pill', title: Store.backend === 'drive' ? (Drive.user?.emailAddress || '') : 'Notes are stored in this browser' },
      icon(Store.backend === 'drive' ? 'folder' : 'film'), Store.backend === 'drive' ? 'Google Drive' : 'Local files') : null,
    Store.backend ? h('button', { class: 'icon-btn', title: 'Settings', onclick: openSettings }, icon('settings')) : null,
  ].filter(Boolean));
}

const main = () => $('#app');
function setLoading(msg) { main().replaceChildren(h('div', { class: 'center-msg' }, h('div', { class: 'spinner' }), h('p', {}, msg || 'Loading…'))); }
function errorBox(msg, retry) {
  return h('div', { class: 'center-msg' }, h('p', { class: 'error' }, msg), retry ? h('button', { class: 'btn', onclick: retry }, 'Try again') : null);
}

// ───────────────────────── routing ─────────────────────────
let navSeq = 0;
let cleanupView = null;
function route() {
  navSeq++;
  closeMenus();
  if (cleanupView) { cleanupView(); cleanupView = null; }
  if (!Store.backend) return settings.backend === 'drive' && settings.clientId ? renderSignIn() : renderStart();
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'p' && parts[1]) return renderProject(parts[1]);
  if (parts[0] === 'r' && parts[1] && parts[2]) return renderReview(parts[1], parts[2]);
  return renderProjects();
}
window.addEventListener('hashchange', route);

// ───────────────────────── start / sign-in ─────────────────────────
function renderStart() {
  renderTopbar();
  const isFile = location.protocol === 'file:';
  const cid = h('input', { class: 'input mono', placeholder: '1234567890-abc.apps.googleusercontent.com', value: settings.clientId, spellcheck: 'false' });
  const connect = async () => {
    settings.clientId = cid.value.trim();
    if (!settings.clientId) return toast('Paste your OAuth client ID first');
    saveSettings();
    try { await connectDrive(); } catch (e) { toast(e.message); }
  };
  main().replaceChildren(h('div', { class: 'start' },
    h('h1', {}, 'Review your videos, frame by frame.'),
    h('p', { class: 'lead' }, 'Timestamped notes, drawings on the frame, version stacks and approvals. Your video files stay in Google Drive — this app only streams them.'),
    h('div', { class: 'start-cards' },
      h('section', { class: 'card start-card' },
        h('h2', {}, icon('folder'), 'Google Drive'),
        h('p', { class: 'muted' }, 'Each project is a Drive folder. Videos stream straight from Drive, and your notes are saved to one file in your Drive (', h('code', {}, DATA_FILE), ').'),
        h('label', { class: 'field' }, h('span', {}, 'OAuth client ID'), cid),
        h('details', { class: 'howto' },
          h('summary', {}, 'How do I get a client ID? (free, about 5 minutes)'),
          h('ol', {},
            h('li', {}, 'Open ', h('a', { href: 'https://console.cloud.google.com/projectcreate', target: '_blank', rel: 'noopener' }, 'Google Cloud console'), ' and create a project.'),
            h('li', {}, 'Enable the ', h('a', { href: 'https://console.cloud.google.com/apis/library/drive.googleapis.com', target: '_blank', rel: 'noopener' }, 'Google Drive API'), '.'),
            h('li', {}, 'Under ', h('b', {}, 'Google Auth Platform → Audience'), ', choose External, keep it in Testing, and add your own Google account as a test user.'),
            h('li', {}, 'Under ', h('b', {}, 'Clients'), ', create a ', h('b', {}, 'Web application'), ' client. Add this to Authorized JavaScript origins:', h('code', { class: 'block' }, location.origin)),
            h('li', {}, 'Copy the client ID and paste it above.'))),
        isFile ? h('p', { class: 'warn' }, 'You opened this page as a file. Google sign-in only works from http://localhost or a real website — see the README.') : null,
        h('button', { class: 'btn primary', onclick: connect }, 'Connect Google Drive')),
      h('section', { class: 'card start-card' },
        h('h2', {}, icon('film'), 'Local files'),
        h('p', { class: 'muted' }, 'Try it now with videos on this computer. Notes are kept in this browser; open the same file again later and its notes come back.'),
        h('div', { class: 'grow' }),
        h('button', { class: 'btn', onclick: async () => { settings.backend = 'local'; saveSettings(); await Store.load('local'); location.hash = '#/'; route(); } }, 'Use local files')),
    )));
}

function renderSignIn() {
  renderTopbar();
  main().replaceChildren(h('div', { class: 'start narrow' },
    h('h1', {}, 'Welcome back'),
    h('p', { class: 'lead' }, 'Sign in to load your projects and notes from Google Drive.'),
    h('div', { class: 'row gap' },
      h('button', { class: 'btn primary big', onclick: () => connectDrive().catch((e) => toast(e.message)) }, 'Sign in with Google'),
      h('button', { class: 'btn ghost', onclick: () => { settings.backend = null; saveSettings(); renderStart(); } }, 'Change setup'))));
}

async function connectDrive() {
  await waitForGIS();
  Drive.init();
  if (!Drive.validToken()) await Drive.requestToken('');
  setLoading('Loading your projects from Drive…');
  try {
    Drive.user = (await Drive.about()).user;
    await Store.load('drive');
  } catch (e) {
    Store.backend = null;
    main().replaceChildren(errorBox('Could not load from Drive: ' + e.message, () => connectDrive().catch((er) => toast(er.message))));
    return;
  }
  settings.backend = 'drive';
  saveSettings();
  route();
  if (Drive.missingScopes) askForMissingScopes();
}

// ───────────────────────── settings modal ─────────────────────────
function openSettings() {
  const name = h('input', { class: 'input', value: settings.name, placeholder: Drive.user?.displayName || 'Your name' });
  const fps = h('select', { class: 'select' }, FPS_OPTIONS.map((f) => h('option', { value: f, selected: Number(settings.fps) === f }, f + ' fps')));
  const importBtn = h('button', { class: 'btn sm', onclick: () => {
    const input = h('input', { type: 'file', accept: 'application/json,.json' });
    input.addEventListener('change', async () => {
      const f = input.files[0];
      if (!f) return;
      try {
        const d = normalizeData(JSON.parse(await f.text()));
        if (!confirm(`Replace your current notes with this backup (${d.projects.length} projects)?`)) return;
        Store.data = d; Store.save(); m.close(); route(); toast('Backup restored');
      } catch { toast('That file is not a Cutroom backup'); }
    });
    input.click();
  } }, icon('upload'), 'Restore backup');
  const m = modal({
    title: 'Settings',
    body: [
      h('label', { class: 'field' }, h('span', {}, 'Your name on notes'), name),
      h('label', { class: 'field' }, h('span', {}, 'Default frame rate for new videos'), fps),
      h('div', { class: 'field' }, h('span', {}, 'Backup'),
        h('div', { class: 'row gap' },
          h('button', { class: 'btn sm', onclick: () => download(`cutroom-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(Store.data, null, 2), 'application/json') }, icon('download'), 'Download backup'),
          importBtn)),
      h('div', { class: 'field' }, h('span', {}, 'Storage'),
        h('p', { class: 'muted small' }, Store.backend === 'drive'
          ? `Signed in as ${Drive.user?.emailAddress || 'Google user'}. Notes are saved in “${DATA_FILE}” in your Drive.`
          : 'Notes are saved in this browser only. Download a backup to keep them safe.')),
    ],
    foot: [
      h('button', { class: 'btn ghost', onclick: () => {
        if (Store.dirty) Store.flush();
        if (Store.backend === 'drive') Drive.signOut();
        Store.backend = null; settings.backend = null; saveSettings(); m.close(); location.hash = '#/'; route();
      } }, Store.backend === 'drive' ? 'Sign out' : 'Switch to Google Drive'),
      h('div', { class: 'grow' }),
      h('button', { class: 'btn primary', onclick: () => {
        settings.name = name.value.trim(); settings.fps = Number(fps.value); saveSettings(); m.close(); toast('Settings saved');
      } }, 'Save'),
    ],
  });
}

// ───────────────────────── projects ─────────────────────────
function projectStats(pid) {
  const assets = projectAssets(pid);
  return {
    assets: assets.length,
    approved: assets.filter((a) => a.status === 'approved').length,
    open: assets.reduce((n, a) => n + a.comments.filter((c) => !c.resolved).length, 0),
  };
}

function renderProjects() {
  renderTopbar([{ label: 'Projects' }]);
  const projects = [...Store.data.projects].sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  main().replaceChildren(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', {}, 'Projects'), h('div', { class: 'grow' }),
      h('button', { class: 'btn primary', onclick: newProject }, icon('plus'), 'New project')),
    projects.length ? null : h('p', { class: 'muted hint' }, Store.backend === 'drive'
      ? 'Create a project by choosing a Drive folder that holds your cuts. Every video in it shows up for review.'
      : 'Create a project, then add video files from your computer.'),
    h('div', { class: 'grid projects' },
      projects.map((p) => {
        const st = projectStats(p.id);
        return h('a', { class: 'card project-card', href: `#/p/${p.id}` },
          h('div', { class: 'pc-icon' }, icon(p.folderId ? 'folder' : 'film')),
          h('div', { class: 'pc-body' },
            h('div', { class: 'pc-name' }, p.name),
            h('div', { class: 'pc-meta' }, `${st.assets} in review · ${st.approved} approved · ${st.open} open notes`)),
          h('button', { class: 'icon-btn pc-menu', title: 'Project options', onclick: (e) => {
            e.preventDefault(); e.stopPropagation();
            popMenu(e.currentTarget, [
              { label: 'Rename', onclick: () => promptModal('Rename project', 'Name', p.name, (v) => { p.name = v; Store.save(); route(); }) },
              p.folderId ? { label: 'Open folder in Drive', icon: 'external', onclick: () => window.open(`https://drive.google.com/drive/folders/${p.folderId}`, '_blank', 'noopener') } : null,
              { sep: true },
              { label: 'Remove project', danger: true, onclick: () => {
                if (!confirm(`Remove “${p.name}” and all its notes from Cutroom? Your video files are not touched.`)) return;
                Store.data.projects = Store.data.projects.filter((x) => x.id !== p.id);
                for (const a of projectAssets(p.id)) delete Store.data.assets[a.id];
                Store.save(); route();
              } },
            ]);
          } }, icon('more')));
      }),
      h('button', { class: 'card new-card', onclick: newProject }, icon('plus'), h('span', {}, 'New project')))));
}

function newProject() {
  if (Store.backend === 'drive') {
    folderPicker((folder) => {
      let p = Store.data.projects.find((x) => x.folderId === folder.id);
      if (!p) {
        p = { id: 'p_' + uid(), name: folder.name, folderId: folder.id, createdAt: Date.now() };
        Store.data.projects.push(p); Store.save();
      }
      location.hash = `#/p/${p.id}`;
    });
  } else {
    promptModal('New project', 'Project name', '', (name) => {
      const p = { id: 'p_' + uid(), name, folderId: null, createdAt: Date.now() };
      Store.data.projects.push(p); Store.save();
      location.hash = `#/p/${p.id}`;
    });
  }
}

function parseFolderLink(s) {
  s = s.trim();
  return s.match(/\/folders\/([\w-]{10,})/)?.[1] || s.match(/[?&]id=([\w-]{10,})/)?.[1] || (/^[\w-]{20,}$/.test(s) ? s : null);
}

function folderPicker(onPick) {
  let mode = 'mine';
  let stack = [{ id: 'root', name: 'My Drive' }];
  const list = h('div', { class: 'folder-list' });
  const crumbs = h('div', { class: 'folder-crumbs' });
  const useBtn = h('button', { class: 'btn primary' }, 'Use this folder');
  const tabMine = h('button', { class: 'tab on' }, 'My Drive');
  const tabShared = h('button', { class: 'tab' }, 'Shared with me');
  const link = h('input', { class: 'input', placeholder: 'Or paste a Drive folder link' });
  const linkBtn = h('button', { class: 'btn' }, 'Use link');

  const setMode = (m) => {
    mode = m;
    stack = [m === 'mine' ? { id: 'root', name: 'My Drive' } : { id: 'shared', name: 'Shared with me' }];
    tabMine.classList.toggle('on', m === 'mine'); tabShared.classList.toggle('on', m === 'shared');
    load();
  };
  tabMine.onclick = () => setMode('mine');
  tabShared.onclick = () => setMode('shared');

  async function load() {
    const cur = stack[stack.length - 1];
    crumbs.replaceChildren(...stack.map((f, i) => [
      i ? h('span', { class: 'sep' }, '›') : null,
      i < stack.length - 1 ? h('button', { class: 'link-btn', onclick: () => { stack = stack.slice(0, i + 1); load(); } }, f.name) : h('span', {}, f.name),
    ]).flat().filter(Boolean));
    useBtn.disabled = stack.length === 1;
    useBtn.textContent = stack.length === 1 ? 'Open a folder to choose it' : `Use “${cur.name}”`;
    list.replaceChildren(h('div', { class: 'muted pad' }, 'Loading folders…'));
    try {
      const folders = mode === 'shared' && stack.length === 1 ? await Drive.sharedFolders() : await Drive.folders(cur.id);
      if (stack[stack.length - 1] !== cur) return;
      list.replaceChildren(...(folders.length
        ? folders.map((f) => h('button', { class: 'folder-row', onclick: () => { stack.push(f); load(); } }, icon('folder'), h('span', { class: 'grow' }, f.name), icon('chevronRight')))
        : [h('div', { class: 'muted pad' }, 'No folders in here.')]));
    } catch (e) {
      list.replaceChildren(h('div', { class: 'error pad' }, e.message));
    }
  }
  useBtn.onclick = () => { const cur = stack[stack.length - 1]; m.close(); onPick(cur); };
  linkBtn.onclick = async () => {
    const id = parseFolderLink(link.value);
    if (!id) return toast('That does not look like a Drive folder link');
    try {
      const f = await Drive.meta(id);
      if (f.mimeType !== 'application/vnd.google-apps.folder') return toast('That link is a file, not a folder');
      m.close(); onPick(f);
    } catch (e) { toast('Could not open that folder: ' + e.message); }
  };
  const m = modal({
    title: 'Choose a Drive folder', wide: true,
    body: [h('div', { class: 'tabs' }, tabMine, tabShared), crumbs, list, h('div', { class: 'row gap link-row' }, link, linkBtn)],
    foot: [h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel'), useBtn],
  });
  load();
}

// ───────────────────────── project page (asset grid) ─────────────────────────
const folderCache = new Map();
const proxyCache = new Map(); // projectId -> Map(originalFileId -> proxy file)
let gridFilter = 'all';

async function loadProxies(p, force) {
  if (!p.folderId) return new Map();
  if (!force && proxyCache.has(p.id)) return proxyCache.get(p.id);
  const m = await Drive.proxies(p.folderId).catch(() => new Map());
  proxyCache.set(p.id, m);
  return m;
}

function driveItems(p, files) {
  const assets = projectAssets(p.id);
  const fileToAsset = new Map();
  for (const a of assets) for (const v of a.versions) if (v.fileId) fileToAsset.set(v.fileId, a);
  const byId = new Map(files.map((f) => [f.id, f]));
  const items = [], seen = new Set();
  for (const f of files) {
    const a = fileToAsset.get(f.id);
    if (a) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      const latest = [...a.versions].reverse().find((v) => byId.has(v.fileId));
      items.push({ id: a.id, asset: a, file: byId.get(latest?.fileId) || f });
    } else {
      items.push({ id: 'd_' + f.id, asset: null, file: f });
    }
  }
  for (const a of assets) if (!seen.has(a.id)) items.push({ id: a.id, asset: a, file: null, missing: true });
  return items;
}

async function renderProject(pid) {
  const p = findProject(pid);
  if (!p) { location.hash = '#/'; return; }
  const nav = navSeq;
  renderTopbar([{ label: 'Projects', href: '#/' }, { label: p.name }]);
  const grid = h('div', { class: 'grid assets' });
  const chips = h('div', { class: 'chips' });
  const isDrive = !!p.folderId;
  let items = [];

  const draw = () => {
    const counts = { all: items.length, new: 0, review: 0, changes: 0, approved: 0 };
    for (const it of items) counts[it.asset ? it.asset.status : 'new']++;
    chips.replaceChildren(...[['all', 'All'], ['new', 'New'], ['review', 'In review'], ['changes', 'Needs changes'], ['approved', 'Approved']]
      .filter(([k]) => k === 'all' || counts[k])
      .map(([k, label]) => h('button', { class: 'chip-btn' + (gridFilter === k ? ' on' : ''), onclick: () => { gridFilter = k; draw(); } }, label, h('span', { class: 'count' }, counts[k]))));
    const shown = items.filter((it) => gridFilter === 'all' || (it.asset ? it.asset.status : 'new') === gridFilter);
    if (!items.length) {
      grid.replaceChildren(h('div', { class: 'empty' },
        icon('film'),
        h('p', {}, isDrive ? 'No videos in this folder yet. Upload or move videos into it in Drive, then refresh.' : 'No videos yet. Add files from your computer, or drop them here.'),
        isDrive ? null : h('button', { class: 'btn primary', onclick: addFiles }, icon('plus'), 'Add videos')));
      return;
    }
    grid.replaceChildren(...shown.map((it) => assetCard(p, it)));
  };

  const loadDrive = async (force) => {
    if (!force && folderCache.has(p.id)) { items = driveItems(p, folderCache.get(p.id)); draw(); }
    else grid.replaceChildren(...Array.from({ length: 6 }, () => h('div', { class: 'card asset-card skeleton' }, h('div', { class: 'thumb' }), h('div', { class: 'ac-body' }, h('div', { class: 'sk-line' }), h('div', { class: 'sk-line short' })))));
    try {
      const [files] = await Promise.all([Drive.videos(p.folderId), loadProxies(p, true)]);
      folderCache.set(p.id, files);
      if (nav !== navSeq) return;
      items = driveItems(p, files);
      draw();
      // pull new client comments for this project's shared videos in the background
      if (linksReady()) {
        const shared = projectAssets(p.id).filter((a) => a.share?.token && !a.share.revoked);
        Promise.allSettled(shared.map((a) => syncShare(p, a))).then(() => { if (nav === navSeq && shared.length) draw(); });
      }
    } catch (e) {
      if (nav !== navSeq) return;
      grid.replaceChildren(errorBox('Could not list this folder: ' + e.message, () => loadDrive(true)));
    }
  };
  const loadLocal = () => { items = projectAssets(p.id).sort((a, b) => a.name.localeCompare(b.name)).map((a) => ({ id: a.id, asset: a })); draw(); };
  async function addFiles(files) {
    if (!Array.isArray(files)) files = await pickFiles();
    if (!files.length) return;
    const n = addLocalFiles(p, files);
    toast(n ? `Added ${n} video${n > 1 ? 's' : ''}` : 'Those videos are already here — reconnected them');
    loadLocal();
  }

  const page = h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('h1', {}, p.name),
      h('div', { class: 'grow' }),
      isDrive ? h('a', { class: 'btn ghost', href: `https://drive.google.com/drive/folders/${p.folderId}`, target: '_blank', rel: 'noopener' }, icon('external'), 'Open in Drive') : null,
      isDrive ? h('button', { class: 'btn', title: 'Make smaller H.264 copies that stream and scrub smoothly', onclick: () => proxyModal(p, folderCache.get(p.id) || [], null, () => loadDrive(true)) }, icon('film'), 'Make proxies') : null,
      isDrive ? h('button', { class: 'btn', onclick: () => loadDrive(true) }, icon('refresh'), 'Refresh')
        : h('button', { class: 'btn primary', onclick: addFiles }, icon('plus'), 'Add videos')),
    chips, grid);

  if (!isDrive) {
    page.addEventListener('dragover', (e) => { e.preventDefault(); page.classList.add('dropping'); });
    page.addEventListener('dragleave', (e) => { if (e.target === page) page.classList.remove('dropping'); });
    page.addEventListener('drop', (e) => { e.preventDefault(); page.classList.remove('dropping'); addFiles([...e.dataTransfer.files]); });
  }
  main().replaceChildren(page);
  if (isDrive) loadDrive(false); else loadLocal();
}

function assetCard(p, it) {
  const a = it.asset;
  const name = a ? a.name : stripExt(it.file.name);
  const versions = a ? a.versions.length : 1;
  const open = a ? a.comments.filter((c) => !c.resolved).length : 0;
  const total = a ? a.comments.length : 0;
  let thumb;
  let dur = null;
  const proxy = it.file && proxyCache.get(p.id)?.get(it.file.id);
  if (it.file) {
    dur = it.file.videoMediaMetadata?.durationMillis ? Number(it.file.videoMediaMetadata.durationMillis) / 1000 : null;
    const thumbLink = it.file.thumbnailLink || proxy?.thumbnailLink;
    thumb = thumbLink
      ? h('img', { src: thumbLink.replace(/=s\d+$/, '=s640'), alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => e.target.replaceWith(h('div', { class: 'thumb-ph' }, icon('film'))) })
      : h('div', { class: 'thumb-ph' }, icon('film'), h('small', {}, 'Drive is still processing'));
  } else if (a) {
    const v = a.versions[a.versions.length - 1];
    const url = v.localKey && localFiles.get(v.localKey);
    thumb = url
      ? h('video', { src: url + '#t=0.5', muted: true, preload: 'metadata', playsinline: true, tabindex: '-1' })
      : h('div', { class: 'thumb-ph' }, icon('film'), h('small', {}, it.missing ? 'Not in this folder anymore' : 'Open to reconnect file'));
  }
  return h('a', { class: 'card asset-card', href: `#/r/${p.id}/${encodeURIComponent(it.id)}` },
    h('div', { class: 'thumb' }, thumb,
      versions > 1 ? h('span', { class: 'badge vbadge', title: `${versions} versions` }, icon('layers'), 'v' + versions) : null,
      dur ? h('span', { class: 'badge dur' }, fmtDur(dur)) : null,
      proxy ? h('span', { class: 'badge pbadge', title: 'Plays from a smooth-streaming proxy' }, 'Proxy') : null,
      a?.share?.token && !a.share.revoked ? h('span', { class: 'badge sbadge', title: 'Has an active client link' }, icon('share'), 'Client link') : null),
    h('div', { class: 'ac-body' },
      h('div', { class: 'ac-name', title: name }, name),
      h('div', { class: 'ac-meta' }, statusPill(a?.status),
        total ? h('span', { class: 'muted note-count', title: `${open} open of ${total} notes` }, icon('comment'), `${open}/${total}`) : null)));
}

// ───────────────────────── proxies (via the local helper) ─────────────────────────
async function helperCall(path, body) {
  const opts = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {};
  const r = await fetch(HELPER_URL + path, { ...opts, cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Helper replied ${r.status}`);
  return j;
}

const JOB_LABELS = {
  queued: 'Waiting', checking: 'Checking', downloading: 'Downloading original', encoding: 'Converting',
  uploading: 'Uploading proxy', done: 'Done', skipped: 'Already has a proxy', error: 'Failed', waiting: 'Needs sign-in',
};

function proxyModal(p, files, onlyId, onFinished) {
  const body = h('div', { class: 'proxy-body' });
  const foot = h('div', { class: 'row gap grow end' });
  let timer = null, closed = false, startedHere = false;
  const m = modal({
    title: 'Make smooth-streaming proxies', wide: true, body, foot: [foot],
    onClose: () => { closed = true; clearTimeout(timer); if (startedHere) onFinished?.(); },
  });
  const helperFile = new URL('proxy-helper.py', location.href).href;

  async function start() {
    body.replaceChildren(h('div', { class: 'center-msg small-msg' }, h('div', { class: 'spinner' }), h('p', {}, 'Looking for the proxy helper on this computer…')));
    foot.replaceChildren();
    let health;
    // Chrome holds requests to this computer until the person answers its
    // "local network access" prompt, so explain that instead of spinning forever.
    const hint = setTimeout(() => {
      if (closed || !body.querySelector('.small-msg')) return;
      body.querySelector('.small-msg').append(h('p', { class: 'warn' },
        'Chrome is waiting for your permission. Look near the address bar for a prompt about accessing apps or devices on your local network and click Allow. No prompt? Click the icon at the left of the address bar, then set “Local network access” to Allow and reload.'));
    }, 4000);
    try { health = await helperCall('/health'); } catch { clearTimeout(hint); return showInstall(); }
    clearTimeout(hint);
    if (closed) return;
    if (!health.ffmpeg) return showInstall('The helper is running but can’t find ffmpeg. Install it with:  brew install ffmpeg');
    const st = await helperCall('/status').catch(() => ({ jobs: [] }));
    const active = st.jobs.filter((j) => j.folderId === p.folderId && !['done', 'skipped', 'error'].includes(j.state));
    if (active.length) { startedHere = true; return showProgress(); }
    showPicker(health);
  }

  function showInstall(problem) {
    body.replaceChildren(
      h('p', {}, 'Proxies are smaller H.264 copies of your videos. They stream smoothly, seek instantly and step frame by frame, and they play even when the original is ProRes or HEVC. Cutroom keeps them in a “', PROXY_FOLDER, '” folder next to the originals, and your notes stay on the originals.'),
      h('p', {}, 'Converting video needs your computer, so a small helper does the work. Open Terminal and run these two commands, then leave the window open:'),
      h('code', { class: 'block' }, `cd ~/Downloads && curl -fsSLO ${helperFile}`),
      h('code', { class: 'block' }, 'python3 proxy-helper.py'),
      h('p', { class: 'muted small' }, 'It needs ffmpeg (', h('code', {}, 'brew install ffmpeg'), '). If Chrome asks whether this site may access devices on your local network, click Allow: that’s how the page talks to the helper.'),
      ...(problem ? [h('p', { class: 'warn' }, problem)] : []));
    foot.replaceChildren(h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Close'), h('button', { class: 'btn primary', onclick: start }, 'I started it, check again'));
  }

  function showPicker(health) {
    const proxies = proxyCache.get(p.id) || new Map();
    const rows = files.map((f) => {
      const has = proxies.has(f.id);
      const cb = h('input', { type: 'checkbox', checked: onlyId ? f.id === onlyId : !has });
      cb.checked = onlyId ? f.id === onlyId : !has;
      return { f, cb, el: h('label', { class: 'proxy-row' }, cb, h('span', { class: 'grow' }, f.name),
        f.size ? h('span', { class: 'faint small' }, `${(Number(f.size) / 1e9).toFixed(2)} GB`) : null,
        has ? h('span', { class: 'pill st-approved' }, 'Has proxy') : null) };
    });
    const res = h('select', { class: 'select' }, h('option', { value: 1080 }, '1080p (recommended)'), h('option', { value: 720 }, '720p (smallest, fastest)'), h('option', { value: 0 }, 'Original size'));
    const force = h('input', { type: 'checkbox' });
    body.replaceChildren(
      h('p', { class: 'muted small' }, `Helper found · encoder: ${health.encoder === 'h264_videotoolbox' ? 'Apple hardware (fast)' : health.encoder}. Each video is downloaded, converted on this computer, then uploaded to “${PROXY_FOLDER}” in this project’s Drive folder.`),
      files.length ? h('div', { class: 'folder-list proxy-list' }, rows.map((r) => r.el)) : h('p', { class: 'muted' }, 'No videos in this folder yet.'),
      h('div', { class: 'row gap proxy-opts' }, h('label', { class: 'field' }, h('span', {}, 'Size'), res),
        h('label', { class: 'row gap small' }, force, 'Replace proxies that already exist')));
    foot.replaceChildren(h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: async () => {
        const chosen = rows.filter((r) => r.cb.checked).map((r) => ({ id: r.f.id, name: r.f.name, size: r.f.size }));
        if (!chosen.length) return toast('Tick at least one video');
        try {
          await helperCall('/jobs', { token: await Drive.getToken(), folderId: p.folderId, files: chosen, resolution: Number(res.value), force: force.checked });
          startedHere = true;
          showProgress();
        } catch (e) { toast('Could not start: ' + e.message); }
      } }, 'Make proxies'));
  }

  function showProgress() {
    const list = h('div', { class: 'folder-list proxy-list' });
    const summary = h('p', { class: 'muted small' });
    body.replaceChildren(summary, list,
      h('p', { class: 'faint small' }, 'You can close this window: the helper keeps working as long as its Terminal window stays open. Keep a Cutroom tab open too, so it can renew the helper’s Google sign-in for long batches.'));
    foot.replaceChildren(h('button', { class: 'btn', onclick: () => m.close() }, 'Close'));
    let lastTokenPush = Date.now();
    const poll = async () => {
      if (closed) return;
      try {
        const st = await helperCall('/status');
        const jobs = st.jobs.filter((j) => j.folderId === p.folderId);
        const needsToken = !st.hasToken || jobs.some((j) => j.state === 'waiting') || Date.now() - lastTokenPush > 20 * 60 * 1000;
        if (needsToken && Store.backend === 'drive') { lastTokenPush = Date.now(); helperCall('/token', { token: await Drive.getToken() }).catch(() => {}); }
        list.replaceChildren(...jobs.map((j) => h('div', { class: 'proxy-row' + (j.state === 'error' ? ' failed' : '') },
          h('div', { class: 'grow' },
            h('div', { class: 'proxy-name' }, j.name),
            h('div', { class: 'faint small' }, JOB_LABELS[j.state] || j.state, j.detail ? ' · ' + j.detail : ''),
            ['downloading', 'encoding', 'uploading'].includes(j.state) ? h('div', { class: 'bar' }, h('div', { style: { width: Math.round(j.progress * 100) + '%' } })) : null),
          j.state === 'done' ? h('span', { class: 'pill st-approved' }, 'Ready') : j.state === 'error' ? h('span', { class: 'pill st-changes' }, 'Failed') : null)));
        const left = jobs.filter((j) => !['done', 'skipped', 'error'].includes(j.state)).length;
        summary.textContent = left ? `Working on ${jobs.length - left + 1} of ${jobs.length}…` : `Finished: ${jobs.filter((j) => j.state === 'done').length} made, ${jobs.filter((j) => j.state === 'error').length} failed.`;
        if (!left && startedHere) { await loadProxies(p, true); onFinished?.(); startedHere = false; }
      } catch {
        summary.textContent = 'Lost contact with the helper. Is its Terminal window still open?';
      }
      timer = setTimeout(poll, 1000);
    };
    poll();
  }

  start();
}

// ───────────────────────── client review links ─────────────────────────
// Clients open review.html#t=<token>. The comment store is a Google Apps Script
// web app in the owner's account (apps-script/Code.gs). This side publishes the
// video and your notes, and merges client comments and replies back in.
const PUB = window.CUTROOM_PUBLIC || {};
const linksReady = () => !!(PUB.linksEndpoint && !PUB.linksEndpoint.startsWith('__') && Store.data.links?.ownerKey);
function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function shareUrl(token) {
  const base = PUB.siteUrl && !PUB.siteUrl.startsWith('__') ? PUB.siteUrl : new URL('.', location.href).href;
  return new URL('review.html', base).href + '#t=' + token;
}
async function linksCall(body) {
  const r = await fetch(PUB.linksEndpoint, { method: 'POST', body: JSON.stringify({ ownerKey: Store.data.links?.ownerKey, ...body }) });
  const j = await r.json().catch(() => ({ error: 'The links service didn’t answer properly' }));
  if (j.error) throw new Error(j.error);
  return j;
}

async function syncShare(p, asset) {
  const share = asset.share;
  const proxies = await loadProxies(p);
  const versions = (share.scope === 'latest' ? asset.versions.slice(-1) : asset.versions).filter((v) => v.fileId);
  if (!versions.length) throw new Error('Only Drive videos can be shared');
  const ids = new Set(versions.map((v) => v.id));
  const mine = asset.comments.filter((c) => c.source !== 'client' && ids.has(c.versionId));
  const replies = {};
  for (const c of asset.comments) {
    if (!ids.has(c.versionId)) continue;
    const own = c.replies.filter((r) => r.source !== 'client');
    if (own.length) replies[c.id] = own.map((r) => ({ id: r.id, text: r.text, author: r.author, createdAt: r.createdAt }));
  }
  const res = await linksCall({
    action: 'sync', token: share.token, title: asset.name, project: p.name, status: asset.status, allowDraw: share.allowDraw !== false,
    versions: versions.map((v) => ({ id: v.id, label: v.name, fileId: proxies.get(v.fileId)?.id || v.fileId, fps: asset.fps || settings.fps || 24 })),
    owner: {
      comments: mine.map((c) => ({ id: c.id, versionId: c.versionId, t: c.t, text: c.text, drawing: c.drawing, author: c.author, createdAt: c.createdAt })),
      replies,
      resolved: asset.comments.filter((c) => c.resolved && ids.has(c.versionId)).map((c) => c.id),
      hidden: share.hidden || [],
    },
  });
  mergeShareThread(asset, res);
  share.syncedAt = Date.now();
  Store.save({ quiet: true });
  return res;
}

function mergeShareThread(asset, thread) {
  const byId = new Map(asset.comments.map((c) => [c.id, c]));
  const hidden = new Set(asset.share?.hidden || []);
  for (const sc of thread.comments || []) {
    let c = byId.get(sc.id);
    if (sc.source === 'client') {
      if (hidden.has(sc.id)) continue;
      if (!c) {
        c = { id: sc.id, source: 'client', versionId: sc.versionId, t: sc.t, text: sc.text, drawing: sc.drawing || null, author: sc.author, createdAt: sc.createdAt, resolved: false, replies: [] };
        asset.comments.push(c); byId.set(c.id, c);
      }
    }
    if (!c) continue;
    const have = new Set(c.replies.map((r) => r.id));
    for (const r of sc.replies || []) {
      if (r.source === 'client' && !have.has(r.id)) c.replies.push({ id: r.id, source: 'client', text: r.text, author: r.author, createdAt: r.createdAt });
    }
    c.replies.sort((a, b) => a.createdAt - b.createdAt);
  }
}

function shareModal(p, asset, onChange) {
  const body = h('div');
  const foot = h('div', { class: 'row gap grow end' });
  const m = modal({ title: `Client link for “${asset.name}”`, wide: true, body, foot: [foot] });

  function setup() {
    const key = h('input', { class: 'input mono', placeholder: 'Owner key from your Cutroom links script' });
    body.replaceChildren(
      h('p', {}, 'Client links need the Cutroom links script in your Google account (it stores client comments in your Drive).'),
      PUB.linksEndpoint && !PUB.linksEndpoint.startsWith('__')
        ? h('label', { class: 'field' }, h('span', {}, 'Owner key'), key)
        : h('p', { class: 'warn' }, 'This copy of Cutroom has no links service configured (config.js).'));
    foot.replaceChildren(h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Close'),
      h('button', { class: 'btn primary', onclick: async () => {
        const k = key.value.trim(); if (!k) return toast('Paste the owner key first');
        try { await fetch(PUB.linksEndpoint, { method: 'POST', body: JSON.stringify({ action: 'list', ownerKey: k }) }).then((r) => r.json()).then((j) => { if (j.error) throw new Error(j.error); }); }
        catch (e) { return toast('That key didn’t work: ' + e.message); }
        Store.data.links = { ownerKey: k }; Store.save({ quiet: true }); show();
      } }, 'Save key'));
  }

  function show() {
    if (!linksReady()) return setup();
    const s = asset.share;
    if (s?.token && !s.revoked) {
      const url = shareUrl(s.token);
      const input = h('input', { class: 'input', value: url, readonly: true, onfocus: (e) => e.target.select() });
      const counts = asset.comments.filter((c) => c.source === 'client').length;
      body.replaceChildren(
        h('p', {}, 'Anyone with this link can watch this video and add comments, drawings and replies. They can’t see your other videos, edit, resolve or delete anything.'),
        h('div', { class: 'share-url' }, input, h('button', { class: 'btn primary', onclick: async () => { try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { input.select(); toast('Press ⌘C to copy'); } } }, icon('copy'), 'Copy')),
        h('p', { class: 'muted small' }, `${counts} client comment${counts === 1 ? '' : 's'} so far · shares ${s.scope === 'latest' ? 'the latest version only' : 'all versions'}${s.allowDraw === false ? ' · drawing off' : ''} · last synced ${s.syncedAt ? timeAgo(s.syncedAt) : 'never'}`),
        h('p', { class: 'faint small' }, 'The video file is set to “anyone with the link can view” in Drive so the client can stream it (the proxy when there is one). Turning the link off restores the previous Drive sharing.'));
      foot.replaceChildren(
        h('button', { class: 'btn ghost', onclick: async () => {
          if (!confirm('Turn this link off? The client will no longer be able to open it. Their comments stay in your review.')) return;
          try { await linksCall({ action: 'revoke', token: s.token }); s.revoked = true; Store.save({ quiet: true }); toast('Link turned off'); show(); onChange?.(); }
          catch (e) { toast('Couldn’t turn it off: ' + e.message); }
        } }, 'Turn link off'),
        h('div', { class: 'grow' }),
        h('button', { class: 'btn', onclick: async () => { try { await syncShare(p, asset); toast('Synced'); show(); onChange?.(); } catch (e) { toast('Sync failed: ' + e.message); } } }, icon('refresh'), 'Sync now'),
        h('button', { class: 'btn primary', onclick: () => m.close() }, 'Done'));
      return;
    }
    const scope = h('select', { class: 'select' }, h('option', { value: 'all' }, 'All versions'), h('option', { value: 'latest' }, 'Latest version only'));
    const draw = h('input', { type: 'checkbox', checked: true }); draw.checked = true;
    const hasProxy = asset.versions.some((v) => proxyCache.get(p.id)?.get(v.fileId));
    body.replaceChildren(
      h('p', {}, 'Create a private link your client can open without signing in. They can watch, add timestamped comments and drawings, and reply. Their comments appear here, tagged “Client”, and your notes appear for them, tagged “Team”.'),
      h('div', { class: 'row gap proxy-opts' }, h('label', { class: 'field' }, h('span', {}, 'Share'), scope), h('label', { class: 'row gap small' }, draw, 'Let them draw on frames')),
      hasProxy ? null : h('p', { class: 'warn' }, 'Tip: this video has no proxy. Clients will stream the original file, which may be large or not play in their browser. Make a proxy first for smooth review.'));
    foot.replaceChildren(h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: async (e) => {
        e.currentTarget.disabled = true; e.currentTarget.textContent = 'Creating…';
        asset.share = { token: newToken(), createdAt: Date.now(), scope: scope.value, allowDraw: draw.checked, hidden: [] };
        try { await syncShare(p, asset); Store.save({ quiet: true }); show(); onChange?.(); }
        catch (err) { delete asset.share; toast('Couldn’t create the link: ' + err.message); show(); }
      } }, icon('share'), 'Create link'));
  }
  show();
}

// ───────────────────────── review page ─────────────────────────
async function renderReview(pid, aid) {
  const p = findProject(pid);
  if (!p) { location.hash = '#/'; return; }
  const nav = navSeq;
  let asset = Store.data.assets[aid];
  if (!asset) {
    if (!aid.startsWith('d_') || !p.folderId) { location.hash = `#/p/${pid}`; return; }
    setLoading('Opening video…');
    try {
      const fid = aid.slice(2);
      const cached = folderCache.get(pid)?.find((f) => f.id === fid);
      const f = cached || (await Drive.meta(fid));
      if (nav !== navSeq) return;
      asset = createAsset(p, { fileId: f.id, name: f.name });
    } catch (e) {
      main().replaceChildren(errorBox('Could not open this video: ' + e.message, () => route()));
      return;
    }
  }
  renderTopbar([{ label: 'Projects', href: '#/' }, { label: p.name, href: `#/p/${p.id}` }, { label: asset.name }]);
  p.updatedAt = Date.now();

  const rv = {
    vIdx: asset.versions.length - 1,
    filter: 'open',
    selected: null,
    pinT: null,
    tool: null,
    color: INK_COLORS[0],
    strokes: [],
    current: null,
    fps: Number(asset.fps || settings.fps || 24),
    blobUrl: null,
    raf: 0,
    activeId: null,
  };
  const curV = () => asset.versions[rv.vIdx];
  const versionComments = () => asset.comments.filter((c) => c.versionId === curV().id).sort((a, b) => a.t - b.t || a.createdAt - b.createdAt);
  const halfFrame = () => 0.6 / rv.fps;

  // ── player DOM
  const video = h('video', { class: 'video', playsinline: true, preload: 'auto' });
  const canvas = h('canvas', { class: 'ink' });
  const stageMsg = h('div', { class: 'stage-msg hidden' });
  const stage = h('div', { class: 'stage' }, video, canvas, stageMsg);

  const buffered = h('div', { class: 'sb-buffer' });
  const played = h('div', { class: 'sb-played' });
  const headEl = h('div', { class: 'sb-head' });
  const markers = h('div', { class: 'sb-markers' });
  const tip = h('div', { class: 'sb-tip hidden' });
  const track = h('div', { class: 'sb-track' }, buffered, played);
  const scrub = h('div', { class: 'scrub', title: '' }, track, markers, headEl, tip);

  const playBtn = h('button', { class: 'ctl', title: 'Play / pause (Space or K)' }, icon('play'));
  const stepB = h('button', { class: 'ctl', title: 'Previous frame (←)' }, icon('stepBack'));
  const stepF = h('button', { class: 'ctl', title: 'Next frame (→)' }, icon('stepFwd'));
  const tcEl = h('span', { class: 'tc-now' }, '00:00:00:00');
  const durEl = h('span', { class: 'tc-dur' }, '00:00:00:00');
  const loopBtn = h('button', { class: 'ctl', title: 'Loop' }, icon('loop'));
  const speedSel = h('select', { class: 'select sm', title: 'Playback speed' }, [0.25, 0.5, 1, 1.5, 2].map((s) => h('option', { value: s, selected: s === 1 }, s + '×')));
  const fpsSel = h('select', { class: 'select sm', title: 'Frame rate (for timecode & frame stepping)' }, FPS_OPTIONS.map((f) => h('option', { value: f, selected: f === rv.fps }, f + ' fps')));
  if (!FPS_OPTIONS.includes(rv.fps)) fpsSel.prepend(h('option', { value: rv.fps, selected: true }, rv.fps + ' fps'));
  const muteBtn = h('button', { class: 'ctl', title: 'Mute (M)' }, icon('volume'));
  const vol = h('input', { type: 'range', class: 'vol', min: 0, max: 1, step: 0.05, value: readJSON('cutroom:vol', 1), title: 'Volume' });
  const fsBtn = h('button', { class: 'ctl', title: 'Fullscreen (F)' }, icon('expand'));
  const srcSel = h('select', { class: 'select sm hidden', title: 'Play the smooth proxy or the original file' },
    h('option', { value: 'proxy' }, 'Proxy'), h('option', { value: 'original' }, 'Original'));
  srcSel.addEventListener('change', () => {
    writeJSON('cutroom:source', srcSel.value);
    loadVersion({ keepTime: true });
  });
  const player = h('div', { class: 'player' }, stage,
    h('div', { class: 'controls' }, scrub,
      h('div', { class: 'ctl-row' }, playBtn, stepB, stepF,
        h('span', { class: 'tc-wrap' }, tcEl, h('span', { class: 'faint' }, ' / '), durEl),
        h('div', { class: 'grow' }), srcSel, loopBtn, speedSel, fpsSel, muteBtn, vol, fsBtn)));

  // ── composer DOM
  const composeTc = h('button', { class: 'tc chip', title: 'Jump to this frame' }, '00:00:00:00');
  const pinBadge = h('span', { class: 'pin hidden', title: 'Your note is pinned to this frame' }, 'pinned');
  const textarea = h('textarea', { class: 'compose-input', rows: 3, placeholder: 'Pause anywhere and type a note… (C)' });
  const toolBtns = Object.fromEntries([['pen', 'Draw (D)'], ['arrow', 'Arrow (A)'], ['box', 'Box (B)']].map(([t, title]) =>
    [t, h('button', { class: 'tool', title, onclick: () => setTool(rv.tool === t ? null : t) }, icon(t))]));
  const swatches = INK_COLORS.map((c) => h('button', { class: 'swatch' + (c === rv.color ? ' on' : ''), style: { background: c }, title: 'Ink colour', onclick: () => { rv.color = c; swatches.forEach((s) => s.classList.toggle('on', s.style.background === swatchBg(c))); } }));
  const swatchBg = (c) => { const d = h('div', { style: { background: c } }); return d.style.background; };
  const undoBtn = h('button', { class: 'tool', title: 'Undo stroke', onclick: () => { rv.strokes.pop(); afterInkChange(); } }, icon('undo'));
  const clearBtn = h('button', { class: 'tool', title: 'Clear drawing', onclick: () => { rv.strokes = []; afterInkChange(); } }, icon('x'));
  const postBtn = h('button', { class: 'btn primary sm', onclick: () => post() }, 'Post note');
  const composer = h('div', { class: 'composer' },
    h('div', { class: 'compose-head' }, h('span', { class: 'muted' }, 'Note at'), composeTc, pinBadge, h('div', { class: 'grow' }), h('span', { class: 'kbd-hint' }, '⌘/Ctrl + Enter')),
    textarea,
    h('div', { class: 'compose-tools' }, toolBtns.pen, toolBtns.arrow, toolBtns.box, h('span', { class: 'divider' }), swatches, h('span', { class: 'divider' }), undoBtn, clearBtn, h('div', { class: 'grow' }), postBtn));

  const tabs = h('div', { class: 'tabs' });
  const list = h('div', { class: 'cmt-list' });
  const panel = h('aside', { class: 'panel' }, composer, tabs, list);

  // ── header DOM
  const title = h('input', { class: 'title-input', value: asset.name, title: 'Rename', spellcheck: 'false' });
  title.addEventListener('change', () => { const v = title.value.trim(); if (v) { asset.name = v; Store.save(); renderTopbar([{ label: 'Projects', href: '#/' }, { label: p.name, href: `#/p/${p.id}` }, { label: v }]); setSaveState('saving'); } });
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') title.blur(); });
  const versionSel = h('select', { class: 'select', title: 'Version' });
  const statusSel = h('select', { class: 'select status-select' }, Object.entries(STATUSES).map(([k, s]) => h('option', { value: k }, s.label)));
  const head = h('div', { class: 'rv-head' },
    h('a', { class: 'icon-btn', href: `#/p/${p.id}`, title: 'Back to project' }, icon('chevronLeft')),
    title,
    h('div', { class: 'grow' }),
    h('div', { class: 'seg' }, icon('layers'), versionSel,
      h('button', { class: 'icon-btn sm', title: 'Version options', onclick: (e) => versionMenu(e.currentTarget) }, icon('more'))),
    h('button', { class: 'btn sm', onclick: () => addVersion() }, icon('plus'), 'New version'),
    statusSel,
    p.folderId ? h('button', { class: 'btn sm' + (asset.share?.token && !asset.share.revoked ? ' shared' : ''), title: 'Get a link clients can comment on', onclick: () => shareModal(p, asset, () => { renderComments(); renderMarkers(); }) }, icon('share'), asset.share?.token && !asset.share.revoked ? 'Shared' : 'Share') : null,
    h('button', { class: 'btn sm', onclick: (e) => exportMenu(e.currentTarget) }, icon('download'), 'Export'),
    h('button', { class: 'icon-btn', title: 'Keyboard shortcuts (?)', onclick: showShortcuts }, icon('keyboard')));

  main().replaceChildren(h('div', { class: 'review' }, head, h('div', { class: 'rv-body' }, player, panel)));

  // ── versions & status
  function fillVersions() {
    versionSel.replaceChildren(...asset.versions.map((v, i) => h('option', { value: i, selected: i === rv.vIdx },
      `v${i + 1}${i === asset.versions.length - 1 ? ' (latest)' : ''} · ${v.name}`)));
  }
  versionSel.addEventListener('change', () => { rv.vIdx = Number(versionSel.value); loadVersion(); });
  function fillStatus() {
    statusSel.value = asset.status || 'review';
    statusSel.className = 'select status-select ' + (STATUSES[asset.status]?.cls || '');
  }
  statusSel.addEventListener('change', () => { asset.status = statusSel.value; fillStatus(); Store.save(); toast(`Marked as “${STATUSES[asset.status].label}”`); });

  async function addVersion() {
    if (p.folderId) {
      let files = folderCache.get(p.id);
      try { if (!files) { files = await Drive.videos(p.folderId); folderCache.set(p.id, files); } } catch (e) { return toast(e.message); }
      const mine = new Set(asset.versions.map((v) => v.fileId));
      const cands = files.filter((f) => !mine.has(f.id)).sort((a, b) => (b.modifiedTime || '').localeCompare(a.modifiedTime || ''));
      const m = modal({
        title: `Stack a new version on “${asset.name}”`, wide: true,
        body: cands.length
          ? [h('p', { class: 'muted small' }, 'Pick the newer cut from this project’s folder. It becomes v' + (asset.versions.length + 1) + '; earlier versions and their notes stay one click away.'),
            h('div', { class: 'folder-list' }, cands.map((f) => h('button', { class: 'folder-row', onclick: () => { m.close(); stackDriveFile(f); } },
              icon('film'), h('span', { class: 'grow' }, f.name), h('span', { class: 'faint small' }, f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : ''))))]
          : h('p', { class: 'muted' }, 'Every video in this folder is already part of this stack. Upload the new cut to the Drive folder, then try again.'),
        foot: [h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel')],
      });
    } else {
      const [f] = await pickFiles({ multiple: false });
      if (!f) return;
      const key = fileKey(f);
      if (!localFiles.has(key)) localFiles.set(key, URL.createObjectURL(f));
      asset.versions.push({ id: uid(), localKey: key, name: f.name, addedAt: Date.now() });
      afterVersionAdded();
    }
  }
  function stackDriveFile(f) {
    const other = projectAssets(p.id).find((a) => a.id !== asset.id && a.versions.some((v) => v.fileId === f.id));
    if (other) {
      if (other.comments.length && !confirm(`“${f.name}” already has ${other.comments.length} notes. Stack it here and keep them with that version?`)) return;
      asset.versions.push(...other.versions);
      asset.comments.push(...other.comments);
      delete Store.data.assets[other.id];
    } else {
      asset.versions.push({ id: uid(), fileId: f.id, name: f.name, addedAt: Date.now() });
    }
    afterVersionAdded();
  }
  function afterVersionAdded() {
    rv.vIdx = asset.versions.length - 1;
    if (asset.status === 'approved') asset.status = 'review';
    Store.save(); fillStatus(); loadVersion();
    toast(`Added as v${asset.versions.length}`);
  }
  function versionMenu(anchor) {
    const v = curV();
    popMenu(anchor, [
      { label: 'Rename this version', onclick: () => promptModal('Rename version', 'Label', v.name, (val) => { v.name = val; Store.save(); fillVersions(); }) },
      v.fileId ? { label: 'Open file in Drive', icon: 'external', onclick: () => window.open(`https://drive.google.com/file/d/${v.fileId}/view`, '_blank', 'noopener') } : null,
      v.fileId ? { label: proxyCache.get(p.id)?.get(v.fileId) ? 'Remake proxy for this version' : 'Make a proxy for this version', icon: 'film',
        onclick: () => proxyModal(p, [{ id: v.fileId, name: v.name }], v.fileId, async () => { await loadProxies(p, true); loadVersion({ keepTime: true }); }) } : null,
      asset.versions.length > 1 ? { label: 'Unstack into its own item', onclick: unstack } : null,
    ]);
  }
  function unstack() {
    const v = curV();
    if (!confirm(`Move v${rv.vIdx + 1} (“${v.name}”) and its notes out of this stack into its own item?`)) return;
    asset.versions.splice(rv.vIdx, 1);
    const moved = asset.comments.filter((c) => c.versionId === v.id);
    asset.comments = asset.comments.filter((c) => c.versionId !== v.id);
    const na = { id: 'a_' + uid(), projectId: p.id, name: stripExt(v.name), status: 'review', createdAt: Date.now(), versions: [v], comments: moved };
    Store.data.assets[na.id] = na;
    rv.vIdx = Math.min(rv.vIdx, asset.versions.length - 1);
    Store.save(); loadVersion();
    toast('Unstacked into its own item');
  }

  // ── video loading
  function showMsg(content) { stageMsg.replaceChildren(...[content].flat().filter(Boolean)); stageMsg.classList.remove('hidden'); }
  function hideMsg() { stageMsg.classList.add('hidden'); }

  async function loadVersion({ keepTime = false } = {}) {
    const resumeAt = keepTime ? video.currentTime : 0;
    fillVersions();
    video.pause();
    if (!keepTime) { rv.selected = null; rv.strokes = []; rv.current = null; rv.pinT = null; textarea.value = ''; setTool(null); }
    if (rv.blobUrl) { URL.revokeObjectURL(rv.blobUrl); rv.blobUrl = null; }
    renderComments(); renderMarkers(); renderInk();
    const v = curV();
    const myNav = navSeq;
    let src = null;
    if (v.fileId) {
      showMsg([h('div', { class: 'spinner' }), h('p', {}, 'Streaming from Drive…')]);
      const proxy = (await loadProxies(p)).get(v.fileId);
      if (myNav !== navSeq || curV() !== v) return;
      srcSel.classList.toggle('hidden', !proxy);
      if (proxy) {
        srcSel.value = readJSON('cutroom:source', 'proxy') === 'original' ? 'original' : 'proxy';
        srcSel.options[0].textContent = `Proxy ${proxy.appProperties?.cutroomProxyRes && proxy.appProperties.cutroomProxyRes !== '0' ? proxy.appProperties.cutroomProxyRes + 'p' : ''}`.trim();
      }
      const playId = proxy && srcSel.value === 'proxy' ? proxy.id : v.fileId;
      if (swReady) src = './__drive/' + playId;
      else {
        try {
          const r = await Drive.api(`files/${playId}?alt=media&supportsAllDrives=true`);
          src = rv.blobUrl = URL.createObjectURL(await r.blob());
        } catch (e) { showMsg(h('p', { class: 'error' }, 'Could not load from Drive: ' + e.message)); return; }
      }
    } else if (v.localKey) {
      src = localFiles.get(v.localKey);
      if (!src) { showRelink(v); return; }
    }
    if (myNav !== navSeq) return;
    video.src = src;
    video.load();
    if (resumeAt) video.addEventListener('loadedmetadata', () => seekTo(resumeAt), { once: true });
  }
  function showRelink(v) {
    video.removeAttribute('src'); video.load();
    showMsg([
      icon('film'),
      h('p', {}, 'Open “', h('b', {}, v.name), '” from your computer to keep reviewing.'),
      h('p', { class: 'faint small' }, 'Local files are not uploaded anywhere, so the browser needs you to pick the file again after a reload.'),
      h('button', { class: 'btn primary', onclick: async () => {
        const [f] = await pickFiles({ multiple: false });
        if (!f) return;
        const key = fileKey(f);
        if (key !== v.localKey && !confirm(`“${f.name}” isn’t the same file as “${v.name}”. Use it for this version anyway?`)) return;
        if (key !== v.localKey) { v.localKey = key; v.name = f.name; Store.save(); }
        localFiles.set(key, URL.createObjectURL(f));
        loadVersion();
      } }, 'Choose file'),
    ]);
  }

  // ── video events
  video.volume = Number(vol.value);
  video.addEventListener('loadedmetadata', () => {
    hideMsg(); layoutInk(); renderMarkers(); updateTime();
    durEl.textContent = fmtTC(video.duration, rv.fps);
    // Chrome can open a .mov whose video codec it can't decode (ProRes, 4:2:2 HEVC…):
    // the timeline and audio work but the picture stays black. Say so.
    if (!video.videoWidth) {
      const v = curV();
      const status = h('div', { class: 'proxy-wait hidden' });
      const makeBtn = v.fileId ? h('button', { class: 'btn primary', onclick: () => proxyModal(p, [{ id: v.fileId, name: v.name }], v.fileId, async () => { await loadProxies(p, true); loadVersion({ keepTime: true }); }) }, icon('film'), 'Make a proxy') : null;
      showMsg([
        h('p', { class: 'error' }, 'This browser can’t show the picture in this file.'),
        h('p', { class: 'faint small' }, 'The audio and timeline load, but the video codec (often ProRes or 10-bit 4:2:2 HEVC in camera .mov files) isn’t supported. A proxy fixes this: once it’s ready, it plays here automatically.'),
        status, makeBtn,
        h('button', { class: 'btn ghost', onclick: hideMsg }, 'Show anyway'),
      ]);
      if (v.fileId) watchProxyJob(v, status, makeBtn);
    }
  });

  // If the helper is already making a proxy for this version, show its progress
  // and switch to the proxy as soon as it's uploaded.
  function watchProxyJob(v, status, makeBtn) {
    const myNav = navSeq;
    let reached = false;
    const tick = async () => {
      if (myNav !== navSeq || curV() !== v || stageMsg.classList.contains('hidden')) return;
      try {
        const st = await helperCall('/status');
        reached = true;
        const job = st.jobs.filter((j) => j.fileId === v.fileId).pop();
        if (job && !['error', 'skipped'].includes(job.state)) {
          makeBtn?.classList.add('hidden');
          status.classList.remove('hidden');
          if (job.state === 'done') {
            status.replaceChildren(h('p', {}, 'Proxy ready. Loading it…'));
            await loadProxies(p, true);
            return loadVersion({ keepTime: true });
          }
          status.replaceChildren(...[
            h('p', { class: 'small' }, `Making a proxy: ${JOB_LABELS[job.state] || job.state}${job.detail ? ' · ' + job.detail : ''}`),
            ['downloading', 'encoding', 'uploading'].includes(job.state) ? h('div', { class: 'bar' }, h('div', { style: { width: Math.round(job.progress * 100) + '%' } })) : null,
          ].filter(Boolean));
          if (job.state === 'waiting' && Store.backend === 'drive') helperCall('/token', { token: await Drive.getToken() }).catch(() => {});
        } else if (job?.state === 'error') {
          status.classList.remove('hidden');
          status.replaceChildren(h('p', { class: 'error small' }, 'The last proxy attempt failed: ' + job.detail));
          makeBtn?.classList.remove('hidden');
        }
      } catch { if (!reached) return; }
      setTimeout(tick, 2000);
    };
    tick();
  }
  video.addEventListener('error', () => {
    if (!video.getAttribute('src')) return;
    const code = video.error?.code;
    showMsg([h('p', { class: 'error' }, code === 4
      ? 'This video can’t be played in the browser.'
      : 'The video stopped loading.'),
      h('p', { class: 'faint small' }, code === 4
        ? (curV().fileId ? 'Browsers can’t play ProRes, DNxHR and some HEVC .mov files. Use “Make a proxy for this version” in the version menu (⋯) to create a playable copy.' : 'Browsers play H.264/AAC MP4 and WebM. ProRes, DNxHR and some HEVC .mov files won’t play.')
        : (curV().fileId ? 'Your Google session may have expired. Reload the page and sign in again.' : 'Try opening the file again.')),
      h('button', { class: 'btn', onclick: () => loadVersion() }, 'Retry')]);
  });
  video.addEventListener('play', () => { playBtn.replaceChildren(icon('pause')); rv.selected = null; markSelected(); renderInk(); tick(); });
  video.addEventListener('pause', () => { playBtn.replaceChildren(icon('play')); updateTime(); renderInk(); });
  video.addEventListener('seeked', () => { updateTime(); renderInk(); });
  video.addEventListener('timeupdate', () => { if (video.paused) updateTime(); });
  video.addEventListener('progress', updateBuffer);
  video.addEventListener('volumechange', () => { muteBtn.replaceChildren(icon(video.muted || video.volume === 0 ? 'mute' : 'volume')); });
  video.addEventListener('click', () => { if (!rv.tool) togglePlay(); });

  function tick() { cancelAnimationFrame(rv.raf); updateTime(); if (!video.paused) rv.raf = requestAnimationFrame(tick); }
  function updateTime() {
    const t = video.currentTime, d = video.duration || 0;
    tcEl.textContent = fmtTC(t, rv.fps);
    const pct = d ? (t / d) * 100 : 0;
    played.style.width = pct + '%';
    headEl.style.left = pct + '%';
    composeTc.textContent = fmtTC(rv.pinT ?? t, rv.fps);
    // highlight the note the playhead just passed
    let active = null;
    for (const c of versionComments()) { if (c.t <= t + halfFrame() && t - c.t < 2.5) active = c.id; }
    if (active !== rv.activeId) {
      rv.activeId = active;
      $$('.cmt', list).forEach((el) => el.classList.toggle('active', el.dataset.id === active));
      $$('.marker', markers).forEach((el) => el.classList.toggle('active', el.dataset.id === active));
    }
  }
  function updateBuffer() {
    const d = video.duration; const b = video.buffered;
    if (!d || !b.length) return;
    let end = 0;
    for (let i = 0; i < b.length; i++) if (b.start(i) <= video.currentTime + 0.5) end = Math.max(end, b.end(i));
    buffered.style.width = (end / d) * 100 + '%';
  }

  // ── transport
  const togglePlay = () => { if (!video.getAttribute('src')) return; video.paused ? video.play().catch(() => {}) : video.pause(); };
  function seekTo(t) { if (!isFinite(video.duration)) return; video.currentTime = Math.max(0, Math.min(video.duration - 0.001, t)); updateTime(); }
  function stepFrame(n) {
    video.pause();
    const f = Math.floor(video.currentTime * rv.fps + 1e-4) + n;
    seekTo((Math.max(0, f) + 0.5) / rv.fps);
  }
  playBtn.onclick = togglePlay;
  stepB.onclick = () => stepFrame(-1);
  stepF.onclick = () => stepFrame(1);
  loopBtn.onclick = () => { video.loop = !video.loop; loopBtn.classList.toggle('on', video.loop); };
  speedSel.onchange = () => { video.playbackRate = Number(speedSel.value); };
  fpsSel.onchange = () => { rv.fps = Number(fpsSel.value); asset.fps = rv.fps; Store.save(); durEl.textContent = fmtTC(video.duration, rv.fps); updateTime(); renderComments(); };
  muteBtn.onclick = () => { video.muted = !video.muted; };
  vol.oninput = () => { video.volume = Number(vol.value); video.muted = false; writeJSON('cutroom:vol', video.volume); };
  fsBtn.onclick = () => { document.fullscreenElement ? document.exitFullscreen() : player.requestFullscreen?.().catch(() => {}); };

  // scrubbing
  const scrubTime = (e) => { const r = track.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (video.duration || 0); };
  let dragging = false, wasPlaying = false;
  scrub.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.marker') || !video.duration) return;
    dragging = true; wasPlaying = !video.paused; video.pause();
    scrub.setPointerCapture(e.pointerId); seekTo(scrubTime(e));
  });
  scrub.addEventListener('pointermove', (e) => {
    if (!video.duration) return;
    const t = scrubTime(e);
    const r = track.getBoundingClientRect();
    tip.textContent = fmtTC(t, rv.fps);
    tip.style.left = ((t / video.duration) * r.width) + 'px';
    tip.classList.remove('hidden');
    if (dragging) seekTo(t);
  });
  scrub.addEventListener('pointerleave', () => { if (!dragging) tip.classList.add('hidden'); });
  const endDrag = () => { if (!dragging) return; dragging = false; tip.classList.add('hidden'); if (wasPlaying) video.play().catch(() => {}); };
  scrub.addEventListener('pointerup', endDrag);
  scrub.addEventListener('pointercancel', endDrag);

  // ── markers
  function renderMarkers() {
    const d = video.duration;
    const cs = versionComments();
    markers.replaceChildren(...(!d ? [] : cs.map((c, i) => h('button', {
      class: 'marker' + (c.resolved ? ' resolved' : '') + (c.id === rv.selected ? ' selected' : ''),
      'data-id': c.id, style: { left: Math.min(100, (c.t / d) * 100) + '%' },
      title: `#${i + 1} · ${fmtTC(c.t, rv.fps)} · ${c.author}: ${c.text || '(drawing)'}`,
      onclick: (e) => { e.stopPropagation(); selectComment(c); },
    }))));
  }

  // ── ink (drawing on the frame)
  function layoutInk() {
    const sw = stage.clientWidth, sh = stage.clientHeight;
    const vw = video.videoWidth || 16, vh = video.videoHeight || 9;
    const scale = Math.min(sw / vw, sh / vh);
    const w = vw * scale, hh = vh * scale;
    Object.assign(canvas.style, { left: (sw - w) / 2 + 'px', top: (sh - hh) / 2 + 'px', width: w + 'px', height: hh + 'px' });
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(hh * dpr));
    renderInk();
  }
  const ro = new ResizeObserver(() => layoutInk());
  ro.observe(stage);

  function renderInk() {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const t = video.currentTime;
    let strokes = null;
    if (rv.strokes.length || rv.current) {
      if (rv.pinT == null || Math.abs(t - rv.pinT) < halfFrame()) strokes = rv.current ? [...rv.strokes, rv.current] : rv.strokes;
    } else if (video.paused) {
      const sel = rv.selected && asset.comments.find((c) => c.id === rv.selected);
      const at = sel && sel.drawing && Math.abs(t - sel.t) < halfFrame() ? sel
        : versionComments().find((c) => c.drawing && Math.abs(t - c.t) < halfFrame());
      if (at) strokes = at.drawing;
    }
    if (strokes) drawStrokes(ctx, strokes, canvas.width, canvas.height);
  }
  function drawStrokes(ctx, strokes, W, H) {
    for (const s of strokes) {
      const P = s.pts.map(([x, y]) => [x * W, y * H]);
      if (!P.length) continue;
      ctx.strokeStyle = s.color; ctx.lineWidth = Math.max(2, s.w * W); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = ctx.lineWidth * 0.8;
      ctx.beginPath();
      const a = P[0], b = P[P.length - 1];
      if (s.tool === 'pen') {
        ctx.moveTo(a[0], a[1]);
        if (P.length === 1) ctx.lineTo(a[0] + 0.1, a[1]);
        for (let i = 1; i < P.length; i++) ctx.lineTo(P[i][0], P[i][1]);
        ctx.stroke();
      } else if (s.tool === 'box') {
        ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
      } else if (s.tool === 'arrow') {
        ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), L = Math.max(14, ctx.lineWidth * 4);
        ctx.beginPath();
        ctx.moveTo(b[0], b[1]); ctx.lineTo(b[0] - L * Math.cos(ang - 0.45), b[1] - L * Math.sin(ang - 0.45));
        ctx.moveTo(b[0], b[1]); ctx.lineTo(b[0] - L * Math.cos(ang + 0.45), b[1] - L * Math.sin(ang + 0.45));
        ctx.stroke();
      }
    }
    ctx.shadowBlur = 0;
  }
  const normPt = (e) => {
    const r = canvas.getBoundingClientRect();
    const r4 = (n) => Math.round(Math.max(0, Math.min(1, n)) * 10000) / 10000;
    return [r4((e.clientX - r.left) / r.width), r4((e.clientY - r.top) / r.height)];
  };
  function setTool(t) {
    rv.tool = t;
    for (const [k, b] of Object.entries(toolBtns)) b.classList.toggle('on', k === t);
    canvas.classList.toggle('armed', !!t);
    if (t) { video.pause(); if (rv.pinT == null && rv.strokes.length === 0) rv.pinT = null; }
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (!rv.tool || !video.getAttribute('src')) return;
    e.preventDefault();
    video.pause();
    if (rv.pinT != null && Math.abs(video.currentTime - rv.pinT) > halfFrame()) seekTo(rv.pinT);
    if (rv.pinT == null) rv.pinT = video.currentTime;
    canvas.setPointerCapture(e.pointerId);
    rv.current = { tool: rv.tool, color: rv.color, w: 0.0045, pts: [normPt(e)] };
    renderInk();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!rv.current) return;
    const pt = normPt(e);
    if (rv.current.tool === 'pen') {
      const last = rv.current.pts[rv.current.pts.length - 1];
      if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) > 0.0015) rv.current.pts.push(pt);
    } else rv.current.pts = [rv.current.pts[0], pt];
    renderInk();
  });
  const endStroke = () => {
    if (!rv.current) return;
    const s = rv.current; rv.current = null;
    const [a, b] = [s.pts[0], s.pts[s.pts.length - 1]];
    if (s.tool === 'pen' || Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.01) rv.strokes.push(s);
    afterInkChange();
  };
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  function afterInkChange() {
    if (!rv.strokes.length && !textarea.value.trim()) rv.pinT = null;
    pinBadge.classList.toggle('hidden', rv.pinT == null);
    updateTime(); renderInk();
  }

  // ── composer
  textarea.addEventListener('input', () => {
    if (textarea.value.trim() && rv.pinT == null) { video.pause(); rv.pinT = video.currentTime; }
    afterInkChange();
  });
  textarea.addEventListener('focus', () => video.pause());
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); post(); }
    if (e.key === 'Escape') textarea.blur();
  });
  composeTc.onclick = () => { video.pause(); seekTo(rv.pinT ?? video.currentTime); };

  function post() {
    const text = textarea.value.trim();
    if (!text && !rv.strokes.length) return toast('Write a note or draw on the frame first');
    if (!video.getAttribute('src')) return toast('Load the video first');
    const c = {
      id: uid(), versionId: curV().id, t: rv.pinT ?? video.currentTime, text,
      author: authorName(), createdAt: Date.now(), resolved: false,
      drawing: rv.strokes.length ? rv.strokes : null, replies: [],
    };
    asset.comments.push(c);
    if (asset.status === 'approved') { asset.status = 'changes'; fillStatus(); }
    Store.save();
    textarea.value = ''; rv.strokes = []; rv.pinT = null; setTool(null);
    if (rv.filter === 'resolved') rv.filter = 'open';
    rv.selected = c.id;
    afterInkChange(); renderComments(); renderMarkers();
  }

  // ── comment list
  function renderComments() {
    const all = versionComments();
    const num = new Map(all.map((c, i) => [c.id, i + 1]));
    const counts = { all: all.length, open: all.filter((c) => !c.resolved).length, resolved: all.filter((c) => c.resolved).length };
    tabs.replaceChildren(...[['open', 'Open'], ['resolved', 'Resolved'], ['all', 'All']].map(([k, l]) =>
      h('button', { class: 'tab' + (rv.filter === k ? ' on' : ''), onclick: () => { rv.filter = k; renderComments(); } }, l, h('span', { class: 'count' }, counts[k]))));
    const shown = all.filter((c) => rv.filter === 'all' || (rv.filter === 'open' ? !c.resolved : c.resolved));
    if (!shown.length) {
      list.replaceChildren(h('div', { class: 'cmt-empty' },
        all.length && rv.filter === 'open' ? [icon('check'), h('p', {}, 'Every note on this version is resolved.')]
          : rv.filter === 'resolved' ? h('p', {}, 'Nothing resolved yet.')
            : [icon('comment'), h('p', {}, 'No notes on this version yet.'), h('p', { class: 'faint small' }, 'Pause on a frame and start typing, or press D to draw on it.')]));
      return;
    }
    list.replaceChildren(...shown.map((c) => commentEl(c, num.get(c.id))));
    rv.activeId = undefined; updateTime();
  }
  function commentEl(c, n) {
    const el = h('div', { class: 'cmt' + (c.resolved ? ' resolved' : '') + (rv.selected === c.id ? ' selected' : ''), 'data-id': c.id });
    const textEl = h('div', { class: 'cmt-text' }, c.text || h('em', { class: 'faint' }, 'Drawing only'));
    const replies = h('div', { class: 'replies' }, c.replies.map((r) => h('div', { class: 'reply' },
      h('div', { class: 'cmt-meta' }, h('span', { class: 'author' }, r.author), r.source === 'client' ? h('span', { class: 'client-tag' }, 'Client') : null, h('span', { class: 'faint' }, ' · ' + timeAgo(r.createdAt)),
        r.source === 'client' ? null : h('button', { class: 'link-btn faint', onclick: () => { if (!confirm('Delete this reply?')) return; c.replies = c.replies.filter((x) => x.id !== r.id); Store.save(); renderComments(); } }, 'Delete')),
      h('div', { class: 'cmt-text' }, r.text))));
    const actions = h('div', { class: 'cmt-actions' },
      h('button', { class: 'link-btn', onclick: () => openReply() }, icon('comment'), 'Reply'));
    function openReply() {
      const ta = h('textarea', { class: 'compose-input sm', rows: 2, placeholder: 'Reply…' });
      const send = () => { const v = ta.value.trim(); if (!v) return; c.replies.push({ id: uid(), text: v, author: authorName(), createdAt: Date.now() }); Store.save(); renderComments(); };
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } if (e.key === 'Escape') renderComments(); });
      actions.replaceChildren(h('div', { class: 'reply-box' }, ta, h('div', { class: 'row gap end' },
        h('button', { class: 'btn ghost sm', onclick: () => renderComments() }, 'Cancel'), h('button', { class: 'btn primary sm', onclick: send }, 'Reply'))));
      ta.focus();
    }
    function edit() {
      const ta = h('textarea', { class: 'compose-input sm', rows: 3, value: c.text });
      const save = () => { c.text = ta.value.trim(); c.editedAt = Date.now(); Store.save(); renderComments(); };
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); if (e.key === 'Escape') renderComments(); });
      textEl.replaceWith(h('div', { class: 'reply-box' }, ta, h('div', { class: 'row gap end' },
        h('button', { class: 'btn ghost sm', onclick: () => renderComments() }, 'Cancel'), h('button', { class: 'btn primary sm', onclick: save }, 'Save'))));
      ta.focus();
    }
    el.append(
      h('div', { class: 'cmt-top' },
        h('span', { class: 'cmt-num' }, '#' + n),
        h('button', { class: 'tc chip', title: 'Jump to this frame', onclick: () => selectComment(c) }, fmtTC(c.t, rv.fps)),
        c.drawing ? h('span', { class: 'cmt-ink', title: 'Has a drawing' }, icon('pen')) : null,
        h('div', { class: 'grow' }),
        h('button', { class: 'icon-btn sm resolve' + (c.resolved ? ' on' : ''), title: c.resolved ? 'Reopen' : 'Resolve', onclick: () => {
          c.resolved = !c.resolved; c.resolvedAt = c.resolved ? Date.now() : null; Store.save(); renderComments(); renderMarkers();
        } }, icon('check')),
        h('button', { class: 'icon-btn sm', title: 'More', onclick: (e) => popMenu(e.currentTarget, c.source === 'client'
          ? [{ label: 'Hide this client comment', danger: true, onclick: () => {
            if (!confirm('Hide this comment? It disappears for you and from the client link.')) return;
            asset.share = asset.share || {}; asset.share.hidden = [...new Set([...(asset.share.hidden || []), c.id])];
            asset.comments = asset.comments.filter((x) => x.id !== c.id); Store.save(); renderComments(); renderMarkers(); renderInk();
          } }]
          : [
            { label: 'Edit', icon: 'pen', onclick: edit },
            { label: 'Delete', danger: true, onclick: () => { if (!confirm('Delete this note?')) return; asset.comments = asset.comments.filter((x) => x.id !== c.id); Store.save(); renderComments(); renderMarkers(); renderInk(); } },
          ]) }, icon('more'))),
      h('div', { class: 'cmt-meta' }, h('span', { class: 'author' }, c.author), c.source === 'client' ? h('span', { class: 'client-tag' }, 'Client') : null, h('span', { class: 'faint', title: new Date(c.createdAt).toLocaleString() }, ' · ' + timeAgo(c.createdAt) + (c.editedAt ? ' · edited' : ''))),
      textEl, replies, actions);
    el.addEventListener('click', (e) => { if (e.target.closest('button,textarea,input,a')) return; selectComment(c); });
    return el;
  }
  function selectComment(c) {
    rv.selected = c.id;
    video.pause();
    seekTo(c.t);
    markSelected();
    $(`.cmt[data-id="${c.id}"]`, list)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    renderInk();
  }
  function markSelected() {
    $$('.cmt', list).forEach((el) => el.classList.toggle('selected', el.dataset.id === rv.selected));
    $$('.marker', markers).forEach((el) => el.classList.toggle('selected', el.dataset.id === rv.selected));
  }
  function jumpComment(dir) {
    const cs = versionComments(); if (!cs.length) return;
    const t = video.currentTime;
    const c = dir > 0 ? cs.find((x) => x.t > t + halfFrame()) : [...cs].reverse().find((x) => x.t < t - halfFrame());
    if (c) selectComment(c);
  }

  // ── export
  function exportMenu(anchor) {
    const v = curV(), n = rv.vIdx + 1, base = `${asset.name} v${n}`.replace(/[\\/:*?"<>|]+/g, '-');
    const cs = versionComments();
    if (!cs.length) return toast('No notes on this version to export');
    const csvCell = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    popMenu(anchor, [
      { label: 'Notes as text (for your editor)', onclick: () => {
        const lines = [`${asset.name} — v${n} (${v.name})`, `${cs.length} notes · exported ${new Date().toLocaleString()}`, ''];
        cs.forEach((c, i) => {
          lines.push(`#${i + 1}  ${fmtTC(c.t, rv.fps)}  ${c.resolved ? '[done]' : '[open]'}  ${c.author}${c.drawing ? '  (drawing)' : ''}`);
          lines.push(...(c.text || '(drawing only)').split('\n').map((l) => '    ' + l));
          c.replies.forEach((r) => lines.push(`    ↳ ${r.author}: ${r.text}`));
          lines.push('');
        });
        download(base + ' notes.txt', lines.join('\n'), 'text/plain');
      } },
      { label: 'Notes as CSV (spreadsheet)', onclick: () => {
        const rows = [['#', 'Timecode', 'Seconds', 'Version', 'Author', 'Note', 'Status', 'Has drawing', 'Replies', 'Created']];
        cs.forEach((c, i) => rows.push([i + 1, fmtTC(c.t, rv.fps), c.t.toFixed(3), `v${n}`, c.author, c.text, c.resolved ? 'Resolved' : 'Open', c.drawing ? 'yes' : '', c.replies.map((r) => `${r.author}: ${r.text}`).join(' | '), new Date(c.createdAt).toISOString()]));
        download(base + ' notes.csv', rows.map((r) => r.map(csvCell).join(',')).join('\r\n'), 'text/csv');
      } },
      { label: 'DaVinci Resolve markers (.edl)', onclick: () => {
        const off = 3600; // Resolve timelines start at 01:00:00:00 by default
        const lines = [`TITLE: ${base}`, 'FCM: NON-DROP FRAME', ''];
        cs.forEach((c, i) => {
          const a = fmtTC(c.t + off, rv.fps), b = fmtTC(c.t + off + 1 / rv.fps, rv.fps);
          const note = `#${i + 1} ${c.author}: ${c.text || '(drawing)'}`.replace(/[\r\n|]+/g, ' ').slice(0, 240);
          lines.push(`${String(i + 1).padStart(3, '0')}  001      V     C        ${a} ${b} ${a} ${b}  `);
          lines.push(` |C:${c.resolved ? 'ResolveColorGreen' : 'ResolveColorRed'} |M:${note} |D:1`, '');
        });
        download(base + ' markers.edl', lines.join('\n'), 'text/plain');
      } },
    ]);
  }

  // ── keyboard
  function onKey(e) {
    if ($('.modal-wrap')) return;
    if (e.target.closest('input,textarea,select,[contenteditable]')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    const handled = {
      ' ': togglePlay, k: togglePlay, K: togglePlay,
      ArrowLeft: () => (e.shiftKey ? seekTo(video.currentTime - 1) : stepFrame(-1)),
      ArrowRight: () => (e.shiftKey ? seekTo(video.currentTime + 1) : stepFrame(1)),
      j: () => seekTo(video.currentTime - 5), J: () => seekTo(video.currentTime - 5),
      l: () => seekTo(video.currentTime + 5), L: () => seekTo(video.currentTime + 5),
      c: () => { video.pause(); textarea.focus(); }, C: () => { video.pause(); textarea.focus(); },
      d: () => setTool(rv.tool === 'pen' ? null : 'pen'), a: () => setTool(rv.tool === 'arrow' ? null : 'arrow'), b: () => setTool(rv.tool === 'box' ? null : 'box'),
      m: () => { video.muted = !video.muted; }, f: () => fsBtn.click(),
      '[': () => jumpComment(-1), ']': () => jumpComment(1),
      Home: () => seekTo(0), End: () => seekTo(video.duration),
      Escape: () => setTool(null),
      '?': showShortcuts,
    }[k];
    if (handled) { e.preventDefault(); handled(); }
  }
  document.addEventListener('keydown', onKey);

  // Keep a shared video's client link in sync: pull client comments now and
  // every 30 s, and push your own notes a moment after you change them.
  let syncTimer = null, pushTimer = null;
  const doSync = async () => {
    if (!asset.share?.token || asset.share.revoked || !linksReady()) return;
    const before = asset.comments.length + asset.comments.reduce((n, c) => n + c.replies.length, 0);
    try { await syncShare(p, asset); } catch (e) { console.warn('Client link sync failed', e); return; }
    const after = asset.comments.length + asset.comments.reduce((n, c) => n + c.replies.length, 0);
    if (after !== before && !list.querySelector('textarea:focus')) { renderComments(); renderMarkers(); }
  };
  if (asset.share?.token && !asset.share.revoked) { doSync(); syncTimer = setInterval(doSync, 30000); }
  Store.onSave = () => { if (asset.share?.token && !asset.share.revoked) { clearTimeout(pushTimer); pushTimer = setTimeout(doSync, 1500); } };

  cleanupView = () => {
    clearInterval(syncTimer); clearTimeout(pushTimer); Store.onSave = null;
    document.removeEventListener('keydown', onKey);
    ro.disconnect();
    cancelAnimationFrame(rv.raf);
    video.pause();
    video.removeAttribute('src'); video.load();
    if (rv.blobUrl) URL.revokeObjectURL(rv.blobUrl);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };

  fillStatus();
  loadVersion();
}

function showShortcuts() {
  const rows = [
    ['Space / K', 'Play / pause'], ['← / →', 'Previous / next frame'], ['Shift + ← / →', 'Back / forward 1 second'],
    ['J / L', 'Back / forward 5 seconds'], ['[ / ]', 'Previous / next note'], ['C', 'Write a note at this frame'],
    ['D / A / B', 'Draw / arrow / box'], ['Esc', 'Stop drawing'], ['⌘/Ctrl + Enter', 'Post note'], ['M', 'Mute'], ['F', 'Fullscreen'],
  ];
  const m = modal({
    title: 'Keyboard shortcuts',
    body: h('div', { class: 'shortcuts' }, rows.map(([k, d]) => h('div', { class: 'sc-row' }, h('kbd', {}, k), h('span', {}, d)))),
    foot: [h('button', { class: 'btn', onclick: () => m.close() }, 'Close')],
  });
}

// ───────────────────────── boot ─────────────────────────
async function boot() {
  renderTopbar();
  setLoading('Starting…');
  swReady = await setupSW();
  if (settings.backend === 'local') {
    await Store.load('local');
    route();
  } else if (settings.backend === 'drive' && settings.clientId) {
    if (Drive.restoreToken()) {
      try { await connectDrive(); } catch (e) { toast(e.message); route(); }
    } else route();
  } else route();
}

window.Cutroom = { Store, addLocalFiles, findProject, route }; // handy from the dev console
boot();
