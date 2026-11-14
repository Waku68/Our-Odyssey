import { h } from './dom.js?v=39';
import { store, data, me } from './state.js?v=39';

/* ---------- NEW! のしるし ----------
   相手が足したり変えたりしたもの（ひとことも）に「NEW!」を貼る。画面に0.7秒ほど映ったら「見た」ことにして、
   次に画面を描き直したときにはずす（見ている最中に消えないように）。記録は端末ごと・人ごとに残す */
let seen = null;
const seenLater = {};
const selfEdited = new Set();
const seenKey = () => `our-odyssey-seen:${me()}`;
function hashStr(str) {
  let a = 0xdeadbeef, b = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677); }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return (4294967296 * (2097151 & b) + (a >>> 0)).toString(36);
}
const entrySig = (e) => hashStr(JSON.stringify([e.section, e.title, e.body, e.date, e.category, e.lat, e.lng, e.photo]));
const moodSig = (m) => hashStr(JSON.stringify([m.date, m.level, m.note, m.shared]));
function partnerPairs() {
  const out = [];
  for (const e of data.entries) if (e.author !== me()) out.push([`e:${e.id}`, entrySig(e)]);
  for (const c of data.comments) if (c.author !== me()) out.push([`c:${c.id}`, '1']);
  for (const m of data.moods) if (m.user_id !== me()) out.push([`m:${m.id}`, moodSig(m)]);
  return out;
}
function saveSeen() { try { localStorage.setItem(seenKey(), JSON.stringify(seen)); } catch { /* 入らなくても動く */ } }
function commitSeen() {
  if (store?.mode !== 'supabase' || !store.user()) return;
  if (!seen) {
    try { seen = JSON.parse(localStorage.getItem(seenKey())); } catch { seen = null; }
    // はじめて使うときは、いまあるものは全部「見た」ことにする
    if (!seen) { seen = Object.fromEntries(partnerPairs()); saveSeen(); return; }
  }
  Object.assign(seen, seenLater);
  for (const k of Object.keys(seenLater)) delete seenLater[k];
  // 自分が相手のものを変えたとき（行きたい→行った など）は NEW にしない
  for (const id of selfEdited) { const e = data.entries.find((x) => x.id === id); if (e) seen[`e:${id}`] = entrySig(e); }
  selfEdited.clear();
  // もうないものの記録は捨てる
  const alive = new Set([...data.entries.map((e) => `e:${e.id}`), ...data.comments.map((c) => `c:${c.id}`), ...data.moods.map((m) => `m:${m.id}`)]);
  for (const k of Object.keys(seen)) if (!alive.has(k)) delete seen[k];
  saveSeen();
}
const unseen = ([k, sig]) => seen && seen[k] !== sig;
function entryNew(e) {
  if (!e || !seen) return [];
  const out = [];
  if (e.author !== me()) out.push([`e:${e.id}`, entrySig(e)]);
  for (const c of data.comments) if (c.entry_id === e.id && c.author !== me()) out.push([`c:${c.id}`, '1']);
  return out.filter(unseen);
}
const sectionNew = (sections) => data.entries.some((e) => sections.includes(e.section) && entryNew(e).length);
const moodsNew = () => !!seen && data.moods.some((m) => m.user_id !== me() && unseen([`m:${m.id}`, moodSig(m)]));
let seenObs = null;
function newMark(el, pairs) {
  if (!pairs?.length) return el;
  el.classList.add('is-new');
  el.append(h('span', { class: 'newtag', 'aria-label': 'NEW' }, 'NEW!'));
  el.newPairs = pairs;
  seenObs ??= new IntersectionObserver((list) => {
    for (const it of list) {
      const t = it.target;
      clearTimeout(t.seenTimer);
      if (it.isIntersecting && it.intersectionRatio >= .5) t.seenTimer = setTimeout(() => {
        for (const [k, sig] of t.newPairs || []) seenLater[k] = sig;
        seenObs.unobserve(t);
      }, 700);
    }
  }, { threshold: [0, .5] });
  seenObs.observe(el);
  return el;
}
function markSeenNow(pairs) { for (const [k, sig] of pairs) seenLater[k] = sig; }

// 画面を描き直す前に、見張りをやめる
function dropSeenObserver() { seenObs?.disconnect(); seenObs = null; }

export { selfEdited, moodSig, commitSeen, entryNew, sectionNew, moodsNew, newMark, markSeenNow, dropSeenObserver };
