import { CONFIG } from './config.js';
import { createStore } from './store.js?v=11';

const app = document.getElementById('app');
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
const md = (s) => { const { m, d } = parse(s); return `${m}月${d}日`; };
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
  if (months % 12 === 0) return `${months / 12}周年`;
  return months > 12 ? `${Math.floor(months / 12)}年${months % 12}ヶ月` : `${months}ヶ月`;
};

const me = () => store.user().id;
const nameOf = (id) => (data.profiles.find((p) => p.id === id)?.display_name) || 'ななし';
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
async function shrink(file) {
  const max = store.mode === 'demo' ? 900 : 1600;
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
}
async function act(fn) {
  try { await fn(); await refresh(); } catch (e) { alert(e.message || String(e)); }
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
  const view = h('main', { class: 'view' }, r.page());
  app.replaceChildren(view, tabBar(r.tab));
  if (dir && !reduceMotion()) view.classList.add(dir > 0 ? 'in-r' : 'in-l');
}
window.addEventListener('hashchange', () => { if (store?.user()) { draw(); window.scrollTo(0, 0); } });

const tabBar = (active) => h('nav', { class: 'tabbar', 'aria-label': 'タブ' }, TABS.map((t, i) =>
  h('a', { href: t.href, class: i === active ? 'on' : '', 'aria-current': i === active ? 'page' : null,
    onclick: (ev) => { if (i === active && shown?.depth === 0) { ev.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); } } },
  tabIcon(t.icon), h('span', { class: 'en' }, t.en))));

const pageNav = (back) => h('div', { class: 'nav' },
  back ? h('a', { class: 'link', href: '#/more' }, '← その他') : h('span'),
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
  if (daysBetween(t, nm.date) === 0) banners.push(`今日は ${spanLabel(nm.months)} の記念日！`);
  if (days > 0 && days % 100 === 0) banners.push(`今日で ${days}日！`);
  for (const e of data.entries.filter((x) => x.section === 'anniversary' && x.date)) {
    const ny = nextYearly(e.date, t);
    if (ny.date === t && ny.years > 0) banners.push(`今日は「${e.title}」から ${ny.years}年！`);
  }
  const hero = (k) => data.entries.filter((e) => e.section === 'hero' && e.category === k).sort(byCreated).pop();
  const slot = (k, label) => {
    const e = hero(k);
    const b = h('button', { class: `slot ${k}${e ? ' has' : ''}`, 'aria-label': `${label}をえらぶ`, onclick: () => setHero(k, e) },
      h('span', {}, `[${label}]`));
    if (e) store.photoUrl(e.photo).then((u) => { b.style.backgroundImage = `url("${u}")`; });
    return b;
  };
  const heroEl = h('div', { class: 'home' },
      h('div', { class: 'tag' }, `Since ${dots(CONFIG.START_DATE)}`),
      h('p', { class: 'big first' }, String(days)),
      h('p', { class: 'big' }, 'Days'),
      banners.map((b) => h('div', { class: 'banner' }, b)),
      h('div', { class: 'stage' },
        slot('a', 'ふたりの写真'), slot('b', '思い出の品の写真'),
        h('img', { class: 'flower blue', src: 'assets/tulip-blue.webp', alt: '' }),
        h('img', { class: 'flower pink', src: 'assets/tulip-pink.webp', alt: '' })));
  const pin = h('div', { class: 'hero-pin' }, heroEl);
  const root = h('div', {}, pin,
    store.mode === 'demo' && h('p', { class: 'note' }, 'お試しモード：書いた内容はこの端末にだけ保存されます。'),
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
  const kind = { gift: '贈りもの', place: '過ごした場所', anniversary: '記念日' };
  const items = [{ date: CONFIG.START_DATE, title: '付き合いはじめた日', k: '記念日' },
    ...data.entries.filter((e) => e.date && kind[e.section]).map((e) => ({ id: e.id, section: e.section, date: e.date, title: e.title, k: kind[e.section], photo: e.photo }))];
  items.sort((a, b) => (a.date < b.date ? 1 : -1));
  const out = [];
  let year = null, group = null;
  for (const it of items) {
    const y = it.date.slice(0, 4);
    if (y !== year) { year = y; group = h('div', { class: 'tl' }); out.push(h('div', { class: 'year fade' }, y), group); }
    group.append(h(it.id ? 'button' : 'div', { class: 'it fade', type: it.id ? 'button' : null, onclick: it.id ? () => (it.section === 'anniversary' ? (location.hash = '#/more/anniv') : openDetail(it.id)) : null },
      h('div', { class: 'd' }, dots(it.date).slice(5)), h('div', { class: 't' }, it.title),
      h('div', { class: 'muted' }, it.k), it.photo && photoImg(it.photo, '')));
  }
  return h('section', { class: 'home-tl' },
    h('div', { class: 'head fade' }, h('h1', {}, 'Timeline')), out);
}
function addDays(s, n) {
  const d = new Date(utc(s) + n * 864e5);
  return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}
async function setHero(k, e) {
  const f = await pickFile(); if (!f) return;
  act(async () => {
    const photo = await store.uploadPhoto(await shrink(f));
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
    s.onload = () => ok(window.L); s.onerror = () => ng(new Error('地図を読みこめませんでした。'));
    document.head.append(s);
  });
  return leafletP;
}
const TILE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const pin = (L, lat, lng, fill = '#16204F') =>
  L.circleMarker([lat, lng], { radius: 9, color: '#16204F', weight: 2, fillColor: fill, fillOpacity: 1 });

function geoField(v) {
  const box = h('div', { hidden: true });
  const status = h('span', { class: 'muted' }, v.lat != null ? '場所をえらんであります' : '');
  let map, marker, L;
  const put = (lat, lng) => {
    v.lat = lat; v.lng = lng; status.textContent = '場所をえらんであります';
    if (marker) marker.remove();
    marker = pin(L, lat, lng).addTo(map);
  };
  const q = h('input', { type: 'text', placeholder: '場所の名前でさがす' });
  const search = async () => {
    if (!q.value.trim()) return;
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=ja&q=${encodeURIComponent(q.value)}`);
    const [hit] = await r.json();
    if (!hit) { status.textContent = '見つかりませんでした。地図をタップしてえらべます。'; return; }
    map.setView([+hit.lat, +hit.lon], 14); put(+hit.lat, +hit.lon);
  };
  q.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); search(); } });
  const mapEl = h('div', { class: 'map pick' });
  box.append(h('div', { class: 'row' }, q, h('button', { type: 'button', class: 'btn ghost small', onclick: search }, 'さがす')), mapEl);
  const open = async () => {
    box.hidden = false;
    if (map) return;
    L = await leaflet();
    map = L.map(mapEl).setView(v.lat != null ? [v.lat, v.lng] : [36.2, 138.2], v.lat != null ? 14 : 4);
    L.tileLayer(TILE, { attribution: ATTR, maxZoom: 19 }).addTo(map);
    if (v.lat != null) marker = pin(L, v.lat, v.lng).addTo(map);
    map.on('click', (ev) => put(ev.latlng.lat, ev.latlng.lng));
    setTimeout(() => map.invalidateSize(), 60);
  };
  const clear = () => { v.lat = null; v.lng = null; status.textContent = ''; if (marker) marker.remove(); };
  return h('div', {},
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn ghost small', onclick: open }, '地図で場所をえらぶ'),
      h('button', { type: 'button', class: 'link', onclick: clear }, 'はずす'), status),
    box);
}

const LEVELS = ['とても\nつらい', 'つらい', 'ふつう', 'いい', 'とても\nいい'];
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
function closeDialog(dlg, force = false) {
  if (!dlg.open || dlg.classList.contains('closing')) return;
  if (!force && dlg.guard && !dlg.guard()) return;
  dlg.classList.add('closing');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(() => dlg.close(), reduce ? 0 : 170);
}

/* ---------- 日付をえらぶ帯（横にスクロールする日のカード） ---------- */
function dayStrip({ value, onChange, marks = new Set(), max = null, allowNone = false }) {
  let sel = value || null;
  let { y, m } = parse(sel || today());
  const label = h('span', { class: 'pill-text' });
  const native = h('input', { type: 'date', class: 'month-native', 'aria-label': 'カレンダーから日付をえらぶ', max: max || null,
    onclick: () => { try { native.showPicker(); } catch { /* 未対応のブラウザはそのまま */ } },
    onchange: (ev) => { if (ev.target.value) pick(ev.target.value); } });
  const strip = h('div', { class: 'strip' });
  const center = (smooth) => {
    const c = strip.querySelector('.on') || strip.querySelector('.today');
    const left = c ? c.offsetLeft - (strip.clientWidth - c.offsetWidth) / 2 : 0;
    strip.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
  };
  const bm = () => { const i = h('i', { class: 'bm' }); i.innerHTML = BOOKMARK; return i; };
  const noneBtn = allowNone ? h('button', { type: 'button', class: 'chip', onclick: () => { sel = null; render(); onChange(null); } }, '日付なし') : null;
  const next = h('button', { type: 'button', class: 'mnav', 'aria-label': '次の月', onclick: () => shift(1) }, '›');
  function render() {
    label.textContent = `${MONTHS[m - 1]}  ${y}`;
    native.value = sel || '';
    next.disabled = !!max && ymd(y, m, lastDay(y, m)) >= max;
    const t = today();
    strip.replaceChildren(...Array.from({ length: lastDay(y, m) }, (_, i) => {
      const d = ymd(y, m, i + 1);
      const cls = ['day', d === sel && 'on', d === t && 'today', marks.has(d) && 'marked'].filter(Boolean).join(' ');
      return h('button', { type: 'button', class: cls, disabled: !!max && d > max, 'aria-pressed': String(d === sel),
        'aria-label': `${m}月${i + 1}日${marks.has(d) ? '（記録あり）' : ''}`, onclick: () => pick(d) },
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
      h('button', { type: 'button', class: 'mnav', 'aria-label': '前の月', onclick: () => shift(-1) }, '‹'),
      h('span', { class: 'pill' }, label, native), next),
    strip,
    h('div', { class: 'row daypick-foot' },
      h('button', { type: 'button', class: 'btn small', onclick: () => pick(max && today() > max ? max : today()) }, '今日へ'), noneBtn,
      h('span', { class: 'muted' }, '月の部分をタップするとカレンダー')));
  root.pick = pick;
  return root;
}

/* ---------- 入力のモーダル ---------- */
// 入力欄の中身。モーダルでも、ページの下に置く入力欄でも使う。
function formParts({ fields, initial = {}, onSubmit, after, submitLabel = '保存する' }) {
  const v = { ...initial };
  let newPhoto = null;
  let dirty = false;
  const touch = () => { dirty = true; };
  const err = h('p', { class: 'err', role: 'alert' });
  const field = (f, inner, tag = 'div') => h(tag, { class: 'field' },
    f.label && h('span', { class: 'flabel' }, f.label, !f.required && !f.readonly && f.type !== 'check' && h('span', { class: 'opt' }, 'なくてもOK')),
    inner, f.hint && h('span', { class: 'hint' }, f.hint));
  const control = (f) => {
    if (f.type === 'geo') return field(f, geoField(v));
    if (f.type === 'date') {
      return field(f, dayStrip({ value: v[f.name], allowNone: !f.required, onChange: (d) => { v[f.name] = d; touch(); } }));
    }
    if (f.type === 'photo') {
      const img = v.photo ? photoImg(v.photo, 'drop-img') : h('img', { class: 'drop-img', alt: '', hidden: true });
      const txt = h('span', { class: 'drop-txt', hidden: !!v.photo }, '＋ 写真をえらぶ', h('small', {}, 'タップして端末の写真から'));
      const rm = h('button', { type: 'button', class: 'link', hidden: !v.photo, onclick: () => {
        newPhoto = null; v.photo = null; img.hidden = true; img.removeAttribute('src'); txt.hidden = false; rm.hidden = true; touch();
      } }, '写真をはずす');
      const drop = h('button', { type: 'button', class: 'drop', onclick: async () => {
        const file = await pickFile(); if (!file) return;
        newPhoto = await shrink(file); img.src = URL.createObjectURL(newPhoto); img.hidden = false; txt.hidden = true; rm.hidden = false; touch();
      } }, img, txt);
      return field(f, h('div', {}, drop, rm));
    }
    if (f.type === 'level') {
      const btns = LEVELS.map((label, i) => h('button', { type: 'button', class: v.level === i + 1 ? 'on' : '',
        onclick: () => { v.level = i + 1; btns.forEach((b, j) => b.classList.toggle('on', j === i)); touch(); } }, label));
      return field(f, h('div', { class: 'levels' }, btns));
    }
    if (f.type === 'check') {
      return h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: !!v[f.name], onchange: (ev) => { v[f.name] = ev.target.checked; touch(); } }), f.label);
    }
    const common = { value: v[f.name] ?? '', required: f.required, readonly: f.readonly, placeholder: f.ph,
      oninput: (ev) => { v[f.name] = ev.target.value; touch(); } };
    if (f.type === 'textarea') return field(f, h('textarea', common), 'label');
    if (f.type === 'category') {
      const input = h('input', { type: 'text', ...common });
      const chips = h('div', { class: 'chips' }, f.options.map((o) => h('button', { type: 'button', class: `chip${v[f.name] === o ? ' on' : ''}`,
        onclick: () => { input.value = o; v[f.name] = o; touch(); [...chips.children].forEach((c) => c.classList.toggle('on', c.textContent === o)); } }, o)));
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
      if (missing) { err.textContent = `「${f.label}」を${['date', 'level', 'category'].includes(f.type) ? 'えらんで' : '書いて'}ください。`; return; }
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
  dlg.guard = () => !fp.isDirty() || confirm('書きかけの内容を捨てて閉じますか？');
  dlg.append(h('form', { class: 'sheet', novalidate: true, onsubmit: fp.handle },
    h('div', { class: 'mhead' },
      h('div', {}, en && h('div', { class: 'tag' }, en), h('h2', {}, title), lead && h('p', { class: 'lead' }, lead)),
      h('button', { type: 'button', class: 'x', 'aria-label': 'とじる', onclick: () => closeDialog(dlg) }, '×')),
    h('div', { class: 'mbody' }, fp.controls),
    h('div', { class: 'mfoot' }, fp.err, h('div', { class: 'row' }, fp.submit,
      h('button', { class: 'btn ghost', type: 'button', onclick: () => closeDialog(dlg) }, 'やめる')))));
  showDialog(dlg);
}
function inlineForm({ fields, onSubmit }) {
  const fp = formParts({ fields, onSubmit, after: refresh, submitLabel: '追加する' });
  return h('form', { class: 'inline-form', novalidate: true, onsubmit: fp.handle }, fp.controls, fp.err, h('div', { class: 'row' }, fp.submit));
}

/* ---------- 各欄 ---------- */
const F = {
  title: (label, ph) => ({ name: 'title', type: 'text', label, required: true, ph }),
  date: (label = '日付') => ({ name: 'date', type: 'date', label }),
  body: { name: 'body', type: 'textarea', label: 'ひとこと', ph: 'そのときのこと、思ったことを自由に' },
  geo: { type: 'geo', label: '地図の場所', hint: '入れておくと地図にピンが立ちます' },
  photo: { type: 'photo', label: '写真' },
};
const LIKE_CATS = ['食べ物', '飲み物', '仕草', '場所', '曲'];
const SECTIONS = {
  place: { en: 'Places', jp: '過ごした場所', lead: 'ふたりで過ごした場所を残す', fields: () => [F.title('場所の名前', '例：江ノ島の水族館'), F.date('行った日'), F.body, F.geo, F.photo] },
  like: { en: 'Likes', jp: '好きなもの', lead: '相手の「好き」をメモしておく', fields: () => [
    { name: 'category', type: 'category', label: '種類', required: true, options: likeCats(), ph: 'えらぶか、自由に書く' }, F.title('好きなもの', '例：抹茶ラテ'), F.body, F.photo] },
  wish: { en: 'Wishes', jp: '行きたいところ', lead: 'いつか一緒に行きたいところ', fields: () => [F.title('行きたいところ', '例：金沢の21世紀美術館'), { ...F.body, ph: '行きたい理由、やりたいこと' }, F.geo, F.photo] },
  gift: { en: 'Gifts', jp: '贈ったもの', lead: '贈ったもの・もらったもの', fields: () => [F.title('贈ったもの', '例：手編みのマフラー'), F.date('贈った日'), F.body, F.photo] },
  dislike: { en: 'Dislikes', jp: '嫌いなもの', lead: '相手の苦手なものを覚えておく', fields: () => [F.title('嫌いなもの', '例：満員電車'), F.body] },
};
const likeCats = () => [...new Set([...LIKE_CATS, ...data.entries.filter((e) => e.section === 'like' && e.category).map((e) => e.category)])];

function talk(e) {
  const list = data.comments.filter((c) => c.entry_id === e.id).sort(byCreated);
  const input = h('input', { type: 'text', placeholder: 'ひとこと書く', 'aria-label': 'ひとこと' });
  return h('details', { class: 'talk', open: openTalks.has(e.id), ontoggle: (ev) => { ev.target.open ? openTalks.add(e.id) : openTalks.delete(e.id); } },
    h('summary', {}, `ひとこと（${list.length}）`),
    list.map((c) => h('div', { class: 'c' }, h('span', {}, `${nameOf(c.author)}：${c.body}`),
      c.author === me() && h('button', { class: 'link', onclick: () => act(() => store.removeComment(c.id)) }, '消す'))),
    h('form', { onsubmit: (ev) => { ev.preventDefault(); if (input.value.trim()) act(() => store.addComment(e.id, input.value.trim())); } },
      input, h('button', { class: 'btn small', type: 'submit' }, '送る')));
}
function removeEntry(e) {
  if (!confirm('消しますか？元には戻せません。')) return;
  act(async () => { await store.removeEntry(e.id); await store.removePhoto(e.photo); });
}
function entryCard(e, key) {
  const S = SECTIONS[key];
  const mine = e.author === me();
  const meta = [e.date && dots(e.date), e.category, key === 'gift' ? `${nameOf(e.author)}から` : nameOf(e.author)].filter(Boolean).join(' ・ ');
  const edit = () => entryEdit(e);
  const addPhoto = async () => {
    const f = await pickFile(); if (!f) return;
    act(async () => store.saveEntry({ id: e.id, photo: await store.uploadPhoto(await shrink(f)) }));
  };
  const went = () => entryWent(e);
  return h('article', { class: 'card' },
    e.photo && photoImg(e.photo),
    h('h2', {}, e.title), h('div', { class: 'meta' }, meta),
    e.body && h('p', {}, e.body),
    h('div', { class: 'row' },
      key === 'wish' && h('button', { class: 'btn small', onclick: went }, '行った！'),
      mine && !e.photo && S.fields().includes(F.photo) && h('button', { class: 'btn ghost small', onclick: addPhoto }, '写真を載せる'),
      mine && h('button', { class: 'link', onclick: edit }, 'なおす'),
      mine && h('button', { class: 'link', onclick: () => removeEntry(e) }, '消す')),
    talk(e));
}
function addEntry(key) {
  const S = SECTIONS[key];
  openForm({ title: '書きたす', en: S.en, lead: S.lead, fields: S.fields(), initial: key === 'like' && likeFilter ? { category: likeFilter } : {},
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
      h('button', { class: `chip${likeFilter === c ? ' on' : ''}`, onclick: () => { likeFilter = c; draw(); } }, c || 'ぜんぶ')));
    if (likeFilter) items = items.filter((e) => e.category === likeFilter);
  }
  return h('div', {}, pageNav(true),
    pageHead(S.en, S.jp, h('button', { class: 'btn', onclick: add }, '+ 書きたす')),
    chips,
    items.length ? h('div', { class: 'cards' }, items.map((e) => entryCard(e, key)))
      : h('p', { class: 'empty' }, 'まだ何もありません。「+ 書きたす」から最初のひとつを。'));
}

/* ---------- ひとつの思い出の詳細（モーダル） ---------- */
const EN_OF = { place: 'Places', wish: 'Wishes', like: 'Likes', gift: 'Gifts', dislike: 'Dislikes' };
function entryEdit(e) {
  const S = SECTIONS[e.section];
  openForm({ title: 'なおす', en: S.en, fields: S.fields(), initial: e,
    onSubmit: (v) => store.saveEntry({ id: e.id, title: v.title, body: v.body, date: v.date, category: v.category, lat: v.lat, lng: v.lng, photo: v.photo }) });
}
function entryWent(e) {
  openForm({ title: '行った！', en: 'Places', lead: `「${e.title}」に行った日を残す`, initial: { ...e, date: today() },
    fields: [F.date('行った日'), F.body, F.photo],
    onSubmit: (v) => store.saveEntry({ id: e.id, section: 'place', date: v.date, body: v.body, photo: v.photo }) });
}
function openDetail(id) {
  const dlg = h('dialog', { class: 'modal detail', 'aria-label': '詳細' });
  const render = () => {
    const e = data.entries.find((x) => x.id === id);
    if (!e) { closeDialog(dlg, true); return; }
    const mine = e.author === me();
    const meta = [e.date && dots(e.date), e.category, e.section === 'gift' ? `${nameOf(e.author)}から` : nameOf(e.author)].filter(Boolean).join(' ・ ');
    dlg.replaceChildren(h('div', { class: 'sheet' },
      h('div', { class: 'mhead' },
        h('div', {}, EN_OF[e.section] && h('div', { class: `tag ${e.section}` }, EN_OF[e.section]), h('h2', { class: 'dtitle' }, e.title), h('p', { class: 'lead' }, meta)),
        h('button', { type: 'button', class: 'x', 'aria-label': 'とじる', onclick: () => closeDialog(dlg) }, '×')),
      h('div', { class: 'mbody' },
        e.photo && photoImg(e.photo, 'dphoto'),
        e.body ? h('p', { class: 'dbody' }, e.body) : null,
        e.section === 'wish' && h('button', { class: 'btn', onclick: () => entryWent(e) }, '行った！ → PLACES へ'),
        mine && h('div', { class: 'row' },
          h('button', { class: 'btn ghost small', onclick: () => entryEdit(e) }, 'なおす'),
          h('button', { class: 'link', onclick: () => removeEntry(e) }, '消す')),
        talk(e))));
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
  return e.photo
    ? L.divIcon({ html: el, className: 'pin-wrap', iconSize: [50, 58], iconAnchor: [25, 58] })
    : L.divIcon({ html: el, className: 'pin-wrap', iconSize: [24, 24], iconAnchor: [12, 12] });
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
  leaflet().then((L) => {
    const map = L.map(mapEl, { zoomControl: false });
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer(TILE, { attribution: ATTR, maxZoom: 19 }).addTo(map);
    for (const e of pts) L.marker([e.lat, e.lng], { icon: pinIcon(L, e), title: e.title, keyboard: true }).addTo(map).on('click', () => openDetail(e.id));
    if (mapView) map.setView(mapView.c, mapView.z);
    else if (pts.length === 1) map.setView([pts[0].lat, pts[0].lng], 13);
    else if (pts.length) map.fitBounds(pts.map((e) => [e.lat, e.lng]), { padding: [40, 40], maxZoom: 14 });
    else map.setView([36.2, 138.2], 5);
    map.on('moveend', () => { mapView = { c: map.getCenter(), z: map.getZoom() }; });
    setTimeout(() => map.invalidateSize(), 380);
  }).catch(() => { mapEl.textContent = '地図を読みこめませんでした。'; });

  const row = (e) => h('button', { class: 'lrow', type: 'button', onclick: () => openDetail(e.id) },
    e.photo ? photoImg(e.photo, 'lthumb') : h('span', { class: `lthumb dot ${e.section}` }),
    h('span', { class: 'ltext' }, h('b', {}, e.title),
      h('small', {}, [e.section === 'place' ? 'PLACES' : 'WISHES', e.date && dots(e.date), e.lat == null && '地図なし'].filter(Boolean).join(' ・ '))),
    h('span', { 'aria-hidden': 'true' }, '›'));

  const addBox = h('div', { class: 'addbox' });
  const renderAdd = () => {
    const S = SECTIONS[addKind];
    const form = inlineForm({ fields: S.fields(),
      onSubmit: (v) => store.saveEntry({ section: addKind, title: v.title, body: v.body || '', date: v.date || null, category: null, lat: v.lat ?? null, lng: v.lng ?? null, photo: v.photo || null }) });
    addBox.replaceChildren(
      h('div', { class: 'chips' }, [['place', 'PLACES 過ごした場所'], ['wish', 'WISHES 行きたいところ']].map(([k, label]) =>
        h('button', { type: 'button', class: `chip ${k}${addKind === k ? ' on' : ''}`, onclick: () => { addKind = k; renderAdd(); } }, label))),
      h('p', { class: 'muted' }, S.lead), form);
  };
  renderAdd();

  return h('div', {}, pageNav(),
    pageHead('Places', '過ごした場所と、行きたいところ'),
    chips, mapEl,
    h('p', { class: 'legend' }, h('span', { class: 'lg place' }), '過ごした場所　', h('span', { class: 'lg wish' }), '行きたいところ　・ピンをタップで詳しく'),
    shownList.length ? h('div', { class: 'list' }, shownList.map(row)) : h('p', { class: 'empty' }, 'まだ何もありません。下から最初のひとつを。'),
    h('section', { class: 'madd', id: 'place-add' },
      h('h2', { class: 'en madd-title' }, 'Add'), h('p', { class: 'jp' }, '場所を追加'), addBox));
}

/* ---------- その他（その場で開く） ---------- */
const MORE = [
  { key: 'like', en: 'Likes', jp: '好きなもの' },
  { key: 'gift', en: 'Gifts', jp: '贈ったもの' },
  { key: 'values', en: 'Values', jp: '価値観' },
  { key: 'dislike', en: 'Dislikes', jp: '嫌いなもの' },
  { key: 'anniv', en: 'Days', jp: '記念日' },
  { key: 'settings', en: 'Settings', jp: '設定', link: true },
];
const MORE_PAGES = { like: () => sectionPage('like'), gift: () => sectionPage('gift'), dislike: () => sectionPage('dislike'),
  values: valuesPage, anniv: annivPage, settings: settingsPage };
const moreOpen = new Set();
function annivLines() {
  const t = today();
  const nm = nextMonthly(CONFIG.START_DATE, t);
  const lines = [{ title: `${spanLabel(nm.months)}の記念日`, left: daysBetween(t, nm.date), date: nm.date }];
  for (const e of data.entries.filter((x) => x.section === 'anniversary' && x.date)) {
    const n = daysBetween(t, e.date);
    if (n >= 0) lines.push({ title: e.title, left: n, date: e.date });
    else { const ny = nextYearly(e.date, t); lines.push({ title: `${e.title}（${ny.years}年）`, left: daysBetween(t, ny.date), date: ny.date }); }
  }
  return lines.sort((a, b) => a.left - b.left);
}
function morePreview(key) {
  const go = (k) => { location.hash = `#/more/${k}`; };
  if (key === 'values') {
    const all = data.entries.filter((e) => e.section === 'value');
    const topics = [...new Set(all.map((e) => e.title))];
    return { n: topics.length, items: topics.slice(-3).reverse().map((tp) => {
      const both = new Set(all.filter((e) => e.title === tp).map((e) => e.author)).size >= 2;
      return h('button', { class: 'prow', type: 'button', onclick: () => go('values') }, h('b', {}, tp), h('small', {}, both ? 'ふたりとも答えた' : 'まだ片方だけ'));
    }), add: () => writeValue() };
  }
  if (key === 'anniv') {
    const lines = annivLines();
    return { n: lines.length, items: lines.slice(0, 3).map((l) => h('button', { class: 'prow', type: 'button', onclick: () => go('anniv') },
      h('b', {}, l.title), h('small', {}, l.left === 0 ? '今日！' : `${md(l.date)}・あと${l.left}日`))), add: addAnniv };
  }
  const items = data.entries.filter((e) => e.section === key).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return { n: items.length, items: items.slice(0, 3).map((e) => h('button', { class: 'prow', type: 'button', onclick: () => openDetail(e.id) },
    e.photo ? photoImg(e.photo, 'pthumb') : null,
    h('b', {}, e.title), h('small', {}, [e.category, nameOf(e.author)].filter(Boolean).join(' ・ ')))), add: () => addEntry(key) };
}
function morePage() {
  return h('div', {}, pageNav(), pageHead('More', 'そのほかの思い出'),
    h('ul', { class: 'acc' }, MORE.map((m) => {
      if (m.link) {
        return h('li', {}, h('a', { class: 'acc-head', href: `#/more/${m.key}` },
          h('span', { class: 'en' }, m.en), h('span', { class: 'jp' }, m.jp), h('span', { class: 'chev', 'aria-hidden': 'true' }, '→')));
      }
      const p = morePreview(m.key);
      const open = moreOpen.has(m.key);
      const li = h('li', { class: open ? 'open' : '' });
      const head = h('button', { class: 'acc-head', type: 'button', 'aria-expanded': String(open), onclick: () => {
        const now = !li.classList.contains('open');
        li.classList.toggle('open', now); head.setAttribute('aria-expanded', String(now));
        if (now) moreOpen.add(m.key); else moreOpen.delete(m.key);
      } }, h('span', { class: 'en' }, m.en), h('span', { class: 'jp' }, `${m.jp}・${p.n}`), h('span', { class: 'chev', 'aria-hidden': 'true' }, '+'));
      li.append(head, h('div', { class: 'acc-panel' }, h('div', { class: 'acc-inner' },
        p.items.length ? p.items : h('p', { class: 'muted' }, 'まだ何もありません。'),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', type: 'button', onclick: p.add }, '+ 書きたす'),
          h('a', { class: 'btn ghost small acc-all', href: `#/more/${m.key}` }, `ぜんぶ見る（${p.n}件）`)))));
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
  openForm({ title: topic ? '自分の答え' : 'お題を足す', en: 'Values', lead: topic ? 'このお題への自分の考え' : 'ふたりで答えたいお題と、自分の答え',
    fields: [{ ...F.title('お題', '例：理想の休日の過ごし方'), readonly: !!topic }, { name: 'body', type: 'textarea', label: '自分の考え', required: true, ph: '思っていることをそのまま' }],
    initial: mine || { title: topic || '' },
    onSubmit: (v) => (mine ? store.saveEntry({ id: mine.id, body: v.body }) : store.saveEntry({ section: 'value', title: v.title.trim(), body: v.body })) });
}
function valuesView(all, topics, p, write) {
  const side = (who, e, topic, isMe) => h('div', {},
    h('div', { class: 'who' }, who),
    e ? h('p', {}, e.body) : h('p', { class: 'muted' }, isMe ? 'まだ書いていません' : 'まだ書いていないみたい'),
    isMe && (e
      ? h('div', { class: 'row' }, h('button', { class: 'link', onclick: () => write(topic, e) }, 'なおす'),
        h('button', { class: 'link', onclick: () => removeEntry(e) }, '消す'))
      : h('button', { class: 'btn small', onclick: () => write(topic) }, '書く')));
  return h('div', {}, pageNav(true),
    pageHead('Values', '価値観 ― 同じお題に、ふたりそれぞれの答え', h('button', { class: 'btn', onclick: () => write() }, '+ お題を足す')),
    topics.length ? h('div', { class: 'cards' }, topics.map((t) => {
      const mine = all.find((e) => e.title === t && e.author === me());
      const theirs = all.find((e) => e.title === t && e.author !== me());
      return h('article', { class: 'card' }, h('h2', {}, t),
        h('div', { class: 'pair' }, side(nameOf(me()), mine, t, true), side(p ? nameOf(p.id) : 'あいて', theirs, t, false)));
    })) : h('p', { class: 'empty' }, 'お題を足して、ふたりの答えを並べてみよう。'));
}

/* ---------- 記念日 ---------- */
function addAnniv() {
  openForm({ title: '記念日を足す', en: 'Days', lead: '毎年その日に数えて、当日の朝に通知します', fields: [F.title('なんの日？', '例：はじめて旅行した日'), { ...F.date(), required: true }],
    onSubmit: (v) => store.saveEntry({ section: 'anniversary', title: v.title, date: v.date }) });
}
function annivPage() {
  const t = today();
  const custom = data.entries.filter((e) => e.section === 'anniversary' && e.date).sort((a, b) => (a.date < b.date ? -1 : 1));
  const block = (title, date, e) => {
    const n = daysBetween(date, t);
    const ny = nextYearly(date, t);
    const lines = [];
    if (n < 0) lines.push(`${md(date)}まで、あと${-n}日。`);
    else {
      if (!e) { const nm = nextMonthly(date, t); lines.push(nm.date === t ? `今日は ${spanLabel(nm.months)} の記念日！` : `つぎは ${spanLabel(nm.months)}（${md(nm.date)}）まで、あと${daysBetween(t, nm.date)}日。`); }
      else lines.push(ny.date === t && ny.years > 0 ? `今日でちょうど ${ny.years}年！` : `つぎは ${ny.years}年（${md(ny.date)}）まで、あと${daysBetween(t, ny.date)}日。`);
      lines.push(`${(Math.floor(n / 100) + 1) * 100}日まで、あと${(Math.floor(n / 100) + 1) * 100 - n}日。`);
    }
    return h('article', { class: 'card' },
      h('h2', {}, title), h('div', { class: 'meta' }, dots(date)),
      n >= 0 && h('div', { class: 'count' }, String(n), h('small', {}, '日')),
      lines.map((l) => h('p', {}, l)),
      e && e.author === me() && h('div', { class: 'row' },
        h('button', { class: 'link', onclick: () => openForm({ title: 'なおす', en: 'Days', fields: [F.title('なんの日？', '例：はじめて旅行した日'), { ...F.date(), required: true }], initial: e,
          onSubmit: (v) => store.saveEntry({ id: e.id, title: v.title, date: v.date }) }) }, 'なおす'),
        h('button', { class: 'link', onclick: () => removeEntry(e) }, '消す')));
  };
  const add = addAnniv;
  return h('div', {}, pageNav(true),
    pageHead('Days', '記念日 ― 日数は毎日ひとりでに進みます', h('button', { class: 'btn', onclick: add }, '+ 記念日を足す')),
    h('div', { class: 'cards' }, block('付き合いはじめた日', CONFIG.START_DATE), custom.map((e) => block(e.title, e.date, e))));
}

/* ---------- メンタルの記録 ---------- */
const LEVEL_SHORT = ['とてもつらい', 'つらい', 'ふつう', 'いい', 'とてもいい'];
const DOW = ['日', '月', '火', '水', '木', '金', '土'];
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
  svg.setAttribute('class', 'mchart'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', '気分の移り変わり');
  const pop = h('div', { class: 'mpop', hidden: true });
  const canvas = h('div', { class: 'mcanvas' }, svg, pop);
  const scroller = h('div', { class: 'mscroll' }, canvas);
  const spanLabelEl = h('span', { class: 'mspan' });
  const yax = h('div', { class: 'myax', 'aria-hidden': 'true' },
    [5, 4, 3, 2, 1].map((lv) => h('span', { style: `top:${yOf(lv)}px` }, LEVELS[lv - 1])));

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
      + '<stop offset="0" stop-color="#E79AAB" stop-opacity=".85"/><stop offset="1" stop-color="#E79AAB" stop-opacity=".12"/></linearGradient></defs>';

    // 月ごとの帯と、月の名前
    let { y: yy, m: mm } = parse(start);
    for (let guard = 0; guard < 400; guard++) {
      const ms = ymd(yy, mm, 1);
      if (ms > end) break;
      const ny = mm === 12 ? yy + 1 : yy, nm = mm === 12 ? 1 : mm + 1;
      const x0 = Math.max(0, x(ms)), x1 = Math.min(W, x(ymd(ny, nm, 1)));
      if ((yy * 12 + mm) % 2 === 0) s += `<rect x="${x0}" y="0" width="${Math.max(0, x1 - x0)}" height="${BASE}" fill="#16204F" fill-opacity=".045"/>`;
      if (ms >= start) s += `<line x1="${x(ms)}" x2="${x(ms)}" y1="0" y2="${BASE}" stroke="#16204F" stroke-opacity=".25" stroke-width="1"/>`;
      const lx = Math.max(x0, ms >= start ? x0 : PADL) + 7;
      if (x1 - lx > 34) s += `<text x="${lx}" y="22" class="mon">${MONTHS[mm - 1]}${mm === 1 || guard === 0 ? `<tspan class="yr" dx="5">${yy}</tspan>` : ''}</text>`;
      yy = ny; mm = nm;
    }
    // 気分の高さの目安線
    for (let lv = 1; lv <= 5; lv++) {
      s += `<line x1="0" x2="${W}" y1="${yOf(lv)}" y2="${yOf(lv)}" stroke="#16204F" stroke-opacity="${lv === 3 ? '.3' : '.16'}" stroke-width="1" stroke-dasharray="2 5"/>`;
    }
    // 線と、その下の塗り
    const P = list.map((m) => [x(m.date), yOf(m.level)]);
    const line = smoothPath(P);
    if (line) {
      s += `<path class="area${animate ? ' draw' : ''}" d="${line} L${P[P.length - 1][0]},${BASE} L${P[0][0]},${BASE} Z" fill="url(#mood-fill)"/>`
        + `<path class="line${animate ? ' draw' : ''}" pathLength="1" d="${line}" fill="none" stroke="#16204F" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    // 下の軸と日付
    s += `<line x1="0" x2="${W}" y1="${BASE}" y2="${BASE}" stroke="#16204F" stroke-width="2"/>`;
    const step = [1, 2, 7, 14].find((k) => k * DAY >= 42);
    const LABEL_DAYS = { 1: null, 2: null, 7: [1, 8, 15, 22], 14: [1, 15] };
    for (let d = start, i = 0; d <= end && i < 2000; d = addDays(d, 1), i++) {
      const px = x(d), { m: dm, d: dd } = parse(d);
      if (DAY >= 6) s += `<line x1="${px}" x2="${px}" y1="${BASE}" y2="${BASE + 5}" stroke="#16204F" stroke-opacity=".5" stroke-width="1"/>`;
      if (!step) continue;
      const show = step === 1 || (step === 2 ? dd % 2 === 1 && dd < 31 : LABEL_DAYS[step].includes(dd));
      if (show) s += `<text x="${px}" y="${BASE + 22}" text-anchor="middle" class="tick">${step >= 7 || dd === 1 ? `${dm}/${dd}` : dd}</text>`;
    }
    const tx = x(t);
    s += `<line x1="${tx}" x2="${tx}" y1="${TOP - 26}" y2="${BASE + 30}" stroke="#16204F" stroke-width="1.5" stroke-dasharray="4 4"/>`
      + `<rect x="${tx - 26}" y="${BASE + 31}" width="52" height="20" rx="10" fill="#16204F"/>`
      + `<text x="${tx}" y="${BASE + 46}" text-anchor="middle" class="tick now">TODAY</text>`;
    // 点（メモがある日は中に小さな印）
    for (const m of list) {
      const on = m.date === moodPop, cx = x(m.date), cy = yOf(m.level);
      s += `<g class="pt${on ? ' on' : ''}" data-date="${m.date}" role="button" tabindex="0" aria-label="${dots(m.date)} ${LEVEL_SHORT[m.level - 1]}${m.note ? '（メモあり）' : ''}">`
        + `<line x1="${cx}" x2="${cx}" y1="${BASE}" y2="${BASE + 9}" stroke="#16204F" stroke-width="2"/>`
        + `<circle cx="${cx}" cy="${cy}" r="20" fill="transparent"/>`
        + `<circle cx="${cx}" cy="${cy}" r="${on ? 9 : 7}" fill="${on ? '#16204F' : '#FBF1EF'}" stroke="#16204F" stroke-width="2.5"/>`
        + (m.note ? `<circle cx="${cx}" cy="${cy}" r="2.4" fill="${on ? '#F2C4CE' : '#16204F'}"/>` : '')
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
      '編集', h('span', { 'aria-hidden': 'true' }, '↓'));
    pop.replaceChildren(
      h('div', { class: 'mpop-head' },
        h('span', { class: 'mpop-d' }, `${py === parse(t).y ? '' : `${py}.`}${pm}.${pd}`, h('small', {}, DOW[new Date(utc(m.date)).getUTCDay()])),
        h('span', { class: 'mpop-lv' }, LEVEL_SHORT[m.level - 1])),
      h('p', { class: m.note ? 'mpop-note' : 'mpop-note none' }, m.note || 'メモはありません'),
      h('div', { class: 'mpop-foot' }, editBtn));
    pop.setAttribute('aria-label', `${md(m.date)}の記録`);
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
    stat('記録した日', String(list.length), '日ぶん'),
    stat('いちばん最近', last ? LEVEL_SHORT[last.level - 1] : '—', last ? (parse(last.date).y === parse(t).y ? dots(last.date).slice(5) : dots(last.date)) : 'まだなし', true),
    stat('この30日をならすと', avg ? avg.toFixed(1) : '—', avg ? `5段階で・${LEVEL_SHORT[Math.round(avg) - 1]}寄り` : '記録なし'));

  return h('div', { class: 'mood' }, stats,
    h('div', { class: 'mwrap' },
      h('div', { class: 'mbody' }, scroller, yax,
        !list.length && h('p', { class: 'mempty' }, 'まだ記録がありません。', h('br'), '下の「気分を追加」から。')),
      h('div', { class: 'mctrl' },
        h('div', { class: 'mzoom' },
          h('button', { type: 'button', 'aria-label': '期間を広く（縮める）', onclick: () => zoomBy(1 / 1.6) }, '−'),
          spanLabelEl,
          h('button', { type: 'button', 'aria-label': '期間をせまく（広げる）', onclick: () => zoomBy(1.6) }, '+')),
        h('button', { type: 'button', class: 'mnow', onclick: () => scroller.scrollTo({ left: W, behavior: 'smooth' }) }, 'TODAY →'))));
}

function moodPage() {
  const t = today();
  const mine = data.moods.filter((m) => m.user_id === me()).sort((a, b) => (a.date < b.date ? -1 : 1));
  const byDay = new Map(mine.map((m) => [m.date, m]));
  if (!moodSel || moodSel > t) moodSel = t;

  const v = {};
  const err = h('p', { class: 'err', role: 'alert' });
  const status = h('p', { class: 'mstatus' });
  const levelBtns = LEVELS.map((label, i) => h('button', { type: 'button', onclick: () => { v.level = i + 1; paint(); } }, label));
  const paint = () => levelBtns.forEach((b, i) => { b.classList.toggle('on', v.level === i + 1); b.setAttribute('aria-pressed', String(v.level === i + 1)); });
  const note = h('textarea', { placeholder: 'なにがあった？（なくてもいい）', oninput: (ev) => { v.note = ev.target.value; } });
  const saveBtn = h('button', { class: 'btn', type: 'submit' });
  const del = h('button', { type: 'button', class: 'link', onclick: () => { if (confirm('この日の記録を消しますか？')) act(() => store.removeMood(v.id)); } }, 'この日の記録を消す');
  const loadDay = (d) => {
    const m = byDay.get(d);
    v.id = m?.id; v.level = m?.level; v.note = m?.note || '';
    note.value = v.note; paint(); err.textContent = '';
    status.textContent = m ? `${md(d)}の記録があります。なおせます。` : `${md(d)}は、どんな気分だった？`;
    saveBtn.textContent = m ? 'なおす' : '記録する';
    del.hidden = !m;
  };
  const form = h('form', { class: 'madd', id: 'mood-add', onsubmit: (ev) => {
    ev.preventDefault();
    if (!v.level) { err.textContent = '気分をえらんでください。'; return; }
    const row = { date: moodSel, level: v.level, note: v.note || '', shared: false };
    act(() => store.saveMood(v.id ? { id: v.id, ...row } : row));
  } });
  const strip = dayStrip({ value: moodSel, max: t, marks: new Set(byDay.keys()), onChange: (d) => { moodSel = d; loadDay(d); } });
  const editFromChart = (d) => {
    moodSel = d; draw();
    requestAnimationFrame(() => document.getElementById('mood-add')?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' }));
  };
  form.append(
    h('h2', { class: 'en madd-title' }, 'Add mood'), h('p', { class: 'jp' }, '気分を追加'),
    strip, status,
    h('div', { class: 'levels' }, levelBtns),
    h('label', { class: 'field' }, h('span', { class: 'flabel' }, 'メモ', h('span', { class: 'opt' }, 'なくてもOK')), note),
    err, h('div', { class: 'row' }, saveBtn, del));
  loadDay(moodSel);

  return h('div', {}, pageNav(),
    pageHead('Mood', 'メンタルの記録 ― 思い出したときに、印象に残っている日をざっくりと'),
    moodChart(mine, editFromChart),
    h('p', { class: 'muted mhint' }, '点をタップでメモ、2本指で広げると期間が変わります。ここは自分にしか見えません。'),
    h('button', { class: 'down', type: 'button', onclick: () => form.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, '気分を追加', h('span', { 'aria-hidden': 'true' }, '↓')),
    form);
}

/* ---------- 設定 ---------- */
const b64ToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('このブラウザでは通知を受け取れません。iPhoneの場合は、共有ボタンから「ホーム画面に追加」して、そのアイコンから開いてください。');
  }
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('通知が許可されませんでした。端末の設定で許可してください。');
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
    alert('写真をまとめられなかったので、文章だけを保存しました。');
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
  const backupBtn = h('button', { class: 'btn ghost', onclick: async () => { backupBtn.disabled = true; try { await backup(); } finally { backupBtn.disabled = false; } } }, 'バックアップを保存する');
  return h('div', {}, pageNav(true), pageHead('Settings', '設定'),
    h('div', { class: 'cards' },
      h('section', { class: 'card' }, h('h2', {}, '名前'),
        h('div', { class: 'row', style: 'flex-wrap: nowrap' }, name,
          h('button', { class: 'btn', onclick: () => act(() => store.saveProfile({ display_name: name.value.trim() })) }, '保存'))),
      h('section', { class: 'card' }, h('h2', {}, '記念日の通知'),
        h('label', { class: 'check' }, toggle, 'この端末で通知を受け取る'),
        h('p', { class: 'muted' }, canPush
          ? '月ごとの記念日・100日ごと・足した記念日の当日、朝8時ごろに届きます。iPhoneは「ホーム画面に追加」したアイコンから開いてオンにしてください。'
          : '通知は、本番の保存先と通知の鍵を設定すると使えるようになります。')),
      h('section', { class: 'card' }, h('h2', {}, 'バックアップ'),
        h('p', {}, '書いた内容と写真を、ひとつのファイルにまとめてこの端末に保存します。'), backupBtn),
      store.mode === 'demo'
        ? h('section', { class: 'card' }, h('h2', {}, 'お試しモード'),
          h('p', {}, `いまは「${nameOf(me())}」として見ています。`),
          h('div', { class: 'row' },
            h('button', { class: 'btn ghost', onclick: () => { store.switchUser(); refresh(); } }, `${partner() ? nameOf(partner().id) : 'あいて'}の画面に切りかえる`),
            h('button', { class: 'link', onclick: () => { if (confirm('お試しで書いた内容をぜんぶ消しますか？')) { localStorage.removeItem('our-odyssey-demo'); location.reload(); } } }, 'お試しデータを消す')))
        : h('section', { class: 'card' }, h('h2', {}, 'ログアウト'),
          h('button', { class: 'btn ghost', onclick: async () => { await store.signOut(); location.hash = '#/'; start(); } }, 'ログアウトする'))));
}

/* ---------- ログイン ---------- */
function loginPage() {
  const email = h('input', { type: 'text', required: true, autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false' });
  const toEmail = (v) => (v.includes('@') ? v.trim() : `${v.trim().toLowerCase()}@${CONFIG.LOGIN_DOMAIN}`);
  const pw = h('input', { type: 'password', required: true, autocomplete: 'current-password' });
  const err = h('p', { class: 'err' });
  return h('div', {}, h('div', { class: 'nav' }, h('span'), h('span', { class: 'word' }, 'Our Odyssey'), h('span')),
    h('div', { class: 'head' }, h('h1', {}, 'Login'), h('p', { class: 'jp' }, 'ふたりだけの場所です')),
    h('form', { style: 'display: flex; flex-direction: column; gap: 14px', onsubmit: async (ev) => {
      ev.preventDefault(); err.textContent = '';
      try { await store.signIn(toEmail(email.value), pw.value); await start(); }
      catch { err.textContent = 'ログインできませんでした。名前とパスワードを確かめてください。'; }
    } },
      h('label', {}, '名前（半角の英数字）', email), h('label', {}, 'パスワード', pw), err,
      h('button', { class: 'btn', type: 'submit' }, 'ログイン')));
}

/* ---------- ネットがないときも書けるように ---------- */
// 書いたものはいったん端末にあずけ、つながったら送る（store.js）。ここでは今の状態を小さく出す。
const syncPill = h('div', { class: 'sync', role: 'status', 'aria-live': 'polite', hidden: true });
function showSync() {
  const n = store.pending?.() || 0;
  const off = !navigator.onLine;
  syncPill.hidden = !(off || n);
  syncPill.textContent = off
    ? (n ? `オフライン中・${n}件をあとで送ります` : 'オフライン中・書いたものはあとで送ります')
    : `${n}件を送っています…`;
}
let syncReady = false;
function setupSync() {
  if (syncReady || store.mode !== 'supabase' || !store.flush) return;
  syncReady = true;
  document.body.append(syncPill);
  store.onChange = showSync;
  store.onSync = ({ sent, failed }) => {
    if (failed.length) alert(`送れなかった記録がありました：${failed[0].error.message || failed[0].error}`);
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
  }).catch(() => {});
}

async function start() {
  try {
    store ??= await createStore();
    if (!store.user()) { app.replaceChildren(loginPage()); return; }
    await refresh();
    setupSync();
    // 地図の部品は、最初の画面が出たあと手があいたときに先に読みこんでおく
    (window.requestIdleCallback || ((f) => setTimeout(f, 2500)))(() => leaflet().catch(() => {}).finally(setupOffline));
  } catch (e) {
    app.replaceChildren(h('p', { class: 'empty' }, `読みこめませんでした：${e.message || e}`));
  }
}
start();
