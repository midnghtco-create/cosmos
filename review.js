'use strict';
/*
 * Cutroom client review page. A separate, limited module: someone with a
 * review link can watch that one video, add timestamped comments (with
 * drawings if allowed) and reply. They can't see anything else, resolve,
 * edit or delete. No Google login needed.
 */
const CFG = window.CUTROOM_PUBLIC || {};
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
const ICONS = {
  play: '<polygon points="7 4 20 12 7 20 7 4" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/>',
  stepBack: '<polygon points="18 19 9 12 18 5" fill="currentColor" stroke="none"/><path d="M6 5v14"/>',
  stepFwd: '<polygon points="6 5 15 12 6 19" fill="currentColor" stroke="none"/><path d="M18 5v14"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  arrow: '<path d="M5 19 19 5M9 5h10v10"/>',
  box: '<rect x="4" y="5" width="16" height="14" rx="1.5"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  comment: '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12Z"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  mute: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="m22 9-6 6M16 9l6 6"/>',
  expand: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
};
const icon = (n) => h('span', { class: 'ic', 'aria-hidden': 'true', html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ''}</svg>` });
// ── theme: system → light → dark ──
const THEME_ICONS = {
  system: '<rect x="3" y="4" width="18" height="12" rx="1"/><path d="M8 20h8M12 16v4"/>',
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  dark: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
};
function currentTheme() { try { const t = localStorage.getItem('cutroom:theme'); return t === 'light' || t === 'dark' ? t : 'system'; } catch { return 'system'; } }
function applyTheme(t) {
  if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
  try { if (t === 'system') localStorage.removeItem('cutroom:theme'); else localStorage.setItem('cutroom:theme', t); } catch { /* ignore */ }
}
function themeButton() {
  const label = { system: 'Theme: follows your system', light: 'Theme: light', dark: 'Theme: dark' };
  const b = document.createElement('button');
  b.className = 'icon-btn theme-btn';
  const paint = () => {
    const t = currentTheme();
    b.title = label[t] + ' (click to change)';
    b.setAttribute('aria-label', label[t]);
    b.innerHTML = `<span class="ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${THEME_ICONS[t]}</svg></span>`;
  };
  b.addEventListener('click', () => { const order = ['system', 'light', 'dark']; applyTheme(order[(order.indexOf(currentTheme()) + 1) % 3]); paint(); });
  paint();
  return b;
}

const INK_COLORS = ['#ff4d5e', '#ffd43b', '#3ee08f', '#4dabff', '#ffffff'];
function fmtTC(t, fps) {
  if (!isFinite(t) || t < 0) t = 0;
  const base = Math.round(fps), total = Math.floor(t * fps + 1e-4), ff = total % base, s = Math.floor(total / base);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60, ff].map((n) => String(n).padStart(2, '0')).join(':');
}
function timeAgo(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 604800) return Math.floor(s / 86400) + 'd ago';
  return new Date(ts).toLocaleDateString();
}
function store(key, val) { try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); } catch { return null; } return null; }
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3600); }

// ── server ──
const token = (location.hash.match(/[#&]t=([A-Za-z0-9_-]{16,64})/) || [])[1] || new URLSearchParams(location.search).get('t');
async function api(body) {
  const r = body
    ? await fetch(CFG.linksEndpoint, { method: 'POST', body: JSON.stringify({ token, ...body }) })
    : await fetch(`${CFG.linksEndpoint}?token=${encodeURIComponent(token)}&_=${Date.now()}`);
  const j = await r.json().catch(() => ({ error: 'The review service didn’t answer properly' }));
  if (j.error) throw new Error(j.error);
  return j;
}
const videoUrl = (fileId) => `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true&key=${encodeURIComponent(CFG.apiKey)}`;

// ── state ──
const S = {
  data: null, vIdx: 0, selected: null, pinT: null, tool: null, color: INK_COLORS[0],
  strokes: [], current: null, name: store('cutroom:clientName') || '', raf: 0, activeId: null, posting: false,
};
const curV = () => S.data.versions[S.vIdx];
const fps = () => Number(curV()?.fps) || 24;
const halfFrame = () => 0.6 / fps();
const versionComments = () => S.data.comments.filter((c) => c.versionId === curV().id).sort((a, b) => a.t - b.t || a.createdAt - b.createdAt);

function topbar(title) {
  $('#topbar').replaceChildren(...[
    h('span', { class: 'brand' }, h('span', { class: 'brand-mark' }, icon('play')), h('span', {}, 'Review')),
    title ? h('nav', { class: 'crumbs' }, h('span', { class: 'sep' }, '/'), h('span', { class: 'cur' }, title)) : null,
    h('div', { class: 'grow' }),
    S.name ? h('button', { class: 'backend-pill name-pill', title: 'Change your name', onclick: () => askName(true) }, icon('user'), S.name) : null,
    themeButton(),
  ].filter(Boolean));
}
function fail(msg) {
  topbar();
  $('#app').replaceChildren(h('div', { class: 'center-msg' }, h('p', { class: 'error' }, msg), h('p', { class: 'muted small' }, 'Ask the person who sent you this link for a new one.')));
}

function askName(change) {
  return new Promise((resolve) => {
    const input = h('input', { class: 'input', value: S.name, placeholder: 'e.g. Alex from Brightside', maxlength: 80 });
    const done = () => {
      const v = input.value.trim();
      if (!v) return input.focus();
      S.name = v; store('cutroom:clientName', v); wrap.remove(); topbar(S.data?.title); resolve(v);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(); });
    const wrap = h('div', { class: 'modal-wrap' }, h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'modal-head' }, h('h3', {}, change ? 'Change your name' : 'Who’s reviewing?')),
      h('div', { class: 'modal-body' },
        h('p', { class: 'muted small' }, 'Your name is shown next to your comments so the team knows who said what.'),
        h('label', { class: 'field' }, h('span', {}, 'Your name'), input)),
      h('div', { class: 'modal-foot' }, change ? h('button', { class: 'btn ghost', onclick: () => { wrap.remove(); resolve(S.name); } }, 'Cancel') : null,
        h('button', { class: 'btn primary', onclick: done }, 'Continue'))));
    $('#modal-root').append(wrap);
    setTimeout(() => input.focus(), 30);
  });
}

// ── page ──
async function boot() {
  topbar();
  if (!token) return fail('This review link is incomplete.');
  if (!CFG.linksEndpoint || CFG.linksEndpoint.startsWith('__')) return fail('Review links aren’t set up yet.');
  $('#app').replaceChildren(h('div', { class: 'center-msg' }, h('div', { class: 'spinner' }), h('p', {}, 'Opening the review…')));
  try { S.data = await api(); } catch (e) { return fail(e.message); }
  if (!S.data.versions?.length) return fail('There’s nothing to review on this link yet.');
  S.vIdx = S.data.versions.length - 1;
  document.title = `${S.data.title} · Review`;
  topbar(S.data.title);
  render();
  if (!S.name) await askName(false);
  setInterval(refresh, 20000);
}

async function refresh() {
  if (S.posting || document.hidden) return;
  try {
    const d = await api();
    const before = S.data.comments.length + S.data.comments.reduce((n, c) => n + c.replies.length, 0);
    S.data = d;
    const after = d.comments.length + d.comments.reduce((n, c) => n + c.replies.length, 0);
    if (after !== before && !$('.reply-box textarea:focus')) { renderComments(); renderMarkers(); }
  } catch { /* keep what we have */ }
}

let video, canvas, stage, stageMsg, markers, played, headEl, tcEl, durEl, playBtn, composeTc, textarea, list, tabs, toolBtns = {}, swatches = [];
let filter = 'all';

function render() {
  const d = S.data;
  video = h('video', { class: 'video', playsinline: true, preload: 'auto' });
  canvas = h('canvas', { class: 'ink' });
  stageMsg = h('div', { class: 'stage-msg hidden' });
  stage = h('div', { class: 'stage' }, video, canvas, stageMsg);
  played = h('div', { class: 'sb-played' }); headEl = h('div', { class: 'sb-head' }); markers = h('div', { class: 'sb-markers' });
  const buffered = h('div', { class: 'sb-buffer' }), tip = h('div', { class: 'sb-tip hidden' });
  const track = h('div', { class: 'sb-track' }, buffered, played);
  const scrub = h('div', { class: 'scrub' }, track, markers, headEl, tip);
  playBtn = h('button', { class: 'ctl', title: 'Play / pause (Space)', onclick: togglePlay }, icon('play'));
  tcEl = h('span', { class: 'tc-now' }, '00:00:00:00'); durEl = h('span', { class: 'tc-dur' }, '00:00:00:00');
  const speed = h('select', { class: 'select sm', title: 'Speed', onchange: (e) => { video.playbackRate = Number(e.target.value); } }, [0.5, 1, 1.5, 2].map((s) => h('option', { value: s, selected: s === 1 }, s + '×')));
  const muteBtn = h('button', { class: 'ctl', title: 'Mute (M)', onclick: () => { video.muted = !video.muted; } }, icon('volume'));
  const player = h('div', { class: 'player' }, stage,
    h('div', { class: 'controls' }, scrub, h('div', { class: 'ctl-row' }, playBtn,
      h('button', { class: 'ctl', title: 'Previous frame (←)', onclick: () => stepFrame(-1) }, icon('stepBack')),
      h('button', { class: 'ctl', title: 'Next frame (→)', onclick: () => stepFrame(1) }, icon('stepFwd')),
      h('span', { class: 'tc-wrap' }, tcEl, h('span', { class: 'faint' }, ' / '), durEl),
      h('div', { class: 'grow' }), speed, muteBtn,
      h('button', { class: 'ctl', title: 'Fullscreen (F)', onclick: () => (document.fullscreenElement ? document.exitFullscreen() : player.requestFullscreen?.()) }, icon('expand')))));

  // composer
  composeTc = h('button', { class: 'tc chip', title: 'Jump to this frame', onclick: () => { video.pause(); seekTo(S.pinT ?? video.currentTime); } }, '00:00:00:00');
  textarea = h('textarea', { class: 'compose-input', rows: 3, placeholder: 'Pause on a frame and type your comment… (C)' });
  textarea.addEventListener('input', () => { if (textarea.value.trim() && S.pinT == null) { video.pause(); S.pinT = video.currentTime; } afterInk(); });
  textarea.addEventListener('focus', () => video.pause());
  textarea.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); post(); } if (e.key === 'Escape') textarea.blur(); });
  const tools = [];
  if (d.allowDraw) {
    toolBtns = Object.fromEntries([['pen', 'Draw (D)'], ['arrow', 'Arrow (A)'], ['box', 'Box (B)']].map(([t, title]) => [t, h('button', { class: 'tool', title, onclick: () => setTool(S.tool === t ? null : t) }, icon(t))]));
    swatches = INK_COLORS.map((c) => h('button', { class: 'swatch' + (c === S.color ? ' on' : ''), style: { background: c }, title: 'Colour', onclick: (e) => { S.color = c; swatches.forEach((s) => s.classList.toggle('on', s === e.currentTarget)); } }));
    tools.push(toolBtns.pen, toolBtns.arrow, toolBtns.box, h('span', { class: 'divider' }), swatches, h('span', { class: 'divider' }),
      h('button', { class: 'tool', title: 'Undo stroke', onclick: () => { S.strokes.pop(); afterInk(); } }, icon('undo')),
      h('button', { class: 'tool', title: 'Clear drawing', onclick: () => { S.strokes = []; afterInk(); } }, icon('x')));
  }
  const composer = h('div', { class: 'composer' },
    h('div', { class: 'compose-head' }, h('span', { class: 'muted' }, 'Comment at'), composeTc, h('div', { class: 'grow' }), h('span', { class: 'kbd-hint' }, '⌘/Ctrl + Enter')),
    textarea,
    h('div', { class: 'compose-tools' }, tools, h('div', { class: 'grow' }), h('button', { class: 'btn primary sm', onclick: post }, 'Post comment')));
  tabs = h('div', { class: 'tabs' });
  list = h('div', { class: 'cmt-list' });
  const panel = h('aside', { class: 'panel' }, composer, tabs, list);

  const versionSel = d.versions.length > 1
    ? h('div', { class: 'seg' }, icon('layers'), h('select', { class: 'select', title: 'Version', onchange: (e) => { S.vIdx = Number(e.target.value); loadVideo(); } },
      d.versions.map((v, i) => h('option', { value: i, selected: i === S.vIdx }, `v${i + 1}${i === d.versions.length - 1 ? ' (latest)' : ''} · ${v.label}`))))
    : null;
  const head = h('div', { class: 'rv-head' },
    h('div', { class: 'client-title' }, h('div', { class: 'title-static' }, d.title), d.project ? h('div', { class: 'faint small' }, d.project) : null),
    h('div', { class: 'grow' }), versionSel,
    h('span', { class: 'faint small client-hint' }, 'Click the timeline, pause on a frame, then add your comment.'));
  $('#app').replaceChildren(h('div', { class: 'review' }, head, h('div', { class: 'rv-body' }, player, panel)));

  // video wiring
  video.addEventListener('loadedmetadata', () => {
    stageMsg.classList.add('hidden'); layoutInk(); renderMarkers(); updateTime();
    durEl.textContent = fmtTC(video.duration, fps());
  });
  video.addEventListener('error', () => {
    if (!video.getAttribute('src')) return;
    showMsg([h('p', { class: 'error' }, 'The video couldn’t be loaded.'), h('p', { class: 'faint small' }, 'Google Drive may be limiting downloads of this file. Wait a minute and press Retry. If it keeps happening, let the sender know.'), h('button', { class: 'btn', onclick: loadVideo }, 'Retry')]);
  });
  video.addEventListener('play', () => { playBtn.replaceChildren(icon('pause')); S.selected = null; markSelected(); renderInk(); tick(); });
  video.addEventListener('pause', () => { playBtn.replaceChildren(icon('play')); updateTime(); renderInk(); });
  video.addEventListener('seeked', () => { updateTime(); renderInk(); });
  video.addEventListener('timeupdate', () => { if (video.paused) updateTime(); });
  video.addEventListener('progress', () => {
    const b = video.buffered; if (!video.duration || !b.length) return;
    let end = 0; for (let i = 0; i < b.length; i++) if (b.start(i) <= video.currentTime + 0.5) end = Math.max(end, b.end(i));
    buffered.style.width = (end / video.duration) * 100 + '%';
  });
  video.addEventListener('volumechange', () => muteBtn.replaceChildren(icon(video.muted ? 'mute' : 'volume')));
  video.addEventListener('click', () => { if (!S.tool) togglePlay(); });

  const scrubTime = (e) => { const r = track.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (video.duration || 0); };
  let dragging = false, wasPlaying = false;
  scrub.addEventListener('pointerdown', (e) => { if (e.target.closest('.marker') || !video.duration) return; dragging = true; wasPlaying = !video.paused; video.pause(); scrub.setPointerCapture(e.pointerId); seekTo(scrubTime(e)); });
  scrub.addEventListener('pointermove', (e) => {
    if (!video.duration) return;
    const t = scrubTime(e), r = track.getBoundingClientRect();
    tip.textContent = fmtTC(t, fps()); tip.style.left = (t / video.duration) * r.width + 'px'; tip.classList.remove('hidden');
    if (dragging) seekTo(t);
  });
  scrub.addEventListener('pointerleave', () => { if (!dragging) tip.classList.add('hidden'); });
  const endDrag = () => { if (!dragging) return; dragging = false; tip.classList.add('hidden'); if (wasPlaying) video.play().catch(() => {}); };
  scrub.addEventListener('pointerup', endDrag); scrub.addEventListener('pointercancel', endDrag);

  // drawing
  new ResizeObserver(layoutInk).observe(stage);
  canvas.addEventListener('pointerdown', (e) => {
    if (!S.tool) return;
    e.preventDefault(); video.pause();
    if (S.pinT != null && Math.abs(video.currentTime - S.pinT) > halfFrame()) seekTo(S.pinT);
    if (S.pinT == null) S.pinT = video.currentTime;
    canvas.setPointerCapture(e.pointerId);
    S.current = { tool: S.tool, color: S.color, w: 0.0045, pts: [normPt(e)] }; renderInk();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!S.current) return;
    const pt = normPt(e);
    if (S.current.tool === 'pen') { const l = S.current.pts[S.current.pts.length - 1]; if (Math.hypot(pt[0] - l[0], pt[1] - l[1]) > 0.0015) S.current.pts.push(pt); }
    else S.current.pts = [S.current.pts[0], pt];
    renderInk();
  });
  const endStroke = () => {
    if (!S.current) return;
    const s = S.current; S.current = null;
    const a = s.pts[0], b = s.pts[s.pts.length - 1];
    if (s.tool === 'pen' || Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.01) S.strokes.push(s);
    afterInk();
  };
  canvas.addEventListener('pointerup', endStroke); canvas.addEventListener('pointercancel', endStroke);

  document.addEventListener('keydown', onKey);
  loadVideo();
}

function showMsg(content) { stageMsg.replaceChildren(...[content].flat().filter(Boolean)); stageMsg.classList.remove('hidden'); }
// Google throttles public Drive downloads (403 downloadQuotaExceeded) and a
// seeking video player makes dozens of range requests, so: files up to
// FULL_LOAD_MAX are fetched once (resuming after refusals) and played from
// memory; bigger files stream through sw.js, which retries refused requests.
const FULL_LOAD_MAX = 700 * 1024 * 1024;
let swReady = null;
function setupSW() {
  if (swReady) return swReady;
  swReady = (async () => {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return false;
    try {
      await navigator.serviceWorker.register('./sw.js');
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise((r) => { navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }); setTimeout(r, 3000); });
      return !!navigator.serviceWorker.controller;
    } catch { return false; }
  })();
  return swReady;
}
const blobCache = new Map(); // fileId -> object URL
let loadSeq = 0;

async function fileSize(fileId) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=size&supportsAllDrives=true&key=${encodeURIComponent(CFG.apiKey)}`);
      if (r.ok) return Number((await r.json()).size) || 0;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500 * (i + 1)));
  }
  return 0;
}

async function fetchWhole(fileId, size, onProgress, isCurrent) {
  const parts = [];
  let got = 0, fails = 0;
  while (got < size) {
    if (!isCurrent()) throw new Error('cancelled');
    let r;
    try { r = await fetch(videoUrl(fileId), { headers: { Range: `bytes=${got}-` } }); } catch { r = null; }
    if (!r || (r.status !== 206 && r.status !== 200)) {
      if (++fails > 12) throw new Error(r ? `Google refused the download (${r.status})` : 'Network error');
      onProgress(got / size, true);
      await new Promise((res) => setTimeout(res, Math.min(10000, 500 * 2 ** Math.min(fails, 5))));
      continue;
    }
    fails = 0;
    if (r.status === 200 && got > 0) { parts.length = 0; got = 0; } // server ignored Range: start over
    const reader = r.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value); got += value.length; onProgress(got / size, false);
        if (!isCurrent()) { reader.cancel(); throw new Error('cancelled'); }
      }
    } catch (e) { if (e.message === 'cancelled') throw e; /* dropped mid-stream: resume from `got` */ }
  }
  return URL.createObjectURL(new Blob(parts, { type: 'video/mp4' }));
}

// Videos come through your Google script (the "relay"): it reads the file with
// the owner's own access and hands out ~6 MB pieces, so Drive's public-download
// limits never apply. Pieces load 4 at a time, then play from memory (instant seeking).
const RELAY_CHUNK = 6 * 1024 * 1024;
async function relayPiece(versionId, start) {
  let wait = 600;
  for (let attempt = 0; attempt < 7; attempt++) {
    let j;
    try {
      const r = await fetch(`${CFG.linksEndpoint}?action=chunk&token=${encodeURIComponent(token)}&v=${encodeURIComponent(versionId)}&start=${start}&len=${RELAY_CHUNK}`);
      j = await r.json();
    } catch { j = { error: 'network' }; }
    if (!j.error) {
      const bytes = j.data ? new Uint8Array(await (await fetch('data:application/octet-stream;base64,' + j.data)).arrayBuffer()) : new Uint8Array(0);
      return { total: j.total, bytes };
    }
    if (/turned off|doesn’t exist|Unknown version/.test(j.error)) { const e = new Error(j.error); e.fatal = true; throw e; }
    await new Promise((r) => setTimeout(r, wait + Math.random() * 300)); wait = Math.min(8000, wait * 2);
  }
  throw new Error('The video service is busy');
}
async function loadViaRelay(v, onProgress, isCurrent) {
  const first = await relayPiece(v.id, 0);
  const total = first.total, n = Math.max(1, Math.ceil(total / RELAY_CHUNK));
  const parts = new Array(n); parts[0] = first.bytes;
  let done = 1, next = 1;
  onProgress(done / n, total);
  const worker = async () => {
    while (next < n) {
      const i = next++;
      if (!isCurrent()) throw new Error('cancelled');
      parts[i] = (await relayPiece(v.id, i * RELAY_CHUNK)).bytes;
      done++; onProgress(done / n, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, n - 1) }, worker));
  return URL.createObjectURL(new Blob(parts, { type: 'video/mp4' }));
}

async function loadVideo() {
  video.pause(); S.selected = null; S.strokes = []; S.pinT = null; setTool(null);
  renderComments(); renderMarkers();
  const sel = $('.rv-head select'); if (sel) sel.value = S.vIdx;
  const my = ++loadSeq, isCurrent = () => my === loadSeq;
  const v = curV();
  const bar = h('div', { class: 'bar' }, h('div', { style: { width: '0%' } }));
  const label = h('p', {}, 'Loading video…');
  showMsg([h('div', { class: 'spinner' }), label]);
  try {
    if (v.url) { video.src = v.url; video.load(); return; } // optional external copy (e.g. Cloudflare R2)
    if (blobCache.has(v.id)) { video.src = blobCache.get(v.id); video.load(); return; }
    showMsg([label, h('div', { class: 'proxy-wait' }, bar), h('p', { class: 'faint small' }, 'The whole video loads first, then playback and frame-stepping are instant.')]);
    const url = await loadViaRelay(v, (p, total) => {
      bar.firstChild.style.width = Math.round(p * 100) + '%';
      label.textContent = `Loading video ${Math.round(p * 100)}% · ${(total / 1e6).toFixed(0)} MB`;
    }, isCurrent);
    if (!isCurrent()) return;
    blobCache.set(v.id, url);
    video.src = url;
    video.load();
  } catch (e) {
    if (e.message === 'cancelled' || !isCurrent()) return;
    showMsg([h('p', { class: 'error' }, 'The video couldn’t be loaded.'), h('p', { class: 'faint small' }, e.fatal ? e.message : 'The video service is busy right now. Wait a moment and try again.'), e.fatal ? null : h('button', { class: 'btn', onclick: loadVideo }, 'Retry')]);
  }
}

const togglePlay = () => { if (video.paused) video.play().catch(() => {}); else video.pause(); };
function seekTo(t) { if (!isFinite(video.duration)) return; video.currentTime = Math.max(0, Math.min(video.duration - 0.001, t)); updateTime(); }
function stepFrame(n) { video.pause(); const f = Math.floor(video.currentTime * fps() + 1e-4) + n; seekTo((Math.max(0, f) + 0.5) / fps()); }
function tick() { cancelAnimationFrame(S.raf); updateTime(); if (!video.paused) S.raf = requestAnimationFrame(tick); }
function updateTime() {
  const t = video.currentTime, d = video.duration || 0, pct = d ? (t / d) * 100 : 0;
  tcEl.textContent = fmtTC(t, fps()); played.style.width = pct + '%'; headEl.style.left = pct + '%';
  composeTc.textContent = fmtTC(S.pinT ?? t, fps());
  let active = null;
  for (const c of versionComments()) if (c.t <= t + halfFrame() && t - c.t < 2.5) active = c.id;
  if (active !== S.activeId) {
    S.activeId = active;
    $$('.cmt', list).forEach((el) => el.classList.toggle('active', el.dataset.id === active));
    $$('.marker', markers).forEach((el) => el.classList.toggle('active', el.dataset.id === active));
  }
}

function renderMarkers() {
  const d = video?.duration;
  markers.replaceChildren(...(!d ? [] : versionComments().map((c, i) => h('button', {
    class: 'marker' + (c.resolved ? ' resolved' : '') + (c.id === S.selected ? ' selected' : '') + (c.source === 'owner' ? ' team' : ''),
    'data-id': c.id, style: { left: Math.min(100, (c.t / d) * 100) + '%' },
    title: `#${i + 1} · ${fmtTC(c.t, fps())} · ${c.author}: ${c.text || '(drawing)'}`,
    onclick: (e) => { e.stopPropagation(); selectComment(c); },
  }))));
}

function renderComments() {
  const all = versionComments();
  const num = new Map(all.map((c, i) => [c.id, i + 1]));
  const counts = { all: all.length, open: all.filter((c) => !c.resolved).length, done: all.filter((c) => c.resolved).length };
  tabs.replaceChildren(...[['all', 'All'], ['open', 'Open'], ['done', 'Done']].map(([k, l]) =>
    h('button', { class: 'tab' + (filter === k ? ' on' : ''), onclick: () => { filter = k; renderComments(); } }, l, h('span', { class: 'count' }, counts[k]))));
  const shown = all.filter((c) => filter === 'all' || (filter === 'open' ? !c.resolved : c.resolved));
  if (!shown.length) {
    list.replaceChildren(h('div', { class: 'cmt-empty' }, icon('comment'), h('p', {}, all.length ? 'Nothing here.' : 'No comments yet.'),
      all.length ? null : h('p', { class: 'faint small' }, 'Pause on a frame and type your first comment above.')));
    return;
  }
  list.replaceChildren(...shown.map((c) => commentEl(c, num.get(c.id))));
  S.activeId = undefined; updateTime();
}

function commentEl(c, n) {
  const el = h('div', { class: 'cmt' + (c.resolved ? ' resolved' : '') + (S.selected === c.id ? ' selected' : ''), 'data-id': c.id });
  const actions = h('div', { class: 'cmt-actions' }, h('button', { class: 'link-btn', onclick: () => openReply() }, icon('comment'), 'Reply'));
  function openReply() {
    const ta = h('textarea', { class: 'compose-input sm', rows: 2, placeholder: 'Write a reply…' });
    const send = async () => {
      const text = ta.value.trim(); if (!text) return;
      if (!S.name) await askName(false);
      ta.disabled = true; S.posting = true;
      try { S.data = await api({ action: 'reply', commentId: c.id, text, author: S.name }); renderComments(); toast('Reply posted'); }
      catch (e) { ta.disabled = false; toast('Couldn’t post: ' + e.message); }
      finally { S.posting = false; }
    };
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } if (e.key === 'Escape') renderComments(); });
    actions.replaceChildren(h('div', { class: 'reply-box' }, ta, h('div', { class: 'row gap end' },
      h('button', { class: 'btn ghost sm', onclick: renderComments }, 'Cancel'), h('button', { class: 'btn primary sm', onclick: send }, 'Reply'))));
    ta.focus();
  }
  const who = (x) => [h('span', { class: 'author' }, x.author), x.source === 'owner' ? h('span', { class: 'team-tag' }, 'Team') : null];
  el.append(
    h('div', { class: 'cmt-top' },
      h('span', { class: 'cmt-num' }, '#' + n),
      h('button', { class: 'tc chip', title: 'Jump to this frame', onclick: () => selectComment(c) }, fmtTC(c.t, fps())),
      c.drawing ? h('span', { class: 'cmt-ink', title: 'Has a drawing' }, icon('pen')) : null,
      h('div', { class: 'grow' }),
      c.resolved ? h('span', { class: 'pill st-approved', title: 'The team marked this as done' }, icon('check'), 'Done') : null),
    h('div', { class: 'cmt-meta' }, who(c), h('span', { class: 'faint', title: new Date(c.createdAt).toLocaleString() }, ' · ' + timeAgo(c.createdAt))),
    h('div', { class: 'cmt-text' }, c.text || h('em', { class: 'faint' }, 'Drawing only')),
    h('div', { class: 'replies' }, (c.replies || []).map((r) => h('div', { class: 'reply' },
      h('div', { class: 'cmt-meta' }, who(r), h('span', { class: 'faint' }, ' · ' + timeAgo(r.createdAt))),
      h('div', { class: 'cmt-text' }, r.text)))),
    actions);
  el.addEventListener('click', (e) => { if (e.target.closest('button,textarea,input,a')) return; selectComment(c); });
  return el;
}
function selectComment(c) {
  S.selected = c.id; video.pause(); seekTo(c.t); markSelected();
  $(`.cmt[data-id="${c.id}"]`, list)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  renderInk();
}
function markSelected() {
  $$('.cmt', list).forEach((el) => el.classList.toggle('selected', el.dataset.id === S.selected));
  $$('.marker', markers).forEach((el) => el.classList.toggle('selected', el.dataset.id === S.selected));
}

async function post() {
  const text = textarea.value.trim();
  if (!text && !S.strokes.length) return toast('Write a comment or draw on the frame first');
  if (!S.name) await askName(false);
  if (S.posting) return;
  S.posting = true;
  const btn = $('.composer .btn.primary'); btn.disabled = true; btn.textContent = 'Posting…';
  try {
    S.data = await api({ action: 'comment', versionId: curV().id, t: S.pinT ?? video.currentTime, text, author: S.name, drawing: S.strokes.length ? S.strokes : null });
    textarea.value = ''; S.strokes = []; S.pinT = null; setTool(null);
    if (filter === 'done') filter = 'all';
    const mine = versionComments().filter((c) => c.source === 'client' && c.author === S.name).pop();
    S.selected = mine?.id || null;
    afterInk(); renderComments(); renderMarkers(); toast('Comment posted');
  } catch (e) { toast('Couldn’t post: ' + e.message); }
  finally { S.posting = false; btn.disabled = false; btn.textContent = 'Post comment'; }
}

// ink
function layoutInk() {
  if (!canvas) return;
  const sw = stage.clientWidth, sh = stage.clientHeight, vw = video.videoWidth || 16, vh = video.videoHeight || 9;
  const sc = Math.min(sw / vw, sh / vh), w = vw * sc, hh = vh * sc;
  Object.assign(canvas.style, { left: (sw - w) / 2 + 'px', top: (sh - hh) / 2 + 'px', width: w + 'px', height: hh + 'px' });
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(w * dpr)); canvas.height = Math.max(1, Math.round(hh * dpr));
  renderInk();
}
function renderInk() {
  if (!canvas) return;
  const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height);
  const t = video.currentTime;
  let strokes = null;
  if (S.strokes.length || S.current) { if (S.pinT == null || Math.abs(t - S.pinT) < halfFrame()) strokes = S.current ? [...S.strokes, S.current] : S.strokes; }
  else if (video.paused) {
    const sel = S.selected && S.data.comments.find((c) => c.id === S.selected);
    const at = sel && sel.drawing && Math.abs(t - sel.t) < halfFrame() ? sel : versionComments().find((c) => c.drawing && Math.abs(t - c.t) < halfFrame());
    if (at) strokes = at.drawing;
  }
  if (!strokes) return;
  const W = canvas.width, H = canvas.height;
  for (const s of strokes) {
    const P = s.pts.map(([x, y]) => [x * W, y * H]); if (!P.length) continue;
    ctx.strokeStyle = s.color; ctx.lineWidth = Math.max(2, s.w * W); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = ctx.lineWidth * 0.8; ctx.beginPath();
    const a = P[0], b = P[P.length - 1];
    if (s.tool === 'pen') { ctx.moveTo(a[0], a[1]); if (P.length === 1) ctx.lineTo(a[0] + 0.1, a[1]); for (let i = 1; i < P.length; i++) ctx.lineTo(P[i][0], P[i][1]); ctx.stroke(); }
    else if (s.tool === 'box') ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    else {
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), L = Math.max(14, ctx.lineWidth * 4);
      ctx.beginPath(); ctx.moveTo(b[0], b[1]); ctx.lineTo(b[0] - L * Math.cos(ang - 0.45), b[1] - L * Math.sin(ang - 0.45));
      ctx.moveTo(b[0], b[1]); ctx.lineTo(b[0] - L * Math.cos(ang + 0.45), b[1] - L * Math.sin(ang + 0.45)); ctx.stroke();
    }
  }
  ctx.shadowBlur = 0;
}
function normPt(e) {
  const r = canvas.getBoundingClientRect(), r4 = (n) => Math.round(Math.max(0, Math.min(1, n)) * 10000) / 10000;
  return [r4((e.clientX - r.left) / r.width), r4((e.clientY - r.top) / r.height)];
}
function setTool(t) {
  if (!S.data.allowDraw) t = null;
  S.tool = t;
  for (const [k, b] of Object.entries(toolBtns)) b.classList.toggle('on', k === t);
  canvas?.classList.toggle('armed', !!t);
  if (t) video.pause();
}
function afterInk() { if (!S.strokes.length && !textarea.value.trim()) S.pinT = null; updateTime(); renderInk(); }

function onKey(e) {
  if ($('.modal-wrap') || e.target.closest('input,textarea,select')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const map = {
    ' ': togglePlay, k: togglePlay,
    ArrowLeft: () => (e.shiftKey ? seekTo(video.currentTime - 1) : stepFrame(-1)),
    ArrowRight: () => (e.shiftKey ? seekTo(video.currentTime + 1) : stepFrame(1)),
    j: () => seekTo(video.currentTime - 5), l: () => seekTo(video.currentTime + 5),
    c: () => { video.pause(); textarea.focus(); },
    d: () => setTool(S.tool === 'pen' ? null : 'pen'), a: () => setTool(S.tool === 'arrow' ? null : 'arrow'), b: () => setTool(S.tool === 'box' ? null : 'box'),
    m: () => { video.muted = !video.muted; }, f: () => $('.player').requestFullscreen?.(), Escape: () => setTool(null),
  }[e.key];
  if (map) { e.preventDefault(); map(); }
}

boot();
