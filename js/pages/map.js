// PLACES：過ごした場所と行きたいところの地図と一覧。
import { h } from '../dom.js?v=38';
import { tr } from '../i18n.js?v=38';
import { dots } from '../dates.js?v=38';
import { store, data } from '../state.js?v=38';
import { newMark, entryNew } from '../seen.js?v=38';
import { photoImg } from '../photos.js?v=38';
import { leaflet, TILE, ATTR, MAP_FEEL, limitMap } from '../places.js?v=38';
import { inlineForm } from '../forms.js?v=38';
import { SECTIONS, fromLabel, newEntryRow, openDetail } from '../entries.js?v=38';
import { draw, pageNav, pageHead } from '../shell.js?v=38';

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
  const head = pageHead('Places');
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
    const map = L.map(mapEl, { ...MAP_FEEL, zoomControl: false });
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
      onSubmit: (v) => store.saveEntry(newEntryRow(addKind, v)) });
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

export { mapPage };
