import { CONFIG } from './config.js';
import { createStore } from './store.js';

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
  const img = h('img', { class: cls, alt: '', loading: 'lazy' });
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
async function refresh() { await load(); draw(); }
function draw() {
  const [, a, b] = location.hash.split('/');
  const page = { s: () => sectionPage(b), values: valuesPage, anniv: annivPage, timeline: timelinePage, mood: moodPage, settings: settingsPage }[a] || home;
  app.replaceChildren(page());
}
window.addEventListener('hashchange', () => { if (store?.user()) { draw(); window.scrollTo(0, 0); } });

const MENU = [
  ['#/s/place', 'Places', '過ごした場所'],
  ['#/s/like', 'Likes', '好きなもの'],
  ['#/s/wish', 'Wishes', '行きたいところ'],
  ['#/s/gift', 'Gifts', '贈ったもの'],
  ['#/values', 'Values', '価値観'],
  ['#/s/dislike', 'Dislikes', '嫌いなもの'],
  ['#/anniv', 'Days', '記念日'],
  ['#/timeline', 'Timeline', '年表'],
  ['#/mood', 'Mood', 'メンタルの記録'],
];
const menuList = (onpick) => h('ul', { class: 'menu' }, MENU.map(([href, en, jp]) =>
  h('li', {}, h('a', { href, onclick: onpick }, h('span', { class: 'en' }, en), h('span', { class: 'jp' }, jp)))));

function openMenu() {
  const dlg = h('dialog', { class: 'sheet-dlg', 'aria-label': 'メニュー' });
  dlg.append(h('div', { class: 'menu-sheet' },
    h('div', { class: 'nav' }, h('span', { class: 'word' }, 'Menu'),
      h('button', { class: 'link', onclick: () => closeDialog(dlg) }, 'とじる')),
    menuList(() => dlg.close())));
  showDialog(dlg);
}
const pageNav = () => h('div', { class: 'nav' },
  h('a', { class: 'link', href: '#/' }, '← ホーム'),
  h('a', { class: 'word', href: '#/' }, 'Our Odyssey'),
  h('button', { class: 'link', onclick: openMenu }, 'メニュー'));
const pageHead = (en, jp, ...extra) => h('div', { class: 'head' }, h('h1', {}, en), h('p', { class: 'jp' }, jp), extra);

/* ---------- ホーム ---------- */
function home() {
  const t = today();
  const days = daysBetween(CONFIG.START_DATE, t);
  const nm = nextMonthly(CONFIG.START_DATE, t);
  const left = daysBetween(t, nm.date);
  const banners = [];
  if (left === 0) banners.push(`今日は ${spanLabel(nm.months)} の記念日！`);
  if (days > 0 && days % 100 === 0) banners.push(`今日で ${days}日！`);
  for (const e of data.entries.filter((x) => x.section === 'anniversary' && x.date)) {
    const ny = nextYearly(e.date, t);
    if (ny.date === t && ny.years > 0) banners.push(`今日は「${e.title}」から ${ny.years}年！`);
  }
  const upcoming = left === 0 ? nextMonthly(CONFIG.START_DATE, addDays(t, 1)) : nm;
  const hero = (k) => data.entries.filter((e) => e.section === 'hero' && e.category === k).sort(byCreated).pop();
  const slot = (k, label) => {
    const e = hero(k);
    const b = h('button', { class: `slot ${k}${e ? ' has' : ''}`, 'aria-label': `${label}をえらぶ`, onclick: () => setHero(k, e) },
      h('span', {}, `[${label}]`));
    if (e) store.photoUrl(e.photo).then((u) => { b.style.backgroundImage = `url("${u}")`; });
    return b;
  };
  return h('div', {},
    h('div', { class: 'home' },
      h('div', { class: 'nav' },
        h('button', { class: 'link', onclick: openMenu }, 'メニュー'),
        h('span', { class: 'word' }, 'Our Odyssey'),
        h('a', { class: 'link', href: '#/settings' }, '設定')),
      h('div', { class: 'tag' }, `Since ${dots(CONFIG.START_DATE)}`),
      h('p', { class: 'big first' }, String(days)),
      h('p', { class: 'big' }, 'Days'),
      h('p', { class: 'sub' }, `つぎの記念日は ${md(upcoming.date)}。`, h('br'),
        `${spanLabel(upcoming.months)}まで、あと${daysBetween(t, upcoming.date)}日。`),
      h('div', { class: 'stage' },
        slot('a', 'ふたりの写真'), slot('b', '思い出の品の写真'),
        h('img', { class: 'flower blue', src: 'assets/tulip-blue.webp', alt: '' }),
        h('img', { class: 'flower pink', src: 'assets/tulip-pink.webp', alt: '' }))),
    banners.map((b) => h('div', { class: 'banner' }, b)),
    store.mode === 'demo' && h('p', { class: 'note' }, 'お試しモード：書いた内容はこの端末にだけ保存されます。'),
    menuList());
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
function openForm({ title, en, lead, fields, initial = {}, onSubmit }) {
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
  const dlg = h('dialog', { class: 'modal', 'aria-label': title });
  dlg.guard = () => !dirty || confirm('書きかけの内容を捨てて閉じますか？');
  const submit = h('button', { class: 'btn', type: 'submit' }, '保存する');
  dlg.append(h('form', { class: 'sheet', novalidate: true, onsubmit: async (ev) => {
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
      closeDialog(dlg, true); await refresh();
    } catch (e) { err.textContent = e.message || String(e); submit.disabled = false; }
  } },
    h('div', { class: 'mhead' },
      h('div', {}, en && h('div', { class: 'tag' }, en), h('h2', {}, title), lead && h('p', { class: 'lead' }, lead)),
      h('button', { type: 'button', class: 'x', 'aria-label': 'とじる', onclick: () => closeDialog(dlg) }, '×')),
    h('div', { class: 'mbody' }, fields.map(control)),
    h('div', { class: 'mfoot' }, err, h('div', { class: 'row' }, submit,
      h('button', { class: 'btn ghost', type: 'button', onclick: () => closeDialog(dlg) }, 'やめる')))));
  showDialog(dlg);
}

/* ---------- 各欄 ---------- */
const F = {
  title: (label, ph) => ({ name: 'title', type: 'text', label, required: true, ph }),
  date: (label = '日付') => ({ name: 'date', type: 'date', label }),
  body: { name: 'body', type: 'textarea', label: 'ひとこと', ph: 'そのときのこと、思ったことを自由に' },
  geo: { type: 'geo', label: '地図の場所', hint: '入れておくと PLACES の地図にピンが立ちます' },
  photo: { type: 'photo', label: '写真' },
};
const LIKE_CATS = ['食べ物', '飲み物', '仕草', '場所', '曲'];
const SECTIONS = {
  place: { en: 'Places', jp: '過ごした場所', lead: 'ふたりで過ごした場所を残す', fields: () => [F.title('場所の名前', '例：江ノ島の水族館'), F.date('行った日'), F.body, F.geo, F.photo] },
  like: { en: 'Likes', jp: '好きなもの', lead: '相手の「好き」をメモしておく', fields: () => [
    { name: 'category', type: 'category', label: '種類', required: true, options: likeCats(), ph: 'えらぶか、自由に書く' }, F.title('好きなもの', '例：抹茶ラテ'), F.body, F.geo, F.photo] },
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
  const edit = () => openForm({ title: 'なおす', en: S.en, fields: S.fields(), initial: e,
    onSubmit: (v) => store.saveEntry({ id: e.id, title: v.title, body: v.body, date: v.date, category: v.category, lat: v.lat, lng: v.lng, photo: v.photo }) });
  const addPhoto = async () => {
    const f = await pickFile(); if (!f) return;
    act(async () => store.saveEntry({ id: e.id, photo: await store.uploadPhoto(await shrink(f)) }));
  };
  const went = () => openForm({ title: '行った！', en: 'Places', lead: `「${e.title}」に行った日を残す`, initial: { ...e, date: today() },
    fields: [F.date('行った日'), F.body, F.photo],
    onSubmit: (v) => store.saveEntry({ id: e.id, section: 'place', date: v.date, body: v.body, photo: v.photo }) });
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
function sectionPage(key) {
  const S = SECTIONS[key];
  if (!S) return home();
  let items = data.entries.filter((e) => e.section === key);
  items.sort((a, b) => ((b.date || b.created_at) < (a.date || a.created_at) ? -1 : 1));
  const add = () => openForm({ title: '書きたす', en: S.en, lead: S.lead, fields: S.fields(), initial: key === 'like' && likeFilter ? { category: likeFilter } : {},
    onSubmit: (v) => store.saveEntry({ section: key, title: v.title, body: v.body || '', date: v.date || null, category: v.category || null, lat: v.lat ?? null, lng: v.lng ?? null, photo: v.photo || null }) });
  let chips = null;
  if (key === 'like') {
    const cats = likeCats();
    if (likeFilter && !cats.includes(likeFilter)) likeFilter = '';
    chips = h('div', { class: 'chips' }, ['', ...cats].map((c) =>
      h('button', { class: `chip${likeFilter === c ? ' on' : ''}`, onclick: () => { likeFilter = c; draw(); } }, c || 'ぜんぶ')));
    if (likeFilter) items = items.filter((e) => e.category === likeFilter);
  }
  let mapEl = null;
  if (key === 'place') {
    const pts = data.entries.filter((e) => e.lat != null && ['place', 'like', 'wish'].includes(e.section));
    if (pts.length) {
      mapEl = h('div', { class: 'map' });
      leaflet().then((L) => {
        const map = L.map(mapEl);
        L.tileLayer(TILE, { attribution: ATTR, maxZoom: 19 }).addTo(map);
        const fill = { place: '#16204F', like: '#E79AAB', wish: '#FBF1EF' };
        for (const e of pts) pin(L, e.lat, e.lng, fill[e.section]).addTo(map).bindPopup(h('b', {}, e.title));
        if (pts.length === 1) map.setView([pts[0].lat, pts[0].lng], 13);
        else map.fitBounds(pts.map((e) => [e.lat, e.lng]), { padding: [30, 30] });
      }).catch(() => {});
    }
  }
  return h('div', {}, pageNav(),
    pageHead(S.en, S.jp, h('button', { class: 'btn', onclick: add }, '+ 書きたす')),
    chips, mapEl,
    mapEl && h('p', { class: 'muted' }, '紺：過ごした場所　ピンク：好きな場所　白：行きたいところ'),
    items.length ? h('div', { class: 'cards' }, items.map((e) => entryCard(e, key)))
      : h('p', { class: 'empty' }, 'まだ何もありません。「+ 書きたす」から最初のひとつを。'));
}

/* ---------- 価値観 ---------- */
function valuesPage() {
  const all = data.entries.filter((e) => e.section === 'value').sort(byCreated);
  const topics = [...new Set(all.map((e) => e.title))];
  const p = partner();
  const write = (topic, mine) => openForm({ title: topic ? '自分の答え' : 'お題を足す', en: 'Values', lead: topic ? 'このお題への自分の考え' : 'ふたりで答えたいお題と、自分の答え',
    fields: [{ ...F.title('お題', '例：理想の休日の過ごし方'), readonly: !!topic }, { name: 'body', type: 'textarea', label: '自分の考え', required: true, ph: '思っていることをそのまま' }],
    initial: mine || { title: topic || '' },
    onSubmit: (v) => (mine ? store.saveEntry({ id: mine.id, body: v.body }) : store.saveEntry({ section: 'value', title: v.title.trim(), body: v.body })) });
  const side = (who, e, topic, isMe) => h('div', {},
    h('div', { class: 'who' }, who),
    e ? h('p', {}, e.body) : h('p', { class: 'muted' }, isMe ? 'まだ書いていません' : 'まだ書いていないみたい'),
    isMe && (e
      ? h('div', { class: 'row' }, h('button', { class: 'link', onclick: () => write(topic, e) }, 'なおす'),
        h('button', { class: 'link', onclick: () => removeEntry(e) }, '消す'))
      : h('button', { class: 'btn small', onclick: () => write(topic) }, '書く')));
  return h('div', {}, pageNav(),
    pageHead('Values', '価値観 ― 同じお題に、ふたりそれぞれの答え', h('button', { class: 'btn', onclick: () => write() }, '+ お題を足す')),
    topics.length ? h('div', { class: 'cards' }, topics.map((t) => {
      const mine = all.find((e) => e.title === t && e.author === me());
      const theirs = all.find((e) => e.title === t && e.author !== me());
      return h('article', { class: 'card' }, h('h2', {}, t),
        h('div', { class: 'pair' }, side(nameOf(me()), mine, t, true), side(p ? nameOf(p.id) : 'あいて', theirs, t, false)));
    })) : h('p', { class: 'empty' }, 'お題を足して、ふたりの答えを並べてみよう。'));
}

/* ---------- 記念日 ---------- */
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
  const add = () => openForm({ title: '記念日を足す', en: 'Days', lead: '毎年その日に数えて、当日の朝に通知します', fields: [F.title('なんの日？', '例：はじめて旅行した日'), { ...F.date(), required: true }],
    onSubmit: (v) => store.saveEntry({ section: 'anniversary', title: v.title, date: v.date }) });
  return h('div', {}, pageNav(),
    pageHead('Days', '記念日 ― 日数は毎日ひとりでに進みます', h('button', { class: 'btn', onclick: add }, '+ 記念日を足す')),
    h('div', { class: 'cards' }, block('付き合いはじめた日', CONFIG.START_DATE), custom.map((e) => block(e.title, e.date, e))));
}

/* ---------- 年表 ---------- */
function timelinePage() {
  const kind = { gift: '贈りもの', place: '過ごした場所', anniversary: '記念日' };
  const items = [{ date: CONFIG.START_DATE, title: '付き合いはじめた日', k: '記念日' },
    ...data.entries.filter((e) => e.date && kind[e.section]).map((e) => ({ date: e.date, title: e.title, k: kind[e.section], photo: e.photo }))];
  items.sort((a, b) => (a.date < b.date ? 1 : -1));
  const out = [];
  let year = null, group = null;
  for (const it of items) {
    const y = it.date.slice(0, 4);
    if (y !== year) { year = y; group = h('div', { class: 'tl' }); out.push(h('div', { class: 'year' }, y), group); }
    group.append(h('div', { class: 'it' },
      h('div', { class: 'd' }, dots(it.date).slice(5)), h('div', { class: 't' }, it.title),
      h('div', { class: 'muted' }, it.k), it.photo && photoImg(it.photo, '')));
  }
  return h('div', {}, pageNav(), pageHead('Timeline', '年表 ― 日付のあるものが新しい順に並びます'), out);
}

/* ---------- メンタルの記録 ---------- */
const LEVEL_SHORT = ['とてもつらい', 'つらい', 'ふつう', 'いい', 'とてもいい'];
let moodSel = null;

// 横にスクロールする気分の線。1日 = DAY px。
function moodChart(list, selected, onPick) {
  const t = today();
  const DAY = 14, H = 300, TOP = 30, BASE = 236, PADX = 28;
  const first = list.length && list[0].date < addDays(t, -30) ? list[0].date : addDays(t, -30);
  const start = addDays(first, -3), end = addDays(t, 3);
  const W = PADX * 2 + daysBetween(start, end) * DAY;
  const x = (d) => PADX + daysBetween(start, d) * DAY;
  const y = (lv) => BASE - 22 - ((lv - 1) / 4) * (BASE - 22 - TOP);
  const r1 = (n) => Math.round(n * 10) / 10;
  const P = list.map((m) => [r1(x(m.date)), r1(y(m.level))]);
  const clampY = (v) => Math.min(BASE - 4, Math.max(TOP - 8, v));
  let line = '';
  if (P.length > 1) {
    line = `M${P[0]}`;
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || p2;
      const c1 = [r1(p1[0] + (p2[0] - p0[0]) / 6), r1(clampY(p1[1] + (p2[1] - p0[1]) / 6))];
      const c2 = [r1(p2[0] - (p3[0] - p1[0]) / 6), r1(clampY(p2[1] - (p3[1] - p1[1]) / 6))];
      line += ` C${c1} ${c2} ${p2}`;
    }
  }
  let s = '';
  if (line) s += `<path d="${line} L${P[P.length - 1][0]},${BASE} L${P[0][0]},${BASE} Z" fill="#E79AAB" fill-opacity=".45"/>`
    + `<path d="${line}" fill="none" stroke="#16204F" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (selected) s += `<line x1="${x(selected)}" x2="${x(selected)}" y1="${TOP - 18}" y2="${BASE}" stroke="#16204F" stroke-width="1.5" stroke-dasharray="3 4"/>`;
  s += `<line x1="0" x2="${W}" y1="${BASE}" y2="${BASE}" stroke="#16204F" stroke-width="2"/>`;
  // 目盛り：記録した日（近すぎるものは日付を省く）と「今」
  let lastLabel = -Infinity;
  const tx = x(t);
  for (const m of list) {
    const px = x(m.date);
    s += `<line x1="${px}" x2="${px}" y1="${BASE}" y2="${BASE + 10}" stroke="#16204F" stroke-width="2"/>`;
    if (px - lastLabel >= 40 && tx - px >= 30) {
      const { m: mm, d } = parse(m.date);
      s += `<text x="${px}" y="${BASE + 30}" text-anchor="middle" class="tick">${mm}/${d}</text>`;
      lastLabel = px;
    }
  }
  s += `<line x1="${tx}" x2="${tx}" y1="${BASE}" y2="${BASE + 12}" stroke="#16204F" stroke-width="2.5"/>`
    + `<text x="${tx}" y="${BASE + 32}" text-anchor="middle" class="tick now">今</text>`;
  for (const m of list) {
    const on = m.date === selected;
    s += `<g class="pt" data-date="${m.date}" role="button" tabindex="0" aria-label="${dots(m.date)} ${LEVEL_SHORT[m.level - 1]}">`
      + `<circle cx="${x(m.date)}" cy="${y(m.level)}" r="18" fill="transparent"/>`
      + `<circle cx="${x(m.date)}" cy="${y(m.level)}" r="${on ? 8 : 6}" fill="${on ? '#16204F' : '#F2C4CE'}" stroke="#16204F" stroke-width="2.5"/></g>`;
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', W); svg.setAttribute('height', H);
  svg.setAttribute('class', 'mchart'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', '気分の移り変わり');
  svg.innerHTML = s;
  const hit = (ev) => { const g = ev.target.closest('.pt'); if (g) onPick(g.dataset.date); };
  svg.addEventListener('click', hit);
  svg.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') hit(ev); });

  const scroller = h('div', { class: 'mscroll' }, svg);
  const go = (k) => scroller.scrollBy({ left: k * scroller.clientWidth * 0.7, behavior: 'smooth' });
  const toSel = () => {
    const px = selected && selected !== t ? x(selected) : W;
    scroller.scrollLeft = px - scroller.clientWidth * (selected && selected !== t ? 0.5 : 1);
  };
  const ro = new ResizeObserver(() => { if (scroller.clientWidth) { toSel(); ro.disconnect(); } });
  ro.observe(scroller);
  return h('div', { class: 'mwrap' },
    h('div', { class: 'mlegend' }, h('span', {}, '↑ いい'), h('span', {}, '↓ つらい')),
    scroller,
    h('button', { class: 'arrow l', type: 'button', 'aria-label': '前の日々へ', onclick: () => go(-1) }, '←'),
    h('button', { class: 'arrow r', type: 'button', 'aria-label': '最近へ', onclick: () => go(1) }, '→'),
    !list.length && h('p', { class: 'mempty' }, 'まだ記録がありません。', h('br'), '下の「気分を追加」から。'));
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
  const pickFromChart = (d) => { moodSel = d; draw(); requestAnimationFrame(() => document.getElementById('mood-add')?.scrollIntoView({ behavior: 'smooth', block: 'start' })); };
  form.append(
    h('h2', { class: 'en madd-title' }, 'Add mood'), h('p', { class: 'jp' }, '気分を追加'),
    strip, status,
    h('div', { class: 'levels' }, levelBtns),
    h('label', { class: 'field' }, h('span', { class: 'flabel' }, 'メモ', h('span', { class: 'opt' }, 'なくてもOK')), note),
    err, h('div', { class: 'row' }, saveBtn, del));
  loadDay(moodSel);

  return h('div', {}, pageNav(),
    pageHead('Mood', 'メンタルの記録 ― 思い出したときに、印象に残っている日をざっくりと'),
    moodChart(mine, moodSel, pickFromChart),
    h('p', { class: 'muted mhint' }, '点をタップすると、その日の記録をなおせます。ここは自分にしか見えません。'),
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
  return h('div', {}, pageNav(), pageHead('Settings', '設定'),
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
    pageHead('Login', 'ふたりだけの場所です'),
    h('form', { style: 'display: flex; flex-direction: column; gap: 14px', onsubmit: async (ev) => {
      ev.preventDefault(); err.textContent = '';
      try { await store.signIn(toEmail(email.value), pw.value); await start(); }
      catch { err.textContent = 'ログインできませんでした。名前とパスワードを確かめてください。'; }
    } },
      h('label', {}, '名前（半角の英数字）', email), h('label', {}, 'パスワード', pw), err,
      h('button', { class: 'btn', type: 'submit' }, 'ログイン')));
}

async function start() {
  try {
    store ??= await createStore();
    if (!store.user()) { app.replaceChildren(loginPage()); return; }
    await refresh();
  } catch (e) {
    app.replaceChildren(h('p', { class: 'empty' }, `読みこめませんでした：${e.message || e}`));
  }
}
start();
