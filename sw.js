// Our Odyssey の Service Worker。
// ・通知を受け取って表示する
// ・ネットがなくても開けるように、画面の部品（HTML/CSS/JS/フォント）と見た写真を端末に覚えておく
const SHELL = 'shell-v2';   // このサイトのファイル（つながっていれば毎回新しいものを取りにいく）
const LIBS = 'libs-v1';     // 外から読みこむ部品（Supabase のライブラリ、フォント、地図）
const PHOTOS = 'photos-v1'; // 一度見た写真
const LIB_HOSTS = ['esm.sh', 'unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const SCOPE = self.registration.scope;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.add(SCOPE)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => ![SHELL, LIBS, PHOTOS].includes(k)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const isLib = (url) => LIB_HOSTS.includes(url.hostname);
const isPhoto = (url) => url.pathname.includes('/storage/v1/object/sign/photos/');
const corsFetch = (url) => fetch(url, { mode: 'cors', credentials: 'omit' });
const withTimeout = (p, ms) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('timeout')), ms);
  p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
});

// このサイトのファイル：つながっていれば新しいものを使い、だめなら覚えておいたものを出す
async function fromSite(req) {
  const cache = await caches.open(SHELL);
  const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; });
  try {
    return await withTimeout(net, 4000);
  } catch {
    const hit = (await cache.match(req)) || (await cache.match(req, { ignoreSearch: true }))
      || (req.mode === 'navigate' ? await cache.match(SCOPE) : undefined);
    return hit || net;
  }
}
// 外の部品：覚えているものをすぐ出し、裏で新しいものに入れかえておく
async function fromLib(req) {
  const cache = await caches.open(LIBS);
  const hit = await cache.match(req.url);
  const net = corsFetch(req.url)
    .then((res) => { if (res.ok) cache.put(req.url, res.clone()); return res; })
    .catch(() => fetch(req));
  if (hit) { net.catch(() => {}); return hit; }
  return net;
}
// 写真：場所ごとに中身は変わらないので、URLの期限の部分（?token=）を外して覚える
async function fromPhotos(req) {
  const key = req.url.split('?')[0];
  const cache = await caches.open(PHOTOS);
  const hit = await cache.match(key);
  if (hit) return hit;
  try {
    const res = await corsFetch(req.url);
    if (res.ok) cache.put(key, res.clone());
    return res;
  } catch {
    return fetch(req);
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) event.respondWith(fromSite(req));
  else if (isPhoto(url)) event.respondWith(fromPhotos(req));
  else if (isLib(url)) event.respondWith(fromLib(req));
});

// ページを開いたときに読みこんだ部品を、まとめて覚えておく（初めて開いたときの分も取りこぼさない）
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'warm') return;
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL), libs = await caches.open(LIBS);
    for (const u of event.data.urls || []) {
      try {
        const url = new URL(u);
        if (url.origin === self.location.origin) {
          if (!(await shell.match(u))) { const res = await fetch(u); if (res.ok) await shell.put(u, res); }
        } else if (isLib(url)) {
          if (!(await libs.match(u))) { const res = await corsFetch(u); if (res.ok) await libs.put(u, res); }
        }
      } catch { /* 取れなかったものは次の機会に */ }
    }
  })());
});

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(d.title || 'Our Odyssey', {
    body: d.body || '', icon: 'assets/icon-192.png', badge: 'assets/icon-192.png',
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow(self.registration.scope);
  }));
});
