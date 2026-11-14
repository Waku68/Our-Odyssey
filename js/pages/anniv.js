// DAYS：記念日。付き合った日と、足した記念日のカウント。
import { CONFIG } from '../config.js?v=39';
import { h } from '../dom.js?v=39';
import { tr } from '../i18n.js?v=39';
import { today, daysBetween, nextMonthly, nextYearly, spanLabel, plural, dots, md } from '../dates.js?v=39';
import { store, data } from '../state.js?v=39';
import { openForm, F } from '../forms.js?v=39';
import { canEdit, removeEntry } from '../entries.js?v=39';
import { pageNav, pageHead } from '../shell.js?v=39';

// つぎに来る記念日を、近い順に並べる（MORE のコルクボード用）
function annivLines() {
  const t = today();
  const nm = nextMonthly(CONFIG.START_DATE, t);
  const lines = [{ title: tr(`${spanLabel(nm.months)}の記念日`, `${spanLabel(nm.months)} anniversary`), left: daysBetween(t, nm.date), date: nm.date }];
  for (const e of data.entries.filter((x) => x.section === 'anniversary' && x.date)) {
    const n = daysBetween(t, e.date);
    if (n >= 0) lines.push({ title: e.title, left: n, date: e.date, entry: e });
    else { const ny = nextYearly(e.date, t); lines.push({ title: tr(`${e.title}（${ny.years}年）`, `${e.title} (${plural(ny.years, 'year')})`), left: daysBetween(t, ny.date), date: ny.date, entry: e }); }
  }
  return lines.sort((a, b) => a.left - b.left);
}

function addAnniv() {
  openForm({ title: 'New day', en: 'Days', lead: tr('毎年その日に数えて、当日の朝に通知します', "Counted every year, with a notification that morning"), fields: annivFields(),
    onSubmit: (v) => store.saveEntry({ section: 'anniversary', title: v.title, date: v.date }) });
}
function annivPage() {
  const t = today();
  const custom = data.entries.filter((e) => e.section === 'anniversary' && e.date).sort((a, b) => (a.date < b.date ? -1 : 1));
  const block = (title, date, e) => {
    const n = daysBetween(date, t);
    const ny = nextYearly(date, t);
    const lines = [];
    const hund = (Math.floor(n / 100) + 1) * 100;
    if (n < 0) lines.push(tr(`${md(date)}まで、あと${-n}日。`, `${plural(-n, 'day')} until ${md(date)}.`));
    else {
      if (!e) {
        const nm = nextMonthly(date, t), left = daysBetween(t, nm.date);
        lines.push(nm.date === t ? tr(`今日は ${spanLabel(nm.months)} の記念日！`, `Today is our ${spanLabel(nm.months)} anniversary!`)
          : tr(`つぎは ${spanLabel(nm.months)}（${md(nm.date)}）まで、あと${left}日。`, `${plural(left, 'day')} until ${spanLabel(nm.months)} (${md(nm.date)}).`));
      } else {
        const left = daysBetween(t, ny.date);
        lines.push(ny.date === t && ny.years > 0 ? tr(`今日でちょうど ${ny.years}年！`, `Exactly ${plural(ny.years, 'year')} today!`)
          : tr(`つぎは ${ny.years}年（${md(ny.date)}）まで、あと${left}日。`, `${plural(left, 'day')} until ${plural(ny.years, 'year')} (${md(ny.date)}).`));
      }
      lines.push(tr(`${hund}日まで、あと${hund - n}日。`, `${plural(hund - n, 'day')} until day ${hund}.`));
    }
    return h('article', { class: 'card' },
      h('h2', {}, title), h('div', { class: 'meta' }, dots(date)),
      n >= 0 && h('div', { class: 'count' }, String(n), h('small', {}, tr('日', 'days'))),
      lines.map((l) => h('p', {}, l)),
      canEdit(e) && h('div', { class: 'row' },
        h('button', { class: 'link', onclick: () => openForm({ title: 'Edit', en: 'Days', fields: annivFields(), initial: e,
          onSubmit: (v) => store.saveEntry({ id: e.id, title: v.title, date: v.date }) }) }, 'EDIT'),
        h('button', { class: 'link', onclick: () => removeEntry(e) }, 'DELETE')));
  };
  return h('div', {}, pageNav(true),
    pageHead('Days', h('button', { class: 'btn', onclick: addAnniv }, '+ ADD DAY')),
    h('div', { class: 'cards' }, block(tr('付き合いはじめた日', 'The day we started dating'), CONFIG.START_DATE), custom.map((e) => block(e.title, e.date, e))));
}
function annivFields() {
  return [F.title(tr('なんの日？', 'What day?'), tr('例：はじめて旅行した日', 'e.g. Our first trip')), { ...F.date(), required: true }];
}

export { annivLines, addAnniv, annivPage };
