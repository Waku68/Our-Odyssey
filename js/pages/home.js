// HOME：日数（DAYS）と2人の写真、その下の年表。
import { CONFIG } from '../config.js?v=62';
import { h, reduceMotion } from '../dom.js?v=62';
import { tr } from '../i18n.js?v=62';
import { today, daysBetween, nextMonthly, nextYearly, spanLabel, plural, dots, md } from '../dates.js?v=62';
import { store, data, me, byCreated } from '../state.js?v=62';
import { newMark, entryNew } from '../seen.js?v=62';
import { photoImg, pickPhoto } from '../photos.js?v=62';
import { act, fadeIn } from '../shell.js?v=62';
import { openDetail } from '../entries.js?v=62';

function home() {
  const t = today();
  const days = daysBetween(CONFIG.START_DATE, t);
  const nm = nextMonthly(CONFIG.START_DATE, t);
  const banners = [];
  if (daysBetween(t, nm.date) === 0) banners.push(tr(`今日は ${spanLabel(nm.months)} の記念日！`, `Today is our ${spanLabel(nm.months)} anniversary!`));
  if (days > 0 && days % 100 === 0) banners.push(tr(`今日で ${days}日！`, `${days} days today!`));
  for (const e of data.entries.filter((x) => x.section === 'anniversary' && x.date)) {
    const ny = nextYearly(e.date, t);
    if (ny.date === t && ny.years > 0) banners.push(tr(`今日は「${e.title}」から ${ny.years}年！`, `${plural(ny.years, 'year')} since "${e.title}" today!`));
  }
  const hero = (k) => data.entries.filter((e) => e.section === 'hero' && e.category === k).sort(byCreated).pop();
  const slot = (k, label) => {
    const e = hero(k);
    const b = h('button', { class: `slot ${k}${e ? ' has' : ''}`, 'aria-label': `${label}`, onclick: () => setHero(k, e) },
      h('span', {}, `[${label}]`));
    if (e) store.photoUrl(e.photo).then((u) => { b.style.backgroundImage = `url("${u}")`; });
    return newMark(b, entryNew(e));
  };
  const heroEl = h('div', { class: 'home' },
      h('div', { class: 'tag' }, `Since ${dots(CONFIG.START_DATE)}`),
      h('p', { class: 'big first' }, String(days)),
      h('p', { class: 'big unit' }, days === 1 ? 'Day' : 'Days'),
      banners.map((b) => h('div', { class: 'banner' }, b)),
      h('div', { class: 'stage' },
        slot('a', 'OUR PHOTO'), slot('b', 'KEEPSAKE'),
        h('img', { class: 'flower blue', src: 'assets/tulip-blue.webp', alt: '' }),
        h('img', { class: 'flower pink', src: 'assets/tulip-pink.webp', alt: '' })));
  const pin = h('div', { class: 'hero-pin' }, heroEl);
  const tl = timeline();
  // 年表の後ろに、表紙と同じチューリップを画面の下の左右に置く（スクロールしても動かない）
  const bloom = h('div', { class: 'tl-bloom', 'aria-hidden': 'true' },
    h('img', { class: 'blue', src: 'assets/tulip-blue.webp', alt: '' }), h('img', { class: 'pink', src: 'assets/tulip-pink.webp', alt: '' }));
  const root = h('div', {}, pin,
    store.mode === 'demo' && h('p', { class: 'note' }, tr('お試しモード：書いた内容はこの端末にだけ保存されます。', 'Demo mode: everything is saved on this device only.')),
    tl, bloom);
  requestAnimationFrame(() => { fadeIn(root); pinHero(pin, heroEl); showBloom(bloom, tl); });
  return root;
}
// 表紙が消えて年表が画面に入ってきたら、チューリップを出す（表紙のチューリップから入れかわる）
function showBloom(bloom, tl) {
  if (!('IntersectionObserver' in window)) { bloom.classList.add('on'); return; }
  const io = new IntersectionObserver(([x]) => {
    if (!bloom.isConnected) { io.disconnect(); return; }
    bloom.classList.toggle('on', x.isIntersecting);
  }, { rootMargin: '0px 0px -45% 0px' });
  io.observe(tl);
}
// 1384 DAYS をその場に止めたまま、スクロールに合わせて消していく。消えきったら年表が上がってくる。
function pinHero(pin, hero) {
  if (reduceMotion()) return;
  pin.classList.add('on');
  // スクロールに連動したアニメーションをブラウザに任せられるなら任せる（いちばんなめらか）
  const native = window.CSS?.supports?.('animation-timeline: scroll()');
  let V = 0, W = 0, start = 0, len = 1, raf = 0;
  const layout = () => {
    // iPhoneはスクロール中にアドレスバーの出し入れで高さが変わるので、横幅が変わったときだけ測り直す
    if (!V || window.innerWidth !== W) { V = document.documentElement.clientHeight; W = window.innerWidth; }
    const H = hero.offsetHeight;
    const lead = Math.max(0, H - V);
    const dist = Math.round(V * 0.75);
    start = 0; // ホームは一番上にあるので、スクロールし始めた瞬間から消えはじめる
    len = lead + dist;
    hero.style.top = `${Math.min(0, V - H)}px`;
    pin.style.height = `${H + dist}px`;
    pin.style.setProperty('--fade-start', `${start}px`);
    pin.style.setProperty('--fade-end', `${start + len}px`);
  };
  const update = () => {
    raf = 0;
    const p = Math.min(1, Math.max(0, (window.scrollY - start) / len));
    hero.style.opacity = String(1 - p);
    hero.style.transform = `translate3d(0, ${(-p * 28).toFixed(1)}px, 0)`;
    hero.style.visibility = p >= 1 ? 'hidden' : '';
  };
  const onScroll = () => {
    if (!pin.isConnected) { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onResize); ro.disconnect(); return; }
    if (!native && !raf) raf = requestAnimationFrame(update);
  };
  const onResize = () => { layout(); onScroll(); };
  const ro = new ResizeObserver(onResize);
  ro.observe(hero);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);
  if (native) pin.classList.add('native');
  layout(); if (!native) update();
}
function timeline() {
  const kind = { gift: tr('贈りもの', 'Gift'), place: tr('過ごした場所', 'Place'), anniversary: tr('記念日', 'Anniversary') };
  const items = [{ date: CONFIG.START_DATE, title: tr('付き合いはじめた日', 'The day we started dating'), k: kind.anniversary },
    ...data.entries.filter((e) => e.date && kind[e.section]).map((e) => ({ id: e.id, section: e.section, date: e.date, title: e.title, k: kind[e.section], photo: e.photo, body: e.body }))];
  // 上が古く、下にスクロールするほど新しくなる
  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  // 年で区切らず、ひとつの流れにする。年の数字も項目といっしょに左右の列に入れて、すきまを埋める
  const tl = h('div', { class: 'tl' });
  let year = null, n = 0;
  for (const it of items) {
    const y = it.date.slice(0, 4);
    if (y !== year) { year = y; tl.append(h('div', { class: `yr fade ${n++ % 2 ? 'l' : 'r'}` }, y)); }
    const side = n++ % 2 ? 'l' : 'r';
    const words = [h('div', { class: 'when' }, h('span', { class: 'd' }, dots(it.date).slice(5)), h('span', { class: 'k' }, it.k)),
      h('div', { class: 't' }, it.title), it.body && h('div', { class: 'desc' }, it.body)];
    tl.append(newMark(h(it.id ? 'button' : 'div', { class: `it fade ${side}`, type: it.id ? 'button' : null, onclick: it.id ? () => (it.section === 'anniversary' ? (location.hash = '#/more/anniv') : openDetail(it.id)) : null },
      // 写真があればポラロイドにして、下の白いところに月日・タイトル・説明文をのせる
      it.photo ? h('div', { class: 'snap' }, photoImg(it.photo, ''), h('div', { class: 'cap' }, words)) : h('div', { class: 'plain' }, words)),
      it.id && entryNew(data.entries.find((x) => x.id === it.id))));
  }
  // 年表のおわり（いま）に、今日・つぎの記念日・次に行きたいところ・昔の一枚を置く（列の短いほうに入るので、すきまも埋まる）
  const recent = new Set(items.slice(-3).map((x) => x.id));
  tl.append(...['today', 'next', 'wish', 'memory'].map((k) => endCard(k, recent)).filter(Boolean));
  requestAnimationFrame(() => stagger(tl));
  return h('section', { class: 'home-tl' },
    h('div', { class: 'head fade' }, h('h1', {}, 'Timeline')), tl);
}

// 左右の列をずらして詰める：つぎのものは、いま短いほうの列に入れる。
// ただし、ひとつ前より少し下から始める（上から読めば古い順になるように）。
// 高さが変わったら（文字の読みこみ・画面の幅）置きなおす
const STEP = 56, AFTER_YEAR = 10, GAP = 18;
function stagger(tl) {
  const place = () => {
    if (!tl.isConnected) { ro.disconnect(); return; }
    let prev = -Infinity, prevSide = 'l', prevYear = false;
    const bottom = { l: 0, r: 0 };
    for (const el of tl.children) {
      const side = bottom.l === bottom.r ? (prevSide === 'l' ? 'r' : 'l') : bottom.l < bottom.r ? 'l' : 'r';
      el.classList.toggle('l', side === 'l'); el.classList.toggle('r', side === 'r');
      const top = Math.max(prev + (prevYear ? AFTER_YEAR : STEP), bottom[side] && bottom[side] + GAP, 0);
      el.style.top = `${top}px`;
      bottom[side] = top + el.offsetHeight;
      prev = top; prevSide = side; prevYear = el.classList.contains('yr');
    }
    tl.style.height = `${Math.max(bottom.l, bottom.r)}px`;
  };
  let raf = 0;
  const ro = new ResizeObserver(() => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; place(); }); });
  tl.classList.add('stag');
  place();
  for (const el of tl.children) ro.observe(el);
}

// 年表のおわりに置く1枚
//  today：今日の日付と日数、「つづく…」
//  next：つぎの記念日までのカウントダウン
//  wish：行きたいところを1つ「次はここへ」として（まだ行っていないので、写真は少しうすく）
//  memory：昔の写真を1枚（去年より前の今ごろがあればそれ）。年表の最後のほうの項目とはかぶらないようにする
const pick = (list) => list[Math.floor(Math.random() * list.length)];
function endCard(kind, recent = new Set()) {
  const t = today();
  const wrap = (cls, onclick, ...kids) => h(onclick ? 'button' : 'div', { class: `it end ${cls} fade`, type: onclick ? 'button' : null, onclick }, ...kids);
  const tag = (label, sub) => h('div', { class: 'when' }, h('span', { class: 'd' }, label), sub && h('span', { class: 'k' }, sub));
  if (kind === 'wish') {
    const w = pick(data.entries.filter((e) => e.section === 'wish'));
    if (!w) return null;
    return wrap('end-wish', () => openDetail(w.id),
      h('div', { class: 'snap' }, w.photo ? photoImg(w.photo, '') : h('div', { class: 'blank' }, '?'),
        h('div', { class: 'cap' }, tag('NEXT', tr('次はここへ', 'Where to next')), h('div', { class: 't' }, w.title), w.body && h('div', { class: 'desc' }, w.body))));
  }
  if (kind === 'next') {
    const nm = nextMonthly(CONFIG.START_DATE, t);
    let best = { date: nm.date, label: tr(`${spanLabel(nm.months)}の記念日`, `${spanLabel(nm.months)} anniversary`) };
    for (const e of data.entries.filter((x) => x.section === 'anniversary' && x.date)) {
      const ny = nextYearly(e.date, t);
      if (ny.years > 0 && ny.date < best.date) best = { date: ny.date, label: tr(`「${e.title}」から${ny.years}年`, `${plural(ny.years, 'year')} since "${e.title}"`) };
    }
    const left = daysBetween(t, best.date);
    return wrap('end-next', () => { location.hash = '#/more/anniv'; },
      tag('NEXT', md(best.date)),
      h('div', { class: 'num' }, left === 0 ? 'TODAY' : String(left), left > 0 && h('small', {}, left === 1 ? 'DAY' : 'DAYS')),
      h('div', { class: 't' }, left === 0 ? tr(`今日は${best.label}！`, `${best.label} today!`) : tr(`${best.label}まで`, `until ${best.label}`)));
  }
  if (kind === 'today') {
    const days = daysBetween(CONFIG.START_DATE, t);
    return wrap('end-today', null,
      tag('TODAY', dots(t).slice(5)),
      h('div', { class: 'num' }, String(days), h('small', {}, days === 1 ? 'DAY' : 'DAYS')),
      h('div', { class: 't' }, tr('つづく…', 'To be continued…')));
  }
  if (kind === 'memory') {
    const all = data.entries.filter((e) => e.photo && e.date && e.date < t && ['place', 'gift'].includes(e.section) && !recent.has(e.id));
    if (!all.length) return null;
    // 去年より前の、今日の前後2週間の写真があればそれを（なければどれか1枚）
    const near = all.filter((e) => { const d = Math.abs(daysBetween(t.slice(0, 4) + e.date.slice(4), t)); return e.date.slice(0, 4) < t.slice(0, 4) && Math.min(d, 365 - d) <= 14; });
    const e = pick(near.length ? near : all);
    const ago = Number(t.slice(0, 4)) - Number(e.date.slice(0, 4));
    return wrap('end-memory', () => openDetail(e.id),
      h('div', { class: 'snap' }, photoImg(e.photo, ''),
        h('div', { class: 'cap' }, tag(near.length ? tr(`${ago}年前の今ごろ`, ago === 1 ? 'A year ago' : `${ago} years ago`) : tr('あの日の一枚', 'Looking back'), dots(e.date)),
          h('div', { class: 't' }, e.title))));
  }
  return null;
}

async function setHero(k, e) {
  const blob = await pickPhoto({ aspect: k === 'a' ? '3:4' : '4:5' }); if (!blob) return;
  act(async () => {
    const photo = await store.uploadPhoto(blob);
    const mine = data.entries.filter((x) => x.section === 'hero' && x.category === k && x.author === me());
    if (e && e.author === me()) await store.saveEntry({ id: e.id, photo });
    else await store.saveEntry({ section: 'hero', category: k, title: '', photo });
    // 入れかえる前の写真は、保存先に残さない（消せるのは自分が載せた分だけ）
    for (const old of mine) {
      try {
        if (!(e && old.id === e.id)) await store.removeEntry(old.id);
        if (old.photo && old.photo !== photo) await store.removePhoto(old.photo);
      } catch { /* 片づけに失敗しても、新しい写真はもう入っている */ }
    }
  });
}

export { home };
