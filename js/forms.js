// ダイアログと入力フォーム（日付の帯、写真の欄、地図の欄など）。
import { h, reduceMotion } from './dom.js?v=38';
import { lang, tr } from './i18n.js?v=38';
import { MONTHS, WEEK, pad, ymd, parse, today, utc, md, lastDay } from './dates.js?v=38';
import { store } from './state.js?v=38';
import { ask, notice } from './ask.js?v=38';
import { editPhoto } from './photo-editor.js?v=38';
import { photoImg, pickFile, maxSide, fitImage } from './photos.js?v=38';
import { geoField, placePhoto, namePhotos, smallThumb } from './places.js?v=38';
import { songPhotos } from './songs.js?v=38';
import { SONG_CAT, catLabel, catKey } from './cats.js?v=38';
import { refresh } from './shell.js?v=38';

const BOOKMARK = '<svg viewBox="0 0 10 13" aria-hidden="true"><path d="M0 0h10v13L5 9.5 0 13z" fill="currentColor"/></svg>';

/* ---------- ダイアログ（入力・メニュー共通） ---------- */
function showDialog(dlg) {
  document.body.append(dlg);
  const root = document.documentElement;
  root.classList.add('locked');
  dlg.addEventListener('close', () => { dlg.remove(); if (!document.querySelector('dialog[open]')) root.classList.remove('locked'); });
  dlg.addEventListener('click', (ev) => { if (ev.target === dlg) closeDialog(dlg); });
  dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); closeDialog(dlg); });
  dlg.showModal();
}
async function closeDialog(dlg, force = false) {
  if (!dlg.open || dlg.classList.contains('closing') || dlg.asking) return;
  if (!force && dlg.guard) {
    dlg.asking = true;
    const ok = await dlg.guard();
    dlg.asking = false;
    if (!ok || !dlg.open) return;
  }
  dlg.classList.add('closing');
  setTimeout(() => dlg.close(), reduceMotion() ? 0 : 170);
}

/* ---------- 日付をえらぶ帯（横にスクロールする日のカード） ---------- */
function dayStrip({ value, onChange, marks = new Set(), max = null, allowNone = false }) {
  let sel = value || null;
  let { y, m } = parse(sel || today());
  const label = h('span', { class: 'pill-text' });
  const native = h('input', { type: 'date', class: 'month-native', 'aria-label': tr('カレンダーから日付をえらぶ', 'Pick a date from the calendar'), max: max || null,
    onclick: () => { try { native.showPicker(); } catch { /* 未対応のブラウザはそのまま */ } },
    onchange: (ev) => { if (ev.target.value) pick(ev.target.value); } });
  const strip = h('div', { class: 'strip' });
  const center = (smooth) => {
    const c = strip.querySelector('.on') || strip.querySelector('.today');
    const left = c ? c.offsetLeft - (strip.clientWidth - c.offsetWidth) / 2 : 0;
    strip.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
  };
  const bm = () => { const i = h('i', { class: 'bm' }); i.innerHTML = BOOKMARK; return i; };
  const noneBtn = allowNone ? h('button', { type: 'button', class: 'chip', onclick: () => { sel = null; render(); onChange(null); } }, 'NO DATE') : null;
  const next = h('button', { type: 'button', class: 'mnav', 'aria-label': tr('次の月', 'Next month'), onclick: () => shift(1) }, '›');
  function render() {
    label.textContent = `${MONTHS[m - 1]}  ${y}`;
    native.value = sel || '';
    next.disabled = !!max && ymd(y, m, lastDay(y, m)) >= max;
    const t = today();
    strip.replaceChildren(...Array.from({ length: lastDay(y, m) }, (_, i) => {
      const d = ymd(y, m, i + 1);
      const cls = ['day', d === sel && 'on', d === t && 'today', marks.has(d) && 'marked'].filter(Boolean).join(' ');
      return h('button', { type: 'button', class: cls, disabled: !!max && d > max, 'aria-pressed': String(d === sel),
        'aria-label': `${md(d)}${marks.has(d) ? tr('（記録あり）', ' (recorded)') : ''}`, onclick: () => pick(d) },
      bm(), h('span', { class: 'wd' }, WEEK[new Date(utc(d)).getUTCDay()]), h('span', { class: 'dn' }, pad(i + 1)));
    }));
    if (noneBtn) noneBtn.classList.toggle('on', !sel);
  }
  function pick(d) { sel = d; ({ y, m } = parse(d)); render(); onChange(d); requestAnimationFrame(() => center(true)); }
  function shift(k) {
    m += k;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    render(); requestAnimationFrame(() => center(false));
  }
  render();
  const ro = new ResizeObserver(() => { if (strip.clientWidth) { center(false); ro.disconnect(); } });
  ro.observe(strip);
  const root = h('div', { class: 'daypick' },
    h('div', { class: 'month' },
      h('button', { type: 'button', class: 'mnav', 'aria-label': tr('前の月', 'Previous month'), onclick: () => shift(-1) }, '‹'),
      h('span', { class: 'pill' }, label, native), next),
    strip,
    h('div', { class: 'row daypick-foot' },
      h('button', { type: 'button', class: 'chip', onclick: () => pick(max && today() > max ? max : today()) }, 'TODAY'), noneBtn,
      h('span', { class: 'muted' }, tr('月の部分をタップするとカレンダー', 'Tap the month for a calendar'))));
  root.pick = pick;
  return root;
}

/* ---------- 入力のモーダル ---------- */
// 入力欄の中身。モーダルでも、ページの下に置く入力欄でも使う。
function formParts({ fields, initial = {}, onSubmit, after, submitLabel = 'SAVE' }) {
  const v = { ...initial };
  let newPhoto = null;
  let draft = null; // 保存前の写真は、元の写真と編集の内容を持っておく（何度でもやり直せる）
  let dirty = false;
  let onGeo = () => {};   // 地図の場所が決まったとき（写真の欄が自動で写真を入れるのに使う）
  let onTitle = () => {}; // 名前が変わったとき（写真の欄が名前から写真をさがすのに使う）
  const touch = () => { dirty = true; };
  const err = h('p', { class: 'err', role: 'alert' });
  const field = (f, inner, tag = 'div') => h(tag, { class: 'field' },
    f.label && h('span', { class: 'flabel' }, f.label, f.required && !f.readonly && h('span', { class: 'req' }, tr('必須', 'required'))),
    inner, f.hint && h('span', { class: 'hint' }, f.hint));
  const control = (f) => {
    if (f.type === 'geo') return field(f, geoField(v, (info) => onGeo(info)));
    if (f.type === 'date') {
      return field(f, dayStrip({ value: v[f.name], allowNone: !f.required, onChange: (d) => { v[f.name] = d; touch(); } }));
    }
    if (f.type === 'photo') {
      const img = v.photo ? photoImg(v.photo, 'drop-img') : h('img', { class: 'drop-img', alt: '', hidden: true });
      const txt = h('span', { class: 'drop-txt', hidden: !!v.photo }, '+ ADD PHOTO', h('small', {}, tr('タップして端末の写真から', 'Tap to choose from your device')));
      const show = (blob, d) => {
        newPhoto = blob; draft = d;
        img.src = URL.createObjectURL(blob); img.hidden = false; txt.hidden = true; rm.hidden = false; ed.hidden = false; drop.classList.remove('is-empty'); touch();
      };
      const clearPhoto = () => {
        newPhoto = null; draft = null; v.photo = null; img.hidden = true; img.removeAttribute('src'); txt.hidden = false; rm.hidden = true; ed.hidden = true; drop.classList.add('is-empty');
      };
      // 拾ってきた写真の候補。地図の場所から見つけたもの（いちばん確か）を先頭に、名前で探したものを後ろに並べる
      // 自分で写真をえらんだら（mine）、自動では置きかえない。候補の列はそのまま出しておくので、あとから選べる
      let mine = !!v.photo, auto = false, seq = 0, picked = -1;
      let geoCand = null, textCands = [], cands = [];
      const credit = h('span', { class: 'hint photo-credit', hidden: true });
      const strip = h('div', { class: 'cands', hidden: true });
      const fromDevice = h('button', { type: 'button', class: 'cand dev', onclick: () => choose() }, h('span', {}, '+'), h('small', {}, tr('端末から', 'Device')));
      const say = (t) => { credit.hidden = !t; credit.textContent = t || ''; };
      const paintStrip = () => {
        strip.hidden = !cands.length;
        strip.replaceChildren(...cands.map((c, i) => h('button', { type: 'button', class: `cand${i === picked ? ' on' : ''}`, title: c.title,
          'aria-label': tr(`候補${i + 1}：${c.title}`, `Option ${i + 1}: ${c.title}`), 'aria-pressed': String(i === picked), onclick: () => pick(i, true) },
          h('img', { src: smallThumb(c.url), alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }))), fromDevice);
      };
      const creditOf = (c) => tr(`${c.from}「${c.title}」の写真を仮に入れました。下から別の写真もえらべます`,
        `Added a photo from ${c.from} "${c.title}". You can pick another below.`);
      async function pick(i, byHand) {
        const c = cands[i]; if (!c) return;
        const my = ++seq;
        picked = i; paintStrip(); say(tr('写真を読みこみ中…', 'Loading photo…'));
        let blob = null;
        try { blob = await fitImage(await (await fetch(c.url)).blob()); } catch { blob = null; }
        if (my !== seq) return;
        if (!blob) {   // 読めなかった候補は外して、次へ
          cands.splice(i, 1); picked = -1; paintStrip();
          if (cands.length && (byHand || !mine)) return pick(Math.min(i, cands.length - 1), byHand);
          if (auto) { clearPhoto(); auto = false; }
          say(cands.length ? '' : tr('写真は見つかりませんでした', 'No photo found'));
          return;
        }
        show(blob, { file: blob }); auto = true; mine = false;
        say(creditOf(c));
      }
      const refresh = () => {
        const seen = new Set();
        cands = [geoCand, ...textCands].filter((c) => c && !seen.has(c.url) && seen.add(c.url)).slice(0, 10);
        picked = -1; paintStrip();
        if (mine) { say(cands.length ? tr('ほかの写真の候補です。タップすると入れかわります', 'Other photos you can use — tap to swap') : ''); return; }
        if (cands.length) pick(0, false);
        else { if (auto) { clearPhoto(); auto = false; } say(''); }
      };
      onGeo = async (info) => {
        const my = ++seq;
        if (!info) { geoCand = null; refresh(); return; }
        say(tr('この場所の写真をさがしています…', 'Looking for a photo of this place…'));
        const t = await placePhoto({ ...info, name: v.title });
        if (my !== seq) return;
        geoCand = t && { ...t, from: 'Wikipedia' };
        refresh();
      };
      let timer = 0;
      onTitle = (text) => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          const q = text.trim();
          const my = ++seq;
          if (q.length < 2) { textCands = []; refresh(); return; }
          if (!mine && !geoCand) say(tr('写真をさがしています…', 'Looking for photos…'));
          // 曲なら、まずジャケット写真を候補にする
          const found = v.category === SONG_CAT ? [...await songPhotos(q), ...await namePhotos(q)] : await namePhotos(q);
          if (my !== seq || q !== (v.title || '').trim()) return;
          textCands = found; refresh();
        }, 900);
      };
      async function choose() {
        const file = await pickFile(); if (!file) return;
        const out = await editPhoto(file, { maxSide: maxSide(), lang, withState: true });
        if (out) { seq++; show(out.blob, { file, state: out.state }); mine = true; auto = false; picked = -1; paintStrip(); say(''); }
      }
      // 今の写真をもう一度ひらいて直す
      const reedit = async () => {
        let src = draft?.file, state = draft?.state;
        if (!src && v.photo) {
          try { src = await (await fetch(await store.photoUrl(v.photo))).blob(); } catch { notice(tr('写真を読みこめませんでした', "Couldn't load the photo")); return; }
        }
        if (!src) return;
        const out = await editPhoto(src, { maxSide: maxSide(), lang, withState: true, state });
        if (out) { show(out.blob, { file: src, state: out.state }); mine = true; auto = false; }
      };
      const rm = h('button', { type: 'button', class: 'link', hidden: !v.photo, onclick: () => {
        seq++; clearPhoto(); touch(); mine = false; auto = false; picked = -1; paintStrip(); say('');
      } }, 'REMOVE PHOTO');
      const ed = h('button', { type: 'button', class: 'btn ghost small', hidden: !v.photo, onclick: reedit }, 'EDIT PHOTO');
      const drop = h('button', { type: 'button', class: v.photo ? 'drop' : 'drop is-empty', onclick: choose }, img, txt);
      return field(f, h('div', { class: 'photo-field' }, drop, credit, strip, h('div', { class: 'row' }, ed, rm)));
    }
    const common = { value: v[f.name] ?? '', required: f.required, readonly: f.readonly, placeholder: f.ph,
      oninput: (ev) => { v[f.name] = ev.target.value; touch(); if (f.name === 'title') onTitle(ev.target.value); } };
    if (f.type === 'textarea') return field(f, h('textarea', common), 'label');
    if (f.type === 'category') {
      // 決まった種類は日本語のまま保存し、表示だけ言語に合わせる
      const input = h('input', { type: 'text', ...common, value: catLabel(v[f.name] ?? ''),
        oninput: (ev) => { v[f.name] = catKey(ev.target.value); touch(); } });
      const chips = h('div', { class: 'chips' }, f.options.map((o) => h('button', { type: 'button', class: `chip${v[f.name] === o ? ' on' : ''}`,
        onclick: () => { input.value = catLabel(o); v[f.name] = o; touch(); [...chips.children].forEach((c) => c.classList.toggle('on', c.textContent === catLabel(o))); } }, catLabel(o))));
      input.addEventListener('input', () => [...chips.children].forEach((c) => c.classList.toggle('on', c.textContent === input.value)));
      return field(f, h('div', { class: 'cat' }, chips, input));
    }
    return field(f, h('input', { type: f.type, ...common }), 'label');
  };
  const submit = h('button', { class: 'btn', type: 'submit' }, submitLabel);
  const handle = async (ev) => {
    ev.preventDefault(); err.textContent = '';
    for (const f of fields) {
      const missing = f.required && f.name && !String(v[f.name] ?? '').trim();
      if (missing) {
        const pick = ['date', 'category'].includes(f.type);
        err.textContent = tr(`「${f.label}」を${pick ? 'えらんで' : '書いて'}ください。`, `Please ${pick ? 'choose' : 'fill in'} "${f.label}".`);
        return;
      }
    }
    submit.disabled = true;
    try {
      if (newPhoto) v.photo = await store.uploadPhoto(newPhoto);
      for (const f of fields) if (f.type === 'date' && !v[f.name]) v[f.name] = null;
      await onSubmit(v);
      if (initial.photo && v.photo !== initial.photo) store.removePhoto(initial.photo).catch(() => {});
      await after();
    } catch (e) { err.textContent = e.message || String(e); submit.disabled = false; }
  };
  return { controls: fields.map(control), err, submit, handle, isDirty: () => dirty };
}
function openForm({ title, en, lead, fields, initial, onSubmit }) {
  const dlg = h('dialog', { class: 'modal', 'aria-label': title });
  const fp = formParts({ fields, initial, onSubmit, after: async () => { closeDialog(dlg, true); await refresh(); } });
  dlg.guard = async () => !fp.isDirty() || ask(tr('書きかけの内容を捨てますか？', 'Discard what you wrote?'),
    { text: tr('閉じると、いま書いた内容と写真は消えます。', 'If you close now, your text and photo will be lost.'), ok: 'DISCARD', cancel: 'KEEP WRITING', danger: true });
  dlg.append(h('form', { class: 'sheet', novalidate: true, onsubmit: fp.handle },
    h('div', { class: 'mhead' },
      h('div', {}, en && h('div', { class: 'tag' }, en), h('h2', {}, title), lead && h('p', { class: 'lead' }, lead)),
      h('button', { type: 'button', class: 'x', 'aria-label': 'Close', onclick: () => closeDialog(dlg) }, '×')),
    h('div', { class: 'mbody' }, fp.controls),
    h('div', { class: 'mfoot' }, fp.err, h('div', { class: 'row' }, fp.submit,
      h('button', { class: 'btn ghost', type: 'button', onclick: () => closeDialog(dlg) }, 'CANCEL')))));
  showDialog(dlg);
}
function inlineForm({ fields, onSubmit }) {
  const fp = formParts({ fields, onSubmit, after: refresh, submitLabel: 'ADD' });
  const form = h('form', { class: 'inline-form', novalidate: true, onsubmit: fp.handle }, fp.controls, fp.err, h('div', { class: 'row' }, fp.submit));
  form.isDirty = fp.isDirty;
  return form;
}

/* ---------- 各欄 ---------- */
const F = {
  title: (label, ph) => ({ name: 'title', type: 'text', label, required: true, ph }),
  date: (label = tr('日付', 'Date')) => ({ name: 'date', type: 'date', label }),
  get body() { return { name: 'body', type: 'textarea', label: tr('ひとこと', 'Note'), ph: tr('そのときのこと、思ったことを自由に', 'What happened, how you felt — anything') }; },
  get geo() { return { type: 'geo', label: tr('地図の場所', 'Location'), hint: tr('入れておくと地図にピンが立ちます', 'Adds a pin to the map') }; },
  get photo() { return { type: 'photo', label: tr('写真', 'Photo') }; },
};

export { showDialog, closeDialog, dayStrip, openForm, inlineForm, F };
