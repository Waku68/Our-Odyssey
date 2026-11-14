// MORE：Likes・Gifts・Values・Dislikes・Days をコルクボードで見せる一覧と、それぞれの「VIEW ALL」のページ。
import { h } from '../dom.js?v=39';
import { tr } from '../i18n.js?v=39';
import { md } from '../dates.js?v=39';
import { data, nameOf } from '../state.js?v=39';
import { entryNew, newMark, sectionNew } from '../seen.js?v=39';
import { photoImg } from '../photos.js?v=39';
import { catLabel, likeCats, isSong } from '../cats.js?v=39';
import { songBadge } from '../songs.js?v=39';
import { SECTIONS, fromLabel, likeFilter, setLikeFilter, entryCard, addEntry, openDetail } from '../entries.js?v=39';
import { draw, pageNav, pageHead } from '../shell.js?v=39';
import { writeValue } from './values.js?v=39';
import { annivLines, addAnniv } from './anniv.js?v=39';

function sectionPage(key) {
  const S = SECTIONS[key];
  if (!S) return morePage();
  let items = data.entries.filter((e) => e.section === key);
  items.sort((a, b) => ((b.date || b.created_at) < (a.date || a.created_at) ? -1 : 1));
  const add = () => addEntry(key);
  let chips = null;
  if (key === 'like') {
    const cats = likeCats();
    if (likeFilter && !cats.includes(likeFilter)) setLikeFilter('');
    chips = h('div', { class: 'chips' }, ['', ...cats].map((c) =>
      h('button', { class: `chip${likeFilter === c ? ' on' : ''}`, onclick: () => { setLikeFilter(c); draw(); } }, c ? catLabel(c) : 'ALL')));
    if (likeFilter) items = items.filter((e) => e.category === likeFilter);
  }
  return h('div', {}, pageNav(true),
    pageHead(S.en, h('button', { class: 'btn', onclick: add }, '+ ADD')),
    chips,
    items.length ? h('div', { class: 'cards' }, items.map((e) => entryCard(e, key)))
      : h('p', { class: 'empty' }, tr('まだ何もありません。「+ ADD」から最初のひとつを。', 'Nothing here yet. Tap "+ ADD" to start.')));
}

/* ---------- その他（その場で開く） ---------- */
const MORE = [
  { key: 'like', en: 'Likes', jp: '好きなもの', sub: 'Things they love' },
  { key: 'gift', en: 'Gifts', jp: '贈ったもの', sub: 'Given & received' },
  { key: 'values', en: 'Values', jp: '価値観', sub: 'What we think' },
  { key: 'dislike', en: 'Dislikes', jp: '嫌いなもの', sub: 'Not for them' },
  { key: 'anniv', en: 'Days', jp: '記念日', sub: 'Anniversaries' },
  { key: 'settings', en: 'Settings', jp: '設定', sub: '', link: true },
];

const moreOpen = new Set();
const GEAR = '<svg viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M19.96 10.02 L22.89 10.45 L22.89 13.55 L19.96 13.98 L19.03 16.23 L20.80 18.60 L18.60 20.80 L16.23 19.03 L13.98 19.96 L13.55 22.89 L10.45 22.89 L10.02 19.96 L7.77 19.03 L5.40 20.80 L3.20 18.60 L4.97 16.23 L4.04 13.98 L1.11 13.55 L1.11 10.45 L4.04 10.02 L4.97 7.77 L3.20 5.40 L5.40 3.20 L7.77 4.97 L10.02 4.04 L10.45 1.11 L13.55 1.11 L13.98 4.04 L16.23 4.97 L18.60 3.20 L20.80 5.40 L19.03 7.77Z M15.6 12a3.6 3.6 0 1 0-7.2 0a3.6 3.6 0 1 0 7.2 0Z"/></svg>';
const gearIcon = () => { const i = h('span', { class: 'gear', 'aria-hidden': 'true' }); i.innerHTML = GEAR; return i; };

/* MORE はぜんぶコルクボード（開くと全部を貼る）：ポラロイド（写真あり）とメモ（写真なし）を画鋲で留める。
   大きさ・傾き・ずれ・浮き具合は項目ごとに id から決めるので、開くたびに変わらない */
function seeded(str) {
  let x = 2166136261;
  for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); }
  return () => { x = Math.imul(x ^ (x >>> 15), 2246822507); x = Math.imul(x ^ (x >>> 13), 3266489909); x ^= x >>> 16; return (x >>> 0) / 4294967296; };
}
// cards: { seed, title, sub, onclick, photo?, big?, cls? }
function corkBoard(cards) {
  const between = (r, a, b) => a + (b - a) * r();
  return h('div', { class: 'cork-board' }, h('div', { class: 'cork' }, h('div', { class: 'cork-grid' }, cards.map((c) => {
    const r = seeded(String(c.seed));
    const style = `--s:${between(r, .88, 1.06).toFixed(3)};--r:${between(r, -4, 4).toFixed(2)}deg;--x:${between(r, -3, 4).toFixed(1)}px;--y:${between(r, -3, 10).toFixed(1)}px;--z:${between(r, 1, 3).toFixed(2)}`;
    const pin = h('img', { class: 'tack', src: `assets/pin-${r() < .5 ? 'pink' : 'navy'}.webp`, alt: '' });
    return newMark(h('button', { class: ['pol', !c.photo && 'memo', c.cls].filter(Boolean).join(' '), type: 'button', style, onclick: c.onclick },
      pin, c.photo ? h('span', { class: 'pim' }, photoImg(c.photo, ''), c.badge || null) : null, c.big || null, h('b', {}, c.title), h('small', {}, c.sub),
      !c.photo && c.badge ? c.badge : null), c.fresh);
  }))));
}
const MORE_SECTIONS = { like: ['like'], gift: ['gift'], values: ['value'], dislike: ['dislike'], anniv: ['anniversary'] };
function morePreview(key) {
  const go = (k) => { location.hash = `#/more/${k}`; };
  const board = (n, cards, add) => ({ n, items: cards.length ? [corkBoard(cards)] : [], add });
  if (key === 'values') {
    const all = data.entries.filter((e) => e.section === 'value');
    const topics = [...new Set(all.map((e) => e.title))];
    return board(topics.length, [...topics].reverse().map((tp) => {
      const both = new Set(all.filter((e) => e.title === tp).map((e) => e.author)).size >= 2;
      return { seed: `value:${tp}`, title: tp, fresh: all.filter((e) => e.title === tp).flatMap(entryNew), sub: both ? tr('ふたりとも答えた', 'Both answered') : tr('まだ片方だけ', 'One answer so far'), onclick: () => go('values') };
    }), () => writeValue());
  }
  if (key === 'anniv') {
    const lines = annivLines();
    return board(lines.length, lines.map((l) => ({
      seed: `anniv:${l.title}:${l.date}`, cls: 'days', title: l.title, sub: md(l.date), onclick: () => go('anniv'), fresh: entryNew(l.entry),
      big: h('span', { class: 'big' }, l.left === 0 ? 'TODAY' : String(l.left), l.left === 0 ? null : h('i', {}, l.left === 1 ? 'DAY' : 'DAYS')),
    })), addAnniv);
  }
  const items = data.entries.filter((e) => e.section === key).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return board(items.length, items.map((e) => ({
    seed: e.id, photo: e.photo, title: e.title, onclick: () => openDetail(e.id), fresh: entryNew(e), badge: isSong(e) ? songBadge(e) : null,
    sub: [e.category && catLabel(e.category), e.section === 'gift' ? fromLabel(e) : nameOf(e.author)].filter(Boolean).join('・'),
  })), () => addEntry(key));
}
function morePage() {
  return h('div', {}, pageNav(), pageHead('More'),
    h('ul', { class: 'acc' }, MORE.map((m) => {
      const sub = tr(m.jp, m.sub);
      if (m.link) {
        return h('li', {}, h('a', { class: 'acc-head', href: `#/more/${m.key}` },
          h('span', { class: 'en' }, m.en), h('span', { class: 'jp' }, sub), h('span', { class: 'chev', 'aria-hidden': 'true' }, '→')));
      }
      const p = morePreview(m.key);
      const open = moreOpen.has(m.key);
      const li = h('li', { class: open ? 'open' : '' });
      const head = h('button', { class: 'acc-head', type: 'button', 'aria-expanded': String(open), onclick: () => {
        const now = !li.classList.contains('open');
        li.classList.toggle('open', now); head.setAttribute('aria-expanded', String(now));
        if (now) moreOpen.add(m.key); else moreOpen.delete(m.key);
      } }, h('span', { class: 'en' }, m.en), h('span', { class: 'jp' }, `${sub}・${p.n}`, MORE_SECTIONS[m.key] && sectionNew(MORE_SECTIONS[m.key]) ? h('span', { class: 'newchip' }, 'NEW') : null), gearIcon());
      li.append(head, h('div', { class: 'acc-panel' }, h('div', { class: 'acc-inner' },
        p.items.length ? p.items : h('p', { class: 'muted' }, tr('まだ何もありません。', 'Nothing here yet.')),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', type: 'button', onclick: p.add }, '+ ADD'),
          h('a', { class: 'btn ghost small acc-all', href: `#/more/${m.key}` }, `VIEW ALL (${p.n})`)))));
      return li;
    })));
}

export { morePage, sectionPage };
