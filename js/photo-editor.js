// 写真の編集画面。えらんだ写真を、切り取り・回転・色味・飾り（スタンプ、文字、日付、ふち）してから使う。
// editPhoto(file) → JPEG の Blob（やめたら null）。withState のときは { blob, state } を返し、state を渡すと続きから直せる。

import { h as el } from './dom.js?v=38';
import { ask, notice } from './ask.js?v=38';

const NAVY = '#16204F', PINK = '#F2C4CE', PINK_D = '#E79AAB', PAPER = '#FBF1EF';
const COLORS = [NAVY, PINK_D, PINK, '#FFFFFF'];
const ASPECTS = [['orig', 'ORIGINAL'], ['1:1', '1:1'], ['4:5', '4:5'], ['3:4', '3:4'], ['4:3', '4:3'], ['16:9', '16:9']];
const FILTERS = [['none', 'NONE'], ['warm', 'WARM'], ['rose', 'ROSE'], ['fade', 'FADE'], ['retro', 'RETRO'], ['mono', 'MONO'], ['cool', 'COOL']];
const FRAMES = [['none', 'NONE'], ['white', 'WHITE'], ['polaroid', 'POLAROID'], ['navy', 'NAVY'], ['pink', 'PINK']];
const FRAME_BG = { white: '#FFFFFF', polaroid: '#FBF8F3', navy: NAVY, pink: PINK };
const STICKERS = ['heart', 'star', 'sparkle', 'flower', 'tulipB', 'tulipP'];
const DEFAULT_COLOR = { heart: PINK_D, star: NAVY, sparkle: '#FFFFFF', flower: PINK, text: '#FFFFFF', date: '#FF8A3D' };

const P_HEART = new Path2D('M12 21.2s-8.6-5.2-8.6-11.6A4.9 4.9 0 0 1 12 6.4a4.9 4.9 0 0 1 8.6 3.2c0 6.4-8.6 11.6-8.6 11.6z');
const P_SPARKLE = new Path2D('M12 0C12.9 7.6 16.4 11.1 24 12C16.4 12.9 12.9 16.4 12 24C11.1 16.4 7.6 12.9 0 12C7.6 11.1 11.1 7.6 12 0Z');
const P_STAR = (() => {
  const p = new Path2D();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 4.9 : 12;
    const x = 12 + r * Math.cos(a), y = 12.8 + r * Math.sin(a);
    if (i) p.lineTo(x, y); else p.moveTo(x, y);
  }
  p.closePath();
  return p;
})();

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const uid = () => Math.random().toString(36).slice(2, 9);
const pad2 = (n) => String(n).padStart(2, '0');

/* ---------- 読みこみ ---------- */
async function loadSource(src) {
  let img;
  try { img = await createImageBitmap(src, { imageOrientation: 'from-image' }); }
  catch {
    img = await new Promise((ok, ng) => {
      const i = new Image(); i.onload = () => ok(i); i.onerror = () => ng(new Error('image'));
      i.src = URL.createObjectURL(src);
    });
  }
  // 大きすぎる写真は作業用に縮めておく（スマホのメモリ対策）
  const w0 = img.width || img.naturalWidth, h0 = img.height || img.naturalHeight;
  const k = Math.min(1, 2400 / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  img.close?.();
  return c;
}
const tulips = {};
function loadTulips() {
  for (const [k, f] of [['tulipB', 'tulip-blue'], ['tulipP', 'tulip-pink']]) {
    if (tulips[k]) continue;
    const i = new Image(); i.src = `assets/${f}.webp`; tulips[k] = i;
  }
  return Promise.all(Object.values(tulips).map((i) => (i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; }))));
}

/* ---------- 色味 ---------- */
function applyFilter(ctx, x, y, w, h, name) {
  if (name === 'none' || w < 1 || h < 1) return;
  const d = ctx.getImageData(x, y, w, h), a = d.data;
  for (let i = 0; i < a.length; i += 4) {
    let r = a[i], g = a[i + 1], b = a[i + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    if (name === 'warm') { r = r * 1.05 + 14; g = g * 1.01 + 6; b = b * 0.86 + 6; }
    else if (name === 'rose') { r = r * 1.03 + 16; g = g * 0.97 + 2; b = b * 1.0 + 12; }
    else if (name === 'fade') { r = (r * 0.75 + l * 0.25) * 0.8 + 36; g = (g * 0.75 + l * 0.25) * 0.8 + 32; b = (b * 0.75 + l * 0.25) * 0.8 + 34; }
    else if (name === 'retro') {
      const sr = 0.393 * r + 0.769 * g + 0.189 * b, sg = 0.349 * r + 0.686 * g + 0.168 * b, sb = 0.272 * r + 0.534 * g + 0.131 * b;
      r = (r * 0.45 + sr * 0.55) * 0.88 + 20; g = (g * 0.45 + sg * 0.55) * 0.88 + 16; b = (b * 0.45 + sb * 0.55) * 0.88 + 10;
    } else if (name === 'mono') { const v = (l - 128) * 1.08 + 128 + 4; r = g = b = v; }
    else if (name === 'cool') { r = r * 0.92 + 2; g = g * 0.99 + 6; b = b * 1.06 + 16; }
    a[i] = r; a[i + 1] = g; a[i + 2] = b;
  }
  ctx.putImageData(d, x, y);
  if (name === 'retro') {
    const g = ctx.createRadialGradient(x + w / 2, y + h / 2, Math.min(w, h) * 0.32, x + w / 2, y + h / 2, Math.hypot(w, h) / 2);
    g.addColorStop(0, 'rgba(40,24,10,0)'); g.addColorStop(1, 'rgba(40,24,10,.38)');
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  }
}

/* ---------- 形と大きさ ---------- */
function frameDims(frame) {
  if (frame === 'none') return { pad: 0, bottom: 0 };
  if (frame === 'polaroid') return { pad: 0.055, bottom: 0.24 };
  return { pad: 0.045, bottom: 0.045 };
}
function ratioOf(state, src) {
  const odd = state.rot % 2;
  const iw = odd ? src.height : src.width, ih = odd ? src.width : src.height;
  if (state.aspect === 'orig') return iw / ih;
  const [a, b] = state.aspect.split(':').map(Number);
  return a / b;
}
// 出力の幅 W に対する、写真の場所・拡大率など
function geo(state, src, W) {
  const { pad, bottom } = frameDims(state.frame);
  const A = ratioOf(state, src);
  const p = pad * W, pw = W - 2 * p, ph = pw / A;
  const H = ph + p + bottom * W;
  const odd = state.rot % 2;
  const iw = odd ? src.height : src.width, ih = odd ? src.width : src.height;
  const t = (state.tilt * Math.PI) / 180, c = Math.abs(Math.cos(t)), sn = Math.abs(Math.sin(t));
  const cover = Math.max((pw * c + ph * sn) / iw, (pw * sn + ph * c) / ih);
  const s = cover * state.zoom;
  const ex = (pw * c + ph * sn) / 2, ey = (pw * sn + ph * c) / 2;
  return { x0: p, y0: p, pw, ph, H, iw, ih, t, s, mx: Math.max(0, (s * iw / 2 - ex) / (s * iw)), my: Math.max(0, (s * ih / 2 - ey) / (s * ih)) };
}
function clampPan(state, src) {
  const g = geo(state, src, 1000);
  state.px = clamp(state.px, -g.mx, g.mx); state.py = clamp(state.py, -g.my, g.my);
}

function fontOf(it, fs) {
  if (it.kind === 'date') return `700 ${fs}px "Courier New", Courier, monospace`;
  return it.font === 'round' ? `800 ${fs}px "M PLUS 1p", sans-serif` : `400 ${fs}px Anton, "M PLUS 1p", sans-serif`;
}
function itemSize(it, W, ctx) {
  const u = it.s * W;
  if (it.kind === 'tulipB' || it.kind === 'tulipP') {
    const i = tulips[it.kind];
    return { w: u, h: i?.naturalWidth ? (u * i.naturalHeight) / i.naturalWidth : u * 2 };
  }
  if (it.kind === 'text' || it.kind === 'date') {
    const fs = u * 0.5;
    ctx.font = fontOf(it, fs);
    return { w: Math.max(fs * 0.6, ctx.measureText(it.text || ' ').width), h: fs * 1.2, fs };
  }
  return { w: u, h: u };
}
function drawItem(ctx, it, W, H) {
  const { w, h, fs } = itemSize(it, W, ctx);
  ctx.save();
  ctx.translate(it.x * W, it.y * H); ctx.rotate(it.r);
  if (it.kind === 'tulipB' || it.kind === 'tulipP') {
    const i = tulips[it.kind];
    if (i?.naturalWidth) ctx.drawImage(i, -w / 2, -h / 2, w, h);
  } else if (it.kind === 'text' || it.kind === 'date') {
    ctx.font = fontOf(it, fs); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = it.color;
    if (it.kind === 'date') { ctx.shadowColor = 'rgba(255,106,0,.85)'; ctx.shadowBlur = fs * 0.25; }
    else { ctx.shadowColor = 'rgba(0,0,0,.28)'; ctx.shadowBlur = fs * 0.12; ctx.shadowOffsetY = fs * 0.03; }
    ctx.fillText(it.text || '', 0, fs * 0.04);
  } else {
    const k = w / 24;
    ctx.translate(-w / 2, -h / 2); ctx.scale(k, k);
    ctx.shadowColor = 'rgba(0,0,0,.22)'; ctx.shadowBlur = 1.2; ctx.shadowOffsetY = 0.5;
    ctx.fillStyle = it.color;
    if (it.kind === 'heart') ctx.fill(P_HEART);
    else if (it.kind === 'star') ctx.fill(P_STAR);
    else if (it.kind === 'sparkle') ctx.fill(P_SPARKLE);
    else if (it.kind === 'flower') {
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
        ctx.beginPath(); ctx.arc(12 + 6.2 * Math.cos(a), 12 + 6.2 * Math.sin(a), 5.6, 0, Math.PI * 2); ctx.fill();
      }
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = it.color === '#FFFFFF' ? PINK_D : '#FFF6D8';
      ctx.beginPath(); ctx.arc(12, 12, 3.6, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
  return { w, h };
}
function hit(it, X, Y, W, H, ctx) {
  const { w, h } = itemSize(it, W, ctx);
  const dx = X - it.x * W, dy = Y - it.y * H;
  const c = Math.cos(-it.r), s = Math.sin(-it.r);
  const lx = dx * c - dy * s, ly = dx * s + dy * c;
  const m = Math.max(10, W * 0.02);
  return Math.abs(lx) <= w / 2 + m && Math.abs(ly) <= h / 2 + m;
}

/* ---------- 1枚を描く ---------- */
// 写真の層（重い色味の計算）はキャッシュして、スタンプを動かすときは重ねなおすだけにする
function renderPhoto(state, src, W) {
  const g = geo(state, src, W);
  const c = document.createElement('canvas');
  c.width = Math.round(W); c.height = Math.round(g.H);
  const ctx = c.getContext('2d');
  if (state.frame !== 'none') { ctx.fillStyle = FRAME_BG[state.frame]; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.save();
  ctx.beginPath(); ctx.rect(g.x0, g.y0, g.pw, g.ph); ctx.clip();
  ctx.fillStyle = '#ddd'; ctx.fillRect(g.x0, g.y0, g.pw, g.ph);
  ctx.translate(g.x0 + g.pw / 2, g.y0 + g.ph / 2);
  ctx.rotate(g.t);
  ctx.translate(state.px * g.s * g.iw, state.py * g.s * g.ih);
  ctx.rotate((state.rot * Math.PI) / 2);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, (-src.width * g.s) / 2, (-src.height * g.s) / 2, src.width * g.s, src.height * g.s);
  ctx.restore();
  applyFilter(ctx, Math.floor(g.x0), Math.floor(g.y0), Math.ceil(g.pw), Math.ceil(g.ph), state.filter);
  if (state.frame === 'polaroid' || state.frame === 'white') {
    ctx.strokeStyle = 'rgba(0,0,0,.08)'; ctx.lineWidth = Math.max(1, W * 0.002);
    ctx.strokeRect(g.x0, g.y0, g.pw, g.ph);
  }
  return c;
}
function renderAll(state, src, W, photoLayer, selId) {
  const layer = photoLayer || renderPhoto(state, src, W);
  const c = document.createElement('canvas');
  c.width = layer.width; c.height = layer.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(layer, 0, 0);
  for (const it of state.items) {
    const { w, h } = drawItem(ctx, it, c.width, c.height);
    if (it.id === selId) {
      ctx.save();
      ctx.translate(it.x * c.width, it.y * c.height); ctx.rotate(it.r);
      const m = Math.max(4, c.width * 0.012);
      ctx.setLineDash([c.width * 0.014, c.width * 0.01]); ctx.lineWidth = Math.max(1.5, c.width * 0.004);
      ctx.strokeStyle = '#FFFFFF'; ctx.strokeRect(-w / 2 - m, -h / 2 - m, w + 2 * m, h + 2 * m);
      ctx.lineDashOffset = c.width * 0.012; ctx.strokeStyle = NAVY; ctx.strokeRect(-w / 2 - m, -h / 2 - m, w + 2 * m, h + 2 * m);
      ctx.restore();
    }
  }
  return c;
}

/* ---------- 画面 ---------- */
export async function editPhoto(file, opts = {}) {
  const tr = (ja, en) => (opts.lang === 'en' ? en : ja);
  let src;
  try { src = await loadSource(file); } catch { notice(tr('この写真は開けませんでした', "Couldn't open this photo")); return null; }
  await Promise.all([loadTulips(),
    document.fonts?.load('400 40px Anton').catch(() => {}), document.fonts?.load('800 40px "M PLUS 1p"').catch(() => {})]);

  const fileDate = new Date(file.lastModified || Date.now());
  const dateText = `'${String(fileDate.getFullYear()).slice(2)} ${pad2(fileDate.getMonth() + 1)} ${pad2(fileDate.getDate())}`;
  const fresh = () => ({ aspect: opts.aspect || 'orig', rot: 0, tilt: 0, zoom: 1, px: 0, py: 0, filter: 'none', frame: 'none', items: [] });
  const state = opts.state ? JSON.parse(JSON.stringify(opts.state)) : fresh();
  let tab = 'crop', sel = null, dirty = false, layer = null, layerKey = '';

  const canvas = el('canvas', { class: 'ed-canvas', 'aria-label': tr('編集中の写真', 'Photo being edited') });
  const stage = el('div', { class: 'ed-stage' }, canvas);
  const panel = el('div', { class: 'ed-panel' });
  const tabsEl = el('div', { class: 'ed-tabs', role: 'tablist' });
  const dlg = el('dialog', { class: 'modal editor', 'aria-label': 'Edit photo' });

  /* 描く */
  let cssW = 0, cssH = 0, raf = 0;
  const measure = () => {
    const box = stage.clientWidth || 320;
    const maxH = Math.max(220, Math.min(window.innerHeight * 0.44, 520));
    const r = geo(state, src, 1).H;
    cssW = Math.min(box, maxH / r); cssH = cssW * r;
  };
  function paint() {
    raf = 0;
    measure();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(cssW * dpr);
    const key = JSON.stringify([state.aspect, state.rot, state.tilt, state.zoom, state.px, state.py, state.filter, state.frame, W]);
    if (key !== layerKey) { layer = renderPhoto(state, src, W); layerKey = key; }
    const out = renderAll(state, src, W, layer, sel);
    canvas.width = out.width; canvas.height = out.height;
    canvas.style.width = `${cssW}px`; canvas.style.height = `${cssH}px`;
    canvas.getContext('2d').drawImage(out, 0, 0);
    syncSel();
  }
  const draw = () => { if (!raf) raf = requestAnimationFrame(paint); };
  const change = () => { dirty = true; draw(); };

  /* 指の操作 */
  const pts = new Map();
  let gest = null;
  const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const selItem = () => state.items.find((i) => i.id === sel);
  const mctx = document.createElement('canvas').getContext('2d');
  function begin() {
    const list = [...pts.values()];
    const it = selItem();
    if (list.length >= 2) {
      const [a, b] = list;
      const d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
      gest = it ? { mode: 'pinchItem', d0: d, a0: ang, s0: it.s, r0: it.r } : { mode: 'zoom', d0: d, z0: state.zoom };
      return;
    }
    const p = list[0];
    const hitIt = [...state.items].reverse().find((i) => hit(i, p.x, p.y, cssW, cssH, mctx));
    if (hitIt) {
      // 上に持ってくる
      state.items = state.items.filter((i) => i !== hitIt).concat(hitIt);
      const changed = sel !== hitIt.id;
      sel = hitIt.id;
      gest = { mode: 'drag', p0: p, x0: hitIt.x, y0: hitIt.y };
      if (tab !== 'deco') { tab = 'deco'; buildTabs(); buildPanel(); } else if (changed) buildPanel();
      draw();
    } else {
      if (sel) { sel = null; buildPanel(); draw(); }
      gest = tab === 'crop' ? { mode: 'pan', p0: p, px0: state.px, py0: state.py } : null;
    }
  }
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, local(e));
    begin();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId) || !gest) return;
    pts.set(e.pointerId, local(e));
    const list = [...pts.values()];
    const it = selItem();
    if (gest.mode === 'drag' && it && list.length === 1) {
      const p = list[0];
      it.x = clamp(gest.x0 + (p.x - gest.p0.x) / cssW, 0, 1);
      it.y = clamp(gest.y0 + (p.y - gest.p0.y) / cssH, 0, 1);
      change();
    } else if (gest.mode === 'pan' && list.length === 1) {
      const p = list[0], g = geo(state, src, cssW);
      const dx = p.x - gest.p0.x, dy = p.y - gest.p0.y;
      const c = Math.cos(g.t), s = Math.sin(g.t);
      state.px = gest.px0 + (dx * c + dy * s) / (g.s * g.iw);
      state.py = gest.py0 + (-dx * s + dy * c) / (g.s * g.ih);
      clampPan(state, src); change();
    } else if (list.length >= 2) {
      const [a, b] = list;
      const d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
      if (gest.mode === 'pinchItem' && it) {
        it.s = clamp(gest.s0 * d / gest.d0, 0.04, 1.6); it.r = gest.r0 + ang - gest.a0; change();
      } else if (gest.mode === 'zoom' && tab === 'crop') {
        state.zoom = clamp(gest.z0 * d / gest.d0, 1, 5); clampPan(state, src); change(); syncCrop();
      }
    }
  });
  const end = (e) => { pts.delete(e.pointerId); if (pts.size) begin(); else gest = null; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const k = Math.exp(-e.deltaY * 0.002), it = selItem();
    if (it) { it.s = clamp(it.s * k, 0.04, 1.6); change(); }
    else if (tab === 'crop') { state.zoom = clamp(state.zoom * k, 1, 5); clampPan(state, src); change(); syncCrop(); }
  }, { passive: false });

  /* 下の操作パネル */
  const chip = (label, on, onclick, extra = {}) => el('button', { type: 'button', class: `chip${on ? ' on' : ''}`, 'aria-pressed': String(!!on), onclick, ...extra }, label);
  const slider = (label, min, max, step, value, oninput, fmt) => {
    const out = el('span', { class: 'ed-val' }, fmt(value));
    const input = el('input', { type: 'range', min, max, step, value, 'aria-label': label,
      oninput: (e) => { const v = Number(e.target.value); out.textContent = fmt(v); oninput(v); } });
    const wrap = el('label', { class: 'ed-slider' }, el('span', { class: 'ed-lab' }, label), input, out);
    wrap.set = (v) => { input.value = v; out.textContent = fmt(v); };
    return wrap;
  };
  let cropRefs = {}, selRefs = {};
  const syncCrop = () => { cropRefs.zoom?.set(state.zoom); };
  const syncSel = () => {
    const it = selItem(); if (!it) return;
    selRefs.size?.set(it.s); selRefs.angle?.set(Math.round(((it.r * 180) / Math.PI + 540) % 360 - 180));
  };

  function buildTabs() {
    tabsEl.replaceChildren(...[['crop', 'CROP'], ['filter', 'FILTER'], ['deco', 'DECO']].map(([k, label]) =>
      el('button', { type: 'button', role: 'tab', class: `ed-tab${tab === k ? ' on' : ''}`, 'aria-selected': String(tab === k),
        onclick: () => { tab = k; buildTabs(); buildPanel(); draw(); } }, label)));
  }
  function buildPanel() {
    cropRefs = {}; selRefs = {};
    panel.scrollTop = 0;
    if (tab === 'crop') panel.replaceChildren(cropPanel());
    else if (tab === 'filter') panel.replaceChildren(filterPanel());
    else panel.replaceChildren(decoPanel());
  }
  function cropPanel() {
    cropRefs.zoom = slider('ZOOM', 1, 5, 0.01, state.zoom, (v) => { state.zoom = v; clampPan(state, src); change(); }, (v) => `${v.toFixed(1)}×`);
    const tilt = slider('TILT', -20, 20, 0.5, state.tilt, (v) => { state.tilt = v; clampPan(state, src); change(); }, (v) => `${v > 0 ? '+' : ''}${v}°`);
    return el('div', { class: 'ed-sec' },
      el('div', { class: 'chips' }, ASPECTS.map(([k, label]) => chip(label, state.aspect === k, () => { state.aspect = k; clampPan(state, src); change(); buildPanel(); }))),
      el('div', { class: 'row' },
        el('button', { type: 'button', class: 'btn ghost small', onclick: () => { state.rot = (state.rot + 3) % 4; clampPan(state, src); change(); } }, '⟲ ROTATE'),
        el('button', { type: 'button', class: 'btn ghost small', onclick: () => { state.rot = (state.rot + 1) % 4; clampPan(state, src); change(); } }, 'ROTATE ⟳'),
        el('button', { type: 'button', class: 'link', onclick: () => { Object.assign(state, { rot: 0, tilt: 0, zoom: 1, px: 0, py: 0 }); change(); buildPanel(); } }, 'RESET')),
      cropRefs.zoom, tilt,
      el('p', { class: 'muted ed-hint' }, tr('写真をドラッグで位置合わせ、2本指で拡大', 'Drag the photo to position it; pinch to zoom')));
  }
  function filterPanel() {
    // 小さな見本を色味ごとに作る
    const base = renderPhoto({ ...state, filter: 'none', frame: 'none' }, src, 120);
    const side = Math.min(base.width, base.height);
    const thumb = (name) => {
      const c = el('canvas', { class: 'ed-thumb', width: 64, height: 64 });
      const ctx = c.getContext('2d');
      ctx.drawImage(base, (base.width - side) / 2, (base.height - side) / 2, side, side, 0, 0, 64, 64);
      applyFilter(ctx, 0, 0, 64, 64, name);
      return c;
    };
    return el('div', { class: 'ed-sec' },
      el('div', { class: 'ed-filters' }, FILTERS.map(([k, label]) =>
        el('button', { type: 'button', class: `ed-filter${state.filter === k ? ' on' : ''}`, 'aria-pressed': String(state.filter === k),
          onclick: () => { state.filter = k; change(); buildPanel(); } }, thumb(k), el('span', {}, label)))));
  }
  function addItem(kind) {
    const it = { id: uid(), kind, x: 0.5, y: 0.5, r: 0, s: kind === 'tulipB' || kind === 'tulipP' ? 0.3 : kind === 'text' ? 0.2 : kind === 'date' ? 0.13 : 0.2,
      color: DEFAULT_COLOR[kind] || NAVY, font: 'bold' };
    if (kind === 'text') it.text = tr('ふたりで', 'US');
    if (kind === 'date') { const g = geo(state, src, 1); it.text = dateText; it.x = g.x0 + g.pw * 0.72; it.y = (g.y0 + g.ph * 0.91) / g.H; }
    if (kind === 'text' && state.frame === 'polaroid') { const g = geo(state, src, 1); it.y = (g.y0 + g.ph + (g.H - g.y0 - g.ph) / 2) / g.H; it.color = NAVY; it.font = 'round'; it.s = 0.16; }
    state.items.push(it); sel = it.id; change(); buildPanel();
    if (kind === 'text') setTimeout(() => panel.querySelector('.ed-text')?.select(), 50);
  }
  function stickerBtn(kind) {
    const c = el('canvas', { width: 72, height: 72 });
    const ctx = c.getContext('2d');
    const it = { kind, x: 0.5, y: 0.5, r: 0, s: kind === 'tulipB' || kind === 'tulipP' ? 0.42 : 0.78, color: DEFAULT_COLOR[kind] || NAVY };
    drawItem(ctx, it, 72, 72);
    const names = { heart: 'Heart', star: 'Star', sparkle: 'Sparkle', flower: 'Flower', tulipB: 'Blue tulip', tulipP: 'Pink tulip' };
    return el('button', { type: 'button', class: 'ed-stk', 'aria-label': `Add ${names[kind]}`, onclick: () => addItem(kind) }, c);
  }
  function decoPanel() {
    const it = selItem();
    const parts = [];
    if (it) {
      const isText = it.kind === 'text' || it.kind === 'date';
      const isTulip = it.kind === 'tulipB' || it.kind === 'tulipP';
      selRefs.size = slider('SIZE', 0.04, 1.6, 0.01, it.s, (v) => { it.s = v; change(); }, (v) => `${Math.round(v * 100)}`);
      selRefs.angle = slider('ANGLE', -180, 180, 1, 0, (v) => { it.r = (v * Math.PI) / 180; change(); }, (v) => `${v}°`);
      parts.push(el('div', { class: 'ed-sel' },
        el('div', { class: 'ed-sel-head' }, el('b', {}, tr('えらんだ飾り', 'SELECTED')),
          el('button', { type: 'button', class: 'btn ghost small', onclick: () => { state.items = state.items.filter((x) => x !== it); sel = null; change(); buildPanel(); } }, 'DELETE')),
        isText && el('input', { type: 'text', class: 'ed-text', value: it.text, maxlength: 40, 'aria-label': 'Text',
          oninput: (e) => { it.text = e.target.value; document.fonts?.load(fontOf(it, 40), it.text).then(draw).catch(() => {}); change(); } }),
        it.kind === 'text' && el('div', { class: 'chips' },
          chip('BOLD', it.font !== 'round', () => { it.font = 'bold'; change(); buildPanel(); }),
          chip('ROUND', it.font === 'round', () => { it.font = 'round'; change(); buildPanel(); })),
        !isTulip && el('div', { class: 'ed-colors' }, [...(it.kind === 'date' ? ['#FF8A3D'] : []), ...COLORS].map((c) =>
          el('button', { type: 'button', class: `ed-color${it.color === c ? ' on' : ''}`, style: `background:${c}`, 'aria-label': `Color ${c}`,
            onclick: () => { it.color = c; change(); buildPanel(); } }))),
        selRefs.size, selRefs.angle));
    }
    parts.push(
      el('div', { class: 'ed-lab' }, 'STICKERS'),
      el('div', { class: 'ed-stks' }, STICKERS.map(stickerBtn)),
      el('div', { class: 'row' },
        el('button', { type: 'button', class: 'btn ghost small', onclick: () => addItem('text') }, '+ TEXT'),
        el('button', { type: 'button', class: 'btn ghost small', onclick: () => addItem('date') }, '+ DATE')),
      el('div', { class: 'ed-lab' }, 'FRAME'),
      el('div', { class: 'chips' }, FRAMES.map(([k, label]) => chip(label, state.frame === k, () => { state.frame = k; change(); buildPanel(); }))),
      el('p', { class: 'muted ed-hint' }, tr('飾りはドラッグで移動、2本指で大きさと向き', 'Drag a sticker to move it; pinch to resize and turn it')));
    const box = el('div', { class: 'ed-sec' }, parts);
    requestAnimationFrame(syncSel);
    return box;
  }

  /* 開く・閉じる */
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return; done = true;
      dlg.classList.add('closing');
      setTimeout(() => dlg.close(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 170);
      resolve(v);
    };
    let asking = false;
    const cancel = async () => {
      if (asking) return;
      if (dirty) { asking = true; const ok = await ask(tr('編集をやめますか？', 'Discard your edits?'), { text: tr('ここまでの編集は消えます。', 'Your edits so far will be lost.'), ok: 'DISCARD', cancel: 'KEEP EDITING', danger: true }); asking = false; if (!ok) return; }
      finish(null);
    };
    const save = async () => {
      doneBtn.disabled = true;
      sel = null;
      // 出力の大きさ：長い辺を maxSide に。元の写真より大きくはしない
      const max = opts.maxSide || 1600;
      const r = geo(state, src, 1).H;
      let W = r <= 1 ? max : max / r;
      const g = geo(state, src, W);
      if (g.s > 1) W = Math.max(600, W / g.s);
      const out = renderAll(state, src, Math.round(W), null, null);
      const blob = await new Promise((ok) => out.toBlob(ok, 'image/jpeg', 0.86));
      if (!blob) { doneBtn.disabled = false; notice(tr('写真を作れませんでした', "Couldn't create the photo")); return; }
      const st = JSON.parse(JSON.stringify(state));
      finish(opts.withState ? { blob, state: st } : blob);
    };
    const doneBtn = el('button', { type: 'button', class: 'btn small', onclick: save }, 'DONE');
    dlg.append(el('div', { class: 'sheet ed-sheet' },
      el('div', { class: 'ed-head' },
        el('button', { type: 'button', class: 'link', onclick: cancel }, 'CANCEL'),
        el('span', { class: 'ed-title' }, 'Edit'),
        doneBtn),
      stage, tabsEl, panel));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); cancel(); });
    const root = document.documentElement;
    dlg.addEventListener('close', () => { dlg.remove(); if (!document.querySelector('dialog[open]')) root.classList.remove('locked'); });
    document.body.append(dlg);
    root.classList.add('locked');
    dlg.showModal();
    buildTabs(); buildPanel();
    const ro = new ResizeObserver(() => draw());
    ro.observe(stage);
    dlg.addEventListener('close', () => ro.disconnect());
    draw();
  });
}
