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
  const dlg = h('dialog');
  dlg.append(h('div', { class: 'menu-sheet' },
    h('div', { class: 'nav' }, h('span', { class: 'word' }, 'Menu'),
      h('button', { class: 'link', onclick: () => dlg.close() }, 'とじる')),
    menuList(() => dlg.close())));
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
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

function openForm({ title, fields, initial = {}, onSubmit }) {
  const v = { ...initial };
  let newPhoto = null;
  const err = h('p', { class: 'err' });
  const control = (f) => {
    if (f.type === 'geo') return geoField(v);
    if (f.type === 'photo') {
      const prev = v.photo ? photoImg(v.photo, 'preview') : h('img', { class: 'preview', alt: '', hidden: true });
      return h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn ghost small', onclick: async () => {
          const file = await pickFile(); if (!file) return;
          newPhoto = await shrink(file); prev.hidden = false; prev.src = URL.createObjectURL(newPhoto);
        } }, v.photo ? '写真をかえる' : '写真を載せる'), prev);
    }
    if (f.type === 'level') {
      const btns = LEVELS.map((label, i) => h('button', { type: 'button', class: v.level === i + 1 ? 'on' : '', style: 'white-space: pre-line',
        onclick: () => { v.level = i + 1; btns.forEach((b, j) => b.classList.toggle('on', j === i)); } }, label));
      return h('label', {}, f.label, h('div', { class: 'levels' }, btns));
    }
    if (f.type === 'check') {
      return h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: !!v[f.name], onchange: (ev) => { v[f.name] = ev.target.checked; } }), f.label);
    }
    const common = { value: v[f.name] ?? '', required: f.required, readonly: f.readonly, oninput: (ev) => { v[f.name] = ev.target.value; } };
    if (f.type === 'textarea') return h('label', {}, f.label, h('textarea', common));
    if (f.type === 'category') {
      const id = `dl-${f.name}`;
      return h('label', {}, f.label, h('input', { type: 'text', list: id, placeholder: 'えらぶか、自由に書く', ...common }),
        h('datalist', { id }, f.options.map((o) => h('option', { value: o }))));
    }
    return h('label', {}, f.label, h('input', { type: f.type, ...common }));
  };
  const dlg = h('dialog');
  const submit = h('button', { class: 'btn', type: 'submit' }, '保存する');
  dlg.append(h('form', { class: 'sheet', onsubmit: async (ev) => {
    ev.preventDefault(); err.textContent = '';
    if (fields.some((f) => f.type === 'level') && !v.level) { err.textContent = '気分をえらんでください。'; return; }
    submit.disabled = true;
    try {
      if (newPhoto) v.photo = await store.uploadPhoto(newPhoto);
      for (const f of fields) if (f.type === 'date' && !v[f.name]) v[f.name] = null;
      await onSubmit(v); dlg.close(); await refresh();
    } catch (e) { err.textContent = e.message || String(e); submit.disabled = false; }
  } },
    h('h2', {}, title), fields.map(control), err,
    h('div', { class: 'row' }, submit, h('button', { class: 'btn ghost', type: 'button', onclick: () => dlg.close() }, 'やめる'))));
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}

/* ---------- 各欄 ---------- */
const F = {
  title: (label) => ({ name: 'title', type: 'text', label, required: true }),
  date: (label = '日付') => ({ name: 'date', type: 'date', label }),
  body: { name: 'body', type: 'textarea', label: 'ひとこと' },
  geo: { type: 'geo' }, photo: { type: 'photo' },
};
const LIKE_CATS = ['食べ物', '飲み物', '仕草', '場所', '曲'];
const SECTIONS = {
  place: { en: 'Places', jp: '過ごした場所', fields: () => [F.title('場所の名前'), F.date('行った日'), F.body, F.geo, F.photo] },
  like: { en: 'Likes', jp: '好きなもの', fields: () => [
    { name: 'category', type: 'category', label: '種類', required: true, options: likeCats() }, F.title('好きなもの'), F.body, F.geo, F.photo] },
  wish: { en: 'Wishes', jp: '行きたいところ', fields: () => [F.title('行きたいところ'), F.body, F.geo, F.photo] },
  gift: { en: 'Gifts', jp: '贈ったもの', fields: () => [F.title('贈ったもの'), F.date('贈った日'), F.body, F.photo] },
  dislike: { en: 'Dislikes', jp: '嫌いなもの', fields: () => [F.title('嫌いなもの'), F.body] },
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
  const edit = () => openForm({ title: 'なおす', fields: S.fields(), initial: e,
    onSubmit: (v) => store.saveEntry({ id: e.id, title: v.title, body: v.body, date: v.date, category: v.category, lat: v.lat, lng: v.lng, photo: v.photo }) });
  const addPhoto = async () => {
    const f = await pickFile(); if (!f) return;
    act(async () => store.saveEntry({ id: e.id, photo: await store.uploadPhoto(await shrink(f)) }));
  };
  const went = () => openForm({ title: '行った！', initial: { ...e, date: today() },
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
  const add = () => openForm({ title: '書きたす', fields: S.fields(), initial: key === 'like' && likeFilter ? { category: likeFilter } : {},
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
  const write = (topic, mine) => openForm({ title: topic ? '自分の答え' : 'お題を足す',
    fields: [{ ...F.title('お題'), readonly: !!topic }, { name: 'body', type: 'textarea', label: '自分の考え', required: true }],
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
        h('button', { class: 'link', onclick: () => openForm({ title: 'なおす', fields: [F.title('なんの日？'), { ...F.date(), required: true }], initial: e,
          onSubmit: (v) => store.saveEntry({ id: e.id, title: v.title, date: v.date }) }) }, 'なおす'),
        h('button', { class: 'link', onclick: () => removeEntry(e) }, '消す')));
  };
  const add = () => openForm({ title: '記念日を足す', fields: [F.title('なんの日？'), { ...F.date(), required: true }],
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
function moodChart(list) {
  const W = 320, H = 150, L = 22, R = 10, T = 12, B = 22;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'chart');
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', '気分の折れ線グラフ');
  const t0 = utc(list[0].date), t1 = utc(list[list.length - 1].date);
  const x = (d) => (t1 === t0 ? (L + W - R) / 2 : L + ((utc(d) - t0) / (t1 - t0)) * (W - L - R));
  const y = (lv) => T + ((5 - lv) / 4) * (H - T - B);
  let s = '';
  for (let lv = 1; lv <= 5; lv++) s += `<line x1="${L}" x2="${W - R}" y1="${y(lv)}" y2="${y(lv)}" stroke="#16204F" stroke-opacity=".15"/><text x="6" y="${y(lv) + 4}" font-size="10" fill="#16204F">${lv}</text>`;
  s += `<polyline fill="none" stroke="#16204F" stroke-width="2" stroke-linejoin="round" points="${list.map((m) => `${x(m.date).toFixed(1)},${y(m.level).toFixed(1)}`).join(' ')}"/>`;
  for (const m of list) s += `<circle cx="${x(m.date).toFixed(1)}" cy="${y(m.level).toFixed(1)}" r="4" fill="#E79AAB" stroke="#16204F" stroke-width="2"/>`;
  s += `<text x="${L}" y="${H - 6}" font-size="10" fill="#16204F">${dots(list[0].date)}</text><text x="${W - R}" y="${H - 6}" font-size="10" fill="#16204F" text-anchor="end">${dots(list[list.length - 1].date)}</text>`;
  svg.innerHTML = s;
  return svg;
}
function moodPage() {
  const p = partner();
  const pname = p ? nameOf(p.id) : 'あいて';
  const byDate = (a, b) => (a.date < b.date ? -1 : 1);
  const mine = data.moods.filter((m) => m.user_id === me()).sort(byDate);
  const theirs = data.moods.filter((m) => m.user_id !== me()).sort(byDate);
  const fields = [{ ...F.date('いつごろ'), required: true }, { type: 'level', label: 'そのころの気分' },
    { name: 'note', type: 'textarea', label: 'メモ（なくてもいい）' }, { name: 'shared', type: 'check', label: `この記録を${pname}にも見せる` }];
  const add = () => openForm({ title: '記録する', fields, initial: { date: today(), shared: false },
    onSubmit: (v) => store.saveMood({ date: v.date, level: v.level, note: v.note || '', shared: !!v.shared }) });
  const label = (lv) => LEVELS[lv - 1].replace('\n', '');
  const item = (m, own) => h('article', { class: 'card' },
    h('h2', {}, label(m.level)), h('div', { class: 'meta' }, [dots(m.date), own && (m.shared ? `${pname}にも見せている` : '自分だけ')].filter(Boolean).join(' ・ ')),
    m.note && h('p', {}, m.note),
    own && h('div', { class: 'row' },
      h('button', { class: 'link', onclick: () => openForm({ title: 'なおす', fields, initial: m,
        onSubmit: (v) => store.saveMood({ id: m.id, date: v.date, level: v.level, note: v.note || '', shared: !!v.shared }) }) }, 'なおす'),
      h('button', { class: 'link', onclick: () => { if (confirm('消しますか？')) act(() => store.removeMood(m.id)); } }, '消す')));
  return h('div', {}, pageNav(),
    pageHead('Mood', 'メンタルの記録 ― 思い出したときに、印象に残っている日をざっくりと', h('button', { class: 'btn', onclick: add }, '+ 記録する')),
    h('p', { class: 'note' }, `ここは自分にしか見えません。「${pname}にも見せる」を入れた記録だけ、相手の画面に出ます。`),
    mine.length ? [moodChart(mine), h('div', { class: 'cards' }, [...mine].reverse().map((m) => item(m, true)))]
      : h('p', { class: 'empty' }, 'まだ記録がありません。'),
    theirs.length ? [h('h2', { class: 'en', style: 'font-size: 40px; margin: 36px 0 0' }, 'Shared'),
      h('p', { class: 'jp' }, `${pname}が見せてくれた記録`), moodChart(theirs),
      h('div', { class: 'cards' }, [...theirs].reverse().map((m) => item(m, false)))] : null);
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
  const email = h('input', { type: 'email', required: true, autocomplete: 'username' });
  const pw = h('input', { type: 'password', required: true, autocomplete: 'current-password' });
  const err = h('p', { class: 'err' });
  return h('div', {}, h('div', { class: 'nav' }, h('span'), h('span', { class: 'word' }, 'Our Odyssey'), h('span')),
    pageHead('Login', 'ふたりだけの場所です'),
    h('form', { style: 'display: flex; flex-direction: column; gap: 14px', onsubmit: async (ev) => {
      ev.preventDefault(); err.textContent = '';
      try { await store.signIn(email.value, pw.value); await start(); }
      catch { err.textContent = 'ログインできませんでした。メールアドレスとパスワードを確かめてください。'; }
    } },
      h('label', {}, 'メールアドレス', email), h('label', {}, 'パスワード', pw), err,
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
