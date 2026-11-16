// VALUES：同じお題に、ふたりそれぞれの答えを並べる。
import { h } from '../dom.js?v=55';
import { tr } from '../i18n.js?v=55';
import { store, data, me, nameOf, partner, byCreated } from '../state.js?v=55';
import { openForm, F } from '../forms.js?v=55';
import { removeEntry } from '../entries.js?v=55';
import { ask } from '../ask.js?v=55';
import { act, pageNav, pageHead } from '../shell.js?v=55';

// お題の例（EXAMPLES からえらべる）。えらんだときの言語のまま保存する
const EXAMPLES = [
  ['理想の休日の過ごし方', 'Our ideal day off'],
  ['将来住みたい場所', 'Where we want to live someday'],
  ['結婚についてどう思う？', 'What do we think about marriage?'],
  ['子どものこと', 'Thoughts on having kids'],
  ['お金の使い方・貯め方', 'How we spend and save money'],
  ['家事の分担', 'Splitting the housework'],
  ['ケンカしたときの仲直りのしかた', 'How we make up after a fight'],
  ['連絡はどれくらいの頻度がいい？', 'How often should we text or call?'],
  ['ひとりの時間はどれくらいほしい？', 'How much alone time do we need?'],
  ['記念日の祝い方', 'How to celebrate anniversaries'],
  ['仕事と生活のバランス', 'Work-life balance'],
  ['10年後のふたり', 'Us, ten years from now'],
  ['家族との付き合い方', 'Our relationship with our families'],
  ['友だちとの付き合い方', 'Time with friends'],
  ['ほかの人とふたりきりで会うのはOK？', 'Is meeting someone else one-on-one okay?'],
  ['うれしい愛情表現', 'How we like to be shown love'],
  ['されたら嫌なこと', 'Things we really don\'t like'],
  ['旅行のスタイル', 'Our travel style'],
  ['一緒に住むなら大事にしたいこと', 'What matters if we live together'],
  ['ペットを飼うなら', 'If we had a pet'],
  ['理想の老後', 'How we picture growing old'],
  ['幸せを感じる瞬間', 'When we feel happiest'],
  ['大切にしている習慣', 'Habits we care about'],
  ['誕生日やプレゼントのこと', 'Birthdays and gifts'],
  ['落ちこんだときにしてほしいこと', 'What helps when we\'re feeling down'],
  ['健康のために気をつけていること', 'How we take care of our health'],
  ['いつか叶えたい夢', 'Dreams we want to come true'],
  ['スマホやプライバシーのこと', 'Phones and privacy'],
  ['SNSにふたりのことを載せる？', 'Posting about us on social media'],
  ['食事で大事にしたいこと', 'What matters to us about food'],
  ['尊敬する人・なりたい自分', 'Who we look up to, who we want to be'],
  ['朝型？夜型？理想の1日のリズム', 'Morning or night? Our ideal daily rhythm'],
];

function writeValue(topic, mine) {
  const all = data.entries.filter((e) => e.section === 'value');
  // もうあるお題は例に出さない
  const used = new Set(all.map((e) => e.title));
  const examples = EXAMPLES.map(([ja, en]) => tr(ja, en)).filter((t) => !used.has(t));
  openForm({ title: topic ? 'My answer' : 'New topic', en: 'Values',
    lead: topic ? tr('このお題への自分の考え', 'What you think about this topic') : tr('ふたりで答えたいお題と、自分の答え', 'A topic for both of us, and your answer'),
    fields: [{ ...F.title(tr('お題', 'Topic'), tr('例：理想の休日の過ごし方', 'e.g. Our ideal day off')), readonly: !!topic, examples },
      { name: 'body', type: 'textarea', label: tr('自分の考え', 'Your answer'), required: true, ph: tr('思っていることをそのまま', 'Just say what you think') }],
    initial: mine || { title: topic || '' },
    onSubmit: (v) => (mine ? store.saveEntry({ id: mine.id, body: v.body }) : store.saveEntry({ section: 'value', title: v.title.trim(), body: v.body })) });
}

// お題の名前をなおす・お題ごと消すのは、ふたりどちらでもできる（supabase/values.sql）。
// 相手の答えを先に変える：相手の分が通らなければ（values.sql をまだ実行していないなど）、自分の分も変えずに止まる
const topicRows = (topic) => data.entries.filter((e) => e.section === 'value' && e.title === topic)
  .sort((a, b) => (a.author === me()) - (b.author === me()));
const needOnline = () => {
  // つながっていないと、片方だけ変わって残ることがあるので止める
  if (store.mode !== 'demo' && !navigator.onLine) throw new Error(tr('オフライン中は変えられません。つながってからもう一度ためしてください。', "Can't change this while offline. Try again once you're connected."));
};
function renameTopic(topic) {
  const used = new Set(data.entries.filter((e) => e.section === 'value').map((e) => e.title));
  openForm({ title: 'Rename', en: 'Values', lead: tr('お題の名前をなおす（ふたりの答えはそのまま）', 'Rename this topic (both answers stay)'),
    fields: [F.title(tr('お題', 'Topic'), topic)], initial: { title: topic },
    onSubmit: async (v) => {
      const title = v.title.trim();
      if (title === topic) return;
      // ほかのお題と同じ名前にすると2つが混ざるので、止める
      if (used.has(title)) throw new Error(tr('そのお題はもうあります。別の名前にしてください。', 'That topic already exists. Please use a different name.'));
      needOnline();
      for (const e of topicRows(topic)) await store.saveEntry({ id: e.id, title });
    } });
}
async function deleteTopic(topic) {
  const rows = topicRows(topic);
  const both = rows.some((e) => e.author !== me());
  if (!(await ask(tr('お題ごと消しますか？', 'Delete this topic?'), { ok: 'DELETE', danger: true,
    text: both ? tr('ふたりの答えも消えます。元には戻せません。', "Both of your answers will be deleted. This can't be undone.") : tr('元には戻せません。', "This can't be undone.") }))) return;
  act(async () => { needOnline(); for (const e of rows) await store.removeEntry(e.id); });
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
      return h('article', { class: 'card' },
        h('div', { class: 'topic-head' }, h('h2', {}, t),
          h('div', { class: 'row' }, h('button', { class: 'link', onclick: () => renameTopic(t) }, 'RENAME'),
            h('button', { class: 'link', onclick: () => deleteTopic(t) }, 'DELETE TOPIC'))),
        h('div', { class: 'pair' }, side(nameOf(me()), mine, t, true), side(p ? nameOf(p.id) : tr('あいて', 'Partner'), theirs, t, false)));
    })) : h('p', { class: 'empty' }, tr('お題を足して、ふたりの答えを並べてみよう。', 'Add a topic and line up both of your answers.')));
}

export { valuesPage, writeValue };
