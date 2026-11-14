// 写真をえらぶ・表示する・大きさをそろえる。
import { h } from './dom.js?v=39';
import { lang } from './i18n.js?v=39';
import { store } from './state.js?v=39';
import { editPhoto } from './photo-editor.js?v=39';

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
const maxSide = () => (store.mode === 'demo' ? 900 : 1600);
// 写真をえらんで、切り取り・回転・飾りつけをしてから使う。やめたら null。
async function pickPhoto(opts = {}) {
  const f = await pickFile(); if (!f) return null;
  return editPhoto(f, { maxSide: maxSide(), lang, ...opts });
}

// 拾ってきた写真を、保存する大きさまで縮める
async function fitImage(blob) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, maxSide() / Math.max(bmp.width, bmp.height));
  const c = h('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
}

export { photoImg, pickFile, maxSide, pickPhoto, fitImage };
