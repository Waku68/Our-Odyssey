// データ層。Supabase が設定されていればそちら、なければこの端末だけに保存するお試しモード。
import { CONFIG } from './config.js';

const uuid = () => crypto.randomUUID();
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
    catch { throw new Error('この端末の保存容量がいっぱいです。写真を減らすか、本番の保存先を設定してください。'); }
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

/* ---------- 本番（Supabase） ---------- */
async function supaStore() {
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.119.0');
  const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  let session = (await sb.auth.getSession()).data.session;
  sb.auth.onAuthStateChange((_e, s) => { session = s; });
  const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  const urls = new Map();
  const URL_KEY = 'our-odyssey-photo-urls', URL_LIFE = 60 * 60 * 6;
  let urlCache = {};
  try { urlCache = JSON.parse(localStorage.getItem(URL_KEY)) || {}; } catch { urlCache = {}; }
  for (const [k, v] of Object.entries(urlCache)) if (!(v.exp > Date.now() + 30 * 60e3)) delete urlCache[k];
  let queue = [], flushTimer = 0;
  const flushUrls = async () => {
    const items = queue; queue = [];
    if (!items.length) return;
    try {
      const list = ok(await sb.storage.from('photos').createSignedUrls(items.map((i) => i.path), URL_LIFE));
      const exp = Date.now() + URL_LIFE * 1000;
      const byPath = new Map(list.map((x) => [x.path, x]));
      for (const it of items) {
        const r = byPath.get(it.path);
        urls.delete(it.path);
        if (r?.signedUrl) { urlCache[it.path] = { url: r.signedUrl, exp }; it.res(r.signedUrl); } else it.rej(new Error(r?.error || '写真を読みこめませんでした'));
      }
      try { localStorage.setItem(URL_KEY, JSON.stringify(urlCache)); } catch { /* 保存できなくても動く */ }
    } catch (e) { for (const it of items) { urls.delete(it.path); it.rej(e); } }
  };
  return {
    mode: 'supabase',
    user: () => (session ? { id: session.user.id } : null),
    async signIn(email, password) {
      session = ok(await sb.auth.signInWithPassword({ email, password })).session;
    },
    async signOut() {
      await sb.auth.signOut(); session = null;
      urlCache = {}; try { localStorage.removeItem(URL_KEY); } catch { /* なくてもいい */ }
    },
    async profiles() { return ok(await sb.from('profiles').select('*')); },
    async saveProfile(patch) {
      ok(await sb.from('profiles').upsert({ id: session.user.id, ...patch }));
    },
    async entries() { return ok(await sb.from('entries').select('*').order('created_at')); },
    async saveEntry(e) {
      if (e.id) { const { id, author, created_at, ...rest } = e; ok(await sb.from('entries').update(rest).eq('id', id)); }
      else ok(await sb.from('entries').insert(e));
    },
    async removeEntry(id) { ok(await sb.from('entries').delete().eq('id', id)); },
    async moods() { return ok(await sb.from('moods').select('*').order('date')); },
    async saveMood(m) {
      if (m.id) { const { id, user_id, created_at, ...rest } = m; ok(await sb.from('moods').update(rest).eq('id', id)); }
      else ok(await sb.from('moods').insert(m));
    },
    async removeMood(id) { ok(await sb.from('moods').delete().eq('id', id)); },
    async comments() { return ok(await sb.from('comments').select('*').order('created_at')); },
    async addComment(entry_id, body) { ok(await sb.from('comments').insert({ entry_id, body })); },
    async removeComment(id) { ok(await sb.from('comments').delete().eq('id', id)); },
    async uploadPhoto(blob) {
      const path = `${session.user.id}/${uuid()}.jpg`;
      ok(await sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' }));
      return path;
    },
    // 写真のURLはまとめて1回で発行し、期限まで端末に覚えておく（開き直しても同じURL＝ブラウザのキャッシュが効く）
    photoUrl(path) {
      if (!path) return Promise.resolve('');
      const hit = urlCache[path];
      if (hit && hit.exp > Date.now() + 30 * 60e3) return Promise.resolve(hit.url);
      if (!urls.has(path)) {
        urls.set(path, new Promise((res, rej) => { queue.push({ path, res, rej }); }));
        clearTimeout(flushTimer); flushTimer = setTimeout(flushUrls, 0);
      }
      return urls.get(path);
    },
    async removePhoto(path) { if (path) await sb.storage.from('photos').remove([path]); },
    async savePush(sub) {
      const j = sub.toJSON();
      ok(await sb.from('push_subscriptions').upsert(
        { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: 'endpoint' }));
    },
    async removePush(endpoint) { ok(await sb.from('push_subscriptions').delete().eq('endpoint', endpoint)); },
  };
}
