// コルクボードのポラロイドを、長押しで持ち上げて動かす（重ねてもいい）。離すと S / M / L で大きさを変えられる。
// 並びと大きさはこの端末だけに残す（相手の画面は変わらない）。動かしていないものは、今までどおりの並び。
import { h } from './dom.js?v=43';
import { localKey } from './store.js?v=43';

const KEY = localKey('our-odyssey-cork');
const SIZES = { S: 0.72, M: 1, L: 1.45 };
const HOLD = 210, SLOP = 8, EDGE = 80;

let saved = null;
function boards() {
  if (!saved) { try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { saved = {}; } }
  return saved;
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* 入らなくても、この画面の間は動く */ } }

const hasLayout = (board) => Object.keys(boards()[board] || {}).length > 0;
function resetLayout(board) { delete boards()[board]; save(); }

/* board：'like' など。grid：.cork-grid。cards：[{ el, seed, s（もとの傾き用の大きさ） }]。
   置き場所は「ボードの左上から、ボードの幅を1とした x, y」で持つ（画面の幅が変わっても同じ見た目に） */
function movable(board, grid, cards, onChange) {
  const all = boards();
  const lay = all[board] || {};
  const seeds = new Set(cards.map((c) => c.seed));
  let pruned = false;
  for (const k of Object.keys(lay)) if (!seeds.has(k)) { delete lay[k]; pruned = true; }
  if (pruned) { if (Object.keys(lay).length) all[board] = lay; else delete all[board]; save(); }
  const keep = () => { all[board] = lay; save(); onChange?.(); };

  const W = () => grid.clientWidth || 1;
  const scale = (c) => c.s * (SIZES[lay[c.seed]?.k] || 1);
  const px = (el, name) => parseFloat(el.style.getPropertyValue(name)) || 0;
  // いま見えている位置（傾ける前の箱の左上）を、置き場所として書きとめる
  function pin(c) {
    const L = lay[c.seed] ||= {};
    if (L.x == null) { L.x = (c.el.offsetLeft + px(c.el, '--x')) / W(); L.y = (c.el.offsetTop + px(c.el, '--y')) / W(); }
    return L;
  }
  // ボードからはみ出さないように（大きくするのは真ん中から。下へはボードを伸ばす）
  function clamp(c, x, y) {
    const w = c.el.offsetWidth, hh = c.el.offsetHeight, s = scale(c);
    const minX = (w * s - w) / 2, maxX = W() - (w + w * s) / 2;
    return [Math.max(minX, Math.min(maxX, x)), Math.max((hh * s - hh) / 2, y)];
  }
  function place(c) {
    const L = lay[c.seed];
    if (!L) return;
    c.el.style.setProperty('--s', scale(c).toFixed(3));
    if (L.x != null) {
      c.el.style.setProperty('--x', `${(L.x * W() - c.el.offsetLeft).toFixed(1)}px`);
      c.el.style.setProperty('--y', `${(L.y * W() - c.el.offsetTop).toFixed(1)}px`);
    }
    c.el.style.zIndex = L.z ? String(2 + L.z) : '';
  }
  // 下へ動かしたぶん、ボードを伸ばす
  function fit() {
    let need = 0;
    for (const c of cards) {
      const L = lay[c.seed];
      if (!L || L.x == null) continue;
      const hh = c.el.offsetHeight;
      need = Math.max(need, L.y * W() + (hh + hh * scale(c)) / 2 + 6);
    }
    const natural = Math.max(0, ...cards.map((c) => c.el.offsetTop + c.el.offsetHeight));
    grid.style.minHeight = need > natural ? `${Math.ceil(need)}px` : '';
  }
  const relayout = () => { cards.forEach(place); fit(); if (bar) aimBar(); };
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(relayout);
    ro.observe(grid);
    cards.forEach((c) => ro.observe(c.el));
  } else requestAnimationFrame(relayout);

  /* ---------- 大きさの帯（S / M / L） ---------- */
  let bar = null, barCard = null;
  function aimBar() {
    if (!barCard?.el.isConnected) { closeBar(); return; }
    const g = grid.getBoundingClientRect(), r = barCard.el.getBoundingClientRect();
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    let top = r.top - g.top - bh - 10;
    if (top < -8) top = r.bottom - g.top + 10;
    bar.style.top = `${top}px`;
    bar.style.left = `${Math.max(-6, Math.min(W() - bw + 6, r.left - g.left + r.width / 2 - bw / 2))}px`;
  }
  function closeBar() {
    bar?.remove(); barCard?.el.classList.remove('picked');
    bar = null; barCard = null;
    document.removeEventListener('pointerdown', outside, true);
  }
  function outside(ev) { if (bar && !bar.contains(ev.target) && !barCard?.el.contains(ev.target)) closeBar(); }
  function setSize(c, k) {
    const L = pin(c);
    if (k === 'M') delete L.k; else L.k = k;
    [L.x, L.y] = clamp(c, L.x * W(), L.y * W()).map((v) => v / W());
    place(c); fit(); keep();
    bar.querySelectorAll('[data-k]').forEach((b) => b.classList.toggle('on', b.dataset.k === k));
    requestAnimationFrame(aimBar);
  }
  function openBar(c) {
    closeBar();
    const cur = lay[c.seed]?.k || 'M';
    bar = h('div', { class: 'cork-bar', role: 'group', 'aria-label': 'Size' },
      Object.keys(SIZES).map((k) => h('button', { type: 'button', 'data-k': k, class: k === cur ? 'on' : null, onclick: () => setSize(c, k) }, k)),
      h('button', { type: 'button', class: 'done', onclick: closeBar }, 'DONE'));
    barCard = c;
    c.el.classList.add('picked');
    grid.append(bar);
    aimBar();
    document.addEventListener('pointerdown', outside, true);
  }

  /* ---------- 長押しで持ち上げる ---------- */
  let drag = null, droppedAt = 0, raf = 0;
  function follow() {
    const { c, gx, gy } = drag;
    const g = grid.getBoundingClientRect();
    const [x, y] = clamp(c, drag.px - g.left - gx, drag.py - g.top - gy);
    const L = lay[c.seed];
    L.x = x / W(); L.y = y / W();
    place(c); fit();
  }
  // 画面の上下の端に寄せると、そのまま流れる
  function scrollLoop() {
    if (!drag?.on) return;
    const bottom = innerHeight - EDGE - 40;
    const v = drag.py < EDGE ? -(EDGE - drag.py) / 5 : drag.py > bottom ? (drag.py - bottom) / 5 : 0;
    if (v) { window.scrollBy(0, v); follow(); }
    raf = requestAnimationFrame(scrollLoop);
  }
  function lift() {
    const { c } = drag;
    drag.on = true;
    closeBar();
    const L = pin(c);
    L.z = 1 + Math.max(0, ...Object.values(lay).map((v) => v.z || 0));
    place(c);
    const g = grid.getBoundingClientRect();
    drag.gx = drag.px - g.left - L.x * W();
    drag.gy = drag.py - g.top - L.y * W();
    c.el.classList.add('lifted');
    try { c.el.setPointerCapture(drag.id); } catch { /* もう離れていたら、そのまま */ }
    navigator.vibrate?.(10);
    raf = requestAnimationFrame(scrollLoop);
  }
  function end(ev) {
    if (!drag || (ev?.pointerId != null && ev.pointerId !== drag.id)) return;
    clearTimeout(drag.timer);
    cancelAnimationFrame(raf);
    const { c, on } = drag;
    drag = null;
    removeEventListener('pointerup', end);
    removeEventListener('pointercancel', end);
    if (!on) return;
    droppedAt = Date.now();
    c.el.classList.remove('lifted');
    fit(); keep();
    openBar(c);
  }
  for (const c of cards) {
    const el = c.el;
    el.addEventListener('pointerdown', (ev) => {
      if (ev.button > 0 || !ev.isPrimary || drag) return;
      if (ev.pointerType === 'mouse') ev.preventDefault(); // 文字の選択や、画像の引きずりを出さない
      drag = { c, id: ev.pointerId, sx: ev.clientX, sy: ev.clientY, px: ev.clientX, py: ev.clientY, on: false };
      drag.timer = setTimeout(lift, HOLD);
      // カードの外で指（ボタン）を離したときも、ここで終える。つかむのは持ち上げてから（中の曲のボタンなどを押せるように）
      addEventListener('pointerup', end);
      addEventListener('pointercancel', end);
    });
    el.addEventListener('pointermove', (ev) => {
      if (!drag || drag.c !== c || ev.pointerId !== drag.id) return;
      drag.px = ev.clientX; drag.py = ev.clientY;
      if (drag.on) follow();
      else if (Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) > SLOP) end();
    });
    el.addEventListener('lostpointercapture', (ev) => { if (drag?.on && drag.c === c) end(ev); });
    // 持ち上げている間は、ページをスクロールさせない（touch-action は途中で変えられないので、こちらで止める）
    el.addEventListener('touchmove', (ev) => { if (drag?.on && drag.c === c) ev.preventDefault(); }, { passive: false });
    el.addEventListener('contextmenu', (ev) => ev.preventDefault());
  }
  // 動かしたあとの「タップ」で詳細を開かない
  grid.addEventListener('click', (ev) => {
    if (Date.now() - droppedAt < 700 && ev.target.closest('.pol')) { ev.preventDefault(); ev.stopPropagation(); }
  }, true);
}

export { movable, hasLayout, resetLayout };
