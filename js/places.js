// 地図（Leaflet）と、場所さがし・場所の写真さがし。
import { h } from './dom.js?v=38';
import { lang, tr } from './i18n.js?v=38';
import { TH } from './theme.js?v=38';

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
// 地図を引きすぎないようにする：世界地図の高さが地図の枠の高さより小さくなる手前（世界がほぼ見えるくらい）で止め、
// 上下は地図の端（北極・南極の手前）より外へ動かせないようにする（外の灰色が見えないように）
const MIN_ZOOM = 1;
// 地図の感度：ピンチやホイールで細かく反応させ（整数の段にはまらないように）、指を離したあとも少し長めにすべらせる
const MAP_FEEL = { zoomSnap: 0.25, zoomDelta: 0.75, wheelPxPerZoomLevel: 40, wheelDebounceTime: 20, inertiaDeceleration: 2000, maxBoundsViscosity: 1 };
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
    map = L.map(mapEl, { ...MAP_FEEL }).setView(v.lat != null ? [v.lat, v.lng] : [36.2, 138.2], v.lat != null ? 14 : 4);
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

export { leaflet, TILE, ATTR, MAP_FEEL, limitMap, placePhoto, namePhotos, smallThumb, geoField };
