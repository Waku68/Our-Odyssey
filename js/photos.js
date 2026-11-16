// 写真をえらぶ・表示する・大きさをそろえる。
import { h } from './dom.js?v=57';
import { lang } from './i18n.js?v=57';
import { store } from './state.js?v=57';
import { editPhoto } from './photo-editor.js?v=57';

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
// 何枚かまとめてえらぶ。やめたら空
function pickFiles() {
  return new Promise((res) => {
    const i = h('input', { type: 'file', accept: 'image/*', multiple: true });
    i.onchange = () => res([...i.files]);
    i.click();
  });
}

// 場所の写真は、表紙の1枚（photo）と、ほかの写真（more_photos）に分けて覚えておく。
// 前からある記録には more_photos がない（表紙だけ）
const morePhotos = (e) => (Array.isArray(e?.more_photos) ? e.more_photos.filter(Boolean) : []);
const allPhotos = (e) => [e?.photo, ...morePhotos(e)].filter(Boolean);
// 保存するときの more_photos。空なら送らない（前はあったときだけ消す）。
// こうしておくと、more_photos の欄をまだ足していないデータベースでも、ほかの写真を足さないかぎり今までどおり保存できる
const moreOf = (v, before = null) => {
  const list = morePhotos(v);
  return list.length ? { more_photos: list } : morePhotos(before).length ? { more_photos: null } : {};
};
const maxSide = () => (store.mode === 'demo' ? 900 : 1600);
// 写真をえらんで、切り取り・回転・飾りつけをしてから使う。やめたら null。
async function pickPhoto(opts = {}) {
  const f = await pickFile(); if (!f) return null;
  return editPhoto(f, { maxSide: maxSide(), lang, ...opts });
}

// 拾ってきた写真を、保存する大きさまで縮める
// （端末の写真をまとめてえらんだときもこれを通す。撮ったときの向きに合わせ、読めないブラウザでは img で読む）
async function fitImage(blob) {
  let bmp;
  try { bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
  catch {
    const url = URL.createObjectURL(blob);
    try { bmp = await new Promise((ok, ng) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ng(new Error('image')); i.src = url; }); }
    finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
  }
  const w = bmp.width || bmp.naturalWidth, hgt = bmp.height || bmp.naturalHeight;
  const k = Math.min(1, maxSide() / Math.max(w, hgt));
  const c = h('canvas');
  c.width = Math.round(w * k); c.height = Math.round(hgt * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();   // 大きな写真のメモリをすぐ手放す
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
}

export { photoImg, pickFile, pickFiles, maxSide, pickPhoto, fitImage, morePhotos, allPhotos, moreOf };
