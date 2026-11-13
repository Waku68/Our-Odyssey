// MOOD の折れ線グラフ（横にスクロール、2本指で期間を伸び縮み、点をタップで吹き出し）。
import { h, reduceMotion } from './dom.js?v=38';
import { lang, tr } from './i18n.js?v=38';
import { MONTHS, WEEK, ymd, parse, today, utc, daysBetween, dots, md, plural, addDays } from './dates.js?v=38';
import { TH } from './theme.js?v=38';

const levels = () => tr(['とても\nつらい', 'つらい', 'ふつう', 'いい', 'とても\nいい'], ['Very\nbad', 'Bad', 'Okay', 'Good', 'Very\ngood']);

const levelShort = () => tr(['とてもつらい', 'つらい', 'ふつう', 'いい', 'とてもいい'], ['Very bad', 'Bad', 'Okay', 'Good', 'Very good']);
const dow = () => tr(['日', '月', '火', '水', '木', '金', '土'], WEEK);

let moodPop = null;     // 吹き出しを出している日
let moodScale = 14;     // 1日あたりの幅（px）。ピンチや ＋− で変わる
let moodAnimated = false;

// 点をなめらかに結ぶ線。点と点のあいだで行きすぎない（ありもしない山や谷を作らない）曲線にする。
function smoothPath(P) {
  const n = P.length;
  if (n < 2) return '';
  const r1 = (v) => Math.round(v * 10) / 10;
  const dx = [], d = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = Math.max(1e-6, P[i + 1][0] - P[i][0]); d[i] = (P[i + 1][1] - P[i][1]) / dx[i]; }
  const m = new Array(n);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], q = a * a + b * b;
    if (q > 9) { const k = 3 / Math.sqrt(q); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
  }
  let out = `M${r1(P[0][0])},${r1(P[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const t3 = dx[i] / 3;
    out += ` C${r1(P[i][0] + t3)},${r1(P[i][1] + m[i] * t3)} ${r1(P[i + 1][0] - t3)},${r1(P[i + 1][1] - m[i + 1] * t3)} ${r1(P[i + 1][0])},${r1(P[i + 1][1])}`;
  }
  return out;
}
const spanText = (days) => {
  if (lang === 'en') {
    if (days < 11) return `~${plural(Math.round(days), 'day')}`;
    if (days < 45) return `~${plural(Math.round(days / 7), 'week')}`;
    if (days < 330) return `~${plural(Math.round(days / 30.4), 'month')}`;
    return `~${Math.round(days / 365 * 10) / 10} yrs`;
  }
  if (days < 11) return `${Math.round(days)}日くらい`;
  if (days < 45) return `${Math.round(days / 7)}週間くらい`;
  if (days < 330) return `${Math.round(days / 30.4)}か月くらい`;
  return `${Math.round(days / 365 * 10) / 10}年くらい`;
};

// 横にスクロールする気分の線。2本指で広げる・縮めると、1日の幅が変わる。
function moodChart(list, onEdit) {
  const t = today();
  const H = 300, TOP = 40, BASE = 240, PADL = 56, PADR = 32, MIN_SPAN = 30, MAX_DAY = 60;
  const yOf = (lv) => BASE - 22 - ((lv - 1) / 4) * (BASE - 22 - TOP);
  const end = addDays(t, 3);
  const firstRec = list.length ? list[0].date : t;
  const baseStart = addDays(firstRec < addDays(t, -MIN_SPAN) ? firstRec : addDays(t, -MIN_SPAN), -3);
  let DAY = moodScale, start = baseStart, W = 0, cw = 0;
  const x = (d) => PADL + daysBetween(start, d) * DAY;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'mchart'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', tr('気分の移り変わり', 'Mood over time'));
  const pop = h('div', { class: 'mpop', hidden: true });
  const canvas = h('div', { class: 'mcanvas' }, svg, pop);
  const scroller = h('div', { class: 'mscroll' }, canvas);
  const spanLabelEl = h('span', { class: 'mspan' });
  const yax = h('div', { class: 'myax', 'aria-hidden': 'true' },
    [5, 4, 3, 2, 1].map((lv) => h('span', { style: `top:${yOf(lv)}px` }, levels()[lv - 1])));

  const minDay = () => {
    const room = Math.max(200, (cw || 360) - PADL - PADR);
    return Math.min(14, Math.max(0.8, room / Math.max(1, daysBetween(baseStart, end))));
  };
  const clampDay = (v) => Math.min(MAX_DAY, Math.max(minDay(), v));

  function render() {
    cw = scroller.clientWidth || cw || 360;
    DAY = moodScale = clampDay(DAY);
    const fit = Math.ceil((cw - PADL - PADR) / DAY);
    start = daysBetween(baseStart, end) < fit ? addDays(end, -fit) : baseStart;
    W = Math.round(PADL + PADR + daysBetween(start, end) * DAY);
    const animate = !moodAnimated && !reduceMotion() && list.length > 1;
    let s = '<defs><linearGradient id="mood-fill" x1="0" y1="0" x2="0" y2="1">'
      + `<stop offset="0" stop-color="${TH.pinkD}" stop-opacity=".85"/><stop offset="1" stop-color="${TH.pinkD}" stop-opacity=".12"/></linearGradient></defs>`;

    // 月ごとの帯と、月の名前
    let { y: yy, m: mm } = parse(start);
    for (let guard = 0; guard < 400; guard++) {
      const ms = ymd(yy, mm, 1);
      if (ms > end) break;
      const ny = mm === 12 ? yy + 1 : yy, nm = mm === 12 ? 1 : mm + 1;
      const x0 = Math.max(0, x(ms)), x1 = Math.min(W, x(ymd(ny, nm, 1)));
      if ((yy * 12 + mm) % 2 === 0) s += `<rect x="${x0}" y="0" width="${Math.max(0, x1 - x0)}" height="${BASE}" fill="${TH.navy}" fill-opacity=".045"/>`;
      if (ms >= start) s += `<line x1="${x(ms)}" x2="${x(ms)}" y1="0" y2="${BASE}" stroke="${TH.navy}" stroke-opacity=".25" stroke-width="1"/>`;
      const lx = Math.max(x0, ms >= start ? x0 : PADL) + 7;
      if (x1 - lx > 34) s += `<text x="${lx}" y="22" class="mon">${MONTHS[mm - 1]}${mm === 1 || guard === 0 ? `<tspan class="yr" dx="5">${yy}</tspan>` : ''}</text>`;
      yy = ny; mm = nm;
    }
    // 気分の高さの目安線
    for (let lv = 1; lv <= 5; lv++) {
      s += `<line x1="0" x2="${W}" y1="${yOf(lv)}" y2="${yOf(lv)}" stroke="${TH.navy}" stroke-opacity="${lv === 3 ? '.3' : '.16'}" stroke-width="1" stroke-dasharray="2 5"/>`;
    }
    // 線と、その下の塗り
    const P = list.map((m) => [x(m.date), yOf(m.level)]);
    const line = smoothPath(P);
    if (line) {
      s += `<path class="area${animate ? ' draw' : ''}" d="${line} L${P[P.length - 1][0]},${BASE} L${P[0][0]},${BASE} Z" fill="url(#mood-fill)"/>`
        + `<path class="line${animate ? ' draw' : ''}" pathLength="1" d="${line}" fill="none" stroke="${TH.navy}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    // 下の軸と日付
    s += `<line x1="0" x2="${W}" y1="${BASE}" y2="${BASE}" stroke="${TH.navy}" stroke-width="2"/>`;
    const step = [1, 2, 7, 14].find((k) => k * DAY >= 42);
    const LABEL_DAYS = { 1: null, 2: null, 7: [1, 8, 15, 22], 14: [1, 15] };
    for (let d = start, i = 0; d <= end && i < 2000; d = addDays(d, 1), i++) {
      const px = x(d), { m: dm, d: dd } = parse(d);
      if (DAY >= 6) s += `<line x1="${px}" x2="${px}" y1="${BASE}" y2="${BASE + 5}" stroke="${TH.navy}" stroke-opacity=".5" stroke-width="1"/>`;
      if (!step) continue;
      const show = step === 1 || (step === 2 ? dd % 2 === 1 && dd < 31 : LABEL_DAYS[step].includes(dd));
      if (show) s += `<text x="${px}" y="${BASE + 22}" text-anchor="middle" class="tick">${step >= 7 || dd === 1 ? `${dm}/${dd}` : dd}</text>`;
    }
    const tx = x(t);
    s += `<line x1="${tx}" x2="${tx}" y1="${TOP - 26}" y2="${BASE + 30}" stroke="${TH.navy}" stroke-width="1.5" stroke-dasharray="4 4"/>`
      + `<rect x="${tx - 26}" y="${BASE + 31}" width="52" height="20" rx="10" fill="${TH.navy}"/>`
      + `<text x="${tx}" y="${BASE + 46}" text-anchor="middle" class="tick now">TODAY</text>`;
    // 点（メモがある日は中に小さな印）
    for (const m of list) {
      const on = m.date === moodPop, cx = x(m.date), cy = yOf(m.level);
      s += `<g class="pt${on ? ' on' : ''}" data-date="${m.date}" role="button" tabindex="0" aria-label="${dots(m.date)} ${levelShort()[m.level - 1]}${m.note ? tr('（メモあり）', ' (with note)') : ''}">`
        + `<line x1="${cx}" x2="${cx}" y1="${BASE}" y2="${BASE + 9}" stroke="${TH.navy}" stroke-width="2"/>`
        + `<circle cx="${cx}" cy="${cy}" r="20" fill="transparent"/>`
        + `<circle cx="${cx}" cy="${cy}" r="${on ? 9 : 7}" fill="${on ? '${TH.navy}' : '${TH.paper}'}" stroke="${TH.navy}" stroke-width="2.5"/>`
        + (m.note ? `<circle cx="${cx}" cy="${cy}" r="2.4" fill="${on ? '${TH.pink}' : '${TH.navy}'}"/>` : '')
        + '</g>';
    }
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', W); svg.setAttribute('height', H);
    svg.innerHTML = s;
    canvas.style.width = `${W}px`;
    if (animate) moodAnimated = true;
    spanLabelEl.textContent = spanText((cw - PADL - PADR) / DAY);
    placePop();
  }

  // 吹き出し
  function fillPop() {
    const m = list.find((r) => r.date === moodPop);
    if (!m) return;
    const { y: py, m: pm, d: pd } = parse(m.date);
    const editBtn = h('button', { type: 'button', class: 'mpop-edit', onclick: (ev) => { ev.stopPropagation(); onEdit(m.date); } },
      'EDIT', h('span', { 'aria-hidden': 'true' }, '↓'));
    pop.replaceChildren(
      h('div', { class: 'mpop-head' },
        h('span', { class: 'mpop-d' }, `${py === parse(t).y ? '' : `${py}.`}${pm}.${pd}`, h('small', {}, dow()[new Date(utc(m.date)).getUTCDay()])),
        h('span', { class: 'mpop-lv' }, levelShort()[m.level - 1])),
      h('p', { class: m.note ? 'mpop-note' : 'mpop-note none' }, m.note || tr('メモはありません', 'No note')),
      h('div', { class: 'mpop-foot' }, editBtn));
    pop.setAttribute('aria-label', tr(`${md(m.date)}の記録`, `Entry for ${md(m.date)}`));
  }
  function placePop() {
    const m = moodPop && list.find((r) => r.date === moodPop);
    if (!m) { pop.hidden = true; return; }
    pop.hidden = false;
    const px = x(m.date), py = yOf(m.level);
    const w = pop.offsetWidth, ph = pop.offsetHeight, GAP = 18;
    // 点が見えているあいだは、吹き出しも画面の中に収める
    const sl = scroller.scrollLeft, vis = px >= sl && px <= sl + cw;
    let left = px - w / 2;
    if (vis) left = Math.min(Math.max(left, sl + 8), sl + cw - w - 8);
    left = Math.round(Math.min(Math.max(left, 8), W - w - 8));
    const above = py - GAP - ph >= 2 ? true : py + GAP + ph <= H - 2 ? false : py > H / 2;
    pop.style.left = `${left}px`;
    pop.style.top = `${Math.round(above ? py - GAP - ph : py + GAP)}px`;
    pop.style.setProperty('--tail', `${Math.min(w - 18, Math.max(18, px - left))}px`);
    pop.classList.toggle('below', !above);
  }
  function openPop(date) {
    moodPop = moodPop === date ? null : date;
    fillPop(); render();
    if (!moodPop) return;
    const l = parseFloat(pop.style.left), w = pop.offsetWidth, sl = scroller.scrollLeft;
    if (l < sl + PADL) scroller.scrollTo({ left: l - PADL, behavior: 'smooth' });
    else if (l + w > sl + cw - 8) scroller.scrollTo({ left: l + w - cw + 8, behavior: 'smooth' });
  }
  svg.addEventListener('click', (ev) => {
    const g = ev.target.closest('.pt');
    if (g) openPop(g.dataset.date);
    else if (moodPop) { moodPop = null; render(); }
  });
  scroller.addEventListener('scroll', () => { if (moodPop) placePop(); }, { passive: true });
  svg.addEventListener('keydown', (ev) => { const g = ev.target.closest('.pt'); if (g && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); openPop(g.dataset.date); } });

  // 伸び縮み。指のあいだ（またはボタンなら真ん中）の日付をその場に止めたまま、1日の幅を変える。
  let pending = null, raf = 0;
  const anchorAt = (px) => (scroller.scrollLeft + px - x(end)) / DAY;
  function zoomTo(day, anchor, px) {
    pending = { day, anchor, px };
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const p = pending; pending = null;
      DAY = clampDay(p.day); render();
      scroller.scrollLeft = x(end) + p.anchor * DAY - p.px;
    });
  }
  const zoomBy = (k) => { const px = cw / 2; zoomTo(DAY * k, anchorAt(px), px); };
  let pinch = null;
  const gap2 = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  const midX = (a, b) => (a.clientX + b.clientX) / 2 - scroller.getBoundingClientRect().left;
  scroller.addEventListener('touchstart', (ev) => {
    if (ev.touches.length !== 2) return;
    const [a, b] = ev.touches;
    const px = midX(a, b);
    pinch = { d0: Math.max(10, gap2(a, b)), s0: DAY, anchor: anchorAt(px) };
  }, { passive: true });
  scroller.addEventListener('touchmove', (ev) => {
    if (!pinch || ev.touches.length !== 2) return;
    if (ev.cancelable) ev.preventDefault();
    const [a, b] = ev.touches;
    zoomTo(pinch.s0 * gap2(a, b) / pinch.d0, pinch.anchor, midX(a, b));
  }, { passive: false });
  const endPinch = (ev) => { if (ev.touches.length < 2) pinch = null; };
  scroller.addEventListener('touchend', endPinch);
  scroller.addEventListener('touchcancel', endPinch);
  for (const g of ['gesturestart', 'gesturechange']) scroller.addEventListener(g, (ev) => ev.preventDefault());
  scroller.addEventListener('wheel', (ev) => {   // パソコンのトラックパッドのピンチ、Ctrl＋ホイール
    if (!ev.ctrlKey) return;
    ev.preventDefault();
    const px = ev.clientX - scroller.getBoundingClientRect().left;
    zoomTo(DAY * Math.exp(-ev.deltaY * 0.01), anchorAt(px), px);
  }, { passive: false });

  // 最初の位置：吹き出しがあればそこ、なければいちばん右（今日）
  let seenW = 0;
  const ro = new ResizeObserver(() => {
    const w = scroller.clientWidth;
    if (!w || w === seenW) return;
    const first = !seenW; seenW = w;
    const keep = first ? null : anchorAt(w / 2);
    fillPop(); render();
    if (first) {
      const m = moodPop && list.find((r) => r.date === moodPop);
      scroller.scrollLeft = m ? x(m.date) - w / 2 : W;
    } else scroller.scrollLeft = x(end) + keep * DAY - w / 2;
  });
  ro.observe(scroller);

  // 上の小さな集計
  const last = list[list.length - 1];
  const recent = list.filter((m) => m.date >= addDays(t, -30));
  const avg = recent.length ? recent.reduce((a, m) => a + m.level, 0) / recent.length : null;
  const stat = (k, v, sub, jp) => h('div', { class: 'mstat' }, h('span', { class: 'k' }, k), h('span', { class: jp ? 'v jp' : 'v' }, v), h('small', {}, sub));
  const stats = h('div', { class: 'mstats' },
    stat(tr('記録した日', 'Days logged'), String(new Set(list.map((m) => m.date)).size), tr('日ぶん', 'days')),
    stat(tr('いちばん最近', 'Latest'), last ? levelShort()[last.level - 1] : '—', last ? (parse(last.date).y === parse(t).y ? dots(last.date).slice(5) : dots(last.date)) : tr('まだなし', 'none yet'), true),
    stat(tr('この30日をならすと', '30-day average'), avg ? avg.toFixed(1) : '—', avg ? tr(`5段階で・${levelShort()[Math.round(avg) - 1]}寄り`, `of 5 · mostly ${levelShort()[Math.round(avg) - 1].toLowerCase()}`) : tr('記録なし', 'no entries')));

  return h('div', { class: 'mood' }, stats,
    h('div', { class: 'mwrap' },
      h('div', { class: 'mchart-body' }, scroller, yax,
        !list.length && h('p', { class: 'mempty' }, tr('まだ記録がありません。', 'No entries yet.'), h('br'), tr('下の「ADD MOOD」から。', 'Start with ADD MOOD below.'))),
      h('div', { class: 'mctrl' },
        h('div', { class: 'mzoom' },
          h('button', { type: 'button', 'aria-label': tr('期間を広く（縮める）', 'Show a longer period'), onclick: () => zoomBy(1 / 1.6) }, '−'),
          spanLabelEl,
          h('button', { type: 'button', 'aria-label': tr('期間をせまく（広げる）', 'Show a shorter period'), onclick: () => zoomBy(1.6) }, '+')),
        h('button', { type: 'button', class: 'mnow', onclick: () => scroller.scrollTo({ left: W, behavior: 'smooth' }) }, 'TODAY →'))));
}

export { levels, moodChart };
