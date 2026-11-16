// ひとつの記録（場所・好きなもの・贈りもの など）の欄の決まり、カード、詳細、足す・なおす・消す。
import { h } from './dom.js?v=55';
import { tr } from './i18n.js?v=55';
import { dots, today } from './dates.js?v=55';
import { store, data, me, nameOf, byCreated } from './state.js?v=55';
import { entryNew, newMark, markSeenNow } from './seen.js?v=55';
import { ask } from './ask.js?v=55';
import { photoImg, pickPhoto, morePhotos, allPhotos, moreOf } from './photos.js?v=55';
import { catLabel, likeCats, isSong, SONG_CAT } from './cats.js?v=55';
import { songPlayer } from './songs.js?v=55';
import { showDialog, closeDialog, openForm, F } from './forms.js?v=55';
import { act } from './shell.js?v=55';

// Likes のしぼりこみ（えらんでいる種類）と、ひらいているひとこと欄
let likeFilter = '';
const setLikeFilter = (c) => { likeFilter = c; };
const openTalks = new Set();

const SECTIONS = {
  place: { en: 'Places', lead: () => tr('ふたりで過ごした場所を残す', 'Places we spent time together'),
    fields: () => [F.title(tr('場所の名前', 'Place'), tr('例：江ノ島の水族館', 'e.g. Enoshima Aquarium')), F.date(tr('行った日', 'Date visited')), F.body, F.geo, F.photo, F.morePhotos] },
  like: { en: 'Likes', lead: () => tr('相手の「好き」をメモしておく', 'Things they love'), fields: () => [
    { name: 'category', type: 'category', label: tr('種類', 'Type'), required: true, options: likeCats() },
    F.title(tr('好きなもの', 'What'), tr('例：抹茶ラテ', 'e.g. Matcha latte')),
    { type: 'song', label: tr('どの曲？', 'Which song?'), hint: tr('えらんでおくと、ふたりとも同じ曲を聴けます', 'Pick it so you both hear the same song') },
    F.body, F.photo] },
  wish: { en: 'Wishes', lead: () => tr('いつか一緒に行きたいところ', 'Places we want to go someday'),
    fields: () => [F.title(tr('行きたいところ', 'Place'), tr('例：金沢の21世紀美術館', 'e.g. 21st Century Museum, Kanazawa')), { ...F.body, ph: tr('行きたい理由、やりたいこと', 'Why, and what we want to do there') }, F.geo, F.photo, F.morePhotos] },
  gift: { en: 'Gifts', lead: () => tr('贈ったもの・もらったもの', 'Gifts given and received'), fields: () => [
    { name: 'category', type: 'category', label: tr('どっち？', 'Given or received?'), required: true, options: GIFT_WAYS, optLabel: giftWayLabel },
    F.title(tr('贈りもの', 'Gift'), tr('例：手編みのマフラー', 'e.g. Hand-knit scarf')), F.date(), F.body, F.photo] },
  dislike: { en: 'Dislikes', lead: () => tr('相手の苦手なものを覚えておく', "Things they don't like"),
    fields: () => [F.title(tr('嫌いなもの', 'What'), tr('例：満員電車', 'e.g. Packed trains')), F.body] },
  // 自分だけの写真。データベースの決まりで、書いた本人にしか読めない（相手の画面には出てこない）
  secret: { en: 'Secret', own: true, lead: () => tr('自分だけに見えるお気に入りの写真。相手には見えません', "Favorite photos only you can see. Your partner can't."),
    fields: () => [{ ...F.photo, required: true, secret: true, manual: true },
      { ...F.title(tr('ひとこと', 'Caption'), tr('例：この笑顔が好き', 'e.g. Love this smile')), required: false },
      F.date(tr('撮った日', 'Date taken')), { ...F.body, label: tr('メモ', 'Note') }] },
};

// 贈りものは「贈った」か「もらった」かを category に入れる（前からある、空のものは「贈った」）
const GIFT_WAYS = ['given', 'received'];
const giftWayLabel = (w) => (w === 'received' ? tr('もらったもの', 'Received') : tr('贈ったもの', 'Given'));
// 贈った人：「もらった」なら書いた人の相手
const giverOf = (e) => (e.category === 'received' ? data.profiles.find((p) => p.id !== e.author)?.id : e.author);
const fromLabel = (e) => (e.section === 'gift' ? tr(`${nameOf(giverOf(e))}から`, `from ${nameOf(giverOf(e))}`) : nameOf(e.author));
// 種類の表示（贈りものの「贈った・もらった」は「◯◯から」で分かるので出さない）
const catText = (e) => (e.section !== 'gift' && e.category ? catLabel(e.category) : '');
// なおすときの最初の値（前からある贈りものは「贈った」をえらんだ状態にする）
const editInitial = (e) => (e.section === 'gift' && !e.category ? { ...e, category: 'given' } : e);
// なおす・消すのは書いた本人だけ（データベースの決まりと同じ）
const canEdit = (e) => !!e && e.author === me();

const entryMeta = (e) => [e.date && dots(e.date), catText(e), SECTIONS[e.section]?.own ? tr('自分だけ', 'Only you') : fromLabel(e)].filter(Boolean).join(' ・ ');
// 自分だけの記録には、ひとこと欄を出さない
const talkable = (e) => !SECTIONS[e.section]?.own;
// フォームに書いた内容から、新しい記録を作る
const newEntryRow = (section, v) => ({ section, title: v.title || '', body: v.body || '', date: v.date || null, category: v.category || null,
  lat: v.lat ?? null, lng: v.lng ?? null, photo: v.photo || null, ...moreOf(v), ...songOf(v) });
// えらんだ曲（種類が「曲」のときだけ）。曲でない記録には song を送らない
const songOf = (v, before = null) => (v.category === SONG_CAT && v.song ? { song: v.song } : before?.song ? { song: null } : {});

function talk(e, fresh = new Set()) {
  const list = data.comments.filter((c) => c.entry_id === e.id).sort(byCreated);
  const anyNew = list.some((c) => fresh.has(`c:${c.id}`));
  if (anyNew) openTalks.add(e.id);
  const input = h('input', { type: 'text', placeholder: tr('ひとこと書く', 'Write a comment'), 'aria-label': tr('ひとこと', 'Comment') });
  return h('details', { class: 'talk', open: openTalks.has(e.id), ontoggle: (ev) => { ev.target.open ? openTalks.add(e.id) : openTalks.delete(e.id); } },
    h('summary', {}, `COMMENTS (${list.length})`),
    list.map((c) => h('div', { class: 'c' }, h('span', {}, fresh.has(`c:${c.id}`) && h('i', { class: 'newinline' }, 'NEW!'), `${nameOf(c.author)}${tr('：', ': ')}${c.body}`),
      c.author === me() && h('button', { class: 'link', onclick: () => act(() => store.removeComment(c.id)) }, 'DELETE'))),
    h('form', { onsubmit: (ev) => { ev.preventDefault(); if (input.value.trim()) act(() => store.addComment(e.id, input.value.trim())); } },
      input, h('button', { class: 'btn small', type: 'submit' }, 'SEND')));
}
async function removeEntry(e) {
  if (!(await ask(tr('消しますか？', 'Delete this?'), { text: tr('元には戻せません。', "This can't be undone."), ok: 'DELETE', danger: true }))) return;
  act(async () => { await store.removeEntry(e.id); for (const p of allPhotos(e)) await store.removePhoto(p); });
}
function entryCard(e, key) {
  const S = SECTIONS[key];
  const ok = canEdit(e);
  const meta = entryMeta(e);
  const edit = () => entryEdit(e);
  const addPhoto = async () => {
    const blob = await pickPhoto(); if (!blob) return;
    act(async () => store.saveEntry({ id: e.id, photo: await store.uploadPhoto(blob, { secret: !!S.own }) }));
  };
  const went = () => entryWent(e);
  return newMark(h('article', { class: 'card' },
    e.photo && photoImg(e.photo),
    e.title && h('h2', {}, e.title), h('div', { class: 'meta' }, meta),
    e.body && h('p', {}, e.body),
    isSong(e) ? songPlayer(e) : null,
    h('div', { class: 'row' },
      key === 'wish' && h('button', { class: 'btn small', onclick: went }, 'BEEN THERE!'),
      ok && !e.photo && S.fields().some((f) => f.type === 'photo') && h('button', { class: 'btn ghost small', onclick: addPhoto }, 'ADD PHOTO'),
      ok && h('button', { class: 'link', onclick: edit }, 'EDIT'),
      ok && h('button', { class: 'link', onclick: () => removeEntry(e) }, 'DELETE')),
    talkable(e) && talk(e)), entryNew(e));
}
function addEntry(key) {
  const S = SECTIONS[key];
  openForm({ title: 'Add', en: S.en, lead: S.lead(), fields: S.fields(), initial: key === 'like' && likeFilter ? { category: likeFilter } : key === 'gift' ? { category: 'given' } : {},
    onSubmit: (v) => store.saveEntry(newEntryRow(key, v)) });
}

/* ---------- ひとつの思い出の詳細（モーダル） ---------- */

function entryEdit(e) {
  const S = SECTIONS[e.section];
  openForm({ title: 'Edit', en: S.en, fields: S.fields(), initial: editInitial(e),
    onSubmit: (v) => store.saveEntry({ id: e.id, title: v.title, body: v.body, date: v.date, category: v.category, lat: v.lat, lng: v.lng, photo: v.photo, ...moreOf(v, e), ...songOf(v, e) }) });
}
function entryWent(e) {
  openForm({ title: 'Been there!', en: 'Places', lead: tr(`「${e.title}」に行った日を残す`, `When did we go to "${e.title}"?`), initial: { ...e, date: today() },
    fields: [F.date(tr('行った日', 'Date visited')), F.body, ...(e.lat == null ? [F.geo] : []), F.photo, F.morePhotos],
    onSubmit: (v) => store.saveEntry({ id: e.id, section: 'place', date: v.date, body: v.body, photo: v.photo, ...moreOf(v, e), lat: v.lat ?? null, lng: v.lng ?? null }) });
}
// 写真が何枚かあるとき：横にめくって見る。下の数字と点で、いま何枚目か分かる（点をタップするとその写真へ）
function photoGallery(paths) {
  const track = h('div', { class: 'dgallery', tabindex: '0', 'aria-label': tr(`写真 ${paths.length}枚`, `${paths.length} photos`) }, paths.map((p) => photoImg(p, 'dphoto')));
  const num = h('span', { class: 'dg-num' });
  const dots = paths.map((_, i) => h('button', { type: 'button', class: 'dg-dot', 'aria-label': tr(`${i + 1}枚目`, `Photo ${i + 1}`),
    onclick: () => track.scrollTo({ left: track.children[i].offsetLeft - track.offsetLeft, behavior: 'smooth' }) }));
  let cur = -1;
  const mark = () => {
    const i = Math.min(paths.length - 1, Math.max(0, Math.round(track.scrollLeft / (track.clientWidth || 1))));
    if (i === cur) return;
    cur = i;
    num.textContent = `${i + 1} / ${paths.length}`;
    dots.forEach((d, k) => { d.classList.toggle('on', k === i); d.setAttribute('aria-current', String(k === i)); });
  };
  track.addEventListener('scroll', mark, { passive: true });
  mark();
  return h('div', { class: 'dgallery-wrap' }, track, h('div', { class: 'dg-foot' }, h('div', { class: 'dg-dots' }, dots), num));
}
function openDetail(id) {
  const dlg = h('dialog', { class: 'modal detail', 'aria-label': tr('詳細', 'Details') });
  // 開いた時点の NEW を覚えておいて、ひとことに印をつける。開いたら「見た」ことにする
  const fresh = new Set(entryNew(data.entries.find((x) => x.id === id)).map(([k]) => k));
  const render = () => {
    const e = data.entries.find((x) => x.id === id);
    if (!e) { closeDialog(dlg, true); return; }
    markSeenNow(entryNew(e));
    const ok = canEdit(e);
    const meta = entryMeta(e);
    dlg.replaceChildren(h('div', { class: 'sheet' },
      h('div', { class: 'mhead' },
        h('div', {}, SECTIONS[e.section] && h('div', { class: `tag ${e.section}` }, SECTIONS[e.section].en), h('h2', { class: 'dtitle' }, e.title), h('p', { class: 'lead' }, meta)),
        h('button', { type: 'button', class: 'x', 'aria-label': 'Close', onclick: () => closeDialog(dlg) }, '×')),
      h('div', { class: 'mbody' },
        morePhotos(e).length ? photoGallery(allPhotos(e)) : e.photo && photoImg(e.photo, 'dphoto'),
        e.body ? h('p', { class: 'dbody' }, e.body) : null,
        isSong(e) ? songPlayer(e) : null,
        e.section === 'wish' && h('button', { class: 'btn', onclick: () => entryWent(e) }, 'BEEN THERE! → PLACES'),
        ok && h('div', { class: 'row' },
          h('button', { class: 'btn ghost small', onclick: () => entryEdit(e) }, 'EDIT'),
          h('button', { class: 'link', onclick: () => removeEntry(e) }, 'DELETE')),
        talkable(e) && talk(e, fresh))));
  };
  dlg.refresh = render;
  render();
  showDialog(dlg);
}

export { SECTIONS, fromLabel, catText, canEdit, likeFilter, setLikeFilter, newEntryRow, removeEntry, entryCard, addEntry, openDetail };
