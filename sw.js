/*
 * Cutroom service worker.
 *
 * A <video> element can't send an Authorization header, so it can't read a
 * private Google Drive file directly. The page points the video at
 * ./__drive/<fileId>; this worker catches that request, adds the user's
 * OAuth token, forwards any Range header (so seeking works without
 * downloading the whole file) and streams Drive's response straight back.
 * Nothing is stored or proxied through a server: it's browser -> Google.
 */
let token = null;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'token') token = e.data.token || null;
});

function askClient(client) {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 15000);
    ch.port1.onmessage = (ev) => { clearTimeout(timer); resolve(ev.data || null); };
    client.postMessage({ type: 'need-token' }, [ch.port2]);
  });
}

async function freshToken() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const c of clients) {
    const t = await askClient(c);
    if (t) { token = t; return t; }
  }
  return null;
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  const pub = url.pathname.match(/\/__public\/([\w-]+)$/);
  if (pub) { e.respondWith(publicStream(pub[1], url.searchParams.get('key'), e.request)); return; }
  const m = url.pathname.match(/\/__drive\/([\w-]+)$/);
  if (!m) return;
  e.respondWith(stream(m[1], e.request));
});

// Client review links: a shared (anyone-with-link) file streamed with the site's
// read-only API key. Google throttles public downloads and randomly refuses
// requests with 403 downloadQuotaExceeded / 429; a video element gives up on
// the first refusal, so retry here with backoff and the player never sees it.
async function publicStream(fileId, key, req) {
  const target = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true&key=${encodeURIComponent(key || '')}`;
  const headers = {};
  const range = req.headers.get('range');
  if (range) headers.Range = range;
  let res;
  for (let attempt = 0; attempt < 7; attempt++) {
    try {
      res = await fetch(target, { headers });
      if (![403, 429, 500, 502, 503, 504].includes(res.status)) return res;
    } catch (err) { /* network blip: retry */ }
    await new Promise((r) => setTimeout(r, Math.min(8000, 400 * 2 ** attempt) + Math.random() * 300));
  }
  return res || new Response('Video unavailable', { status: 503 });
}

async function stream(fileId, req) {
  const target = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = token || (await freshToken());
    if (!t) return new Response('Not signed in to Google Drive', { status: 401 });
    const headers = { Authorization: 'Bearer ' + t };
    const range = req.headers.get('range');
    if (range) headers.Range = range;
    const res = await fetch(target, { headers });
    if (res.status === 401 && attempt === 0) { token = null; continue; }
    return res;
  }
  return new Response('Drive authorization failed', { status: 401 });
}
