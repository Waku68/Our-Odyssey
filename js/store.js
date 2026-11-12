// データ層。Supabase が設定されていればそちら、なければこの端末だけに保存するお試しモード。
import { CONFIG } from './config.js';

const uuid = () => crypto.randomUUID();
// 設定で「ALL ENGLISH」にしているときは英語のメッセージにする
const tr = (ja, en) => { try { return localStorage.getItem('our-odyssey-lang') === 'en' ? en : ja; } catch { return ja; } };
const nowIso = () => new Date().toISOString();

export async function createStore() {
  if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) return supaStore();
  return demoStore();
}

/* ---------- お試しモード（localStorage） ---------- */
function demoStore() {
  const KEY = 'our-odyssey-demo';
  const fresh = () => ({
    me: 'a',
    profiles: [
      { id: 'a', display_name: 'わく', notify: false },
      { id: 'b', display_name: 'みく', notify: false },
    ],
    entries: [], moods: [], comments: [],
  });
  let db;
  try { db = JSON.parse(localStorage.getItem(KEY)) || fresh(); } catch { db = fresh(); }
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(db)); }
    catch { throw new Error(tr('この端末の保存容量がいっぱいです。写真を減らすか、本番の保存先を設定してください。', 'This device is out of storage. Remove some photos or set up the live database.')); }
  };
  const blobToDataUrl = (blob) => new Promise((ok, ng) => {
    const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = ng; r.readAsDataURL(blob);
  });
  return {
    mode: 'demo',
    user: () => ({ id: db.me }),
    async signIn() {}, async signOut() {},
    switchUser() { db.me = db.me === 'a' ? 'b' : 'a'; save(); },
    async profiles() { return db.profiles; },
    async saveProfile(patch) { Object.assign(db.profiles.find(p => p.id === db.me), patch); save(); },
    async entries() { return db.entries; },
    async saveEntry(e) {
      if (e.id) Object.assign(db.entries.find(x => x.id === e.id), e);
      else db.entries.push({ id: uuid(), author: db.me, created_at: nowIso(), ...e });
      save();
    },
    async removeEntry(id) {
      db.entries = db.entries.filter(x => x.id !== id);
      db.comments = db.comments.filter(c => c.entry_id !== id); save();
    },
    async moods() { return db.moods.filter(m => m.user_id === db.me || m.shared); },
    async saveMood(m) {
      if (m.id) Object.assign(db.moods.find(x => x.id === m.id), m);
      else db.moods.push({ id: uuid(), user_id: db.me, created_at: nowIso(), ...m });
      save();
    },
    async removeMood(id) { db.moods = db.moods.filter(x => x.id !== id); save(); },
    async comments() { return db.comments; },
    async addComment(entry_id, body) {
      db.comments.push({ id: uuid(), entry_id, body, author: db.me, created_at: nowIso() }); save();
    },
    async removeComment(id) { db.comments = db.comments.filter(c => c.id !== id); save(); },
    async uploadPhoto(blob) { return blobToDataUrl(blob); },
    async photoUrl(path) { return path; },
    async removePhoto() {},
    async savePush() {}, async removePush() {},
  };
}

/* ---------- 端末の中に写真をあずかる場所（IndexedDB） ---------- */
const idb = (() => {
  let dbp;
  const open = () => (dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open('our-odyssey', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('blobs');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('blobs', mode);
      const req = fn(t.objectStore('blobs'));
      t.oncomplete = () => res(req.result);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  };
  return {
    put: (k, v) => run('readwrite', (s) => s.put(v, k)),
    get: (k) => run('readonly', (s) => s.get(k)),
    del: (k) => run('readwrite', (s) => s.delete(k)),
  };
})();

// つながっているのに返事が来ない（電波が弱い）ときに、いつまでも待たないようにする
function timedFetch(input, init = {}) {
  const url = String(input?.url || input);
  const slow = /\/storage\/v1\/object\//.test(url) && (init.method || 'GET') !== 'GET';
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), slow ? 90000 : 12000);
  init.signal?.addEventListener('abort', () => c.abort());
  return fetch(input, { ...init, signal: c.signal }).finally(() => clearTimeout(t));
}

/* ---------- 本番（Supabase） ---------- */
// ネットがなくても書けるように、書きこみはいったん端末の「送る予定リスト」に入れてから送る。
// 読みこみは最後に取れた内容を端末に覚えておき、つながらないときはそれに「まだ送っていない分」を重ねて出す。
async function supaStore() {
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.119.0');
  const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, { global: { fetch: timedFetch } });
  let session = (await sb.auth.getSession()).data.session;
  sb.auth.onAuthStateChange((_e, s) => { session = s; });
  const uid = () => session?.user.id;
  const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  const readLS = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const writeLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

  /* 写真のURL */
  const urls = new Map();
  const URL_KEY = 'our-odyssey-photo-urls', URL_LIFE = 60 * 60 * 6;
  let urlCache = readLS(URL_KEY, {});
  // 期限切れのURLも、オフラインのときは端末に残った写真を出すのに使うので、しばらく取っておく
  for (const [k, v] of Object.entries(urlCache)) if (!(v.exp > Date.now() - 30 * 864e5)) delete urlCache[k];
  let urlQueue = [], urlTimer = 0;
  const flushUrls = async () => {
    const items = urlQueue; urlQueue = [];
    if (!items.length) return;
    try {
      const list = ok(await sb.storage.from('photos').createSignedUrls(items.map((i) => i.path), URL_LIFE));
      const exp = Date.now() + URL_LIFE * 1000;
      const byPath = new Map(list.map((x) => [x.path, x]));
      for (const it of items) {
        const r = byPath.get(it.path);
        urls.delete(it.path);
        if (r?.signedUrl) { urlCache[it.path] = { url: r.signedUrl, exp }; it.res(r.signedUrl); } else it.rej(new Error(r?.error || tr('写真を読みこめませんでした', "Couldn't load the photo")));
      }
      writeLS(URL_KEY, urlCache);
    } catch (e) {
      for (const it of items) {
        urls.delete(it.path);
        if (urlCache[it.path]) it.res(urlCache[it.path].url); else it.rej(e);
      }
    }
  };

  /* 最後に取れた内容と、まだ送っていない分 */
  const CACHE_KEY = 'our-odyssey-cache', OUTBOX_KEY = 'our-odyssey-outbox';
  let snap = readLS(CACHE_KEY, {});
  let outbox = readLS(OUTBOX_KEY, []);
  for (const o of outbox) o.sending = false;
  const saveOutbox = () => {
    if (!writeLS(OUTBOX_KEY, outbox)) throw new Error(tr('この端末の保存容量がいっぱいで、記録をあずかれませんでした。', "This device is out of storage, so the entry couldn't be kept."));
  };
  const pendingPhotos = new Set(outbox.filter((o) => o.kind === 'upload').map((o) => o.path));
  const localUrls = new Map();
  const localPhoto = (path) => {
    if (!localUrls.has(path)) {
      localUrls.set(path, idb.get(path).then((b) => (b ? URL.createObjectURL(b) : Promise.reject(new Error(tr('写真が見つかりません', 'Photo not found'))))));
    }
    return localUrls.get(path);
  };

  async function pull(table, query) {
    let rows;
    try {
      rows = ok(await query);
      if (snap.uid !== uid()) snap = { uid: uid() };
      snap[table] = rows;
      writeLS(CACHE_KEY, snap);
    } catch (e) {
      if (snap.uid === uid() && snap[table]) rows = snap[table];
      else if (retryable(e)) rows = [];
      else throw e;
    }
    return overlay(table, rows);
  }
  function overlay(table, rows) {
    let out = rows.map((r) => ({ ...r }));
    for (const o of outbox) {
      if (o.uid !== uid()) continue;
      if (o.table === table) {
        if (o.kind === 'insert') { if (!out.some((r) => r.id === o.id)) out.push({ ...o.row }); }
        else if (o.kind === 'update') { const r = out.find((x) => x.id === o.id); if (r) Object.assign(r, o.patch); }
        else if (o.kind === 'delete') out = out.filter((x) => x.id !== o.id);
      } else if (table === 'comments' && o.table === 'entries' && o.kind === 'delete') {
        out = out.filter((c) => c.entry_id !== o.id);
      }
    }
    return out;
  }

  // 同じ行への書きこみは、まだ送っていなければひとつにまとめる
  function enqueue(op) {
    Object.assign(op, { qid: crypto.randomUUID(), uid: uid(), sending: false });
    const same = (o) => !o.sending && o.uid === op.uid && o.table === op.table && o.id && o.id === op.id;
    const ins = outbox.find((o) => o.kind === 'insert' && same(o));
    if (op.kind === 'update' && ins) { Object.assign(ins.row, op.patch); saveOutbox(); return ins.qid; }
    if (op.kind === 'update') {
      const up = outbox.find((o) => o.kind === 'update' && same(o));
      if (up) { Object.assign(up.patch, op.patch); saveOutbox(); return up.qid; }
    }
    if (op.kind === 'delete' && ins) {
      outbox = outbox.filter((o) => !same(o) && !(op.table === 'entries' && o.table === 'comments' && !o.sending && o.row?.entry_id === op.id));
      saveOutbox(); return null;
    }
    if (op.kind === 'delete') outbox = outbox.filter((o) => !(o.kind === 'update' && same(o)));
    outbox.push(op); saveOutbox(); return op.qid;
  }

  // つながっていないだけ（あとで送れば通る）か、送っても通らない内容か
  const retryable = (e) => !navigator.onLine || e?.status === 0 || e?.status >= 500 || e?.name === 'AuthRetryableFetchError'
    || /fetch|load failed|network|abort|timed? ?out|jwt/i.test(String(e?.message || e));

  async function send(op) {
    if (op.kind === 'upload') {
      const blob = await idb.get(op.path).catch(() => null);
      if (blob) {
        const { error } = await sb.storage.from('photos').upload(op.path, blob, { contentType: 'image/jpeg' });
        if (error && !/exist|duplicate/i.test(error.message)) throw error;
      }
      pendingPhotos.delete(op.path);
      idb.del(op.path).catch(() => {});
      return;
    }
    if (op.kind === 'removePhoto') {
      const { error } = await sb.storage.from('photos').remove([op.path]);
      if (error) throw error;
      return;
    }
    const t = sb.from(op.table);
    const res = await (op.kind === 'insert' ? t.insert(op.row)
      : op.kind === 'update' ? t.update(op.patch).eq('id', op.id)
      : t.delete().eq('id', op.id));
    // 前に送ったときに届いていた（返事だけ受け取れなかった）なら、それで送れたことにする
    if (res.error && !(op.kind === 'insert' && res.error.code === '23505')) {
      const e = new Error(res.error.message); e.status = res.status; throw e;
    }
  }

  let running = null;
  async function drain(background) {
    const failed = []; let sent = 0;
    for (;;) {
      const op = uid() && outbox.find((o) => o.uid === uid());
      if (!op) break;
      op.sending = true;
      try { await send(op); sent++; }
      catch (e) {
        op.sending = false;
        if (retryable(e)) break;
        failed.push({ op, error: e });
      }
      outbox = outbox.filter((o) => o !== op);
      saveOutbox();
      api.onChange?.();
    }
    if (background && (sent || failed.length)) api.onSync?.({ sent, failed });
    return { sent, failed };
  }
  // 同時に二重で送らないように、送っている最中ならその終わりを待つ
  function flush(background = false) {
    running ??= drain(background).finally(() => { running = null; api.onChange?.(); });
    return running;
  }
  async function write(op) {
    const qid = enqueue(op);
    api.onChange?.();
    if (!qid) return;
    const { failed } = await flush();
    const f = failed.find((x) => x.op.qid === qid);
    if (f) throw f.error;
  }
  const needNet = () => {
    if (!navigator.onLine) throw new Error(tr('オフライン中は変えられません。つながってからもう一度ためしてください。', "Can't change this while offline. Try again once you're connected."));
  };

  const api = {
    mode: 'supabase',
    onChange: null, onSync: null,
    pending: () => outbox.filter((o) => o.uid === uid()).length,
    flush: () => flush(true),
    user: () => (session ? { id: session.user.id } : null),
    async signIn(email, password) {
      session = ok(await sb.auth.signInWithPassword({ email, password })).session;
    },
    async signOut() {
      await sb.auth.signOut(); session = null;
      urlCache = {}; snap = {};
      try { localStorage.removeItem(URL_KEY); localStorage.removeItem(CACHE_KEY); } catch { /* なくてもいい */ }
    },
    async profiles() { return pull('profiles', sb.from('profiles').select('*')); },
    async saveProfile(patch) {
      needNet();
      ok(await sb.from('profiles').upsert({ id: session.user.id, ...patch }));
    },
    async entries() { return pull('entries', sb.from('entries').select('*').order('created_at')); },
    async saveEntry(e) {
      if (e.id) { const { id, author, created_at, ...patch } = e; await write({ kind: 'update', table: 'entries', id, patch }); }
      else { const row = { id: uuid(), author: uid(), created_at: nowIso(), ...e }; await write({ kind: 'insert', table: 'entries', id: row.id, row }); }
    },
    async removeEntry(id) { await write({ kind: 'delete', table: 'entries', id }); },
    async moods() { return pull('moods', sb.from('moods').select('*').order('date')); },
    async saveMood(m) {
      if (m.id) { const { id, user_id, created_at, ...patch } = m; await write({ kind: 'update', table: 'moods', id, patch }); }
      else { const row = { id: uuid(), user_id: uid(), created_at: nowIso(), ...m }; await write({ kind: 'insert', table: 'moods', id: row.id, row }); }
    },
    async removeMood(id) { await write({ kind: 'delete', table: 'moods', id }); },
    async comments() { return pull('comments', sb.from('comments').select('*').order('created_at')); },
    async addComment(entry_id, body) {
      const row = { id: uuid(), entry_id, body, author: uid(), created_at: nowIso() };
      await write({ kind: 'insert', table: 'comments', id: row.id, row });
    },
    async removeComment(id) { await write({ kind: 'delete', table: 'comments', id }); },
    // 写真はまず端末にあずけて、つながったら送る
    async uploadPhoto(blob) {
      const path = `${uid()}/${uuid()}.jpg`;
      try { await idb.put(path, blob); }
      catch {
        ok(await sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' }));
        return path;
      }
      pendingPhotos.add(path);
      await write({ kind: 'upload', path });
      return path;
    },
    // 写真のURLはまとめて1回で発行し、期限まで端末に覚えておく（開き直しても同じURL＝ブラウザのキャッシュが効く）
    photoUrl(path) {
      if (!path) return Promise.resolve('');
      if (pendingPhotos.has(path) || localUrls.has(path)) return localPhoto(path);
      const hit = urlCache[path];
      if (hit && (hit.exp > Date.now() + 30 * 60e3 || !navigator.onLine)) return Promise.resolve(hit.url);
      if (!urls.has(path)) {
        urls.set(path, new Promise((res, rej) => { urlQueue.push({ path, res, rej }); }));
        clearTimeout(urlTimer); urlTimer = setTimeout(flushUrls, 0);
      }
      return urls.get(path);
    },
    async removePhoto(path) {
      if (!path) return;
      const up = outbox.find((o) => o.kind === 'upload' && o.path === path && !o.sending);
      if (up) {
        outbox = outbox.filter((o) => o !== up); saveOutbox();
        pendingPhotos.delete(path); idb.del(path).catch(() => {});
        api.onChange?.();
        return;
      }
      await write({ kind: 'removePhoto', path });
    },
    async savePush(sub) {
      needNet();
      const j = sub.toJSON();
      ok(await sb.from('push_subscriptions').upsert(
        { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: 'endpoint' }));
    },
    async removePush(endpoint) { needNet(); ok(await sb.from('push_subscriptions').delete().eq('endpoint', endpoint)); },
  };
  return api;
}
