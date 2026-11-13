// VALUES：同じお題に、ふたりそれぞれの答えを並べる。
import { h } from '../dom.js?v=38';
import { tr } from '../i18n.js?v=38';
import { store, data, me, nameOf, partner, byCreated } from '../state.js?v=38';
import { openForm, F } from '../forms.js?v=38';
import { removeEntry } from '../entries.js?v=38';
import { pageNav, pageHead } from '../shell.js?v=38';

function writeValue(topic, mine) {
  openForm({ title: topic ? 'My answer' : 'New topic', en: 'Values',
    lead: topic ? tr('このお題への自分の考え', 'What you think about this topic') : tr('ふたりで答えたいお題と、自分の答え', 'A topic for both of us, and your answer'),
    fields: [{ ...F.title(tr('お題', 'Topic'), tr('例：理想の休日の過ごし方', 'e.g. Our ideal day off')), readonly: !!topic },
      { name: 'body', type: 'textarea', label: tr('自分の考え', 'Your answer'), required: true, ph: tr('思っていることをそのまま', 'Just say what you think') }],
    initial: mine || { title: topic || '' },
    onSubmit: (v) => (mine ? store.saveEntry({ id: mine.id, body: v.body }) : store.saveEntry({ section: 'value', title: v.title.trim(), body: v.body })) });
}
function valuesPage() {
  const all = data.entries.filter((e) => e.section === 'value').sort(byCreated);
  const topics = [...new Set(all.map((e) => e.title))];
  const p = partner();
  const side = (who, e, topic, isMe) => h('div', {},
    h('div', { class: 'who' }, who),
    e ? h('p', {}, e.body) : h('p', { class: 'muted' }, isMe ? tr('まだ書いていません', 'Not written yet') : tr('まだ書いていないみたい', 'No answer yet')),
    isMe && (e
      ? h('div', { class: 'row' }, h('button', { class: 'link', onclick: () => writeValue(topic, e) }, 'EDIT'),
        h('button', { class: 'link', onclick: () => removeEntry(e) }, 'DELETE'))
      : h('button', { class: 'btn small', onclick: () => writeValue(topic) }, 'WRITE')));
  return h('div', {}, pageNav(true),
    pageHead('Values', h('button', { class: 'btn', onclick: () => writeValue() }, '+ ADD TOPIC')),
    topics.length ? h('div', { class: 'cards' }, topics.map((t) => {
      const mine = all.find((e) => e.title === t && e.author === me());
      const theirs = all.find((e) => e.title === t && e.author !== me());
      return h('article', { class: 'card' }, h('h2', {}, t),
        h('div', { class: 'pair' }, side(nameOf(me()), mine, t, true), side(p ? nameOf(p.id) : tr('あいて', 'Partner'), theirs, t, false)));
    })) : h('p', { class: 'empty' }, tr('お題を足して、ふたりの答えを並べてみよう。', 'Add a topic and line up both of your answers.')));
}

export { valuesPage, writeValue };
