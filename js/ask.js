// ブラウザ標準の confirm / alert のかわりに出す、サイトの見た目に合わせた小さなポップ。
// ask(...) → OK なら true、やめたら false（Promise）。notice(...) → 閉じたら終わる（Promise）。
import { h as el, reduceMotion } from './dom.js?v=39';

function open({ title, text, ok, cancel, danger }) {
  return new Promise((resolve) => {
    let done = false;
    const dlg = el('dialog', { class: 'ask', role: 'alertdialog', 'aria-label': title });
    const finish = (v) => {
      if (done) return;
      done = true;
      dlg.classList.add('closing');
      setTimeout(() => { dlg.close(); dlg.remove(); resolve(v); }, reduceMotion() ? 0 : 150);
    };
    const okBtn = el('button', { type: 'button', class: `btn${danger ? ' danger' : ''}`, onclick: () => finish(true) }, ok);
    dlg.append(el('div', { class: 'ask-card' },
      el('p', { class: 'ask-title' }, title),
      text && el('p', { class: 'ask-text' }, text),
      el('div', { class: 'ask-btns' }, okBtn,
        cancel && el('button', { type: 'button', class: 'btn ghost', onclick: () => finish(false) }, cancel))));
    // 外側をタップ・Esc はやめる扱い
    dlg.addEventListener('click', (ev) => { if (ev.target === dlg) finish(false); });
    dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); finish(false); });
    document.body.append(dlg);
    dlg.showModal();
    (cancel ? dlg.querySelector('.btn.ghost') : okBtn).focus();
  });
}

export const ask = (title, { text, ok = 'OK', cancel = 'CANCEL', danger = false } = {}) => open({ title, text, ok, cancel, danger });
export const notice = (title, { text, ok = 'OK' } = {}) => open({ title, text, ok, cancel: null });
