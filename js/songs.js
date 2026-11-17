/* ---------- 曲：タップで聴く ----------
   Likes の「曲」は、曲名で Apple Music（iTunes）をさがして、30秒の試聴を流す。全曲を聴くときは各アプリで開く */
import { h, svgIcon } from './dom.js?v=67';
import { tr } from './i18n.js?v=67';
import { notice } from './ask.js?v=67';
import { store } from './state.js?v=67';

// iTunes の検索は JSONP で呼ぶ（ブラウザの CORS に左右されない）
function jsonp(url) {
  return new Promise((ok, ng) => {
    const cb = `__oo${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const s = h('script', { src: `${url}&callback=${cb}` });
    const done = () => { clearTimeout(t); delete window[cb]; s.remove(); };
    const t = setTimeout(() => { done(); ng(new Error('timeout')); }, 10000);
    window[cb] = (d) => { done(); ok(d); };
    s.onerror = () => { done(); ng(new Error('load')); };
    document.head.append(s);
  });
}
const toTrack = (r) => r && r.previewUrl && ({ id: r.trackId, name: r.trackName, artist: r.artistName, preview: r.previewUrl,
  art: (r.artworkUrl100 || '').replace(/\/\d+x\d+bb\./, '/600x600bb.'), url: r.trackViewUrl, from: 'Apple Music' });
const songQuery = (title) => title.replace(/[／/|｜\-–—「」『』"]/g, ' ').replace(/\s+/g, ' ').trim();
async function getJson(url, ms = 8000) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { signal: c.signal }); if (!r.ok) throw new Error(String(r.status)); return await r.json(); } finally { clearTimeout(t); }
}
// Apple Music（iTunes）：ふつうの読みこみ → だめなら JSONP
async function itunesSongs(q) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&country=jp&lang=ja_jp&media=music&entity=song&limit=8`;
  let j;
  try { j = await getJson(url); } catch { j = await jsonp(url); }
  return (j.results || []).map(toTrack).filter(Boolean);
}
// 予備：Deezer（こちらも30秒の試聴がある）
async function deezerSongs(q) {
  const j = await jsonp(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&output=jsonp&limit=8`);
  return (j.data || []).filter((d) => d.preview).map((d) => ({ id: `dz${d.id}`, name: d.title, artist: d.artist?.name || '', preview: d.preview,
    art: d.album?.cover_big || '', url: d.link, from: 'Deezer' }));
}
// iTunes は短いあいだに何度も呼ぶと断られる（コルクボードの曲が一度にさがしに行くと起きる）。
// ひとつずつ間をあけて呼び、断られたら少し待ってもう一度。Deezer は日本の曲に弱いので最後の手段
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let itunesLine = Promise.resolve();
function itunesQueued(q) {
  const run = itunesLine.then(() => itunesSongs(q));
  itunesLine = run.catch(() => {}).then(() => wait(350));
  return run;
}
// iPhone の Safari は itunes.apple.com の検索をミュージックのアプリ（musics://）へ飛ばしてしまい、結果を読めない。
// 直接がだめなら Supabase の関数 songs に代わりに呼んでもらう。一度だめだったら、そのあとは最初から関数へ
let directOk = true;
async function appleSongs(q) {
  if (directOk || !store?.songSearch) {
    try { return await itunesQueued(q); } catch (e) { if (!store?.songSearch) throw e; directOk = false; }
  }
  return (await store.songSearch(q)).map(toTrack).filter(Boolean);
}
const FALLBACK_KEEP = 60000;   // 予備の結果は1分だけ覚えて、そのあとはまた Apple Music からさがす
const songSearches = new Map();
function searchSongs(title) {
  const q = songQuery(title);
  if (!q) return Promise.resolve([]);
  if (!songSearches.has(q)) {
    songSearches.set(q, (async () => {
      let a = null, b = null;
      try { a = await appleSongs(q); } catch {
        await wait(1500);
        try { a = await appleSongs(q); } catch { /* 予備へ */ }
      }
      if (a?.length) return a;
      try { b = await deezerSongs(q); } catch { /* どちらもだめ */ }
      if (b?.length) { setTimeout(() => songSearches.delete(q), FALLBACK_KEEP); return b; }
      if (a || b) return [];
      throw new Error('search failed');
    })().catch((e) => { songSearches.delete(q); throw e; }));
  }
  return songSearches.get(q);
}
// 足すときにえらんで保存した曲（e.song）。ふたりとも同じ曲になる
const savedTrack = (e) => (e?.song?.preview ? e.song : null);
// その曲の候補。えらんで保存した曲があればそれだけ。前からの記録は曲名でさがす（「ちがう曲？」でえらんだ曲は端末に覚えておく）
const songCache = new Map(), songDone = new Map();
const songKey = (e) => `${e.id}|${e.title}`;
function songFor(e) {
  const key = songKey(e);
  const saved = savedTrack(e);
  if (saved) { songDone.set(key, [saved]); return Promise.resolve([saved]); }
  if (!songCache.has(key)) {
    songDone.delete(key);   // えらんだ曲を外したあとに、その曲が残らないように
    songCache.set(key, searchSongs(e.title).then((tracks) => {
      songDone.set(key, tracks);
      if (tracks[0]?.from === 'Deezer') setTimeout(() => { songCache.delete(key); songDone.delete(key); }, FALLBACK_KEEP);
      return tracks;
    },
      (err) => { songCache.delete(key); throw err; }));
  }
  return songCache.get(key);
}
const PICK_KEY = 'our-odyssey-song-pick';
const songPick = (e) => { try { return JSON.parse(localStorage.getItem(PICK_KEY))?.[songKey(e)] || 0; } catch { return 0; } };
function setSongPick(e, i) {
  try { const m = JSON.parse(localStorage.getItem(PICK_KEY)) || {}; m[songKey(e)] = i; localStorage.setItem(PICK_KEY, JSON.stringify(m)); } catch { /* 覚えられなくても動く */ }
}
const pickedTrack = (e, tracks) => tracks[songPick(e)] || tracks[0];
// 試聴の音はひとつだけ鳴らす。鳴っている曲が変わったら、ボタンの見た目を合わせる
const audio = { el: null, key: null, subs: new Set() };
function audioEl() {
  if (!audio.el) {
    audio.el = new Audio();
    audio.el.preload = 'none';
    for (const ev of ['play', 'pause', 'ended', 'timeupdate', 'error']) audio.el.addEventListener(ev, () => audio.subs.forEach((f) => f()));
    audio.el.addEventListener('ended', () => { audio.key = null; });
  }
  return audio.el;
}
// iPhone は「タップした瞬間」に鳴らし始めないと音を出させてくれないので、曲をさがしている間は無音を流しておく
let silentUrl = '';
function silent() {
  if (silentUrl) return silentUrl;
  const n = 800, buf = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) buf.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); buf.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  buf.setUint32(16, 16, true); buf.setUint16(20, 1, true); buf.setUint16(22, 1, true); buf.setUint32(24, 8000, true);
  buf.setUint32(28, 16000, true); buf.setUint16(32, 2, true); buf.setUint16(34, 16, true); str(36, 'data'); buf.setUint32(40, n * 2, true);
  return (silentUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })));
}
function playTrack(key, track) {
  const el = audioEl();
  if (audio.key === key && !el.paused) { el.pause(); return; }
  if (audio.key !== key || el.src !== track.preview) { audio.key = key; el.src = track.preview; }
  el.play().catch(() => {});
  audio.subs.forEach((f) => f());
}
const isPlaying = (key) => audio.key === key && audio.el && !audio.el.paused;
// 画面から消えたボタンは見張りをやめる
function onAudio(node, f) {
  const sub = () => { if (!node.isConnected) { audio.subs.delete(sub); return; } f(); };
  audio.subs.add(sub);
  return sub;
}
const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z" fill="currentColor"/></svg>';

// コルクボードのポラロイドに付ける小さな再生ボタン（タップでその場で試聴）
function songBadge(e) {
  const key = `like:${e.id}`;
  const b = h('span', { class: 'song-play', role: 'button', tabindex: '0', 'aria-label': tr(`「${e.title}」を聴く`, `Play "${e.title}"`) });
  const paint = () => { const on = isPlaying(key); b.classList.toggle('on', on); svgIcon(b, on ? PAUSE : PLAY); };
  onAudio(b, paint); paint();
  songFor(e).catch(() => {});   // 先にさがしておくと、タップしてすぐ鳴る
  const go = async (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    if (isPlaying(key)) { audio.el.pause(); return; }
    const el = audioEl();
    const ready = songDone.get(songKey(e));
    if (!ready) { audio.key = null; el.src = silent(); el.play().catch(() => {}); }
    b.classList.add('busy');
    try {
      const tracks = ready || await songFor(e);
      if (!tracks.length) { notice(tr('試聴できる曲が見つかりませんでした', 'No preview found'), { text: tr('曲名を「曲名 アーティスト名」にすると見つかりやすくなります。', 'Try "title artist" as the name.') }); return; }
      playTrack(key, pickedTrack(e, tracks));
    } catch { notice(tr('曲をさがせませんでした', "Couldn't look up the song")); }
    finally { b.classList.remove('busy'); }
  };
  b.addEventListener('click', go);
  b.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') go(ev); });
  return b;
}
// 全曲を聴くためのリンク（各アプリの検索をひらく）
const fullSongLinks = (q) => [
  h('a', { class: 'chip', href: `https://open.spotify.com/search/${encodeURIComponent(q)}`, target: '_blank', rel: 'noopener' }, 'SPOTIFY'),
  h('a', { class: 'chip', href: `https://music.youtube.com/search?q=${encodeURIComponent(q)}`, target: '_blank', rel: 'noopener' }, 'YOUTUBE')];
const musicLinks = (q) => h('div', { class: 'song-links' }, h('span', { class: 'muted' }, tr('全部聴く：', 'Full song:')), fullSongLinks(q));
// 詳細やカードに出すプレーヤー
function songPlayer(e) {
  const box = h('div', { class: 'song' });
  const key = `like:${e.id}`;
  let tracks = [], i = 0;
  const status = h('p', { class: 'muted' }, tr('曲をさがしています…', 'Looking up the song…'));
  box.append(status);
  const render = () => {
    const t = tracks[i];
    if (!t) {
      box.replaceChildren(h('p', { class: 'muted' }, tr('試聴できる曲が見つかりませんでした。曲名を「曲名 アーティスト名」にすると見つかりやすくなります。', 'No preview found. Try "title artist" as the name.')), musicLinks(songQuery(e.title)));
      return;
    }
    const btn = h('button', { type: 'button', class: 'song-btn', 'aria-label': tr('試聴', 'Preview'), onclick: () => playTrack(key, t) });
    const bar = h('i', {});
    const paint = () => {
      const on = isPlaying(key) && audio.el.src === t.preview;
      svgIcon(btn, on ? PAUSE : PLAY); btn.classList.toggle('on', on);
      const el = audio.el;
      bar.style.width = audio.key === key && el?.duration ? `${(el.currentTime / el.duration) * 100}%` : '0%';
    };
    onAudio(box, paint);
    const others = tracks.length > 1;
    box.replaceChildren(
      h('div', { class: 'song-main' },
        h('div', { class: 'song-art' }, t.art && h('img', { src: t.art, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }), btn),
        h('div', { class: 'song-txt' }, h('b', {}, t.name), h('small', {}, t.artist),
          h('span', { class: 'song-bar' }, bar), h('small', { class: 'song-note' }, tr(`${t.from} の30秒試聴`, `30-second ${t.from} preview`)))),
      h('div', { class: 'song-links' },
        others && h('button', { type: 'button', class: 'chip', onclick: () => { if (audio.key === key) { audio.el.pause(); audio.key = null; } i = (i + 1) % tracks.length; setSongPick(e, i); render(); } }, tr('ちがう曲？', 'NOT THIS ONE?')),
        t.url && h('a', { class: 'chip', href: t.url, target: '_blank', rel: 'noopener' }, t.from.toUpperCase()),
        fullSongLinks(`${t.name} ${t.artist}`)));
    paint();
  };
  songFor(e).then((r) => { tracks = r; i = Math.min(songPick(e), Math.max(0, r.length - 1)); render(); })
    .catch(() => { box.replaceChildren(h('p', { class: 'muted' }, tr('曲をさがせませんでした（電波を確かめてください）', "Couldn't look up the song (check your connection)")), musicLinks(songQuery(e.title))); });
  return box;
}
// 足す・なおすときに、曲をえらぶ欄。さがした結果からタップでえらぶ（試聴して確かめられる）
// value：えらんである曲。query：はじめにさがす言葉（好きなもの の欄）。onPick(track | null)：えらんだ・外したとき
function songPicker({ value, query = '', onPick }) {
  let sel = value?.preview ? value : null, list = [], seq = 0, timer = 0, typed = false;
  const input = h('input', { type: 'text', class: 'song-q', enterkeyhint: 'search', value: query,
    placeholder: tr('曲名やアーティスト名でさがす', 'Search by title or artist'), 'aria-label': tr('曲をさがす', 'Search for the song'),
    oninput: () => { typed = true; find(400); },
    onkeydown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); find(0); } } });
  const status = h('p', { class: 'hint song-status' });
  const rows = h('div', { class: 'song-list' });
  const chosen = h('div', { class: 'song-chosen' });
  const root = h('div', { class: 'song-pick' }, chosen, input, status, rows);
  const keyOf = (t) => `pick:${t.id}`;
  const art = (t) => {
    const btn = h('button', { type: 'button', class: 'song-btn', 'aria-label': tr(`「${t.name}」を試聴`, `Preview "${t.name}"`),
      onclick: (ev) => { ev.stopPropagation(); playTrack(keyOf(t), t); } });
    btn.track = t;
    return h('div', { class: 'song-art' }, t.art && h('img', { src: t.art, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }), btn);
  };
  const txt = (t) => h('span', { class: 'song-txt' }, h('b', {}, t.name), h('small', {}, t.artist));
  const paint = () => root.querySelectorAll('.song-btn').forEach((b) => {
    const on = isPlaying(keyOf(b.track)); svgIcon(b, on ? PAUSE : PLAY); b.classList.toggle('on', on);
  });
  onAudio(root, paint);
  const stop = () => { if (audio.key?.startsWith('pick:')) { audio.el?.pause(); audio.key = null; } };
  const choose = (t) => { stop(); sel = t; onPick(t); render(); };
  function render() {
    chosen.hidden = !sel; input.hidden = !!sel; status.hidden = !!sel; rows.hidden = !!sel;
    if (sel) {
      chosen.replaceChildren(h('div', { class: 'song-main' }, art(sel), txt(sel)),
        h('div', { class: 'song-links' },
          h('button', { type: 'button', class: 'chip', onclick: () => { stop(); sel = null; onPick(null); render(); if (input.value.trim()) find(0); input.focus(); } }, 'CHANGE')));
    } else {
      rows.replaceChildren(...list.map((t) => h('div', { class: 'song-row' }, art(t),
        h('button', { type: 'button', class: 'song-choose', onclick: () => choose(t) }, txt(t), h('span', { class: 'chip' }, 'PICK')))));
    }
    paint();
  }
  const say = (t) => { status.textContent = t; };
  function find(ms) {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = input.value.trim(), my = ++seq;
      if (!q) { list = []; say(''); render(); return; }
      say(tr('さがしています…', 'Searching…'));
      let found = null;
      try { found = await searchSongs(q); } catch { found = null; }
      if (my !== seq) return;
      list = found || [];
      say(!found ? tr('曲をさがせませんでした（電波を確かめてください）', "Couldn't search (check your connection)")
        : !list.length ? tr('見つかりませんでした。アーティスト名も足してみてください', 'Nothing found. Try adding the artist.')
          : list[0].from === 'Deezer' ? tr('Apple Music につながらなかったので、予備の Deezer の結果です', "Couldn't reach Apple Music, so these are from Deezer")
            : tr('▶ で試聴、PICK でえらぶ。見つからなければアーティスト名も足してください', '▶ to preview, PICK to choose. Not here? Add the artist.'));
      render();
    }, ms);
  }
  // 好きなもの の欄が変わったら、自分でさがす言葉を書きかえていないかぎり、それでさがし直す
  root.setQuery = (q) => { if (typed || sel || (q === input.value && list.length)) return; input.value = q; find(700); };
  render();
  if (!sel && query.trim()) find(0);
  return root;
}
// 保存する曲の中身（試聴の URL など、鳴らすのに要るものだけ）
const songRow = (t) => (t ? { id: t.id, name: t.name, artist: t.artist, preview: t.preview, art: t.art, url: t.url, from: t.from } : null);
// 曲の写真の候補：ジャケット写真
async function songPhotos(q) {
  try { return (await searchSongs(q)).filter((t) => t.art).slice(0, 4).map((t) => ({ url: t.art, title: `${t.name} / ${t.artist}`, from: t.from })); } catch { return []; }
}

export { songBadge, songPlayer, songPhotos, songPicker, songRow };
