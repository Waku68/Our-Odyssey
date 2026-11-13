import { CONFIG } from './config.js';
import { createStore } from './store.js?v=35';
import { editPhoto } from './photo-editor.js?v=35';
import { ask, notice } from './ask.js?v=35';
import * as theme from './theme.js?v=35';
const { TH } = theme;
theme.apply();

const app = document.getElementById('app');

/* ---------- 言語（ふだんは日本語＋ボタンだけ英語、設定で全部英語） ---------- */
const LANG_KEY = 'our-odyssey-lang';
let lang = (() => { try { return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'ja'; } catch { return 'ja'; } })();
const tr = (ja, en) => (lang === 'en' ? en : ja);
document.documentElement.lang = lang;
function setLang(v) {
  lang = v === 'en' ? 'en' : 'ja';
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* 保存できなくても今回は切りかえる */ }
  document.documentElement.lang = lang;
  tellSwLang();
  draw();
}
// 通知の言語をそろえるため、Service Worker にも今の言語を教えておく
function tellSwLang() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage({ type: 'lang', lang })).catch(() => {});
}
let store;
let data = { entries: [], moods: [], comments: [], profiles: [] };
let likeFilter = '';
const openTalks = new Set();

/* ---------- 小さな道具 ---------- */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  const a = attrs || {};
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : String(kid));
  }
  for (const [k, v] of Object.entries(a)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = true;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  return el;
}
const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; };
const today = () => { const d = new Date(); return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
const utc = (s) => { const { y, m, d } = parse(s); return Date.UTC(y, m - 1, d); };
export const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
const dots = (s) => s.replaceAll('-', '.');
const md = (s) => { const { m, d } = parse(s); return tr(`${m}月${d}日`, `${MONTHS[m - 1]} ${d}`); };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// start から数えて k か月後の日付（月末は丸める）
function addMonths(start, k) {
  const s = parse(start);
  const y = s.y + Math.floor((s.m - 1 + k) / 12);
  const m = ((s.m - 1 + k) % 12) + 1;
  return ymd(y, m, Math.min(s.d, lastDay(y, m)));
}
// 次に来る「月ごとの記念日」。今日が当日なら今日を返す。
export function nextMonthly(start, t) {
  const s = parse(start), n = parse(t);
  let months = (n.y - s.y) * 12 + (n.m - s.m);
  if (addMonths(start, months) < t) months++;
  return { date: addMonths(start, months), months };
}
function nextYearly(start, t) {
  const s = parse(start), n = parse(t);
  let years = n.y - s.y;
  if (addMonths(start, years * 12) < t) years++;
  return { date: addMonths(start, years * 12), years };
}
export const spanLabel = (months) => {
  const y = Math.floor(months / 12), m = months % 12;
  if (lang === 'en') {
    if (m === 0) return plural(y, 'year');
    return y ? `${plural(y, 'year')} ${plural(m, 'month')}` : plural(m, 'month');
  }
  if (m === 0) return `${y}周年`;
  return months > 12 ? `${y}年${m}ヶ月` : `${months}ヶ月`;
};

const me = () => store.user().id;
const nameOf = (id) => (data.profiles.find((p) => p.id === id)?.display_name) || tr('ななし', 'No name');
const partner = () => data.profiles.find((p) => p.id !== me());
const byCreated = (a, b) => (a.created_at < b.created_at ? -1 : 1);

function photoImg(path, cls = 'photo') {
  const img = h('img', { class: cls, alt: '', loading: 'lazy', decoding: 'async' });
  store.photoUrl(path).then((u) => { img.src = u; }).catch(() => {});
  return img;
}
function pickFile() {
  return new Promise((res) => {
    const i = h('input', { type: 'file', accept: 'image/*' });
    i.onchange = () => res(i.files[0] || null);
    i.click();
  });
}
const maxSide = () => (store.mode === 'demo' ? 900 : 1600);
// 写真をえらんで、切り取り・回転・飾りつけをしてから使う。やめたら null。
async function pickPhoto(opts = {}) {
  const f = await pickFile(); if (!f) return null;
  return editPhoto(f, { maxSide: maxSide(), lang, ...opts });
}
async function act(fn) {
  try { await fn(); await refresh(); } catch (e) { notice(tr('うまくいきませんでした', "Something went wrong"), { text: e.message || String(e) }); }
}

/* ---------- 読みこみと画面の切りかえ ---------- */
async function load() {
  const [entries, moods, comments, profiles] = await Promise.all(
    [store.entries(), store.moods(), store.comments(), store.profiles()]);
  data = { entries, moods, comments, profiles };
}
async function refresh() {
  await load(); draw();
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
    const [entries, moods, comments, profiles] = await Promise.all([store.entries(), store.moods(), store.comments(), store.profiles()]);
    const next = { entries, moods, comments, profiles };
    if (liveSig(next) !== liveSig(data)) {
      if (isEditing()) { liveAgain = true; setTimeout(liveRefresh, 5000); }
      else { const y = window.scrollY; data = next; draw(); window.scrollTo(0, y); }
    }
  } catch { /* つながらないときは次の機会に */ } finally {
    liveBusy = false;
    if (liveAgain) { liveAgain = false; setTimeout(liveRefresh, 800); }
  }
}
/* ---------- NEW! のしるし ----------
   相手が足したり変えたりしたもの（ひとことも）に「NEW!」を貼る。画面に0.7秒ほど映ったら「見た」ことにして、
   次に画面を描き直したときにはずす（見ている最中に消えないように）。記録は端末ごと・人ごとに残す */
let seen = null;
const seenLater = {};
const selfEdited = new Set();
const seenKey = () => `our-odyssey-seen:${me()}`;
function hashStr(str) {
  let a = 0xdeadbeef, b = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677); }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return (4294967296 * (2097151 & b) + (a >>> 0)).toString(36);
}
const entrySig = (e) => hashStr(JSON.stringify([e.section, e.title, e.body, e.date, e.category, e.lat, e.lng, e.photo]));
const moodSig = (m) => hashStr(JSON.stringify([m.date, m.level, m.note, m.shared]));
function partnerPairs() {
  const out = [];
  for (const e of data.entries) if (e.author !== me()) out.push([`e:${e.id}`, entrySig(e)]);
  for (const c of data.comments) if (c.author !== me()) out.push([`c:${c.id}`, '1']);
  for (const m of data.moods) if (m.user_id !== me()) out.push([`m:${m.id}`, moodSig(m)]);
  return out;
}
function saveSeen() { try { localStorage.setItem(seenKey(), JSON.stringify(seen)); } catch { /* 入らなくても動く */ } }
function commitSeen() {
  if (store?.mode !== 'supabase' || !store.user()) return;
  if (!seen) {
    try { seen = JSON.parse(localStorage.getItem(seenKey())); } catch { seen = null; }
    // はじめて使うときは、いまあるものは全部「見た」ことにする
    if (!seen) { seen = Object.fromEntries(partnerPairs()); saveSeen(); return; }
  }
  Object.assign(seen, seenLater);
  for (const k of Object.keys(seenLater)) delete seenLater[k];
  // 自分が相手のものを変えたとき（行きたい→行った など）は NEW にしない
  for (const id of selfEdited) { const e = data.entries.find((x) => x.id === id); if (e) seen[`e:${id}`] = entrySig(e); }
  selfEdited.clear();
  // もうないものの記録は捨てる
  const alive = new Set([...data.entries.map((e) => `e:${e.id}`), ...data.comments.map((c) => `c:${c.id}`), ...data.moods.map((m) => `m:${m.id}`)]);
  for (const k of Object.keys(seen)) if (!alive.has(k)) delete seen[k];
  saveSeen();
}
const unseen = ([k, sig]) => seen && seen[k] !== sig;
function entryNew(e) {
  if (!e || !seen) return [];
  const out = [];
  if (e.author !== me()) out.push([`e:${e.id}`, entrySig(e)]);
  for (const c of data.comments) if (c.entry_id === e.id && c.author !== me()) out.push([`c:${c.id}`, '1']);
  return out.filter(unseen);
}
const sectionNew = (sections) => data.entries.some((e) => sections.includes(e.section) && entryNew(e).length);
const moodsNew = () => !!seen && data.moods.some((m) => m.user_id !== me() && unseen([`m:${m.id}`, moodSig(m)]));
let seenObs = null;
function newMark(el, pairs) {
  if (!pairs?.length) return el;
  el.classList.add('is-new');
  el.append(h('span', { class: 'newtag', 'aria-label': 'NEW' }, 'NEW!'));
  el.newPairs = pairs;
  seenObs ??= new IntersectionObserver((list) => {
    for (const it of list) {
      const t = it.target;
      clearTimeout(t.seenTimer);
      if (it.isIntersecting && it.intersectionRatio >= .5) t.seenTimer = setTimeout(() => {
        for (const [k, sig] of t.newPairs || []) seenLater[k] = sig;
        seenObs.unobserve(t);
      }, 700);
    }
  }, { threshold: [0, .5] });
  seenObs.observe(el);
  return el;
}
function markSeenNow(pairs) { for (const [k, sig] of pairs) seenLater[k] = sig; }
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
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

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
function route() {
  const [, a = '', b] = location.hash.split('/');
  if (a === 'map') return { tab: 1, depth: 0, page: mapPage };
  if (a === 'mood') return { tab: 2, depth: 0, page: moodPage };
  if (a === 'more') return MORE_PAGES[b] ? { tab: 3, depth: 1, page: MORE_PAGES[b] } : { tab: 3, depth: 0, page: morePage };
  return { tab: 0, depth: 0, page: home };
}
let shown = null;
function draw() {
  if (LEGACY[location.hash]) history.replaceState(null, '', LEGACY[location.hash]);
  const r = route();
  let dir = 0;
  if (shown && (shown.tab !== r.tab || shown.depth !== r.depth)) dir = r.tab !== shown.tab ? Math.sign(r.tab - shown.tab) : Math.sign(r.depth - shown.depth);
  shown = r;
  commitSeen();
  seenObs?.disconnect(); seenObs = null;
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
const pageHead = (en, _jp, ...extra) => h('div', { class: 'head' }, h('h1', {}, en), extra);

// 画面に入ってきたものから、ふわっと出す
function fadeIn(root) {
  const els = root.querySelectorAll('.fade');
  if (!('IntersectionObserver' in window) || reduceMotion()) { els.forEach((e) => e.classList.add('in')); return; }
  const io = new IntersectionObserver((list) => list.forEach((x) => {
    if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); }
  }), { rootMargin: '0px 0px -6% 0px' });
  els.forEach((e) => io.observe(e));
}

/* ---------- ホーム（DAYS と、その下の年表） ---------- */
function home() {
  const t = today();
  const days = daysBetween(CONFIG.START_DATE, t);
  const nm = nextMonthly(CONFIG.START_DATE, t);
  const banners = [];
  if (daysBetween(t, nm.date) === 0) banners.push(tr(`今日は ${spanLabel(nm.months)} の記念日！`, `Today is our ${spanLabel(nm.months)} anniversary!`));
  if (days > 0 && days % 100 === 0) banners.push(tr(`今日で ${days}日！`, `${days} days today!`));
  for (const e of data.entries.filter((x) => x.section === 'anniversary' && x.date)) {
    const ny = nextYearly(e.date, t);
    if (ny.date === t && ny.years > 0) banners.push(tr(`今日は「${e.title}」から ${ny.years}年！`, `${plural(ny.years, 'year')} since "${e.title}" today!`));
  }
  const hero = (k) => data.entries.filter((e) => e.section === 'hero' && e.category === k).sort(byCreated).pop();
  const slot = (k, label) => {
    const e = hero(k);
    const b = h('button', { class: `slot ${k}${e ? ' has' : ''}`, 'aria-label': `${label}`, onclick: () => setHero(k, e) },
      h('span', {}, `[${label}]`));
    if (e) store.photoUrl(e.photo).then((u) => { b.style.backgroundImage = `url("${u}")`; });
    return newMark(b, entryNew(e));
  };
  const heroEl = h('div', { class: 'home' },
      h('div', { class: 'tag' }, `Since ${dots(CONFIG.START_DATE)}`),
      h('p', { class: 'big first' }, String(days)),
      h('p', { class: 'big unit' }, 'Days'),
      banners.map((b) => h('div', { class: 'banner' }, b)),
      h('div', { class: 'stage' },
        slot('a', 'OUR PHOTO'), slot('b', 'KEEPSAKE'),
        h('img', { class: 'flower blue', src: 'assets/tulip-blue.webp', alt: '' }),
        h('img', { class: 'flower pink', src: 'assets/tulip-pink.webp', alt: '' })));
  const pin = h('div', { class: 'hero-pin' }, heroEl);
  const root = h('div', {}, pin,
    store.mode === 'demo' && h('p', { class: 'note' }, tr('お試しモード：書いた内容はこの端末にだけ保存されます。', 'Demo mode: everything is saved on this device only.')),
    timeline());
  requestAnimationFrame(() => { fadeIn(root); pinHero(pin, heroEl); });
  return root;
}
// 1384 DAYS をその場に止めたまま、スクロールに合わせて消していく。消えきったら年表が上がってくる。
function pinHero(pin, hero) {
  if (reduceMotion()) return;
  pin.classList.add('on');
  // スクロールに連動したアニメーションをブラウザに任せられるなら任せる（いちばんなめらか）
  const native = window.CSS?.supports?.('animation-timeline: scroll()');
  let V = 0, W = 0, start = 0, len = 1, raf = 0;
  const layout = () => {
    // iPhoneはスクロール中にアドレスバーの出し入れで高さが変わるので、横幅が変わったときだけ測り直す
    if (!V || window.innerWidth !== W) { V = document.documentElement.clientHeight; W = window.innerWidth; }
    const H = hero.offsetHeight;
    const lead = Math.max(0, H - V);
    const dist = Math.round(V * 0.75);
    start = 0; // ホームは一番上にあるので、スクロールし始めた瞬間から消えはじめる
    len = lead + dist;
    hero.style.top = `${Math.min(0, V - H)}px`;
    pin.style.height = `${H + dist}px`;
    pin.style.setProperty('--fade-start', `${start}px`);
    pin.style.setProperty('--fade-end', `${start + len}px`);
  };
  const update = () => {
    raf = 0;
    const p = Math.min(1, Math.max(0, (window.scrollY - start) / len));
    hero.style.opacity = String(1 - p);
    hero.style.transform = `translate3d(0, ${(-p * 28).toFixed(1)}px, 0)`;
    hero.style.visibility = p >= 1 ? 'hidden' : '';
  };
  const onScroll = () => {
    if (!pin.isConnected) { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onResize); ro.disconnect(); return; }
    if (!native && !raf) raf = requestAnimationFrame(update);
  };
  const onResize = () => { layout(); onScroll(); };
  const ro = new ResizeObserver(onResize);
  ro.observe(hero);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);
  if (native) pin.classList.add('native');
  layout(); if (!native) update();
}
function timeline() {
  const kind = { gift: tr('贈りもの', 'Gift'), place: tr('過ごした場所', 'Place'), anniversary: tr('記念日', 'Anniversary') };
  const items = [{ date: CONFIG.START_DATE, title: tr('付き合いはじめた日', 'The day we started dating'), k: kind.anniversary },
    ...data.entries.filter((e) => e.date && kind[e.section]).map((e) => ({ id: e.id, section: e.section, date: e.date, title: e.title, k: kind[e.section], photo: e.photo }))];
  // 上が古く、下にスクロールするほど新しくなる
  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const out = [];
  let year = null, group = null;
  for (const it of items) {
    const y = it.date.slice(0, 4);
    if (y !== year) { year = y; group = h('div', { class: 'tl' }); out.push(h('div', { class: 'year fade' }, y), group); }
    group.append(newMark(h(it.id ? 'button' : 'div', { class: 'it fade', type: it.id ? 'button' : null, onclick: it.id ? () => (it.section === 'anniversary' ? (location.hash = '#/more/anniv') : openDetail(it.id)) : null },
      h('div', { class: 'd' }, dots(it.date).slice(5)), h('div', { class: 't' }, it.title),
      h('div', { class: 'muted' }, it.k), it.photo && photoImg(it.photo, '')), it.id && entryNew(data.entries.find((x) => x.id === it.id))));
  }
  return h('section', { class: 'home-tl' },
    h('div', { class: 'head fade' }, h('h1', {}, 'Timeline')), out);
}
function addDays(s, n) {
  const d = new Date(utc(s) + n * 864e5);
  return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}
async function setHero(k, e) {
  const blob = await pickPhoto({ aspect: k === 'a' ? '3:4' : '4:5' }); if (!blob) return;
  act(async () => {
    const photo = await store.uploadPhoto(blob);
    if (e && e.author === me()) await store.saveEntry({ id: e.id, photo });
    else await store.saveEntry({ section: 'hero', category: k, title: '', photo });
  });
}

/* ---------- 入力シート ---------- */
let leafletP;
function leaflet() {
  leafletP ??= new Promise((ok, ng) => {
    document.head.append(h('link', { rel: 'stylesheet', href: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css' }));
    const s = h('script', { src: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js' });
    s.onload = () => ok(window.L); s.onerror = () => ng(new Error(tr('地図を読みこめませんでした。', "Couldn't load the map.")));
    document.head.append(s);
  });
  return leafletP;
}
const TILE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
// 地図を引きすぎないようにする：世界地図の高さが画面の高さより小さくなる手前（最低でもアジアが見えるくらい）で止め、
// 上下は地図の端（北極・南極の手前）より外へ動かせないようにする（外の灰色が見えないように）
const MIN_ZOOM = 3;
function limitMap(L, map, el) {
  map.setMaxBounds(L.latLngBounds([-85, -540], [85, 540]));
  map.options.maxBoundsViscosity = 1;
  const fit = () => {
    const h = el.clientHeight || 0;
    map.setMinZoom(Math.max(MIN_ZOOM, Math.ceil(Math.log2(Math.max(1, h) / 256))));
  };
  fit();
  return fit;
}
const pin = (L, lat, lng, fill = TH.navy) =>
  L.circleMarker([lat, lng], { radius: 9, color: TH.navy, weight: 2, fillColor: fill, fillOpacity: 1 });

/* ---------- 場所から写真をさがす（Wikipedia の記事の写真） ---------- */
async function wikiThumb(lc, title) {
  const u = `https://${lc}.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1&prop=pageimages&piprop=thumbnail&pithumbsize=1280&titles=${encodeURIComponent(title)}`;
  const pg = Object.values((await (await fetch(u)).json()).query?.pages || {})[0];
  return pg?.thumbnail?.source ? { url: pg.thumbnail.source, title: pg.title } : null;
}
const wikiTag = (tag) => { const i = tag.indexOf(':'); return i > 0 && i < 4 ? [tag.slice(0, i), tag.slice(i + 1)] : ['ja', tag]; };
async function wikiNear(lat, lng, name) {
  const u = `https://ja.wikipedia.org/w/api.php?action=query&format=json&origin=*&list=geosearch&gscoord=${lat}|${lng}&gsradius=1000&gslimit=20`;
  const list = (await (await fetch(u)).json()).query?.geosearch || [];
  const norm = (x) => x.replace(/[\s　・()（）「」]/g, '').toLowerCase();
  const n = name ? norm(name) : '';
  // 書いた名前と記事名が重なるものを優先。なければ、すぐそば（150m以内）の記事
  const cands = [...(n ? list.filter((g) => { const t = norm(g.title); return t.length > 1 && (n.includes(t) || t.includes(n)); }) : []),
    ...list.filter((g) => g.dist <= 150)];
  for (const g of cands) { const t = await wikiThumb('ja', g.title); if (t) return t; }
  return null;
}
async function placePhoto({ lat, lng, wiki, name }) {
  try {
    if (!wiki && lat != null) {
      const r = await (await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&extratags=1&lat=${lat}&lon=${lng}`)).json();
      wiki = r?.extratags?.wikipedia;
    }
    if (wiki) { const t = await wikiThumb(...wikiTag(wiki)); if (t) return t; }
    return lat != null ? await wikiNear(lat, lng, name) : null;
  } catch { return null; }
}
// 名前から写真をさがす：日本語版Wikipediaの記事の写真＋Wikimedia Commonsの写真
async function namePhotos(q) {
  const enc = encodeURIComponent(q);
  const wiki = fetch(`https://ja.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${enc}&gsrlimit=6&prop=pageimages&piprop=thumbnail&pithumbsize=1280`)
    .then((r) => r.json()).then((j) => Object.values(j.query?.pages || {}).sort((a, b) => a.index - b.index)
      .filter((p) => p.thumbnail?.source).map((p) => ({ url: p.thumbnail.source, title: p.title, from: 'Wikipedia' }))).catch(() => []);
  const commons = fetch(`https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(`${q} filetype:bitmap`)}&gsrlimit=8&prop=imageinfo&iiprop=url|mime&iiurlwidth=1280`)
    .then((r) => r.json()).then((j) => Object.values(j.query?.pages || {}).sort((a, b) => a.index - b.index)
      .map((p) => ({ i: p.imageinfo?.[0], t: p.title })).filter(({ i }) => i && /jpeg|png|webp/.test(i.mime || ''))
      .map(({ i, t }) => ({ url: i.thumburl || i.url, title: t.replace(/^File:/, '').replace(/\.[a-z]+$/i, ''), from: 'Wikimedia Commons' }))).catch(() => []);
  const [a, b] = await Promise.all([wiki, commons]);
  return [...a, ...b];
}
// 候補の列に出す小さな画像（Wikimedia の決まった大きさの縮小版）
const smallThumb = (u) => u.replace(/\/\d+px-/, '/250px-');
async function fitImage(blob) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, maxSide() / Math.max(bmp.width, bmp.height));
  const c = h('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
}

/* 場所の名前から地図の位置をさがす。
   1) OpenStreetMap（Nominatim）で名前をさがす（施設・駅・お店など）
   2) 見つからなければ、国土地理院の検索（日本の地名・住所）でさがす
   見つかった候補はいくつか並べて、タップでえらび直せる */
async function geoSearch(q) {
  const out = [];
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&extratags=1&accept-language=${lang}&q=${encodeURIComponent(q)}`);
    for (const x of await r.json()) {
      out.push({ lat: +x.lat, lng: +x.lon, name: x.name || x.display_name.split(',')[0],
        sub: x.display_name.split(',').slice(1, 4).join(',').trim(), wiki: x.extratags?.wikipedia });
    }
  } catch { /* 次の検索へ */ }
  if (!out.length) {
    try {
      const r = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(q)}`);
      for (const x of (await r.json()).slice(0, 5)) {
        const [lng, lat] = x.geometry?.coordinates || [];
        if (lat != null) out.push({ lat, lng, name: x.properties?.title || q, sub: tr('国土地理院', 'GSI Japan') });
      }
    } catch { /* どちらもだめ */ }
  }
  return out;
}
function geoField(v, onSet = () => {}) {
  const box = h('div', { hidden: true });
  const picked = () => tr('場所をえらんであります', 'Location set');
  const status = h('span', { class: 'muted' }, v.lat != null ? picked() : '');
  const hits = h('div', { class: 'geo-hits', hidden: true });
  let map, marker, L, seq = 0;
  const put = (lat, lng, wiki) => {
    v.lat = lat; v.lng = lng; status.textContent = picked();
    if (marker) marker.remove();
    marker = pin(L, lat, lng).addTo(map);
    onSet({ lat, lng, wiki });
  };
  const q = h('input', { type: 'text', placeholder: tr('場所の名前でさがす（例：富士急ハイランド）', 'Search by place name'), enterkeyhint: 'search' });
  const choose = (list, i) => {
    const x = list[i];
    map.setView([x.lat, x.lng], 15); put(x.lat, x.lng, x.wiki);
    [...hits.children].forEach((c, j) => c.classList.toggle('on', j === i));
  };
  const search = async () => {
    const text = q.value.trim();
    if (!text || !map) return;
    const my = ++seq;
    status.textContent = tr('さがしています…', 'Searching…');
    const list = await geoSearch(text);
    if (my !== seq) return;
    hits.hidden = list.length < 2;
    hits.replaceChildren(...list.map((x, i) => h('button', { type: 'button', class: 'geo-hit', onclick: () => choose(list, i) },
      h('b', {}, x.name), x.sub && h('small', {}, x.sub))));
    if (!list.length) { status.textContent = tr('見つかりませんでした。名前を短くするか、地図をタップしてえらべます。', 'Not found. Try a shorter name, or tap the map.'); return; }
    choose(list, 0);
    if (list.length > 1) status.textContent = tr('ちがったら下の候補からえらび直せます', 'Not right? Pick another below');
  };
  // 日本語入力の「確定」の Enter では検索しない
  q.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.isComposing && ev.keyCode !== 229) { ev.preventDefault(); search(); } });
  const mapEl = h('div', { class: 'map pick' });
  box.append(h('div', { class: 'row search-row' }, q, h('button', { type: 'button', class: 'btn ghost small', onclick: search }, 'SEARCH')), hits, mapEl,
    h('p', { class: 'hint' }, tr('地図をタップしても場所をえらべます', 'You can also tap the map')));
  const open = async () => {
    box.hidden = false;
    if (map) return;
    try { L = await leaflet(); } catch (e) { status.textContent = e.message; return; }
    map = L.map(mapEl, { maxBoundsViscosity: 1 }).setView(v.lat != null ? [v.lat, v.lng] : [36.2, 138.2], v.lat != null ? 14 : 4);
    const refit = limitMap(L, map, mapEl);
    L.tileLayer(TILE, { attribution: ATTR, maxZoom: 19 }).addTo(map);
    if (v.lat != null) marker = pin(L, v.lat, v.lng).addTo(map);
    map.on('click', (ev) => put(ev.latlng.lat, ev.latlng.lng));
    setTimeout(() => { map.invalidateSize(); refit(); }, 60);
    // まだ場所がなければ、書いてある名前でそのままさがす
    if (v.lat == null && (v.title || '').trim()) { q.value = v.title.trim(); search(); }
  };
  const clear = () => { v.lat = null; v.lng = null; status.textContent = ''; if (marker) marker.remove(); onSet(null); };
  return h('div', {},
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn ghost small', onclick: open }, 'PICK ON MAP'),
      h('button', { type: 'button', class: 'link', onclick: clear }, 'CLEAR'), status),
    box);
}

const levels = () => tr(['とても\nつらい', 'つらい', 'ふつう', 'いい', 'とても\nいい'], ['Very\nbad', 'Bad', 'Okay', 'Good', 'Very\ngood']);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const BOOKMARK = '<svg viewBox="0 0 10 13" aria-hidden="true"><path d="M0 0h10v13L5 9.5 0 13z" fill="currentColor"/></svg>';

/* ---------- ダイアログ（入力・メニュー共通） ---------- */
function showDialog(dlg) {
  document.body.append(dlg);
  const root = document.documentElement;
  root.classList.add('locked');
  dlg.addEventListener('close', () => { dlg.remove(); if (!document.querySelector('dialog[open]')) root.classList.remove('locked'); });
  dlg.addEventListener('click', (ev) => { if (ev.target === dlg) closeDialog(dlg); });
  dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); closeDialog(dlg); });
  dlg.showModal();
}
async function closeDialog(dlg, force = false) {
  if (!dlg.open || dlg.classList.contains('closing') || dlg.asking) return;
  if (!force && dlg.guard) {
    dlg.asking = true;
    const ok = await dlg.guard();
    dlg.asking = false;
    if (!ok || !dlg.open) return;
  }
  dlg.classList.add('closing');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(() => dlg.close(), reduce ? 0 : 170);
}

/* ---------- 日付をえらぶ帯（横にスクロールする日のカード） ---------- */
function dayStrip({ value, onChange, marks = new Set(), max = null, allowNone = false }) {
  let sel = value || null;
  let { y, m } = parse(sel || today());
  const label = h('span', { class: 'pill-text' });
  const native = h('input', { type: 'date', class: 'month-native', 'aria-label': tr('カレンダーから日付をえらぶ', 'Pick a date from the calendar'), max: max || null,
    onclick: () => { try { native.showPicker(); } catch { /* 未対応のブラウザはそのまま */ } },
    onchange: (ev) => { if (ev.target.value) pick(ev.target.value); } });
  const strip = h('div', { class: 'strip' });
  const center = (smooth) => {
    const c = strip.querySelector('.on') || strip.querySelector('.today');
    const left = c ? c.offsetLeft - (strip.clientWidth - c.offsetWidth) / 2 : 0;
    strip.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
  };
  const bm = () => { const i = h('i', { class: 'bm' }); i.innerHTML = BOOKMARK; return i; };
  const noneBtn = allowNone ? h('button', { type: 'button', class: 'chip', onclick: () => { sel = null; render(); onChange(null); } }, 'NO DATE') : null;
  const next = h('button', { type: 'button', class: 'mnav', 'aria-label': tr('次の月', 'Next month'), onclick: () => shift(1) }, '›');
  function render() {
    label.textContent = `${MONTHS[m - 1]}  ${y}`;
    native.value = sel || '';
    next.disabled = !!max && ymd(y, m, lastDay(y, m)) >= max;
    const t = today();
    strip.replaceChildren(...Array.from({ length: lastDay(y, m) }, (_, i) => {
      const d = ymd(y, m, i + 1);
      const cls = ['day', d === sel && 'on', d === t && 'today', marks.has(d) && 'marked'].filter(Boolean).join(' ');
      return h('button', { type: 'button', class: cls, disabled: !!max && d > max, 'aria-pressed': String(d === sel),
        'aria-label': `${md(d)}${marks.has(d) ? tr('（記録あり）', ' (recorded)') : ''}`, onclick: () => pick(d) },
      bm(), h('span', { class: 'wd' }, WEEK[new Date(utc(d)).getUTCDay()]), h('span', { class: 'dn' }, pad(i + 1)));
    }));
    if (noneBtn) noneBtn.classList.toggle('on', !sel);
  }
  function pick(d) { sel = d; ({ y, m } = parse(d)); render(); onChange(d); requestAnimationFrame(() => center(true)); }
  function shift(k) {
    m += k;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    render(); requestAnimationFrame(() => center(false));
  }
  render();
  const ro = new ResizeObserver(() => { if (strip.clientWidth) { center(false); ro.disconnect(); } });
  ro.observe(strip);
  const root = h('div', { class: 'daypick' },
    h('div', { class: 'month' },
      h('button', { type: 'button', class: 'mnav', 'aria-label': tr('前の月', 'Previous month'), onclick: () => shift(-1) }, '‹'),
      h('span', { class: 'pill' }, label, native), next),
    strip,
    h('div', { class: 'row daypick-foot' },
      h('button', { type: 'button', class: 'chip', onclick: () => pick(max && today() > max ? max : today()) }, 'TODAY'), noneBtn,
      h('span', { class: 'muted' }, tr('月の部分をタップするとカレンダー', 'Tap the month for a calendar'))));
  root.pick = pick;
  return root;
}

/* ---------- 入力のモーダル ---------- */
// 入力欄の中身。モーダルでも、ページの下に置く入力欄でも使う。
function formParts({ fields, initial = {}, onSubmit, after, submitLabel = 'SAVE' }) {
  const v = { ...initial };
  let newPhoto = null;
  let draft = null; // 保存前の写真は、元の写真と編集の内容を持っておく（何度でもやり直せる）
  let dirty = false;
  let onGeo = () => {};
  let onTitle = () => {}; // 名前が変わったとき（写真の欄が名前から写真をさがすのに使う）   // 地図の場所が決まったとき（写真の欄が自動で写真を入れるのに使う）
  const touch = () => { dirty = true; };
  const err = h('p', { class: 'err', role: 'alert' });
  const field = (f, inner, tag = 'div') => h(tag, { class: 'field' },
    f.label && h('span', { class: 'flabel' }, f.label, f.required && !f.readonly && h('span', { class: 'req' }, tr('必須', 'required'))),
    inner, f.hint && h('span', { class: 'hint' }, f.hint));
  const control = (f) => {
    if (f.type === 'geo') return field(f, geoField(v, (info) => onGeo(info)));
    if (f.type === 'date') {
      return field(f, dayStrip({ value: v[f.name], allowNone: !f.required, onChange: (d) => { v[f.name] = d; touch(); } }));
    }
    if (f.type === 'photo') {
      const img = v.photo ? photoImg(v.photo, 'drop-img') : h('img', { class: 'drop-img', alt: '', hidden: true });
      const txt = h('span', { class: 'drop-txt', hidden: !!v.photo }, '+ ADD PHOTO', h('small', {}, tr('タップして端末の写真から', 'Tap to choose from your device')));
      const show = (blob, d) => {
        newPhoto = blob; draft = d;
        img.src = URL.createObjectURL(blob); img.hidden = false; txt.hidden = true; rm.hidden = false; ed.hidden = false; drop.classList.remove('is-empty'); touch();
      };
      const clearPhoto = () => {
        newPhoto = null; draft = null; v.photo = null; img.hidden = true; img.removeAttribute('src'); txt.hidden = false; rm.hidden = true; ed.hidden = true; drop.classList.add('is-empty');
      };
      // 拾ってきた写真の候補。地図の場所から見つけたもの（いちばん確か）を先頭に、名前で探したものを後ろに並べる
      // 自分で写真をえらんだら（mine）、自動では置きかえない。候補の列はそのまま出しておくので、あとから選べる
      let mine = !!v.photo, auto = false, seq = 0, picked = -1;
      let geoCand = null, textCands = [], cands = [];
      const credit = h('span', { class: 'hint photo-credit', hidden: true });
      const strip = h('div', { class: 'cands', hidden: true });
      const fromDevice = h('button', { type: 'button', class: 'cand dev', onclick: () => choose() }, h('span', {}, '+'), h('small', {}, tr('端末から', 'Device')));
      const say = (t) => { credit.hidden = !t; credit.textContent = t || ''; };
      const paintStrip = () => {
        strip.hidden = !cands.length;
        strip.replaceChildren(...cands.map((c, i) => h('button', { type: 'button', class: `cand${i === picked ? ' on' : ''}`, title: c.title,
          'aria-label': tr(`候補${i + 1}：${c.title}`, `Option ${i + 1}: ${c.title}`), 'aria-pressed': String(i === picked), onclick: () => pick(i, true) },
          h('img', { src: smallThumb(c.url), alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }))), fromDevice);
      };
      const creditOf = (c) => tr(`${c.from}「${c.title}」の写真を仮に入れました。下から別の写真もえらべます`,
        `Added a photo from ${c.from} "${c.title}". You can pick another below.`);
      async function pick(i, byHand) {
        const c = cands[i]; if (!c) return;
        const my = ++seq;
        picked = i; paintStrip(); say(tr('写真を読みこみ中…', 'Loading photo…'));
        let blob = null;
        try { blob = await fitImage(await (await fetch(c.url)).blob()); } catch { blob = null; }
        if (my !== seq) return;
        if (!blob) {   // 読めなかった候補は外して、次へ
          cands.splice(i, 1); picked = -1; paintStrip();
          if (cands.length && (byHand || !mine)) return pick(Math.min(i, cands.length - 1), byHand);
          if (auto) { clearPhoto(); auto = false; }
          say(cands.length ? '' : tr('写真は見つかりませんでした', 'No photo found'));
          return;
        }
        show(blob, { file: blob }); auto = true; mine = false;
        say(creditOf(c));
      }
      const refresh = () => {
        const seen = new Set();
        cands = [geoCand, ...textCands].filter((c) => c && !seen.has(c.url) && seen.add(c.url)).slice(0, 10);
        picked = -1; paintStrip();
        if (mine) { say(cands.length ? tr('ほかの写真の候補です。タップすると入れかわります', 'Other photos you can use — tap to swap') : ''); return; }
        if (cands.length) pick(0, false);
        else { if (auto) { clearPhoto(); auto = false; } say(''); }
      };
      onGeo = async (info) => {
        const my = ++seq;
        if (!info) { geoCand = null; refresh(); return; }
        say(tr('この場所の写真をさがしています…', 'Looking for a photo of this place…'));
        const t = await placePhoto({ ...info, name: v.title });
        if (my !== seq) return;
        geoCand = t && { ...t, from: 'Wikipedia' };
        refresh();
      };
      let timer = 0;
      onTitle = (text) => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          const q = text.trim();
          const my = ++seq;
          if (q.length < 2) { textCands = []; refresh(); return; }
          if (!mine && !geoCand) say(tr('写真をさがしています…', 'Looking for photos…'));
          // 曲なら、まずジャケット写真を候補にする
          const found = v.category === SONG_CAT ? [...await songPhotos(q), ...await namePhotos(q)] : await namePhotos(q);
          if (my !== seq || q !== (v.title || '').trim()) return;
          textCands = found; refresh();
        }, 900);
      };
      async function choose() {
        const file = await pickFile(); if (!file) return;
        const out = await editPhoto(file, { maxSide: maxSide(), lang, withState: true });
        if (out) { seq++; show(out.blob, { file, state: out.state }); mine = true; auto = false; picked = -1; paintStrip(); say(''); }
      }
      // 今の写真をもう一度ひらいて直す
      const reedit = async () => {
        let src = draft?.file, state = draft?.state;
        if (!src && v.photo) {
          try { src = await (await fetch(await store.photoUrl(v.photo))).blob(); } catch { notice(tr('写真を読みこめませんでした', "Couldn't load the photo")); return; }
        }
        if (!src) return;
        const out = await editPhoto(src, { maxSide: maxSide(), lang, withState: true, state });
        if (out) { show(out.blob, { file: src, state: out.state }); mine = true; auto = false; }
      };
      const rm = h('button', { type: 'button', class: 'link', hidden: !v.photo, onclick: () => {
        seq++; clearPhoto(); touch(); mine = false; auto = false; picked = -1; paintStrip(); say('');
      } }, 'REMOVE PHOTO');
      const ed = h('button', { type: 'button', class: 'btn ghost small', hidden: !v.photo, onclick: reedit }, 'EDIT PHOTO');
      const drop = h('button', { type: 'button', class: v.photo ? 'drop' : 'drop is-empty', onclick: choose }, img, txt);
      return field(f, h('div', { class: 'photo-field' }, drop, credit, strip, h('div', { class: 'row' }, ed, rm)));
    }
    if (f.type === 'level') {
      const btns = levels().map((label, i) => h('button', { type: 'button', class: v.level === i + 1 ? 'on' : '',
        onclick: () => { v.level = i + 1; btns.forEach((b, j) => b.classList.toggle('on', j === i)); touch(); } }, label));
      return field(f, h('div', { class: 'levels' }, btns));
    }
    if (f.type === 'check') {
      return h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: !!v[f.name], onchange: (ev) => { v[f.name] = ev.target.checked; touch(); } }), f.label);
    }
    const common = { value: v[f.name] ?? '', required: f.required, readonly: f.readonly, placeholder: f.ph,
      oninput: (ev) => { v[f.name] = ev.target.value; touch(); if (f.name === 'title') onTitle(ev.target.value); } };
    if (f.type === 'textarea') return field(f, h('textarea', common), 'label');
    if (f.type === 'category') {
      // 決まった種類は日本語のまま保存し、表示だけ言語に合わせる
      const input = h('input', { type: 'text', ...common, value: catLabel(v[f.name] ?? ''),
        oninput: (ev) => { v[f.name] = catKey(ev.target.value); touch(); } });
      const chips = h('div', { class: 'chips' }, f.options.map((o) => h('button', { type: 'button', class: `chip${v[f.name] === o ? ' on' : ''}`,
        onclick: () => { input.value = catLabel(o); v[f.name] = o; touch(); [...chips.children].forEach((c) => c.classList.toggle('on', c.textContent === catLabel(o))); } }, catLabel(o))));
      input.addEventListener('input', () => [...chips.children].forEach((c) => c.classList.toggle('on', c.textContent === input.value)));
      return field(f, h('div', { class: 'cat' }, chips, input));
    }
    return field(f, h('input', { type: f.type, ...common }), 'label');
  };
  const submit = h('button', { class: 'btn', type: 'submit' }, submitLabel);
  const handle = async (ev) => {
    ev.preventDefault(); err.textContent = '';
    for (const f of fields) {
      const missing = f.type === 'level' ? !v.level : (f.required && f.name && !String(v[f.name] ?? '').trim());
      if (missing) {
        const pick = ['date', 'level', 'category'].includes(f.type);
        err.textContent = tr(`「${f.label}」を${pick ? 'えらんで' : '書いて'}ください。`, `Please ${pick ? 'choose' : 'fill in'} "${f.label}".`);
        return;
      }
    }
    submit.disabled = true;
    try {
      if (newPhoto) v.photo = await store.uploadPhoto(newPhoto);
      for (const f of fields) if (f.type === 'date' && !v[f.name]) v[f.name] = null;
      await onSubmit(v);
      if (initial.photo && v.photo !== initial.photo) store.removePhoto(initial.photo).catch(() => {});
      await after();
    } catch (e) { err.textContent = e.message || String(e); submit.disabled = false; }
  };
  return { controls: fields.map(control), err, submit, handle, isDirty: () => dirty };
}
function openForm({ title, en, lead, fields, initial, onSubmit }) {
  const dlg = h('dialog', { class: 'modal', 'aria-label': title });
  const fp = formParts({ fields, initial, onSubmit, after: async () => { closeDialog(dlg, true); await refresh(); } });
  dlg.guard = async () => !fp.isDirty() || ask(tr('書きかけの内容を捨てますか？', 'Discard what you wrote?'),
    { text: tr('閉じると、いま書いた内容と写真は消えます。', 'If you close now, your text and photo will be lost.'), ok: 'DISCARD', cancel: 'KEEP WRITING', danger: true });
  dlg.append(h('form', { class: 'sheet', novalidate: true, onsubmit: fp.handle },
    h('div', { class: 'mhead' },
      h('div', {}, en && h('div', { class: 'tag' }, en), h('h2', {}, title), lead && h('p', { class: 'lead' }, lead)),
      h('button', { type: 'button', class: 'x', 'aria-label': 'Close', onclick: () => closeDialog(dlg) }, '×')),
    h('div', { class: 'mbody' }, fp.controls),
    h('div', { class: 'mfoot' }, fp.err, h('div', { class: 'row' }, fp.submit,
      h('button', { class: 'btn ghost', type: 'button', onclick: () => closeDialog(dlg) }, 'CANCEL')))));
  showDialog(dlg);
}
function inlineForm({ fields, onSubmit }) {
  const fp = formParts({ fields, onSubmit, after: refresh, submitLabel: 'ADD' });
  const form = h('form', { class: 'inline-form', novalidate: true, onsubmit: fp.handle }, fp.controls, fp.err, h('div', { class: 'row' }, fp.submit));
  form.isDirty = fp.isDirty;
  return form;
}

/* ---------- 各欄 ---------- */
const F = {
  title: (label, ph) => ({ name: 'title', type: 'text', label, required: true, ph }),
  date: (label = tr('日付', 'Date')) => ({ name: 'date', type: 'date', label }),
  get body() { return { name: 'body', type: 'textarea', label: tr('ひとこと', 'Note'), ph: tr('そのときのこと、思ったことを自由に', 'What happened, how you felt — anything') }; },
  get geo() { return { type: 'geo', label: tr('地図の場所', 'Location'), hint: tr('入れておくと地図にピンが立ちます', 'Adds a pin to the map') }; },
  get photo() { return { type: 'photo', label: tr('写真', 'Photo') }; },
};
const LIKE_CATS = ['食べ物', '飲み物', '仕草', '場所', '曲', 'その他'];
const LIKE_CATS_EN = ['Food', 'Drinks', 'Habits', 'Places', 'Songs', 'Other'];
const OTHER_CAT = 'その他';
// 決まった種類は日本語で保存して、表示だけ英語にする（ふたりの言語設定がちがっても同じ種類になる）
const catLabel = (c) => { const i = LIKE_CATS.indexOf(c); return lang === 'en' && i >= 0 ? LIKE_CATS_EN[i] : c; };
const catKey = (label) => { const i = LIKE_CATS_EN.indexOf(label.trim()); return lang === 'en' && i >= 0 ? LIKE_CATS[i] : label; };
const SECTIONS = {
  place: { en: 'Places', lead: () => tr('ふたりで過ごした場所を残す', 'Places we spent time together'),
    fields: () => [F.title(tr('場所の名前', 'Place'), tr('例：江ノ島の水族館', 'e.g. Enoshima Aquarium')), F.date(tr('行った日', 'Date visited')), F.body, F.geo, F.photo] },
  like: { en: 'Likes', lead: () => tr('相手の「好き」をメモしておく', 'Things they love'), fields: () => [
    { name: 'category', type: 'category', label: tr('種類', 'Type'), required: true, options: likeCats(), ph: tr('えらぶか、自由に書く', 'Pick one or type your own') },
    F.title(tr('好きなもの', 'What'), tr('例：抹茶ラテ', 'e.g. Matcha latte')), F.body, F.photo] },
  wish: { en: 'Wishes', lead: () => tr('いつか一緒に行きたいところ', 'Places we want to go someday'),
    fields: () => [F.title(tr('行きたいところ', 'Place'), tr('例：金沢の21世紀美術館', 'e.g. 21st Century Museum, Kanazawa')), { ...F.body, ph: tr('行きたい理由、やりたいこと', 'Why, and what we want to do there') }, F.geo, F.photo] },
  gift: { en: 'Gifts', lead: () => tr('贈ったもの・もらったもの', 'Gifts given and received'),
    fields: () => [F.title(tr('贈ったもの', 'Gift'), tr('例：手編みのマフラー', 'e.g. Hand-knit scarf')), F.date(tr('贈った日', 'Date given')), F.body, F.photo] },
  dislike: { en: 'Dislikes', lead: () => tr('相手の苦手なものを覚えておく', "Things they don't like"),
    fields: () => [F.title(tr('嫌いなもの', 'What'), tr('例：満員電車', 'e.g. Packed trains')), F.body] },
};
// 「その他」は自分で足した種類よりも後ろ、いちばん最後に並べる
const likeCats = () => [...new Set([...LIKE_CATS, ...data.entries.filter((e) => e.section === 'like' && e.category).map((e) => e.category)])]
  .filter((c) => c !== OTHER_CAT).concat(OTHER_CAT);
const fromLabel = (e) => (e.section === 'gift' ? tr(`${nameOf(e.author)}から`, `from ${nameOf(e.author)}`) : nameOf(e.author));
// なおす・消すのは書いた本人だけ（データベースの決まりと同じ）
const canEdit = (e) => !!e && e.author === me();

/* ---------- 曲：タップで聴く ----------
   Likes の「曲」は、曲名で Apple Music（iTunes）をさがして、30秒の試聴を流す。全曲を聴くときは各アプリで開く */
const SONG_CAT = '曲';
const isSong = (e) => e?.section === 'like' && e.category === SONG_CAT;
// iTunes の検索は JSONP で呼ぶ（ブラウザの CORS に左右されない）
function jsonp(url) {
  return new Promise((ok, ng) => {
    const cb = `__oo${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const s = h('script', { src: `${url}&callback=${cb}` });
    const done = () => { clearTimeout(t); delete window[cb]; s.remove(); };
    const t = setTimeout(() => { done(); ng(new Error('timeout')); }, 10000);
    window[cb] = (d) => { done(); ok(d); };
    s.onerror = () => { done(); ng(new Error('load')); };
    document.head.append(s);
  });
}
const toTrack = (r) => r && r.previewUrl && ({ id: r.trackId, name: r.trackName, artist: r.artistName, preview: r.previewUrl,
  art: (r.artworkUrl100 || '').replace(/\/\d+x\d+bb\./, '/600x600bb.'), url: r.trackViewUrl, from: 'Apple Music' });
const songQuery = (title) => title.replace(/[／/|｜\-–—「」『』"]/g, ' ').replace(/\s+/g, ' ').trim();
async function getJson(url, ms = 8000) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { signal: c.signal }); if (!r.ok) throw new Error(String(r.status)); return await r.json(); } finally { clearTimeout(t); }
}
// Apple Music（iTunes）：ふつうの読みこみ → だめなら JSONP
async function itunesSongs(q) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&country=jp&lang=ja_jp&media=music&entity=song&limit=8`;
  let j;
  try { j = await getJson(url); } catch { j = await jsonp(url); }
  return (j.results || []).map(toTrack).filter(Boolean);
}
// 予備：Deezer（こちらも30秒の試聴がある）
async function deezerSongs(q) {
  const j = await jsonp(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&output=jsonp&limit=8`);
  return (j.data || []).filter((d) => d.preview).map((d) => ({ id: `dz${d.id}`, name: d.title, artist: d.artist?.name || '', preview: d.preview,
    art: d.album?.cover_big || '', url: d.link, from: 'Deezer' }));
}
const songSearches = new Map();
function searchSongs(title) {
  const q = songQuery(title);
  if (!q) return Promise.resolve([]);
  if (!songSearches.has(q)) {
    songSearches.set(q, (async () => {
      let a = null, b = null;
      try { a = await itunesSongs(q); } catch { /* 予備へ */ }
      if (a?.length) return a;
      try { b = await deezerSongs(q); } catch { /* どちらもだめ */ }
      if (b?.length) return b;
      if (a || b) return [];
      throw new Error('search failed');
    })().catch((e) => { songSearches.delete(q); throw e; }));
  }
  return songSearches.get(q);
}
// その曲の Apple Music の候補（曲名でさがした結果）。「ちがう曲？」でえらんだ曲は端末に覚えておく
const songCache = new Map(), songDone = new Map();
const songKey = (e) => `${e.id}|${e.title}`;
function songFor(e) {
  const key = songKey(e);
  if (!songCache.has(key)) {
    songCache.set(key, searchSongs(e.title).then((tracks) => { songDone.set(key, tracks); return tracks; },
      (err) => { songCache.delete(key); throw err; }));
  }
  return songCache.get(key);
}
const PICK_KEY = 'our-odyssey-song-pick';
const songPick = (e) => { try { return JSON.parse(localStorage.getItem(PICK_KEY))?.[songKey(e)] || 0; } catch { return 0; } };
function setSongPick(e, i) {
  try { const m = JSON.parse(localStorage.getItem(PICK_KEY)) || {}; m[songKey(e)] = i; localStorage.setItem(PICK_KEY, JSON.stringify(m)); } catch { /* 覚えられなくても動く */ }
}
const pickedTrack = (e, tracks) => tracks[songPick(e)] || tracks[0];
// 試聴の音はひとつだけ鳴らす。鳴っている曲が変わったら、ボタンの見た目を合わせる
const audio = { el: null, key: null, subs: new Set() };
function audioEl() {
  if (!audio.el) {
    audio.el = new Audio();
    audio.el.preload = 'none';
    for (const ev of ['play', 'pause', 'ended', 'timeupdate', 'error']) audio.el.addEventListener(ev, () => audio.subs.forEach((f) => f()));
    audio.el.addEventListener('ended', () => { audio.key = null; });
  }
  return audio.el;
}
// iPhone は「タップした瞬間」に鳴らし始めないと音を出させてくれないので、曲をさがしている間は無音を流しておく
let silentUrl = '';
function silent() {
  if (silentUrl) return silentUrl;
  const n = 800, buf = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) buf.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); buf.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  buf.setUint32(16, 16, true); buf.setUint16(20, 1, true); buf.setUint16(22, 1, true); buf.setUint32(24, 8000, true);
  buf.setUint32(28, 16000, true); buf.setUint16(32, 2, true); buf.setUint16(34, 16, true); str(36, 'data'); buf.setUint32(40, n * 2, true);
  return (silentUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })));
}
function playTrack(key, track) {
  const el = audioEl();
  if (audio.key === key && !el.paused) { el.pause(); return; }
  if (audio.key !== key || el.src !== track.preview) { audio.key = key; el.src = track.preview; }
  el.play().catch(() => {});
  audio.subs.forEach((f) => f());
}
const isPlaying = (key) => audio.key === key && audio.el && !audio.el.paused;
// 画面から消えたボタンは見張りをやめる
function onAudio(node, f) {
  const sub = () => { if (!node.isConnected) { audio.subs.delete(sub); return; } f(); };
  audio.subs.add(sub);
  return sub;
}
const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z" fill="currentColor"/></svg>';
const svgIcon = (el, svg) => { el.innerHTML = svg; return el; };
// コルクボードのポラロイドに付ける小さな再生ボタン（タップでその場で試聴）
function songBadge(e) {
  const key = `like:${e.id}`;
  const b = h('span', { class: 'song-play', role: 'button', tabindex: '0', 'aria-label': tr(`「${e.title}」を聴く`, `Play "${e.title}"`) });
  const paint = () => { const on = isPlaying(key); b.classList.toggle('on', on); svgIcon(b, on ? PAUSE : PLAY); };
  onAudio(b, paint); paint();
  songFor(e).catch(() => {});   // 先にさがしておくと、タップしてすぐ鳴る
  const go = async (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    if (isPlaying(key)) { audio.el.pause(); return; }
    const el = audioEl();
    const ready = songDone.get(songKey(e));
    if (!ready) { audio.key = null; el.src = silent(); el.play().catch(() => {}); }
    b.classList.add('busy');
    try {
      const tracks = ready || await songFor(e);
      if (!tracks.length) { notice(tr('試聴できる曲が見つかりませんでした', 'No preview found'), { text: tr('曲名を「曲名 アーティスト名」にすると見つかりやすくなります。', 'Try "title artist" as the name.') }); return; }
      playTrack(key, pickedTrack(e, tracks));
    } catch { notice(tr('曲をさがせませんでした', "Couldn't look up the song")); }
    finally { b.classList.remove('busy'); }
  };
  b.addEventListener('click', go);
  b.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') go(ev); });
  return b;
}
const musicLinks = (q) => h('div', { class: 'song-links' },
  h('span', { class: 'muted' }, tr('全部聴く：', 'Full song:')),
  h('a', { class: 'chip', href: `https://open.spotify.com/search/${encodeURIComponent(q)}`, target: '_blank', rel: 'noopener' }, 'SPOTIFY'),
  h('a', { class: 'chip', href: `https://music.youtube.com/search?q=${encodeURIComponent(q)}`, target: '_blank', rel: 'noopener' }, 'YOUTUBE'));
// 詳細やカードに出すプレーヤー
function songPlayer(e) {
  const box = h('div', { class: 'song' });
  const key = `like:${e.id}`;
  let tracks = [], i = 0;
  const status = h('p', { class: 'muted' }, tr('曲をさがしています…', 'Looking up the song…'));
  box.append(status);
  const render = () => {
    const t = tracks[i];
    if (!t) {
      box.replaceChildren(h('p', { class: 'muted' }, tr('試聴できる曲が見つかりませんでした。曲名を「曲名 アーティスト名」にすると見つかりやすくなります。', 'No preview found. Try "title artist" as the name.')), musicLinks(songQuery(e.title)));
      return;
    }
    const btn = h('button', { type: 'button', class: 'song-btn', 'aria-label': tr('試聴', 'Preview'), onclick: () => playTrack(key, t) });
    const bar = h('i', {});
    const paint = () => {
      const on = isPlaying(key) && audio.el.src === t.preview;
      svgIcon(btn, on ? PAUSE : PLAY); btn.classList.toggle('on', on);
      const el = audio.el;
      bar.style.width = audio.key === key && el?.duration ? `${(el.currentTime / el.duration) * 100}%` : '0%';
    };
    onAudio(box, paint);
    const others = tracks.length > 1;
    box.replaceChildren(
      h('div', { class: 'song-main' },
        h('div', { class: 'song-art' }, t.art && h('img', { src: t.art, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }), btn),
        h('div', { class: 'song-txt' }, h('b', {}, t.name), h('small', {}, t.artist),
          h('span', { class: 'song-bar' }, bar), h('small', { class: 'song-note' }, tr(`${t.from} の30秒試聴`, `30-second ${t.from} preview`)))),
      h('div', { class: 'song-links' },
        others && h('button', { type: 'button', class: 'chip', onclick: () => { if (audio.key === key) { audio.el.pause(); audio.key = null; } i = (i + 1) % tracks.length; setSongPick(e, i); render(); } }, tr('ちがう曲？', 'NOT THIS ONE?')),
        t.url && h('a', { class: 'chip', href: t.url, target: '_blank', rel: 'noopener' }, t.from.toUpperCase()),
        h('a', { class: 'chip', href: `https://open.spotify.com/search/${encodeURIComponent(`${t.name} ${t.artist}`)}`, target: '_blank', rel: 'noopener' }, 'SPOTIFY'),
        h('a', { class: 'chip', href: `https://music.youtube.com/search?q=${encodeURIComponent(`${t.name} ${t.artist}`)}`, target: '_blank', rel: 'noopener' }, 'YOUTUBE')));
    paint();
  };
  songFor(e).then((r) => { tracks = r; i = Math.min(songPick(e), Math.max(0, r.length - 1)); render(); })
    .catch(() => { box.replaceChildren(h('p', { class: 'muted' }, tr('曲をさがせませんでした（電波を確かめてください）', "Couldn't look up the song (check your connection)")), musicLinks(songQuery(e.title))); });
  return box;
}
// 曲の写真の候補：ジャケット写真
async function songPhotos(q) {
  try { return (await searchSongs(q)).filter((t) => t.art).slice(0, 4).map((t) => ({ url: t.art, title: `${t.name} / ${t.artist}`, from: t.from })); } catch { return []; }
}

function talk(e, fresh = new Set()) {
  const list = data.comments.filter((c) => c.entry_id === e.id).sort(byCreated);
  const anyNew = list.some((c) => fresh.has(`c:${c.id}`));
  if (anyNew) openTalks.add(e.id);
  const input = h('input', { type: 'text', placeholder: tr('ひとこと書く', 'Write a comment'), 'aria-label': tr('ひとこと', 'Comment') });
  return h('details', { class: 'talk', open: openTalks.has(e.id), ontoggle: (ev) => { ev.target.open ? openTalks.add(e.id) : openTalks.delete(e.id); } },
    h('summary', {}, `COMMENTS (${list.length})`),
    list.map((c) => h('div', { class: 'c' }, h('span', {}, fresh.has(`c:${c.id}`) && h('i', { class: 'newinline' }, 'NEW!'), `${nameOf(c.author)}${tr('：', ': ')}${c.body}`),
      c.author === me() && h('button', { class: 'link', onclick: () => act(() => store.removeComment(c.id)) }, 'DELETE'))),
    h('form', { onsubmit: (ev) => { ev.preventDefault(); if (input.value.trim()) act(() => store.addComment(e.id, input.value.trim())); } },
      input, h('button', { class: 'btn small', type: 'submit' }, 'SEND')));
}
async function removeEntry(e) {
  if (!(await ask(tr('消しますか？', 'Delete this?'), { text: tr('元には戻せません。', "This can't be undone."), ok: 'DELETE', danger: true }))) return;
  act(async () => { await store.removeEntry(e.id); await store.removePhoto(e.photo); });
}
function entryCard(e, key) {
  const S = SECTIONS[key];
  const ok = canEdit(e);
  const meta = [e.date && dots(e.date), e.category && catLabel(e.category), fromLabel(e)].filter(Boolean).join(' ・ ');
  const edit = () => entryEdit(e);
  const addPhoto = async () => {
    const blob = await pickPhoto(); if (!blob) return;
    act(async () => store.saveEntry({ id: e.id, photo: await store.uploadPhoto(blob) }));
  };
  const went = () => entryWent(e);
  return newMark(h('article', { class: 'card' },
    e.photo && photoImg(e.photo),
    h('h2', {}, e.title), h('div', { class: 'meta' }, meta),
    e.body && h('p', {}, e.body),
    isSong(e) ? songPlayer(e) : null,
    h('div', { class: 'row' },
      key === 'wish' && h('button', { class: 'btn small', onclick: went }, 'BEEN THERE!'),
      ok && !e.photo && S.fields().some((f) => f.type === 'photo') && h('button', { class: 'btn ghost small', onclick: addPhoto }, 'ADD PHOTO'),
      ok && h('button', { class: 'link', onclick: edit }, 'EDIT'),
      ok && h('button', { class: 'link', onclick: () => removeEntry(e) }, 'DELETE')),
    talk(e)), entryNew(e));
}
function addEntry(key) {
  const S = SECTIONS[key];
  openForm({ title: 'Add', en: S.en, lead: S.lead(), fields: S.fields(), initial: key === 'like' && likeFilter ? { category: likeFilter } : {},
    onSubmit: (v) => store.saveEntry({ section: key, title: v.title, body: v.body || '', date: v.date || null, category: v.category || null, lat: v.lat ?? null, lng: v.lng ?? null, photo: v.photo || null }) });
}
function sectionPage(key) {
  const S = SECTIONS[key];
  if (!S) return morePage();
  let items = data.entries.filter((e) => e.section === key);
  items.sort((a, b) => ((b.date || b.created_at) < (a.date || a.created_at) ? -1 : 1));
  const add = () => addEntry(key);
  let chips = null;
  if (key === 'like') {
    const cats = likeCats();
    if (likeFilter && !cats.includes(likeFilter)) likeFilter = '';
    chips = h('div', { class: 'chips' }, ['', ...cats].map((c) =>
      h('button', { class: `chip${likeFilter === c ? ' on' : ''}`, onclick: () => { likeFilter = c; draw(); } }, c ? catLabel(c) : 'ALL')));
    if (likeFilter) items = items.filter((e) => e.category === likeFilter);
  }
  return h('div', {}, pageNav(true),
    pageHead(S.en, '', h('button', { class: 'btn', onclick: add }, '+ ADD')),
    chips,
    items.length ? h('div', { class: 'cards' }, items.map((e) => entryCard(e, key)))
      : h('p', { class: 'empty' }, tr('まだ何もありません。「+ ADD」から最初のひとつを。', 'Nothing here yet. Tap "+ ADD" to start.')));
}

/* ---------- ひとつの思い出の詳細（モーダル） ---------- */
const EN_OF = { place: 'Places', wish: 'Wishes', like: 'Likes', gift: 'Gifts', dislike: 'Dislikes' };
function entryEdit(e) {
  const S = SECTIONS[e.section];
  openForm({ title: 'Edit', en: S.en, fields: S.fields(), initial: e,
    onSubmit: (v) => store.saveEntry({ id: e.id, title: v.title, body: v.body, date: v.date, category: v.category, lat: v.lat, lng: v.lng, photo: v.photo }) });
}
function entryWent(e) {
  openForm({ title: 'Been there!', en: 'Places', lead: tr(`「${e.title}」に行った日を残す`, `When did we go to "${e.title}"?`), initial: { ...e, date: today() },
    fields: [F.date(tr('行った日', 'Date visited')), F.body, ...(e.lat == null ? [F.geo] : []), F.photo],
    onSubmit: (v) => store.saveEntry({ id: e.id, section: 'place', date: v.date, body: v.body, photo: v.photo, lat: v.lat ?? null, lng: v.lng ?? null }) });
}
function openDetail(id) {
  const dlg = h('dialog', { class: 'modal detail', 'aria-label': tr('詳細', 'Details') });
  // 開いた時点の NEW を覚えておいて、ひとことに印をつける。開いたら「見た」ことにする
  const fresh = new Set(entryNew(data.entries.find((x) => x.id === id)).map(([k]) => k));
  const render = () => {
    const e = data.entries.find((x) => x.id === id);
    if (!e) { closeDialog(dlg, true); return; }
    markSeenNow(entryNew(e));
    const ok = canEdit(e);
    const meta = [e.date && dots(e.date), e.category && catLabel(e.category), fromLabel(e)].filter(Boolean).join(' ・ ');
    dlg.replaceChildren(h('div', { class: 'sheet' },
      h('div', { class: 'mhead' },
        h('div', {}, EN_OF[e.section] && h('div', { class: `tag ${e.section}` }, EN_OF[e.section]), h('h2', { class: 'dtitle' }, e.title), h('p', { class: 'lead' }, meta)),
        h('button', { type: 'button', class: 'x', 'aria-label': 'Close', onclick: () => closeDialog(dlg) }, '×')),
      h('div', { class: 'mbody' },
        e.photo && photoImg(e.photo, 'dphoto'),
        e.body ? h('p', { class: 'dbody' }, e.body) : null,
        isSong(e) ? songPlayer(e) : null,
        e.section === 'wish' && h('button', { class: 'btn', onclick: () => entryWent(e) }, 'BEEN THERE! → PLACES'),
        ok && h('div', { class: 'row' },
          h('button', { class: 'btn ghost small', onclick: () => entryEdit(e) }, 'EDIT'),
          h('button', { class: 'link', onclick: () => removeEntry(e) }, 'DELETE')),
        talk(e, fresh))));
  };
  dlg.refresh = render;
  render();
  showDialog(dlg);
}

/* ---------- PLACES ＋ WISHES（地図） ---------- */
let mapFilter = 'all';
let mapView = null;
let addKind = 'place';
function pinIcon(L, e) {
  const el = h('div', { class: `pin ${e.section}${e.photo ? ' ph' : ''}` });
  if (e.photo) {
    const img = h('img', { alt: '' });
    el.append(img);
    store.photoUrl(e.photo).then((u) => { img.src = u; }).catch(() => {});
  }
  const box = h('div', { class: `pin-box${e.photo ? ' ph' : ''}` }, el, h('span', { class: 'pin-label' }, e.title));
  return e.photo
    ? L.divIcon({ html: box, className: 'pin-wrap', iconSize: [50, 58], iconAnchor: [25, 58] })
    : L.divIcon({ html: box, className: 'pin-wrap', iconSize: [24, 24], iconAnchor: [12, 12] });
}
// ピンをタップしたときの吹き出し。地図は動かさず、ピンの上に出す（上に入りきらないときは下に出す。ピンは隠さない）
function mapBubble(L, map, mapEl, topInset = () => 0) {
  const pop = h('div', { class: 'mpop-bubble', hidden: true, role: 'dialog' });
  mapEl.append(pop);
  L.DomEvent.disableClickPropagation(pop);
  L.DomEvent.disableScrollPropagation(pop);
  let cur = null;
  const place = () => {
    if (!cur) return;
    const { x: w, y: hgt } = map.getSize();
    const p = map.latLngToContainerPoint([cur.lat, cur.lng]);
    const bw = pop.offsetWidth, bh = pop.offsetHeight;
    const left = Math.min(Math.max(p.x - bw / 2, 10), w - bw - 10);
    const head = p.y - (cur.photo ? 64 : 18);   // ピンの頭の少し上
    const foot = p.y + (cur.photo ? 6 : 14);    // ピンの少し下
    const room = head - 11 - 8 - topInset(), roomBelow = hgt - foot - 11 - 8;
    const below = bh > room && roomBelow > room;
    pop.classList.toggle('below', below);
    pop.style.left = `${left}px`;
    pop.style.top = `${below ? foot : head}px`;
    pop.style.setProperty('--tail', `${Math.min(Math.max(p.x - left, 16), bw - 16)}px`);
  };
  const hide = () => { cur = null; pop.hidden = true; };
  const show = (e) => {
    if (cur?.id === e.id) { hide(); return; }
    cur = e;
    const wish = e.section === 'wish';
    const meta = [wish ? tr('行きたいところ', 'Want to go') : tr('過ごした場所', 'Been there'), e.date && dots(e.date), fromLabel(e)].filter(Boolean).join(' ・ ');
    pop.className = `mpop-bubble ${e.section}`;
    pop.replaceChildren(
      h('button', { type: 'button', class: 'mpop-x', 'aria-label': 'Close', onclick: hide }, '×'),
      h('div', { class: 'mpop-in' },
        e.photo && photoImg(e.photo, 'mpop-ph'),
        h('div', { class: 'mpop-txt' },
          h('small', {}, meta),
          h('b', {}, e.title),
          e.body ? h('p', {}, e.body)
            : h('p', { class: 'none' }, wish ? tr('行きたい理由はまだ書いてありません', 'No reason written yet') : tr('ひとことはまだありません', 'No note yet')))),
      h('button', { type: 'button', class: 'mpop-more', onclick: () => openDetail(e.id) }, 'DETAILS →'));
    pop.hidden = false;
    place();
    pop.classList.remove('pop-in'); void pop.offsetWidth; pop.classList.add('pop-in');
  };
  map.on('move zoom resize', place);
  map.on('click', hide);
  return { show, hide };
}
function mapPage() {
  const all = data.entries.filter((e) => e.section === 'place' || e.section === 'wish')
    .sort((a, b) => ((b.date || b.created_at) < (a.date || a.created_at) ? -1 : 1));
  const shownList = all.filter((e) => mapFilter === 'all' || e.section === mapFilter);
  const pts = shownList.filter((e) => e.lat != null);
  const count = (k) => all.filter((e) => e.section === k).length;
  const chips = h('div', { class: 'chips' }, [['all', `ALL ${all.length}`], ['place', `PLACES ${count('place')}`], ['wish', `WISHES ${count('wish')}`]].map(([k, label]) =>
    h('button', { class: `chip ${k}${mapFilter === k ? ' on' : ''}`, onclick: () => { mapFilter = k; draw(); } }, label)));

  const mapEl = h('div', { class: 'map big-map' });
  // 見出しとALL/PLACES/WISHESの行の裏にも地図を出すが、そこは見るだけ（触るとページのスクロール）。
  // shield がその帯を覆って、地図に指が届かないようにしている
  const shield = h('div', { class: 'places-shield', 'aria-hidden': 'true' });
  const topInset = () => shield.offsetHeight;
  // 地図の下端は凡例の行の裏まで伸ばし、その文字の高さでぼかす（凡例の上は触ってもページのスクロール）
  const legend = h('p', { class: 'legend' },
    h('span', { class: 'lgi' }, h('span', { class: 'lg place' }), tr('過ごした場所', 'Been there')),
    h('span', { class: 'lgi' }, h('span', { class: 'lg wish' }), tr('行きたいところ', 'Want to go')),
    h('span', { class: 'lgi' }, tr('・ピンをタップでひとこと', '・Tap a pin to peek')));
  const botInset = () => legend.offsetHeight;
  const head = pageHead('Places', '');
  // 地図のぼかしは、見出しの文字の高さの半分あたりから始める（終わりはALL/PLACES/WISHESの行の下）
  const fadeStart = () => {
    const t = head.querySelector('h1');
    if (!t || !mapEl.isConnected) return 0;
    const a = t.getBoundingClientRect(), b = mapEl.getBoundingClientRect();
    return Math.max(0, Math.round(a.top + a.height / 2 - b.top));
  };
  const syncInset = () => {
    mapEl.style.setProperty('--inset', `${topInset()}px`); mapEl.style.setProperty('--leg', `${botInset()}px`);
    mapEl.style.setProperty('--fstart', `${fadeStart()}px`);
  };
  leaflet().then((L) => {
    const map = L.map(mapEl, { zoomControl: false, maxBoundsViscosity: 1 });
    const refit = limitMap(L, map, mapEl);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer(TILE, { attribution: ATTR, maxZoom: 19 }).addTo(map);
    syncInset();
    map.on('resize', syncInset);
    const bubble = mapBubble(L, map, mapEl, topInset);
    for (const e of pts) L.marker([e.lat, e.lng], { icon: pinIcon(L, e), title: e.title, keyboard: true }).addTo(map).on('click', () => bubble.show(e));
    const fit = { paddingTopLeft: [40, topInset() + 40], paddingBottomRight: [40, botInset() + 40] };
    if (mapView) map.setView(mapView.c, mapView.z);
    else if (pts.length === 1) map.fitBounds([[pts[0].lat, pts[0].lng], [pts[0].lat, pts[0].lng]], { ...fit, maxZoom: 13 });
    else if (pts.length) map.fitBounds(pts.map((e) => [e.lat, e.lng]), { ...fit, maxZoom: 14 });
    else map.setView([36.2, 138.2], 5);
    map.on('moveend', () => { mapView = { c: map.getCenter(), z: map.getZoom() }; });
    // 日本全体が見えるくらい引いたときは、名前が重なるので出さない
    const labels = () => mapEl.classList.toggle('labels-off', map.getZoom() < 7);
    map.on('zoomend', labels); labels();
    // 見出しのフォントが後から読みこまれるなどして地図の大きさが変わったら、すぐに測り直す（地図は動かさない）。
    // 放っておくと、スマホで最初に触ったときの画面サイズの通知でまとめて測り直され、地図がずれて見える
    let lastSize = '';
    const fitSize = () => {
      const key = `${mapEl.clientWidth}x${mapEl.clientHeight}`;
      if (key === lastSize || !mapEl.clientWidth) return;
      lastSize = key;
      map.invalidateSize({ pan: false });
      refit();
      syncInset();
    };
    if ('ResizeObserver' in window) new ResizeObserver(fitSize).observe(mapEl);
    setTimeout(fitSize, 380);
  }).catch(() => { mapEl.textContent = tr('地図を読みこめませんでした。', "Couldn't load the map."); });

  const row = (e) => newMark(h('button', { class: 'lrow', type: 'button', onclick: () => openDetail(e.id) },
    e.photo ? photoImg(e.photo, 'lthumb') : h('span', { class: `lthumb dot ${e.section}` }),
    h('span', { class: 'ltext' }, h('b', {}, e.title),
      h('small', {}, [e.section === 'place' ? 'PLACES' : 'WISHES', e.date && dots(e.date), e.lat == null && tr('地図なし', 'no pin')].filter(Boolean).join(' ・ '))),
    h('span', { 'aria-hidden': 'true' }, '›')), entryNew(e));

  const addBox = h('div', { class: 'addbox mcard' });
  const renderAdd = () => {
    const S = SECTIONS[addKind];
    const form = inlineForm({ fields: S.fields(),
      onSubmit: (v) => store.saveEntry({ section: addKind, title: v.title, body: v.body || '', date: v.date || null, category: null, lat: v.lat ?? null, lng: v.lng ?? null, photo: v.photo || null }) });
    addBox.replaceChildren(
      h('div', { class: 'seg', role: 'group', 'aria-label': tr('追加する種類', 'What to add') }, [['place', 'PLACES'], ['wish', 'WISHES']].map(([k, label]) =>
        h('button', { type: 'button', class: `${k}${addKind === k ? ' on' : ''}`, 'aria-pressed': String(addKind === k), onclick: () => { addKind = k; renderAdd(); } }, label))),
      h('p', { class: 'muted' }, S.lead()), form);
  };
  renderAdd();

  return h('div', {}, pageNav(),
    h('div', { class: 'places-top' }, head, chips, mapEl, shield, h('div', { class: 'places-spacer' }), legend),
    shownList.length ? h('div', { class: 'list' }, shownList.map(row)) : h('p', { class: 'empty' }, tr('まだ何もありません。下から最初のひとつを。', 'Nothing here yet. Add the first one below.')),
    h('section', { class: 'madd', id: 'place-add' },
      h('h2', { class: 'en madd-title' }, 'Add'), h('p', { class: 'jp' }, tr('場所を追加', 'Add a place')), addBox));
}

/* ---------- その他（その場で開く） ---------- */
const MORE = [
  { key: 'like', en: 'Likes', jp: '好きなもの', sub: 'Things they love' },
  { key: 'gift', en: 'Gifts', jp: '贈ったもの', sub: 'Given & received' },
  { key: 'values', en: 'Values', jp: '価値観', sub: 'What we think' },
  { key: 'dislike', en: 'Dislikes', jp: '嫌いなもの', sub: 'Not for them' },
  { key: 'anniv', en: 'Days', jp: '記念日', sub: 'Anniversaries' },
  { key: 'settings', en: 'Settings', jp: '設定', sub: '', link: true },
];
const MORE_PAGES = { like: () => sectionPage('like'), gift: () => sectionPage('gift'), dislike: () => sectionPage('dislike'),
  values: valuesPage, anniv: annivPage, settings: settingsPage };
const moreOpen = new Set();
const GEAR = '<svg viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M19.96 10.02 L22.89 10.45 L22.89 13.55 L19.96 13.98 L19.03 16.23 L20.80 18.60 L18.60 20.80 L16.23 19.03 L13.98 19.96 L13.55 22.89 L10.45 22.89 L10.02 19.96 L7.77 19.03 L5.40 20.80 L3.20 18.60 L4.97 16.23 L4.04 13.98 L1.11 13.55 L1.11 10.45 L4.04 10.02 L4.97 7.77 L3.20 5.40 L5.40 3.20 L7.77 4.97 L10.02 4.04 L10.45 1.11 L13.55 1.11 L13.98 4.04 L16.23 4.97 L18.60 3.20 L20.80 5.40 L19.03 7.77Z M15.6 12a3.6 3.6 0 1 0-7.2 0a3.6 3.6 0 1 0 7.2 0Z"/></svg>';
const gearIcon = () => { const i = h('span', { class: 'gear', 'aria-hidden': 'true' }); i.innerHTML = GEAR; return i; };
function annivLines() {
  const t = today();
  const nm = nextMonthly(CONFIG.START_DATE, t);
  const lines = [{ title: tr(`${spanLabel(nm.months)}の記念日`, `${spanLabel(nm.months)} anniversary`), left: daysBetween(t, nm.date), date: nm.date }];
  for (const e of data.entries.filter((x) => x.section === 'anniversary' && x.date)) {
    const n = daysBetween(t, e.date);
    if (n >= 0) lines.push({ title: e.title, left: n, date: e.date, entry: e });
    else { const ny = nextYearly(e.date, t); lines.push({ title: tr(`${e.title}（${ny.years}年）`, `${e.title} (${plural(ny.years, 'year')})`), left: daysBetween(t, ny.date), date: ny.date, entry: e }); }
  }
  return lines.sort((a, b) => a.left - b.left);
}
/* MORE はぜんぶコルクボード（開くと全部を貼る）：ポラロイド（写真あり）とメモ（写真なし）を画鋲で留める。
   大きさ・傾き・ずれ・浮き具合は項目ごとに id から決めるので、開くたびに変わらない */
function seeded(str) {
  let x = 2166136261;
  for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); }
  return () => { x = Math.imul(x ^ (x >>> 15), 2246822507); x = Math.imul(x ^ (x >>> 13), 3266489909); x ^= x >>> 16; return (x >>> 0) / 4294967296; };
}
// cards: { seed, title, sub, onclick, photo?, big?, cls? }
function corkBoard(cards) {
  const between = (r, a, b) => a + (b - a) * r();
  return h('div', { class: 'cork-board' }, h('div', { class: 'cork' }, h('div', { class: 'cork-grid' }, cards.map((c) => {
    const r = seeded(String(c.seed));
    const style = `--s:${between(r, .88, 1.06).toFixed(3)};--r:${between(r, -4, 4).toFixed(2)}deg;--x:${between(r, -3, 4).toFixed(1)}px;--y:${between(r, -3, 10).toFixed(1)}px;--z:${between(r, 1, 3).toFixed(2)}`;
    const pin = h('img', { class: 'tack', src: `assets/pin-${r() < .5 ? 'pink' : 'navy'}.webp`, alt: '' });
    return newMark(h('button', { class: ['pol', !c.photo && 'memo', c.cls].filter(Boolean).join(' '), type: 'button', style, onclick: c.onclick },
      pin, c.photo ? h('span', { class: 'pim' }, photoImg(c.photo, ''), c.badge || null) : null, c.big || null, h('b', {}, c.title), h('small', {}, c.sub),
      !c.photo && c.badge ? c.badge : null), c.fresh);
  }))));
}
const MORE_SECTIONS = { like: ['like'], gift: ['gift'], values: ['value'], dislike: ['dislike'], anniv: ['anniversary'] };
function morePreview(key) {
  const go = (k) => { location.hash = `#/more/${k}`; };
  const board = (n, cards, add) => ({ n, items: cards.length ? [corkBoard(cards)] : [], add });
  if (key === 'values') {
    const all = data.entries.filter((e) => e.section === 'value');
    const topics = [...new Set(all.map((e) => e.title))];
    return board(topics.length, [...topics].reverse().map((tp) => {
      const both = new Set(all.filter((e) => e.title === tp).map((e) => e.author)).size >= 2;
      return { seed: `value:${tp}`, title: tp, fresh: all.filter((e) => e.title === tp).flatMap(entryNew), sub: both ? tr('ふたりとも答えた', 'Both answered') : tr('まだ片方だけ', 'One answer so far'), onclick: () => go('values') };
    }), () => writeValue());
  }
  if (key === 'anniv') {
    const lines = annivLines();
    return board(lines.length, lines.map((l) => ({
      seed: `anniv:${l.title}:${l.date}`, cls: 'days', title: l.title, sub: md(l.date), onclick: () => go('anniv'), fresh: entryNew(l.entry),
      big: h('span', { class: 'big' }, l.left === 0 ? 'TODAY' : String(l.left), l.left === 0 ? null : h('i', {}, l.left === 1 ? 'DAY' : 'DAYS')),
    })), addAnniv);
  }
  const items = data.entries.filter((e) => e.section === key).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return board(items.length, items.map((e) => ({
    seed: e.id, photo: e.photo, title: e.title, onclick: () => openDetail(e.id), fresh: entryNew(e), badge: isSong(e) ? songBadge(e) : null,
    sub: [e.category && catLabel(e.category), e.section === 'gift' ? fromLabel(e) : nameOf(e.author)].filter(Boolean).join('・'),
  })), () => addEntry(key));
}
function morePage() {
  return h('div', {}, pageNav(), pageHead('More', ''),
    h('ul', { class: 'acc' }, MORE.map((m) => {
      const sub = tr(m.jp, m.sub);
      if (m.link) {
        return h('li', {}, h('a', { class: 'acc-head', href: `#/more/${m.key}` },
          h('span', { class: 'en' }, m.en), h('span', { class: 'jp' }, sub), h('span', { class: 'chev', 'aria-hidden': 'true' }, '→')));
      }
      const p = morePreview(m.key);
      const open = moreOpen.has(m.key);
      const li = h('li', { class: open ? 'open' : '' });
      const head = h('button', { class: 'acc-head', type: 'button', 'aria-expanded': String(open), onclick: () => {
        const now = !li.classList.contains('open');
        li.classList.toggle('open', now); head.setAttribute('aria-expanded', String(now));
        if (now) moreOpen.add(m.key); else moreOpen.delete(m.key);
      } }, h('span', { class: 'en' }, m.en), h('span', { class: 'jp' }, `${sub}・${p.n}`, MORE_SECTIONS[m.key] && sectionNew(MORE_SECTIONS[m.key]) ? h('span', { class: 'newchip' }, 'NEW') : null), gearIcon());
      li.append(head, h('div', { class: 'acc-panel' }, h('div', { class: 'acc-inner' },
        p.items.length ? p.items : h('p', { class: 'muted' }, tr('まだ何もありません。', 'Nothing here yet.')),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', type: 'button', onclick: p.add }, '+ ADD'),
          h('a', { class: 'btn ghost small acc-all', href: `#/more/${m.key}` }, `VIEW ALL (${p.n})`)))));
      return li;
    })));
}

/* ---------- 価値観 ---------- */
function valuesPage() {
  const all = data.entries.filter((e) => e.section === 'value').sort(byCreated);
  const topics = [...new Set(all.map((e) => e.title))];
  const p = partner();
  const write = writeValue;
  return valuesView(all, topics, p, write);
}
function writeValue(topic, mine) {
  openForm({ title: topic ? 'My answer' : 'New topic', en: 'Values',
    lead: topic ? tr('このお題への自分の考え', 'What you think about this topic') : tr('ふたりで答えたいお題と、自分の答え', 'A topic for both of us, and your answer'),
    fields: [{ ...F.title(tr('お題', 'Topic'), tr('例：理想の休日の過ごし方', 'e.g. Our ideal day off')), readonly: !!topic },
      { name: 'body', type: 'textarea', label: tr('自分の考え', 'Your answer'), required: true, ph: tr('思っていることをそのまま', 'Just say what you think') }],
    initial: mine || { title: topic || '' },
    onSubmit: (v) => (mine ? store.saveEntry({ id: mine.id, body: v.body }) : store.saveEntry({ section: 'value', title: v.title.trim(), body: v.body })) });
}
function valuesView(all, topics, p, write) {
  const side = (who, e, topic, isMe) => h('div', {},
    h('div', { class: 'who' }, who),
    e ? h('p', {}, e.body) : h('p', { class: 'muted' }, isMe ? tr('まだ書いていません', 'Not written yet') : tr('まだ書いていないみたい', 'No answer yet')),
    isMe && (e
      ? h('div', { class: 'row' }, h('button', { class: 'link', onclick: () => write(topic, e) }, 'EDIT'),
        h('button', { class: 'link', onclick: () => removeEntry(e) }, 'DELETE'))
      : h('button', { class: 'btn small', onclick: () => write(topic) }, 'WRITE')));
  return h('div', {}, pageNav(true),
    pageHead('Values', '', h('button', { class: 'btn', onclick: () => write() }, '+ ADD TOPIC')),
    topics.length ? h('div', { class: 'cards' }, topics.map((t) => {
      const mine = all.find((e) => e.title === t && e.author === me());
      const theirs = all.find((e) => e.title === t && e.author !== me());
      return h('article', { class: 'card' }, h('h2', {}, t),
        h('div', { class: 'pair' }, side(nameOf(me()), mine, t, true), side(p ? nameOf(p.id) : tr('あいて', 'Partner'), theirs, t, false)));
    })) : h('p', { class: 'empty' }, tr('お題を足して、ふたりの答えを並べてみよう。', 'Add a topic and line up both of your answers.')));
}

/* ---------- 記念日 ---------- */
function addAnniv() {
  openForm({ title: 'New day', en: 'Days', lead: tr('毎年その日に数えて、当日の朝に通知します', "Counted every year, with a notification that morning"), fields: annivFields(),
    onSubmit: (v) => store.saveEntry({ section: 'anniversary', title: v.title, date: v.date }) });
}
function annivPage() {
  const t = today();
  const custom = data.entries.filter((e) => e.section === 'anniversary' && e.date).sort((a, b) => (a.date < b.date ? -1 : 1));
  const block = (title, date, e) => {
    const n = daysBetween(date, t);
    const ny = nextYearly(date, t);
    const lines = [];
    const hund = (Math.floor(n / 100) + 1) * 100;
    if (n < 0) lines.push(tr(`${md(date)}まで、あと${-n}日。`, `${plural(-n, 'day')} until ${md(date)}.`));
    else {
      if (!e) {
        const nm = nextMonthly(date, t), left = daysBetween(t, nm.date);
        lines.push(nm.date === t ? tr(`今日は ${spanLabel(nm.months)} の記念日！`, `Today is our ${spanLabel(nm.months)} anniversary!`)
          : tr(`つぎは ${spanLabel(nm.months)}（${md(nm.date)}）まで、あと${left}日。`, `${plural(left, 'day')} until ${spanLabel(nm.months)} (${md(nm.date)}).`));
      } else {
        const left = daysBetween(t, ny.date);
        lines.push(ny.date === t && ny.years > 0 ? tr(`今日でちょうど ${ny.years}年！`, `Exactly ${plural(ny.years, 'year')} today!`)
          : tr(`つぎは ${ny.years}年（${md(ny.date)}）まで、あと${left}日。`, `${plural(left, 'day')} until ${plural(ny.years, 'year')} (${md(ny.date)}).`));
      }
      lines.push(tr(`${hund}日まで、あと${hund - n}日。`, `${plural(hund - n, 'day')} until day ${hund}.`));
    }
    return h('article', { class: 'card' },
      h('h2', {}, title), h('div', { class: 'meta' }, dots(date)),
      n >= 0 && h('div', { class: 'count' }, String(n), h('small', {}, tr('日', 'days'))),
      lines.map((l) => h('p', {}, l)),
      canEdit(e) && h('div', { class: 'row' },
        h('button', { class: 'link', onclick: () => openForm({ title: 'Edit', en: 'Days', fields: annivFields(), initial: e,
          onSubmit: (v) => store.saveEntry({ id: e.id, title: v.title, date: v.date }) }) }, 'EDIT'),
        h('button', { class: 'link', onclick: () => removeEntry(e) }, 'DELETE')));
  };
  const add = addAnniv;
  return h('div', {}, pageNav(true),
    pageHead('Days', '', h('button', { class: 'btn', onclick: add }, '+ ADD DAY')),
    h('div', { class: 'cards' }, block(tr('付き合いはじめた日', 'The day we started dating'), CONFIG.START_DATE), custom.map((e) => block(e.title, e.date, e))));
}
function annivFields() {
  return [F.title(tr('なんの日？', 'What day?'), tr('例：はじめて旅行した日', 'e.g. Our first trip')), { ...F.date(), required: true }];
}

/* ---------- メンタルの記録 ---------- */
const levelShort = () => tr(['とてもつらい', 'つらい', 'ふつう', 'いい', 'とてもいい'], ['Very bad', 'Bad', 'Okay', 'Good', 'Very good']);
const dow = () => tr(['日', '月', '火', '水', '木', '金', '土'], WEEK);
let moodSel = null;
let moodPop = null;     // 吹き出しを出している日
let moodScale = 14;     // 1日あたりの幅（px）。ピンチや ＋− で変わる
let moodAnimated = false;

// 点をなめらかに結ぶ線。点と点のあいだで行きすぎない（ありもしない山や谷を作らない）曲線にする。
function smoothPath(P) {
  const n = P.length;
  if (n < 2) return '';
  const r1 = (v) => Math.round(v * 10) / 10;
  const dx = [], d = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = Math.max(1e-6, P[i + 1][0] - P[i][0]); d[i] = (P[i + 1][1] - P[i][1]) / dx[i]; }
  const m = new Array(n);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], q = a * a + b * b;
    if (q > 9) { const k = 3 / Math.sqrt(q); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
  }
  let out = `M${r1(P[0][0])},${r1(P[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const t3 = dx[i] / 3;
    out += ` C${r1(P[i][0] + t3)},${r1(P[i][1] + m[i] * t3)} ${r1(P[i + 1][0] - t3)},${r1(P[i + 1][1] - m[i + 1] * t3)} ${r1(P[i + 1][0])},${r1(P[i + 1][1])}`;
  }
  return out;
}
const spanText = (days) => {
  if (lang === 'en') {
    if (days < 11) return `~${plural(Math.round(days), 'day')}`;
    if (days < 45) return `~${plural(Math.round(days / 7), 'week')}`;
    if (days < 330) return `~${plural(Math.round(days / 30.4), 'month')}`;
    return `~${Math.round(days / 365 * 10) / 10} yrs`;
  }
  if (days < 11) return `${Math.round(days)}日くらい`;
  if (days < 45) return `${Math.round(days / 7)}週間くらい`;
  if (days < 330) return `${Math.round(days / 30.4)}か月くらい`;
  return `${Math.round(days / 365 * 10) / 10}年くらい`;
};

// 横にスクロールする気分の線。2本指で広げる・縮めると、1日の幅が変わる。
function moodChart(list, onEdit) {
  const t = today();
  const H = 300, TOP = 40, BASE = 240, PADL = 56, PADR = 32, MIN_SPAN = 30, MAX_DAY = 60;
  const yOf = (lv) => BASE - 22 - ((lv - 1) / 4) * (BASE - 22 - TOP);
  const end = addDays(t, 3);
  const firstRec = list.length ? list[0].date : t;
  const baseStart = addDays(firstRec < addDays(t, -MIN_SPAN) ? firstRec : addDays(t, -MIN_SPAN), -3);
  let DAY = moodScale, start = baseStart, W = 0, cw = 0;
  const x = (d) => PADL + daysBetween(start, d) * DAY;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'mchart'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', tr('気分の移り変わり', 'Mood over time'));
  const pop = h('div', { class: 'mpop', hidden: true });
  const canvas = h('div', { class: 'mcanvas' }, svg, pop);
  const scroller = h('div', { class: 'mscroll' }, canvas);
  const spanLabelEl = h('span', { class: 'mspan' });
  const yax = h('div', { class: 'myax', 'aria-hidden': 'true' },
    [5, 4, 3, 2, 1].map((lv) => h('span', { style: `top:${yOf(lv)}px` }, levels()[lv - 1])));

  const minDay = () => {
    const room = Math.max(200, (cw || 360) - PADL - PADR);
    return Math.min(14, Math.max(0.8, room / Math.max(1, daysBetween(baseStart, end))));
  };
  const clampDay = (v) => Math.min(MAX_DAY, Math.max(minDay(), v));

  function render() {
    cw = scroller.clientWidth || cw || 360;
    DAY = moodScale = clampDay(DAY);
    const fit = Math.ceil((cw - PADL - PADR) / DAY);
    start = daysBetween(baseStart, end) < fit ? addDays(end, -fit) : baseStart;
    W = Math.round(PADL + PADR + daysBetween(start, end) * DAY);
    const animate = !moodAnimated && !reduceMotion() && list.length > 1;
    let s = '<defs><linearGradient id="mood-fill" x1="0" y1="0" x2="0" y2="1">'
      + `<stop offset="0" stop-color="${TH.pinkD}" stop-opacity=".85"/><stop offset="1" stop-color="${TH.pinkD}" stop-opacity=".12"/></linearGradient></defs>`;

    // 月ごとの帯と、月の名前
    let { y: yy, m: mm } = parse(start);
    for (let guard = 0; guard < 400; guard++) {
      const ms = ymd(yy, mm, 1);
      if (ms > end) break;
      const ny = mm === 12 ? yy + 1 : yy, nm = mm === 12 ? 1 : mm + 1;
      const x0 = Math.max(0, x(ms)), x1 = Math.min(W, x(ymd(ny, nm, 1)));
      if ((yy * 12 + mm) % 2 === 0) s += `<rect x="${x0}" y="0" width="${Math.max(0, x1 - x0)}" height="${BASE}" fill="${TH.navy}" fill-opacity=".045"/>`;
      if (ms >= start) s += `<line x1="${x(ms)}" x2="${x(ms)}" y1="0" y2="${BASE}" stroke="${TH.navy}" stroke-opacity=".25" stroke-width="1"/>`;
      const lx = Math.max(x0, ms >= start ? x0 : PADL) + 7;
      if (x1 - lx > 34) s += `<text x="${lx}" y="22" class="mon">${MONTHS[mm - 1]}${mm === 1 || guard === 0 ? `<tspan class="yr" dx="5">${yy}</tspan>` : ''}</text>`;
      yy = ny; mm = nm;
    }
    // 気分の高さの目安線
    for (let lv = 1; lv <= 5; lv++) {
      s += `<line x1="0" x2="${W}" y1="${yOf(lv)}" y2="${yOf(lv)}" stroke="${TH.navy}" stroke-opacity="${lv === 3 ? '.3' : '.16'}" stroke-width="1" stroke-dasharray="2 5"/>`;
    }
    // 線と、その下の塗り
    const P = list.map((m) => [x(m.date), yOf(m.level)]);
    const line = smoothPath(P);
    if (line) {
      s += `<path class="area${animate ? ' draw' : ''}" d="${line} L${P[P.length - 1][0]},${BASE} L${P[0][0]},${BASE} Z" fill="url(#mood-fill)"/>`
        + `<path class="line${animate ? ' draw' : ''}" pathLength="1" d="${line}" fill="none" stroke="${TH.navy}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    // 下の軸と日付
    s += `<line x1="0" x2="${W}" y1="${BASE}" y2="${BASE}" stroke="${TH.navy}" stroke-width="2"/>`;
    const step = [1, 2, 7, 14].find((k) => k * DAY >= 42);
    const LABEL_DAYS = { 1: null, 2: null, 7: [1, 8, 15, 22], 14: [1, 15] };
    for (let d = start, i = 0; d <= end && i < 2000; d = addDays(d, 1), i++) {
      const px = x(d), { m: dm, d: dd } = parse(d);
      if (DAY >= 6) s += `<line x1="${px}" x2="${px}" y1="${BASE}" y2="${BASE + 5}" stroke="${TH.navy}" stroke-opacity=".5" stroke-width="1"/>`;
      if (!step) continue;
      const show = step === 1 || (step === 2 ? dd % 2 === 1 && dd < 31 : LABEL_DAYS[step].includes(dd));
      if (show) s += `<text x="${px}" y="${BASE + 22}" text-anchor="middle" class="tick">${step >= 7 || dd === 1 ? `${dm}/${dd}` : dd}</text>`;
    }
    const tx = x(t);
    s += `<line x1="${tx}" x2="${tx}" y1="${TOP - 26}" y2="${BASE + 30}" stroke="${TH.navy}" stroke-width="1.5" stroke-dasharray="4 4"/>`
      + `<rect x="${tx - 26}" y="${BASE + 31}" width="52" height="20" rx="10" fill="${TH.navy}"/>`
      + `<text x="${tx}" y="${BASE + 46}" text-anchor="middle" class="tick now">TODAY</text>`;
    // 点（メモがある日は中に小さな印）
    for (const m of list) {
      const on = m.date === moodPop, cx = x(m.date), cy = yOf(m.level);
      s += `<g class="pt${on ? ' on' : ''}" data-date="${m.date}" role="button" tabindex="0" aria-label="${dots(m.date)} ${levelShort()[m.level - 1]}${m.note ? tr('（メモあり）', ' (with note)') : ''}">`
        + `<line x1="${cx}" x2="${cx}" y1="${BASE}" y2="${BASE + 9}" stroke="${TH.navy}" stroke-width="2"/>`
        + `<circle cx="${cx}" cy="${cy}" r="20" fill="transparent"/>`
        + `<circle cx="${cx}" cy="${cy}" r="${on ? 9 : 7}" fill="${on ? '${TH.navy}' : '${TH.paper}'}" stroke="${TH.navy}" stroke-width="2.5"/>`
        + (m.note ? `<circle cx="${cx}" cy="${cy}" r="2.4" fill="${on ? '${TH.pink}' : '${TH.navy}'}"/>` : '')
        + '</g>';
    }
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', W); svg.setAttribute('height', H);
    svg.innerHTML = s;
    canvas.style.width = `${W}px`;
    if (animate) moodAnimated = true;
    spanLabelEl.textContent = spanText((cw - PADL - PADR) / DAY);
    placePop();
  }

  // 吹き出し
  function fillPop() {
    const m = list.find((r) => r.date === moodPop);
    if (!m) return;
    const { y: py, m: pm, d: pd } = parse(m.date);
    const editBtn = h('button', { type: 'button', class: 'mpop-edit', onclick: (ev) => { ev.stopPropagation(); onEdit(m.date); } },
      'EDIT', h('span', { 'aria-hidden': 'true' }, '↓'));
    pop.replaceChildren(
      h('div', { class: 'mpop-head' },
        h('span', { class: 'mpop-d' }, `${py === parse(t).y ? '' : `${py}.`}${pm}.${pd}`, h('small', {}, dow()[new Date(utc(m.date)).getUTCDay()])),
        h('span', { class: 'mpop-lv' }, levelShort()[m.level - 1])),
      h('p', { class: m.note ? 'mpop-note' : 'mpop-note none' }, m.note || tr('メモはありません', 'No note')),
      h('div', { class: 'mpop-foot' }, editBtn));
    pop.setAttribute('aria-label', tr(`${md(m.date)}の記録`, `Entry for ${md(m.date)}`));
  }
  function placePop() {
    const m = moodPop && list.find((r) => r.date === moodPop);
    if (!m) { pop.hidden = true; return; }
    pop.hidden = false;
    const px = x(m.date), py = yOf(m.level);
    const w = pop.offsetWidth, ph = pop.offsetHeight, GAP = 18;
    // 点が見えているあいだは、吹き出しも画面の中に収める
    const sl = scroller.scrollLeft, vis = px >= sl && px <= sl + cw;
    let left = px - w / 2;
    if (vis) left = Math.min(Math.max(left, sl + 8), sl + cw - w - 8);
    left = Math.round(Math.min(Math.max(left, 8), W - w - 8));
    const above = py - GAP - ph >= 2 ? true : py + GAP + ph <= H - 2 ? false : py > H / 2;
    pop.style.left = `${left}px`;
    pop.style.top = `${Math.round(above ? py - GAP - ph : py + GAP)}px`;
    pop.style.setProperty('--tail', `${Math.min(w - 18, Math.max(18, px - left))}px`);
    pop.classList.toggle('below', !above);
  }
  function openPop(date) {
    moodPop = moodPop === date ? null : date;
    fillPop(); render();
    if (!moodPop) return;
    const l = parseFloat(pop.style.left), w = pop.offsetWidth, sl = scroller.scrollLeft;
    if (l < sl + PADL) scroller.scrollTo({ left: l - PADL, behavior: 'smooth' });
    else if (l + w > sl + cw - 8) scroller.scrollTo({ left: l + w - cw + 8, behavior: 'smooth' });
  }
  svg.addEventListener('click', (ev) => {
    const g = ev.target.closest('.pt');
    if (g) openPop(g.dataset.date);
    else if (moodPop) { moodPop = null; render(); }
  });
  scroller.addEventListener('scroll', () => { if (moodPop) placePop(); }, { passive: true });
  svg.addEventListener('keydown', (ev) => { const g = ev.target.closest('.pt'); if (g && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); openPop(g.dataset.date); } });

  // 伸び縮み。指のあいだ（またはボタンなら真ん中）の日付をその場に止めたまま、1日の幅を変える。
  let pending = null, raf = 0;
  const anchorAt = (px) => (scroller.scrollLeft + px - x(end)) / DAY;
  function zoomTo(day, anchor, px) {
    pending = { day, anchor, px };
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const p = pending; pending = null;
      DAY = clampDay(p.day); render();
      scroller.scrollLeft = x(end) + p.anchor * DAY - p.px;
    });
  }
  const zoomBy = (k) => { const px = cw / 2; zoomTo(DAY * k, anchorAt(px), px); };
  let pinch = null;
  const gap2 = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  const midX = (a, b) => (a.clientX + b.clientX) / 2 - scroller.getBoundingClientRect().left;
  scroller.addEventListener('touchstart', (ev) => {
    if (ev.touches.length !== 2) return;
    const [a, b] = ev.touches;
    const px = midX(a, b);
    pinch = { d0: Math.max(10, gap2(a, b)), s0: DAY, anchor: anchorAt(px) };
  }, { passive: true });
  scroller.addEventListener('touchmove', (ev) => {
    if (!pinch || ev.touches.length !== 2) return;
    if (ev.cancelable) ev.preventDefault();
    const [a, b] = ev.touches;
    zoomTo(pinch.s0 * gap2(a, b) / pinch.d0, pinch.anchor, midX(a, b));
  }, { passive: false });
  const endPinch = (ev) => { if (ev.touches.length < 2) pinch = null; };
  scroller.addEventListener('touchend', endPinch);
  scroller.addEventListener('touchcancel', endPinch);
  for (const g of ['gesturestart', 'gesturechange']) scroller.addEventListener(g, (ev) => ev.preventDefault());
  scroller.addEventListener('wheel', (ev) => {   // パソコンのトラックパッドのピンチ、Ctrl＋ホイール
    if (!ev.ctrlKey) return;
    ev.preventDefault();
    const px = ev.clientX - scroller.getBoundingClientRect().left;
    zoomTo(DAY * Math.exp(-ev.deltaY * 0.01), anchorAt(px), px);
  }, { passive: false });

  // 最初の位置：吹き出しがあればそこ、なければいちばん右（今日）
  let seenW = 0;
  const ro = new ResizeObserver(() => {
    const w = scroller.clientWidth;
    if (!w || w === seenW) return;
    const first = !seenW; seenW = w;
    const keep = first ? null : anchorAt(w / 2);
    fillPop(); render();
    if (first) {
      const m = moodPop && list.find((r) => r.date === moodPop);
      scroller.scrollLeft = m ? x(m.date) - w / 2 : W;
    } else scroller.scrollLeft = x(end) + keep * DAY - w / 2;
  });
  ro.observe(scroller);

  // 上の小さな集計
  const last = list[list.length - 1];
  const recent = list.filter((m) => m.date >= addDays(t, -30));
  const avg = recent.length ? recent.reduce((a, m) => a + m.level, 0) / recent.length : null;
  const stat = (k, v, sub, jp) => h('div', { class: 'mstat' }, h('span', { class: 'k' }, k), h('span', { class: jp ? 'v jp' : 'v' }, v), h('small', {}, sub));
  const stats = h('div', { class: 'mstats' },
    stat(tr('記録した日', 'Days logged'), String(new Set(list.map((m) => m.date)).size), tr('日ぶん', 'days')),
    stat(tr('いちばん最近', 'Latest'), last ? levelShort()[last.level - 1] : '—', last ? (parse(last.date).y === parse(t).y ? dots(last.date).slice(5) : dots(last.date)) : tr('まだなし', 'none yet'), true),
    stat(tr('この30日をならすと', '30-day average'), avg ? avg.toFixed(1) : '—', avg ? tr(`5段階で・${levelShort()[Math.round(avg) - 1]}寄り`, `of 5 · mostly ${levelShort()[Math.round(avg) - 1].toLowerCase()}`) : tr('記録なし', 'no entries')));

  return h('div', { class: 'mood' }, stats,
    h('div', { class: 'mwrap' },
      h('div', { class: 'mchart-body' }, scroller, yax,
        !list.length && h('p', { class: 'mempty' }, tr('まだ記録がありません。', 'No entries yet.'), h('br'), tr('下の「ADD MOOD」から。', 'Start with ADD MOOD below.'))),
      h('div', { class: 'mctrl' },
        h('div', { class: 'mzoom' },
          h('button', { type: 'button', 'aria-label': tr('期間を広く（縮める）', 'Show a longer period'), onclick: () => zoomBy(1 / 1.6) }, '−'),
          spanLabelEl,
          h('button', { type: 'button', 'aria-label': tr('期間をせまく（広げる）', 'Show a shorter period'), onclick: () => zoomBy(1.6) }, '+')),
        h('button', { type: 'button', class: 'mnow', onclick: () => scroller.scrollTo({ left: W, behavior: 'smooth' }) }, 'TODAY →'))));
}

function moodPage() {
  const t = today();
  markSeenNow(data.moods.filter((m) => m.user_id !== me()).map((m) => [`m:${m.id}`, moodSig(m)]));
  // 同じ日に何件かあっても（保存を2回押したときなど）、いちばん新しい1件だけを使う
  const own = data.moods.filter((m) => m.user_id === me());
  const latest = new Map();
  for (const m of own) { const p = latest.get(m.date); if (!p || (m.created_at || '') >= (p.created_at || '')) latest.set(m.date, m); }
  const mine = [...latest.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  const byDay = new Map(mine.map((m) => [m.date, m]));
  // その日のほかの（かくれている）記録
  const extras = (d, keep) => own.filter((m) => m.date === d && m.id !== keep).map((m) => m.id);
  if (!moodSel || moodSel > t) moodSel = t;

  const v = {};
  const err = h('p', { class: 'err', role: 'alert' });
  const status = h('p', { class: 'mstatus' });
  const levelBtns = levels().map((label, i) => h('button', { type: 'button', onclick: () => { v.level = i + 1; paint(); } }, label));
  const paint = () => levelBtns.forEach((b, i) => { b.classList.toggle('on', v.level === i + 1); b.setAttribute('aria-pressed', String(v.level === i + 1)); });
  const note = h('textarea', { placeholder: tr('なにがあった？（なくてもいい）', 'What happened? (optional)'), oninput: (ev) => { v.note = ev.target.value; } });
  const saveBtn = h('button', { class: 'btn', type: 'submit' });
  const del = h('button', { type: 'button', class: 'link', onclick: async () => { if (await ask(tr('この日の記録を消しますか？', 'Delete the entry for this day?'), { ok: 'DELETE', danger: true })) act(async () => { for (const id of [v.id, ...extras(moodSel, v.id)]) await store.removeMood(id); }); } }, 'DELETE THIS DAY');
  const loadDay = (d) => {
    const m = byDay.get(d);
    v.id = m?.id; v.level = m?.level; v.note = m?.note || '';
    note.value = v.note; paint(); err.textContent = '';
    status.textContent = m ? tr(`${md(d)}の記録があります。なおせます。`, `You logged ${md(d)}. You can update it.`) : tr(`${md(d)}は、どんな気分だった？`, `How did you feel on ${md(d)}?`);
    saveBtn.textContent = m ? 'UPDATE' : 'SAVE';
    del.hidden = !m;
  };
  const form = h('form', { class: 'madd', id: 'mood-add', onsubmit: (ev) => {
    ev.preventDefault();
    if (!v.level) { err.textContent = tr('気分をえらんでください。', 'Please choose a mood.'); return; }
    if (saveBtn.disabled) return;
    saveBtn.disabled = true;
    const d = moodSel, row = { date: d, level: v.level, note: v.note || '', shared: false };
    act(async () => {
      await store.saveMood(v.id ? { id: v.id, ...row } : row);
      if (v.id) for (const id of extras(d, v.id)) await store.removeMood(id);
    }).finally(() => { saveBtn.disabled = false; });
  } });
  const strip = dayStrip({ value: moodSel, max: t, marks: new Set(byDay.keys()), onChange: (d) => { moodSel = d; loadDay(d); } });
  const editFromChart = (d) => {
    moodSel = d; draw();
    requestAnimationFrame(() => document.getElementById('mood-add')?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' }));
  };
  form.append(
    h('h2', { class: 'en madd-title' }, 'Add mood'), h('p', { class: 'jp' }, tr('気分を追加', 'Log a mood')),
    h('div', { class: 'mcard' },
      strip, status,
      h('div', { class: 'levels' }, levelBtns),
      h('label', { class: 'field' }, h('span', { class: 'flabel' }, tr('メモ', 'Note')), note),
      err, h('div', { class: 'row' }, saveBtn, del)));
  loadDay(moodSel);

  return h('div', {}, pageNav(),
    h('div', { class: 'mood-top' }, pageHead('Mood', ''), moodChart(mine, editFromChart)),
    h('p', { class: 'muted mhint' }, tr('点をタップでメモ、2本指で広げると期間が変わります。ここは自分にしか見えません。', 'Tap a dot to see the note; pinch to change the period. Only you can see this.')),
    h('button', { class: 'down', type: 'button', onclick: () => form.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, 'ADD MOOD', h('span', { 'aria-hidden': 'true' }, '↓')),
    form);
}

/* ---------- 設定 ---------- */
const b64ToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error(tr('このブラウザでは通知を受け取れません。iPhoneの場合は、共有ボタンから「ホーム画面に追加」して、そのアイコンから開いてください。', "This browser can't receive notifications. On iPhone, use Share → Add to Home Screen and open the app from that icon."));
  }
  if ((await Notification.requestPermission()) !== 'granted') throw new Error(tr('通知が許可されませんでした。端末の設定で許可してください。', 'Notifications were not allowed. Please allow them in your device settings.'));
  await navigator.serviceWorker.register('sw.js');
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(CONFIG.VAPID_PUBLIC_KEY) });
  await store.savePush(sub);
  await store.saveProfile({ notify: true });
}
async function disablePush() {
  const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
  const sub = reg && (await reg.pushManager.getSubscription());
  if (sub) { await store.removePush(sub.endpoint); await sub.unsubscribe(); }
  await store.saveProfile({ notify: false });
}
function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
}
async function backup() {
  const stamp = today();
  const entries = data.entries.map((e) => ({ ...e, photo: e.photo ? `photos/${e.id}.jpg` : null }));
  const json = JSON.stringify({ exported_at: new Date().toISOString(), start_date: CONFIG.START_DATE,
    profiles: data.profiles.map((p) => ({ id: p.id, display_name: p.display_name })), entries, moods: data.moods, comments: data.comments }, null, 2);
  try {
    const JSZip = (await import('https://esm.sh/jszip@3.10.1')).default;
    const zip = new JSZip();
    zip.file('our-odyssey.json', json);
    for (const e of data.entries.filter((x) => x.photo)) {
      const blob = await (await fetch(await store.photoUrl(e.photo))).blob();
      zip.file(`photos/${e.id}.jpg`, blob);
    }
    download(await zip.generateAsync({ type: 'blob' }), `our-odyssey-${stamp}.zip`);
  } catch {
    download(new Blob([json], { type: 'application/json' }), `our-odyssey-${stamp}.json`);
    notice(tr('写真をまとめられなかったので、文章だけを保存しました', "Couldn't bundle the photos, so only the text was saved"));
  }
}
function settingsPage() {
  const my = data.profiles.find((p) => p.id === me()) || {};
  const name = h('input', { type: 'text', value: my.display_name || '' });
  const canPush = store.mode === 'supabase' && !!CONFIG.VAPID_PUBLIC_KEY;
  const toggle = h('input', { type: 'checkbox', disabled: !canPush, onchange: (ev) => act(ev.target.checked ? enablePush : disablePush) });
  if (canPush && my.notify && 'serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistration().then((r) => r?.pushManager.getSubscription()).then((s) => { toggle.checked = !!s; }).catch(() => {});
  }
  const backupBtn = h('button', { class: 'btn ghost', onclick: async () => { backupBtn.disabled = true; try { await backup(); } finally { backupBtn.disabled = false; } } }, 'SAVE BACKUP');
  return h('div', {}, pageNav(true), pageHead('Settings', ''),
    h('div', { class: 'cards' },
      h('section', { class: 'card' }, h('h2', {}, tr('名前', 'Name')),
        h('div', { class: 'row', style: 'flex-wrap: nowrap' }, name,
          h('button', { class: 'btn', onclick: () => act(() => store.saveProfile({ display_name: name.value.trim() })) }, 'SAVE'))),
      langCard(),
      themeCard(),
      store.mode === 'supabase' && passwordCard(),
      h('section', { class: 'card' }, h('h2', {}, tr('記念日の通知', 'Anniversary notifications')),
        h('label', { class: 'check' }, toggle, tr('この端末で通知を受け取る', 'Get notifications on this device')),
        h('p', { class: 'muted' }, canPush
          ? tr('月ごとの記念日・100日ごと・足した記念日の当日、朝8時ごろに届きます。iPhoneは「ホーム画面に追加」したアイコンから開いてオンにしてください。', 'Sent around 8 AM on monthly anniversaries, every 100 days, and on days you added. On iPhone, open the app from the Home Screen icon to turn this on.')
          : tr('通知は、本番の保存先と通知の鍵を設定すると使えるようになります。', 'Notifications work once the live database and notification keys are set up.'))),
      h('section', { class: 'card' }, h('h2', {}, tr('バックアップ', 'Backup')),
        h('p', {}, tr('書いた内容と写真を、ひとつのファイルにまとめてこの端末に保存します。', 'Saves everything you wrote and all photos into one file on this device.')), backupBtn),
      store.mode === 'demo'
        ? h('section', { class: 'card' }, h('h2', {}, tr('お試しモード', 'Demo mode')),
          h('p', {}, tr(`いまは「${nameOf(me())}」として見ています。`, `You're viewing as ${nameOf(me())}.`)),
          h('div', { class: 'row' },
            h('button', { class: 'btn ghost', onclick: () => { store.switchUser(); refresh(); } }, `SWITCH TO ${partner() ? nameOf(partner().id) : 'PARTNER'}`),
            h('button', { class: 'link', onclick: async () => { if (await ask(tr('お試しで書いた内容をぜんぶ消しますか？', 'Delete everything written in demo mode?'), { ok: 'DELETE ALL', danger: true })) { localStorage.removeItem('our-odyssey-demo'); location.reload(); } } }, 'CLEAR DEMO DATA')))
        : h('section', { class: 'card' }, h('h2', {}, tr('ログアウト', 'Log out')),
          h('button', { class: 'btn ghost', onclick: async () => { await store.signOut(); location.hash = '#/'; start(); } }, 'LOG OUT'))));
}
function passwordCard() {
  const login = (store.user()?.email || '').split('@')[0];
  const input = (ac) => h('input', { type: 'password', autocomplete: ac, required: true });
  const cur = input('current-password'), next = input('new-password'), again = input('new-password');
  const msg = h('p', { class: 'muted', role: 'status' });
  const btn = h('button', { class: 'btn', type: 'submit' }, 'CHANGE PASSWORD');
  const form = h('form', { class: 'pwform', onsubmit: async (ev) => {
    ev.preventDefault(); msg.classList.remove('err'); msg.textContent = '';
    const fail = (t) => { msg.classList.add('err'); msg.textContent = t; };
    if (!cur.value || !next.value) return fail(tr('いまのパスワードと新しいパスワードを入れてください。', 'Enter your current and new password.'));
    if (next.value.length < 8) return fail(tr('新しいパスワードは8文字以上にしてください。', 'Use at least 8 characters.'));
    if (next.value !== again.value) return fail(tr('確認用のパスワードが一致しません。', "The two new passwords don't match."));
    btn.disabled = true;
    try {
      await store.changePassword(cur.value, next.value);
      cur.value = next.value = again.value = '';
      msg.textContent = tr('パスワードを変えました。次からは新しいパスワードでログインしてください。', 'Password changed. Use the new one next time you log in.');
    } catch (e) { fail(e.message || String(e)); } finally { btn.disabled = false; }
  } },
  // パスワード管理アプリが「どのアカウントのパスワードか」わかるように、ログイン名も入れておく（見えない）
  h('input', { type: 'text', autocomplete: 'username', value: login, hidden: true, readonly: true, 'aria-hidden': 'true', tabindex: '-1' }),
  h('label', {}, tr('いまのパスワード', 'Current password'), cur),
  h('label', {}, tr('新しいパスワード（8文字以上）', 'New password (8+ characters)'), next),
  h('label', {}, tr('新しいパスワード（もう一度）', 'New password (again)'), again),
  msg, h('div', { class: 'row' }, btn));
  return h('section', { class: 'card' }, h('h2', {}, tr('パスワード', 'Password')), form);
}
function themeCard() {
  let cur = theme.load();
  const swatch = (t) => { const c = theme.colors(t); return h('span', { class: 'sw', style: `background:${c.pink};box-shadow:inset 0 0 0 6px ${c.paper}, 0 0 0 1.5px ${c.navy}` }); };
  const chips = h('div', { class: 'chips theme-chips' });
  const slider = h('input', { type: 'range', min: '0', max: '359', step: '1', class: 'hue', 'aria-label': tr('色相', 'Hue') });
  const ink = h('input', { type: 'checkbox' });
  const set = (t, save) => {
    cur = { hue: Math.round(t.hue) % 360, ink: !!t.ink };
    theme.apply(cur, save);
    slider.value = String(cur.hue); ink.checked = cur.ink;
    chips.replaceChildren(...theme.PRESETS.map((p) => {
      const on = p.hue === cur.hue;
      return h('button', { type: 'button', class: `chip${on ? ' on' : ''}`, 'aria-pressed': String(on), onclick: () => set({ hue: p.hue, ink: cur.ink }, true) },
        swatch({ hue: p.hue, ink: cur.ink }), lang === 'en' ? p.en : p.jp);
    }));
  };
  slider.addEventListener('input', () => set({ hue: +slider.value, ink: cur.ink }, false));
  slider.addEventListener('change', () => set({ hue: +slider.value, ink: cur.ink }, true));
  ink.addEventListener('change', () => set({ hue: cur.hue, ink: ink.checked }, true));
  set(cur, false);
  return h('section', { class: 'card' }, h('h2', {}, tr('色のテーマ', 'Color theme')),
    chips,
    h('label', { class: 'hue-row' }, tr('色相をこまかく', 'Fine-tune hue'), slider),
    h('label', { class: 'check' }, ink, tr('文字の紺色もいっしょに変える', 'Shift the navy text color too')),
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'link', onclick: () => set({ hue: theme.PRESETS[0].hue, ink: false }, true) }, 'RESET')),
    h('p', { class: 'muted' }, tr('写真や花・コルクボードの色はそのまま。この端末だけに反映されます。', 'Photos, flowers and the cork board keep their colors. Applies to this device only.')));
}
function langCard() {
  const opt = (v, label) => h('button', { type: 'button', class: `chip${lang === v ? ' on' : ''}`, 'aria-pressed': String(lang === v), onclick: () => setLang(v) }, label);
  return h('section', { class: 'card' }, h('h2', {}, tr('表示の言語', 'Language')),
    h('div', { class: 'chips' }, opt('ja', 'JP + EN'), opt('en', 'ALL ENGLISH')),
    h('p', { class: 'muted' }, tr('ふだんは日本語で、ボタンだけ英語。「ALL ENGLISH」にすると全部英語になります（この端末だけ）。', 'ALL ENGLISH shows every screen in English; JP + EN shows Japanese text with English buttons. Applies to this device only.')));
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
    store ??= await createStore();
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
start();
