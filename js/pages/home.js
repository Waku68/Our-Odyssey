// HOME：日数（DAYS）と2人の写真、その下の年表。
import { CONFIG } from '../config.js?v=71';
import { h, reduceMotion } from '../dom.js?v=71';
import { tr } from '../i18n.js?v=71';
import { today, daysBetween, nextMonthly, nextYearly, spanLabel, plural, dots, md } from '../dates.js?v=71';
import { store, data, me, byCreated } from '../state.js?v=71';
import { newMark, entryNew } from '../seen.js?v=71';
import { photoImg, pickPhoto } from '../photos.js?v=71';
import { act, fadeIn } from '../shell.js?v=71';
import { openDetail, addEntry } from '../entries.js?v=71';

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
  const root = h('div', {}, pin,
    store.mode === 'demo' && h('p', { class: 'note' }, tr('お試しモード：書いた内容はこの端末にだけ保存されます。', 'Demo mode: everything is saved on this device only.')),
    tl);
  requestAnimationFrame(() => { fadeIn(root); pinHero(pin, heroEl); });
  return root;
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
    tl.append(newMark(h(it.id ? 'button' : 'div', { class: `it fade ${side}`, type: it.id ? 'button' : null, 'data-date': it.date, 'data-place': it.section === 'place' ? it.title : null, onclick: it.id ? () => (it.section === 'anniversary' ? (location.hash = '#/more/anniv') : openDetail(it.id)) : null },
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
// 高さが変わったら（文字の読みこみ・画面の幅）置きなおす。置いたあと、列にできたすきまに消印か「足す枠」を入れる
const STEP = 56, AFTER_YEAR = 10, GAP = 18;
function stagger(tl) {
  const deco = h('div', { class: 'tl-deco' });
  const items = [...tl.children];
  tl.prepend(deco);
  const place = () => {
    if (!tl.isConnected) { ro.disconnect(); return; }
    let prev = -Infinity, prevSide = 'l', prevYear = false;
    const bottom = { l: 0, r: 0 };
    const boxes = [];
    for (const el of items) {
      const side = bottom.l === bottom.r ? (prevSide === 'l' ? 'r' : 'l') : bottom.l < bottom.r ? 'l' : 'r';
      el.classList.toggle('l', side === 'l'); el.classList.toggle('r', side === 'r');
      const top = Math.max(prev + (prevYear ? AFTER_YEAR : STEP), bottom[side] && bottom[side] + GAP, 0);
      el.style.top = `${top}px`;
      bottom[side] = top + el.offsetHeight;
      boxes.push({ el, side, top, bottom: bottom[side] });
      prev = top; prevSide = side; prevYear = el.classList.contains('yr');
    }
    const height = Math.max(bottom.l, bottom.r);
    tl.style.height = `${height}px`;
    fillGaps(deco, boxes, height);
  };
  let raf = 0;
  const ro = new ResizeObserver(() => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; place(); }); });
  tl.classList.add('stag');
  place();
  for (const el of items) ro.observe(el);
}

// 列のすきま（上下の項目のあいだ・列の下の余り）に、消印か「足す枠」を置く。
//  消印：そのすきまに近い「過ごした場所」の名前と日付（同じ場所は1回だけ）。
//    大きいすきまには丸い消印、ふつうのすきま（60px くらい）には横長の消印。項目にはかぶせない
//  足す枠：大きいすきまで、近くに押せる場所がないとき。その頃の日付を入れた状態で、場所・贈りものを足せる
// APART：消印どうしを、少なくともこれだけ上下にはなす（多すぎ・少なすぎはここで変える）
const SLOT_H = 112, PAD = 10, APART = 200, SLIM_TILT = 2;
function fillGaps(deco, boxes, height) {
  const gut = parseFloat(getComputedStyle(deco.parentNode).getPropertyValue('--gut')) || 16;
  const col = deco.clientWidth / 2 - gut;
  if (col < 60) { deco.replaceChildren(); return; }
  // 消印の幅は列の幅（ただし丸いのは 170px、横長は 150px まで。CSS の max-width と合わせる）
  const bigW = Math.min(170, col), slimW = Math.min(150, col);
  const bigH = (bigW * 100) / 150, slimH = (slimW * 44) / 150;
  const bigNeed = bigH + 18 + PAD * 2; // 丸い消印：波線が傾いて上下にはみ出すぶんもとる
  const slimNeed = slimH + slimW * Math.sin((SLIM_TILT * Math.PI) / 180) + 6; // 横長：傾きでふえる高さと、上下 3px ずつ
  const gaps = [];
  for (const side of ['l', 'r']) {
    let from = null;
    for (const b of boxes.filter((x) => x.side === side).sort((a, c) => a.top - c.top)) {
      if (from != null) gaps.push({ side, a: from, b: b.top });
      from = b.bottom;
    }
    if (from != null) gaps.push({ side, a: from, b: height });
  }
  gaps.sort((x, y) => x.a - y.a);
  const dated = boxes.filter((x) => x.el.dataset.date);
  const used = new Set();
  const out = [];
  let last = -Infinity;
  for (const g of gaps) {
    const gap = g.b - g.a, room = gap - PAD * 2;
    if (gap < slimNeed) continue;
    const mid = (g.a + g.b) / 2;
    // いちばん近い「過ごした場所」（まだ押していないもの、すきまから離れすぎていないもの）
    const near = dated.filter((x) => x.el.dataset.place && !used.has(x.el)).map((x) => ({ x, d: Math.abs(x.top - mid) }))
      .filter((c) => c.d < 520).sort((p, q) => p.d - q.d)[0]?.x;
    let node;
    if (near && mid - last >= APART) {
      used.add(near.el); last = mid;
      const big = gap >= bigNeed;
      node = postmark(near.el.dataset.place, near.el.dataset.date, !big);
      node.style.top = `${mid - (big ? bigH : slimH) / 2}px`;
    } else if (room >= SLOT_H) {
      // その頃の日付：すきまの真ん中より上で、いちばん近い項目の日付
      const when = dated.filter((x) => x.top <= mid).pop()?.el.dataset.date || today();
      node = addSlot(when);
      node.style.top = `${g.a + PAD + (room - SLOT_H) / 2}px`;
    } else continue;
    node.classList.add(g.side);
    out.push(node);
  }
  // 置きなおし（文字の読みこみなど）で作りなおしても、もう押してあるものはポンともう一度出さない
  const shown = new Set([...deco.children].filter((n) => n.classList.contains('in')).map((n) => n.dataset.k));
  for (const n of deco.children) pressObs?.unobserve(n);
  for (const n of out) if (shown.has(n.dataset.k)) n.classList.add('in');
  deco.replaceChildren(...out);
  out.forEach((n) => n.classList.contains('slim') && fitName(n.querySelector('.pm-s'), 92, 11));
  pressIn(out.filter((n) => !n.classList.contains('in')));
}
// 横長の消印の名前：長くて入らなければ字を小さくし、それでも入らなければ詰める
function fitName(t, max, size) {
  const len = t.getComputedTextLength();
  if (len <= max) return;
  const fs = Math.max(7.5, (size * max) / len);
  t.style.fontSize = `${fs}px`;
  if ((len * fs) / size > max) { t.setAttribute('textLength', max); t.setAttribute('lengthAdjust', 'spacingAndGlyphs'); }
}
// 見えたら、ポンと押したように出す
let pressObs = null;
function pressIn(nodes) {
  if (reduceMotion() || !('IntersectionObserver' in window)) { nodes.forEach((n) => n.classList.add('in')); return; }
  pressObs ??= new IntersectionObserver((list) => list.forEach((x) => { if (x.isIntersecting) { x.target.classList.add('in'); pressObs.unobserve(x.target); } }), { rootMargin: '0px 0px -10% 0px' });
  nodes.forEach((n) => pressObs.observe(n));
}
// 消印。傾きは場所の名前で決める（置きなおしても変わらない）
//  丸い消印：上の弧に場所の名前、まんなかに日付、下の弧に OUR ODYSSEY。右に波線
//  横長の消印（slim）：左に日付の丸（上に年、帯に月日、下にハート）、右に2本の波線と、そのあいだに場所の名前
let stampN = 0;
function postmark(name, date, slim) {
  const id = `pm${++stampN}`;
  const sum = [...name].reduce((a, c) => a + c.codePointAt(0), 0);
  const tilt = slim ? (sum % (SLIM_TILT * 2 + 1)) - SLIM_TILT : (sum % 25) - 12;
  const ink = `<filter id="${id}f"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="${(sum % 25) + 8}"/><feDisplacementMap in="SourceGraphic" scale="1.6"/></filter>`;
  const wave = (x, y, dx, dy, n) => `M${x} ${y}c${dx / 3}-${dy} ${(dx * 2) / 3} ${dy} ${dx} 0${` s${(dx * 2) / 3} ${dy} ${dx} 0`.repeat(n - 1)}`;
  const node = h('div', { class: `stamp${slim ? ' slim' : ''}`, 'aria-hidden': 'true', 'data-k': `${name}|${date}`, style: `--tilt: ${tilt}deg` });
  if (slim) {
    node.innerHTML = `<svg viewBox="0 0 150 44" aria-hidden="true"><defs>${ink}</defs>
<g filter="url(#${id}f)" fill="none" stroke="currentColor">
<circle cx="22" cy="22" r="20" stroke-width="2.2"/><circle cx="22" cy="22" r="15.5" stroke-width="1"/>
<path d="M7.3 17h29.4M7.7 28h28.6" stroke-width="1"/>
<path d="${wave(48, 7, 16.5, 3.5, 6)}${wave(48, 37, 16.5, 3.5, 6)}" stroke-width="1.8"/>
<g fill="currentColor" stroke="none"><text class="pm-y" x="22" y="14.6" text-anchor="middle">${date.slice(0, 4)}</text>
<text class="pm-md" x="22" y="25.7" text-anchor="middle">${dots(date).slice(5)}</text>
<path d="M22 36c-2.3-1.5-3.4-2.7-3.4-3.9a1.7 1.7 0 0 1 3.4-.4a1.7 1.7 0 0 1 3.4 .4c0 1.2-1.1 2.4-3.4 3.9z"/>
<text class="pm-s" x="97.5" y="26" text-anchor="middle"></text></g></g></svg>`;
    node.querySelector('.pm-s').textContent = [...name].length > 16 ? `${[...name].slice(0, 15).join('')}…` : name;
    return node;
  }
  node.innerHTML = `<svg viewBox="0 0 150 100" aria-hidden="true"><defs>
<path id="${id}t" d="M22 50 A28 28 0 0 1 78 50"/><path id="${id}b" d="M18 50 A32 32 0 0 0 82 50"/>${ink}</defs>
<g filter="url(#${id}f)" fill="none" stroke="currentColor">
<circle cx="50" cy="50" r="44" stroke-width="2.6"/><circle cx="50" cy="50" r="34" stroke-width="1.2"/>
<path d="M17 43h66M17 58h66" stroke-width="1.2"/>
<path d="M98 30c7-5 14 5 21 0s14 5 21 0M98 44c7-5 14 5 21 0s14 5 21 0M98 58c7-5 14 5 21 0s14 5 21 0M98 72c7-5 14 5 21 0s14 5 21 0" stroke-width="2"/>
<g fill="currentColor" stroke="none"><text class="pm-n"><textPath href="#${id}t" startOffset="50%" text-anchor="middle"></textPath></text>
<text class="pm-d" x="50" y="55" text-anchor="middle">${dots(date)}</text>
<text class="pm-o"><textPath href="#${id}b" startOffset="50%" text-anchor="middle">OUR ODYSSEY</textPath></text></g></g></svg>`;
  node.querySelector('.pm-n textPath').textContent = [...name].length > 9 ? `${[...name].slice(0, 8).join('')}…` : name;
  return node;
}
// 足す枠：「この頃の思い出」。その頃の日付を入れた状態でフォームがひらく
function addSlot(date) {
  return h('div', { class: 'slot-add', 'data-k': `+${date}` },
    h('div', { class: 'sa-when' }, `${dots(date).slice(0, 7)} ${tr('ごろ', '')}`.trim()),
    h('div', { class: 'sa-t' }, tr('この頃の思い出を足す', 'Add a memory from around then')),
    h('div', { class: 'sa-btns' },
      h('button', { type: 'button', class: 'chip', onclick: () => addEntry('place', { date }) }, '+ PLACE'),
      h('button', { type: 'button', class: 'chip', onclick: () => addEntry('gift', { date }) }, '+ GIFT')));
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
