// アプリの骨組み：読みこみ、画面の切りかえ（タブ）、相手の更新の取りこみ、オフラインの送信待ち、ログイン、起動。
import { CONFIG } from './config.js?v=38';
import { createStore } from './store.js?v=38';
import { notice } from './ask.js?v=38';
import { h, reduceMotion } from './dom.js?v=38';
import { lang, tr } from './i18n.js?v=38';
import { store, data, setStore, setData } from './state.js?v=38';
import { selfEdited, commitSeen, sectionNew, moodsNew, dropSeenObserver } from './seen.js?v=38';
import { leaflet } from './places.js?v=38';

const app = document.getElementById('app');

async function act(fn) {
  try { await fn(); await refresh(); } catch (e) { notice(tr('うまくいきませんでした', "Something went wrong"), { text: e.message || String(e) }); }
}

/* ---------- 読みこみと画面の切りかえ ---------- */
async function fetchAll() {
  const [entries, moods, comments, profiles] = await Promise.all(
    [store.entries(), store.moods(), store.comments(), store.profiles()]);
  return { entries, moods, comments, profiles };
}
async function refresh() {
  setData(await fetchAll()); draw();
  document.querySelectorAll('dialog[open]').forEach((d) => d.refresh?.());
}
/* 相手の更新を取りこむ：アプリに戻ったとき・相手が書いたとき・開いている間はときどき取りなおし、
   変わっていたときだけ描き直す（すぐ届く Realtime の保険として、開いている間は5分ごとにも）。書いている途中なら描き直さず、あとでもう一度ためす */
let liveBusy = false, liveAgain = false, liveTimer = 0;
const liveSig = (d) => JSON.stringify([d.entries, d.moods, d.comments, d.profiles]);
function isEditing() {
  if (document.querySelector('dialog[open]')) return true;
  const a = document.activeElement;
  if (a && app.contains(a) && a.matches('input, textarea, select, [contenteditable]')) return true;
  if ([...app.querySelectorAll('form')].some((f) => f.isDirty?.())) return true;
  return [...app.querySelectorAll('form input[type=text], form textarea')].some((el) => el.value.trim());
}
async function liveRefresh() {
  if (!store?.user() || document.visibilityState !== 'visible') return;
  if (liveBusy) { liveAgain = true; return; }
  liveBusy = true;
  try {
    const next = await fetchAll();
    if (liveSig(next) !== liveSig(data)) {
      if (isEditing()) { liveAgain = true; setTimeout(liveRefresh, 5000); }
      else { const y = window.scrollY; setData(next); draw(); window.scrollTo(0, y); }
    }
  } catch { /* つながらないときは次の機会に */ } finally {
    liveBusy = false;
    if (liveAgain) { liveAgain = false; setTimeout(liveRefresh, 800); }
  }
}

function liveSoon() { clearTimeout(liveTimer); liveTimer = setTimeout(liveRefresh, 400); }
let liveReady = false;
function setupLive() {
  if (liveReady || store.mode !== 'supabase') return;
  liveReady = true;
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') liveSoon(); else commitSeen(); });
  window.addEventListener('focus', liveSoon);
  window.addEventListener('pageshow', liveSoon);
  window.addEventListener('online', liveSoon);
  setInterval(() => { if (document.visibilityState === 'visible') liveRefresh(); }, 300000);
  store.watch?.(liveSoon);
  const save = store.saveEntry.bind(store);
  store.saveEntry = async (e) => { const r = await save(e); if (e.id) selfEdited.add(e.id); return r; };
}

/* ---------- タブと画面の切りかえ ---------- */
const TABS = [
  { href: '#/', en: 'Days', jp: 'ホーム', icon: '<path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' },
  { href: '#/map', en: 'Places', jp: '場所', icon: '<path d="M12 21s-6.5-6.2-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="9.8" r="2.4" fill="currentColor"/>' },
  { href: '#/mood', en: 'Mood', jp: 'きもち', icon: '<path d="M2.5 15c2.5 0 2.5-7 5-7s2.5 9 5 9 2.5-11 5-11 2.5 7 4 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' },
  { href: '#/more', en: 'More', jp: 'その他', icon: '<circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/>' },
];
const tabIcon = (paths) => { const i = h('span', { class: 'ticon', 'aria-hidden': 'true' }); i.innerHTML = `<svg viewBox="0 0 24 24">${paths}</svg>`; return i; };
// 前の画面の場所から、新しい場所へ転送する
const LEGACY = {
  '#/s/place': '#/map', '#/s/wish': '#/map', '#/timeline': '#/',
  '#/s/like': '#/more/like', '#/s/gift': '#/more/gift', '#/s/dislike': '#/more/dislike',
  '#/values': '#/more/values', '#/anniv': '#/more/anniv', '#/settings': '#/more/settings',
};
// 各ページを描く関数は app.js が登録する（ページ側がこのファイルを使うので、こちらからは import しない）
let pages = {};
const setPages = (p) => { pages = p; };
function route() {
  const [, a = '', b] = location.hash.split('/');
  if (a === 'map') return { tab: 1, depth: 0, page: pages.map };
  if (a === 'mood') return { tab: 2, depth: 0, page: pages.mood };
  if (a === 'more') return pages.sub[b] ? { tab: 3, depth: 1, page: pages.sub[b] } : { tab: 3, depth: 0, page: pages.more };
  return { tab: 0, depth: 0, page: pages.home };
}
let shown = null;
function draw() {
  if (LEGACY[location.hash]) history.replaceState(null, '', LEGACY[location.hash]);
  const r = route();
  let dir = 0;
  if (shown && (shown.tab !== r.tab || shown.depth !== r.depth)) dir = r.tab !== shown.tab ? Math.sign(r.tab - shown.tab) : Math.sign(r.depth - shown.depth);
  shown = r;
  commitSeen();
  dropSeenObserver();
  const view = h('main', { class: 'view' }, r.page());
  app.replaceChildren(view, tabBar(r.tab));
  if (dir && !reduceMotion()) view.classList.add(dir > 0 ? 'in-r' : 'in-l');
}
window.addEventListener('hashchange', () => { if (store?.user()) { draw(); window.scrollTo(0, 0); } });

const TAB_NEW = [() => sectionNew(['place', 'gift', 'anniversary', 'hero']), () => sectionNew(['place', 'wish']), moodsNew,
  () => sectionNew(['like', 'gift', 'value', 'dislike', 'anniversary'])];
const tabBar = (active) => h('nav', { class: 'tabbar', 'aria-label': 'Tabs' }, TABS.map((t, i) =>
  h('a', { href: t.href, class: [i === active && 'on', TAB_NEW[i]?.() && 'has-new'].filter(Boolean).join(' '), 'aria-current': i === active ? 'page' : null,
    onclick: (ev) => { if (i === active && shown?.depth === 0) { ev.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); } } },
  tabIcon(t.icon), h('span', { class: 'en' }, t.en))));

const pageNav = (back) => h('div', { class: 'nav' },
  back ? h('a', { class: 'link', href: '#/more' }, '← MORE') : h('span'),
  h('span', { class: 'word' }, 'Our Odyssey'), h('span', { class: 'nav-spacer' }));
// 大きな英語の見出し（日本語の副題は出さない）
const pageHead = (en, ...extra) => h('div', { class: 'head' }, h('h1', {}, en), extra);

// 画面に入ってきたものから、ふわっと出す
function fadeIn(root) {
  const els = root.querySelectorAll('.fade');
  if (!('IntersectionObserver' in window) || reduceMotion()) { els.forEach((e) => e.classList.add('in')); return; }
  const io = new IntersectionObserver((list) => list.forEach((x) => {
    if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); }
  }), { rootMargin: '0px 0px -6% 0px' });
  els.forEach((e) => io.observe(e));
}

// 通知の言語をそろえるため、Service Worker にも今の言語を教えておく
function tellSwLang() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage({ type: 'lang', lang })).catch(() => {});
}

/* ---------- ログイン ---------- */
function loginPage() {
  const email = h('input', { type: 'text', required: true, autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false' });
  const toEmail = (v) => (v.includes('@') ? v.trim() : `${v.trim().toLowerCase()}@${CONFIG.LOGIN_DOMAIN}`);
  const pw = h('input', { type: 'password', required: true, autocomplete: 'current-password' });
  const err = h('p', { class: 'err' });
  return h('div', {}, h('div', { class: 'nav' }, h('span'), h('span', { class: 'word' }, 'Our Odyssey'), h('span')),
    h('div', { class: 'head' }, h('h1', {}, 'Login'), h('p', { class: 'jp' }, tr('ふたりだけの場所です', 'Just for the two of us'))),
    h('form', { style: 'display: flex; flex-direction: column; gap: 14px', onsubmit: async (ev) => {
      ev.preventDefault(); err.textContent = '';
      try { await store.signIn(toEmail(email.value), pw.value); await start(); }
      catch { err.textContent = tr('ログインできませんでした。名前とパスワードを確かめてください。', "Couldn't log in. Check your name and password."); }
    } },
      h('label', {}, tr('名前（半角の英数字）', 'Name (letters and numbers)'), email), h('label', {}, tr('パスワード', 'Password'), pw), err,
      h('button', { class: 'btn', type: 'submit' }, 'LOG IN')));
}

/* ---------- ネットがないときも書けるように ---------- */
// 書いたものはいったん端末にあずけ、つながったら送る（store.js）。ここでは今の状態を小さく出す。
const syncPill = h('div', { class: 'sync', role: 'status', 'aria-live': 'polite', hidden: true });
function showSync() {
  const n = store.pending?.() || 0;
  const off = !navigator.onLine;
  syncPill.hidden = !(off || n);
  syncPill.textContent = off
    ? (n ? tr(`オフライン中・${n}件をあとで送ります`, `Offline · ${n} to send later`) : tr('オフライン中・書いたものはあとで送ります', 'Offline · new entries will be sent later'))
    : tr(`${n}件を送っています…`, `Sending ${n}…`);
}
let syncReady = false;
function setupSync() {
  if (syncReady || store.mode !== 'supabase' || !store.flush) return;
  syncReady = true;
  document.body.append(syncPill);
  store.onChange = showSync;
  store.onSync = ({ sent, failed }) => {
    if (failed.length) notice(tr('送れなかった記録がありました', "Some entries couldn't be sent"), { text: String(failed[0].error.message || failed[0].error) });
    // あずけていた分が送れたら、相手の更新もいっしょに取りなおす（書いている途中なら邪魔しない）
    if (sent && !document.querySelector('dialog[open]')) refresh().catch(() => {});
  };
  const kick = () => { showSync(); store.flush(); };
  window.addEventListener('online', kick);
  window.addEventListener('offline', showSync);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') kick(); });
  setInterval(() => { if (navigator.onLine && store.pending()) store.flush(); }, 30000);
  kick();
}
// アプリの部品を端末に覚えさせて、ネットがなくても開けるようにする
function setupOffline() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.ready.then((reg) => {
    const urls = [location.href.split('#')[0], ...performance.getEntriesByType('resource').map((e) => e.name)];
    reg.active?.postMessage({ type: 'warm', urls });
    reg.active?.postMessage({ type: 'lang', lang });
  }).catch(() => {});
}

async function start() {
  try {
    if (!store) setStore(await createStore());
    if (!store.user()) { app.replaceChildren(loginPage()); return; }
    await refresh();
    setupSync();
    setupLive();
    // 地図の部品は、最初の画面が出たあと手があいたときに先に読みこんでおく
    (window.requestIdleCallback || ((f) => setTimeout(f, 2500)))(() => leaflet().catch(() => {}).finally(setupOffline));
  } catch (e) {
    app.replaceChildren(h('p', { class: 'empty' }, tr('読みこめませんでした：', "Couldn't load: ") + (e.message || e)));
  }
}

export { act, refresh, draw, setPages, pageNav, pageHead, fadeIn, tellSwLang, start };
