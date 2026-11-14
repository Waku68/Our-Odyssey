// MOOD：気分の記録（本人だけに見える）。グラフと、日ごとの入力。
import { h, reduceMotion } from '../dom.js?v=39';
import { tr } from '../i18n.js?v=39';
import { today, md } from '../dates.js?v=39';
import { store, data, me } from '../state.js?v=39';
import { markSeenNow, moodSig } from '../seen.js?v=39';
import { ask } from '../ask.js?v=39';
import { dayStrip } from '../forms.js?v=39';
import { levels, moodChart } from '../mood-chart.js?v=39';
import { act, draw, pageNav, pageHead } from '../shell.js?v=39';

let moodSel = null;

function moodPage() {
  const t = today();
  markSeenNow(data.moods.filter((m) => m.user_id !== me()).map((m) => [`m:${m.id}`, moodSig(m)]));
  // 同じ日に何件かあっても（保存を2回押したときなど）、いちばん新しい1件だけを使う
  const own = data.moods.filter((m) => m.user_id === me());
  const latest = new Map();
  for (const m of own) { const p = latest.get(m.date); if (!p || (m.created_at || '') >= (p.created_at || '')) latest.set(m.date, m); }
  const mine = [...latest.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  const byDay = new Map(mine.map((m) => [m.date, m]));
  // その日のほかの（かくれている）記録
  const extras = (d, keep) => own.filter((m) => m.date === d && m.id !== keep).map((m) => m.id);
  if (!moodSel || moodSel > t) moodSel = t;

  const v = {};
  const err = h('p', { class: 'err', role: 'alert' });
  const status = h('p', { class: 'mstatus' });
  const levelBtns = levels().map((label, i) => h('button', { type: 'button', onclick: () => { v.level = i + 1; paint(); } }, label));
  const paint = () => levelBtns.forEach((b, i) => { b.classList.toggle('on', v.level === i + 1); b.setAttribute('aria-pressed', String(v.level === i + 1)); });
  const note = h('textarea', { placeholder: tr('なにがあった？（なくてもいい）', 'What happened? (optional)'), oninput: (ev) => { v.note = ev.target.value; } });
  const saveBtn = h('button', { class: 'btn', type: 'submit' });
  const del = h('button', { type: 'button', class: 'link', onclick: async () => { if (await ask(tr('この日の記録を消しますか？', 'Delete the entry for this day?'), { ok: 'DELETE', danger: true })) act(async () => { for (const id of [v.id, ...extras(moodSel, v.id)]) await store.removeMood(id); }); } }, 'DELETE THIS DAY');
  const loadDay = (d) => {
    const m = byDay.get(d);
    v.id = m?.id; v.level = m?.level; v.note = m?.note || '';
    note.value = v.note; paint(); err.textContent = '';
    status.textContent = m ? tr(`${md(d)}の記録があります。なおせます。`, `You logged ${md(d)}. You can update it.`) : tr(`${md(d)}は、どんな気分だった？`, `How did you feel on ${md(d)}?`);
    saveBtn.textContent = m ? 'UPDATE' : 'SAVE';
    del.hidden = !m;
  };
  const form = h('form', { class: 'madd', id: 'mood-add', onsubmit: (ev) => {
    ev.preventDefault();
    if (!v.level) { err.textContent = tr('気分をえらんでください。', 'Please choose a mood.'); return; }
    if (saveBtn.disabled) return;
    saveBtn.disabled = true;
    const d = moodSel, row = { date: d, level: v.level, note: v.note || '', shared: false };
    act(async () => {
      await store.saveMood(v.id ? { id: v.id, ...row } : row);
      if (v.id) for (const id of extras(d, v.id)) await store.removeMood(id);
    }).finally(() => { saveBtn.disabled = false; });
  } });
  const strip = dayStrip({ value: moodSel, max: t, marks: new Set(byDay.keys()), onChange: (d) => { moodSel = d; loadDay(d); } });
  const editFromChart = (d) => {
    moodSel = d; draw();
    requestAnimationFrame(() => document.getElementById('mood-add')?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' }));
  };
  form.append(
    h('h2', { class: 'en madd-title' }, 'Add mood'), h('p', { class: 'jp' }, tr('気分を追加', 'Log a mood')),
    h('div', { class: 'mcard' },
      strip, status,
      h('div', { class: 'levels' }, levelBtns),
      h('label', { class: 'field' }, h('span', { class: 'flabel' }, tr('メモ', 'Note')), note),
      err, h('div', { class: 'row' }, saveBtn, del)));
  loadDay(moodSel);

  return h('div', {}, pageNav(),
    h('div', { class: 'mood-top' }, pageHead('Mood'), moodChart(mine, editFromChart)),
    h('p', { class: 'muted mhint' }, tr('点をタップでメモ、2本指で広げると期間が変わります。ここは自分にしか見えません。', 'Tap a dot to see the note; pinch to change the period. Only you can see this.')),
    h('button', { class: 'down', type: 'button', onclick: () => form.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, 'ADD MOOD', h('span', { 'aria-hidden': 'true' }, '↓')),
    form);
}

export { moodPage };
