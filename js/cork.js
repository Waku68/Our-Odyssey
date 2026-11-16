// コルクボードのポラロイド：タップでえらぶ（S / M / L / DONE の帯が出る）→ えらんだカードはそのまま指で動かせる（重ねてもいい）。
// 長押しで詳細を開く。えらんだカードは2本指でつまんでも大きさが変わる（PC はトラックパッドのピンチ）。
// 並びと大きさはこの端末だけに残す（相手の画面は変わらない）。動かしていないものは、今までどおりの並び。
import { h } from './dom.js?v=63';
import { localKey } from './store.js?v=63';

const KEY = localKey('our-odyssey-cork');
const SIZES = { S: 0.72, M: 1, L: 1.45 };
const HOLD = 400, SLOP = 8, EDGE = 80, MIN_K = 0.55, MAX_K = 2.5;

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
  const kOf = (c) => { const k = lay[c.seed]?.k; return typeof k === 'number' ? k : SIZES[k] || 1; };
  const scale = (c) => c.s * kOf(c);
  const px = (el, name) => parseFloat(el.style.getPropertyValue(name)) || 0;
  // いま見えている位置（傾ける前の箱の左上）を、置き場所として書きとめる
  function pin(c) {
    const L = lay[c.seed] ||= {};
    if (L.x == null) { L.x = (c.el.offsetLeft + px(c.el, '--x')) / W(); L.y = (c.el.offsetTop + px(c.el, '--y')) / W(); }
    return L;
  }
  const raise = (c) => { pin(c).z = 1 + Math.max(0, ...Object.values(lay).map((v) => v.z || 0)); };
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
  const relayout = () => { cards.forEach(place); fit(); aimBar(); };
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(relayout);
    ro.observe(grid);
    cards.forEach((c) => ro.observe(c.el));
  } else requestAnimationFrame(relayout);

  // 大きさを変える（真ん中から。ボードの幅より大きくはしない）
  function resize(c, k) {
    const L = pin(c);
    L.k = Math.max(MIN_K, Math.min(MAX_K, W() / (c.el.offsetWidth * c.s), k));
    if (Math.abs(L.k - 1) < 0.04) delete L.k;
    [L.x, L.y] = clamp(c, L.x * W(), L.y * W()).map((v) => v / W());
    place(c); fit(); aimBar();
  }

  /* ---------- えらんだカードと、大きさの帯（S / M / L / DONE） ---------- */
  let picked = null, bar = null;
  function aimBar() {
    if (!bar) return;
    if (!picked?.el.isConnected) { unpick(); return; }
    const g = grid.getBoundingClientRect(), r = picked.el.getBoundingClientRect();
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    let top = r.top - g.top - bh - 12;
    if (top < -8) top = r.bottom - g.top + 12;
    bar.style.top = `${top}px`;
    bar.style.left = `${Math.max(-6, Math.min(W() - bw + 6, r.left - g.left + r.width / 2 - bw / 2))}px`;
    const k = kOf(picked);
    bar.querySelectorAll('[data-k]').forEach((b) => b.classList.toggle('on', Math.abs(SIZES[b.dataset.k] - k) < 0.02));
  }
  function unpick() {
    bar?.remove(); picked?.el.classList.remove('picked');
    bar = null; picked = null;
    document.removeEventListener('pointerdown', outside, true);
  }
  // 2本目の指（つまむとき）は、外に置いても閉じない
  function outside(ev) { if (ev.isPrimary && bar && !bar.contains(ev.target) && !picked?.el.contains(ev.target)) unpick(); }
  function pick(c) {
    if (picked === c) return;
    unpick();
    picked = c;
    bar = h('div', { class: 'cork-bar', role: 'group', 'aria-label': 'Size' },
      Object.keys(SIZES).map((k) => h('button', { type: 'button', 'data-k': k, onclick: () => { raise(c); resize(c, SIZES[k]); keep(); } }, k)),
      h('button', { type: 'button', class: 'done', onclick: unpick }, 'DONE'));
    c.el.classList.add('picked');
    grid.append(bar);
    aimBar();
    document.addEventListener('pointerdown', outside, true);
  }

  /* ---------- 指の動き ----------
     どのカードでも：長押しで詳細。えらんだカードだけ：指を動かすとついてくる（ページはスクロールしない） */
  let press = null, swallow = null, raf = 0;
  const isInner = (t, el) => { const b = t.closest('button, a, [role=button]'); return b && b !== el; }; // 曲の再生ボタンなど
  function follow() {
    const { c, gx, gy } = press;
    const g = grid.getBoundingClientRect();
    const [x, y] = clamp(c, press.px - g.left - gx, press.py - g.top - gy);
    const L = lay[c.seed];
    L.x = x / W(); L.y = y / W();
    place(c); fit(); aimBar();
  }
  // 画面の上下の端に寄せると、そのまま流れる
  function scrollLoop() {
    if (!press?.moving) return;
    const bottom = innerHeight - EDGE - 40;
    const v = press.py < EDGE ? -(EDGE - press.py) / 5 : press.py > bottom ? (press.py - bottom) / 5 : 0;
    if (v) { window.scrollBy(0, v); follow(); }
    raf = requestAnimationFrame(scrollLoop);
  }
  function startMove() {
    const { c } = press;
    clearTimeout(press.timer);
    press.moving = true;
    raise(c);
    const L = pin(c);
    place(c);
    const g = grid.getBoundingClientRect();
    press.gx = press.sx - g.left - L.x * W();
    press.gy = press.sy - g.top - L.y * W();
    c.el.classList.add('lifted');
    try { c.el.setPointerCapture(press.id); } catch { /* もう離れていたら、そのまま */ }
    follow();
    raf = requestAnimationFrame(scrollLoop);
  }
  function longPress() {
    const { c } = press;
    press.done = true;
    swallow = c.el;               // 指を離したときのタップは、えらぶのに使わない
    navigator.vibrate?.(10);
    unpick();
    c.el.click();                 // 詳細を開く（detail が 0 のクリックは、そのまま通す）
  }
  function release(ev) {
    if (!press || (ev?.pointerId != null && ev.pointerId !== press.id)) return;
    clearTimeout(press.timer);
    cancelAnimationFrame(raf);
    const { c, moving, done } = press;
    press = null;
    removeEventListener('pointerup', release);
    removeEventListener('pointercancel', release);
    // 長押しで詳細を開いたあと、指を離したときのクリックが開いた詳細（の外側）に当たって閉じないように
    if (done) {
      const eat = (e) => { e.preventDefault(); e.stopPropagation(); };
      addEventListener('click', eat, { capture: true, once: true });
      setTimeout(() => removeEventListener('click', eat, { capture: true }), 500);
    }
    if (!moving) return;
    swallow = c.el;
    if (pinch?.c !== c) c.el.classList.remove('lifted');
    fit(); keep(); aimBar();
  }
  for (const c of cards) {
    const el = c.el;
    el.addEventListener('pointerdown', (ev) => {
      if (ev.button > 0 || !ev.isPrimary || press || isInner(ev.target, el)) return;
      if (ev.pointerType === 'mouse') ev.preventDefault(); // 文字の選択や、画像の引きずりを出さない
      swallow = null;
      press = { c, id: ev.pointerId, sx: ev.clientX, sy: ev.clientY, px: ev.clientX, py: ev.clientY, moving: false, done: false };
      press.timer = setTimeout(longPress, HOLD);
      // カードの外で指（ボタン）を離したときも、ここで終える
      addEventListener('pointerup', release);
      addEventListener('pointercancel', release);
    });
    el.addEventListener('pointermove', (ev) => {
      if (!press || press.c !== c || ev.pointerId !== press.id || press.done) return;
      press.px = ev.clientX; press.py = ev.clientY;
      if (press.moving) follow();
      else if (Math.hypot(ev.clientX - press.sx, ev.clientY - press.sy) > SLOP) {
        if (picked === c && !pinch) startMove(); else release();
      }
    });
    // 中の文字などがつかんでいた指をカードがつかみ直したときの通知は、終わりではない
    el.addEventListener('lostpointercapture', (ev) => { if (ev.target === el && press?.moving && press.c === c) release(ev); });
    // えらんだカードの上では、ページをスクロールさせない
    el.addEventListener('touchmove', (ev) => { if (picked === c || press?.moving) ev.preventDefault(); }, { passive: false });
    el.addEventListener('contextmenu', (ev) => ev.preventDefault());
    el.addEventListener('touchstart', (ev) => {
      if (picked !== c) return;
      if (!touchCard) {
        touchCard = c;
        addEventListener('touchstart', pinchStart, { passive: false });
        addEventListener('touchmove', pinchMove, { passive: false });
        addEventListener('touchend', pinchEnd);
        addEventListener('touchcancel', pinchEnd);
        addEventListener('gesturestart', noZoom, { passive: false });
      }
      pinchStart(ev);
    }, { passive: false });
    // PC：えらんだカードの上でトラックパッドのピンチ（ctrl ＋ ホイールとして届く）
    let wheelTimer = 0;
    el.addEventListener('wheel', (ev) => {
      if (!ev.ctrlKey || picked !== c) return;
      ev.preventDefault();
      if (!wheelTimer) { raise(c); place(c); }
      resize(c, kOf(c) * Math.exp(-ev.deltaY / 100));
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => { wheelTimer = 0; keep(); }, 300);
    }, { passive: false });
  }
  // タップ：詳細は開かずに、えらぶ。キーボード（Enter）と長押しのクリックは、今までどおり詳細を開く
  grid.addEventListener('click', (ev) => {
    const el = ev.target.closest('.pol');
    if (!el || isInner(ev.target, el) || ev.detail === 0) return;
    ev.preventDefault(); ev.stopPropagation();
    if (swallow === el) { swallow = null; return; }
    const c = cards.find((x) => x.el === el);
    if (c) pick(c);
  }, true);
  // PC：ダブルクリックでも詳細を開く
  grid.addEventListener('dblclick', (ev) => {
    const el = ev.target.closest('.pol');
    if (el && !isInner(ev.target, el)) { unpick(); el.click(); }
  });

  /* ---------- えらんだカードを2本指でつまんで大きさを変える ----------
     2本目の指はカードの外に置いてもいい。つまんでいる間は、ページの拡大やスクロールを止める */
  let pinch = null, touchCard = null;
  const gap = (ts) => Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY) || 1;
  function pinchStart(ev) {
    if (!touchCard || ev.touches.length < 2 || pinch) return;
    if (ev.cancelable) ev.preventDefault();
    const c = touchCard;
    if (press && !press.moving) release(); // 長押しの途中なら、そちらはやめる
    raise(c);
    pinch = { c, d0: gap(ev.touches), k0: kOf(c) };
    c.el.classList.add('lifted');
    place(c);
  }
  function pinchMove(ev) {
    if (!pinch) return;
    if (ev.cancelable) ev.preventDefault();
    if (ev.touches.length >= 2) resize(pinch.c, pinch.k0 * gap(ev.touches) / pinch.d0);
  }
  function pinchEnd(ev) {
    if (pinch && ev.touches.length < 2) {
      const { c } = pinch;
      pinch = null;
      swallow = c.el;
      if (press?.c !== c) c.el.classList.remove('lifted');
      keep();
    }
    if (!ev.touches.length) {
      touchCard = null;
      removeEventListener('touchstart', pinchStart);
      removeEventListener('touchmove', pinchMove);
      removeEventListener('touchend', pinchEnd);
      removeEventListener('touchcancel', pinchEnd);
      removeEventListener('gesturestart', noZoom);
    }
  }
  function noZoom(ev) { if (touchCard) ev.preventDefault(); } // iPhone の Safari の拡大
}

export { movable, hasLayout, resetLayout };
