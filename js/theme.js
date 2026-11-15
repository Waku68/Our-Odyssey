// 色のテーマ。もとの配色（ピンクと紺）の色相だけを回して、雰囲気を変える。
// 選んだテーマはこの端末だけに覚えておく（相手の画面は変わらない）。
const KEY = 'our-odyssey-theme';
const CSS_KEY = 'our-odyssey-theme-css';   // index.html の最初で、読みこみ前に色を当てるための控え

export const BASE = { pink: '#F2C4CE', pinkD: '#E79AAB', navy: '#16204F', paper: '#FBF1EF', accent: '#F74D7E' };
const BASE_HUE = 347;   // もとのピンクの色相

// hue：背景の色相（0〜359）。ink：文字の紺もいっしょに回すか
export const PRESETS = [
  { id: 'original', en: 'ORIGINAL', jp: 'いつもの', hue: BASE_HUE },
  { id: 'peach', en: 'PEACH', jp: 'ピーチ', hue: 18 },
  { id: 'lemon', en: 'LEMON', jp: 'レモン', hue: 48 },
  { id: 'mint', en: 'MINT', jp: 'ミント', hue: 150 },
  { id: 'sky', en: 'SKY', jp: 'そら', hue: 205 },
  { id: 'lavender', en: 'LAVENDER', jp: 'ラベンダー', hue: 268 },
];

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const rgbToHex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > .5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hslToRgb([h, s, l]) {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
const rotate = (hex, deg) => { const [h, s, l] = rgbToHsl(hexToRgb(hex)); return rgbToHex(hslToRgb([(h + deg + 360) % 360, s, l])); };

export function load() {
  try { const t = JSON.parse(localStorage.getItem(KEY)); if (t && Number.isFinite(t.hue)) return { hue: t.hue, ink: !!t.ink }; } catch { /* いつもの色 */ }
  return { hue: BASE_HUE, ink: false };
}
export function colors({ hue, ink }) {
  const d = hue - BASE_HUE;
  return { pink: rotate(BASE.pink, d), pinkD: rotate(BASE.pinkD, d), paper: rotate(BASE.paper, d), accent: rotate(BASE.accent, d),
    navy: ink ? rotate(BASE.navy, d) : BASE.navy };
}
// いま使っている色（JS で描く地図のピンやグラフもこれを使う）
export const TH = { ...BASE };
export function apply(t = load(), save = false) {
  const c = colors(t);
  Object.assign(TH, c);
  const vars = { '--pink': c.pink, '--pink-d': c.pinkD, '--navy': c.navy, '--paper': c.paper, '--accent': c.accent,
    '--navy-rgb': hexToRgb(c.navy).join(' '), '--paper-rgb': hexToRgb(c.paper).join(' ') };
  for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
  const css = Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';');
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', c.pink);
  tintIcon(t);
  if (save) {
    try { localStorage.setItem(KEY, JSON.stringify(t)); localStorage.setItem(CSS_KEY, css); } catch { /* 今回だけ */ }
  }
  return c;
}
export const isOriginal = (t) => t.hue === BASE_HUE && !t.ink;

// アイコンも同じ色合いにする（タブのアイコンと、iPhone で「ホーム画面に追加」するときの絵）。
// すでにホーム画面にあるアイコンと、Android のインストール版のアイコン（manifest の絵）は変えられない。
let iconImg = null;   // もとの絵（apple-touch-icon.png）。一度だけ読む
let iconJob = 0;      // スライダーを動かしている最中に、古い計算の結果で上書きしないための番号
async function tintIcon(t) {
  const links = [...document.querySelectorAll('link[rel=icon], link[rel=apple-touch-icon]')];
  for (const l of links) l.dataset.src ??= l.getAttribute('href');
  const job = ++iconJob;
  if (isOriginal(t)) { for (const l of links) l.href = l.dataset.src; return; }
  const src = links.find((l) => l.rel === 'apple-touch-icon')?.dataset.src;
  if (!src) return;
  try {
    iconImg ??= new Promise((ok, ng) => { const im = new Image(); im.onload = () => ok(im); im.onerror = ng; im.src = src; });
    const im = await iconImg;
    if (job !== iconJob) return;
    const cv = document.createElement('canvas');
    cv.width = im.naturalWidth; cv.height = im.naturalHeight;
    const ctx = cv.getContext('2d');
    ctx.drawImage(im, 0, 0);
    const img = ctx.getImageData(0, 0, cv.width, cv.height), px = img.data, d = t.hue - BASE_HUE;
    for (let i = 0; i < px.length; i += 4) {
      const rgb = [px[i], px[i + 1], px[i + 2]], [h, s, l] = rgbToHsl(rgb);
      const out = hslToRgb([(h + d + 360) % 360, s, l]);
      // 紺をそのままにするときは、明るいところ（空・海・雲のピンク）だけ回す。船のふちはなめらかにまぜる
      const w = t.ink ? 1 : Math.min(1, Math.max(0, (l - .5) / .18));
      for (let k = 0; k < 3; k++) px[i + k] = Math.round(rgb[k] + (out[k] - rgb[k]) * w);
    }
    ctx.putImageData(img, 0, 0);
    const url = cv.toDataURL('image/png');
    for (const l of links) l.href = url;
  } catch { iconImg = null; /* 読めないときは、もとのアイコンのまま */ }
}
