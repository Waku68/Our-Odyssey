// 使い方: node run.mjs <サイトのフォルダ> <出力フォルダ>
// 全画面を順に開いて操作し、そのときの画面の中身（DOM）をファイルに書き出す。リファクタ前後で diff を取る。
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
// playwright は tests/ に入れたもの（npm install）を使う。なければ、作業環境に入っているものを使う
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = createRequire('/opt/npm-tools/node_modules/')('playwright')); }
const CHROME = process.env.CHROME || (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);

const [root, out] = process.argv.slice(2).map((p) => path.resolve(p));
const here = path.dirname(fileURLToPath(import.meta.url));
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const PORT = Number(process.env.PORT || 8123), BASE = `http://localhost:${PORT}/`;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(fs.readFileSync(f));
}).listen(PORT);

const PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVQIW2P8z8Dwn4GBgYGJAQoAHxcCAr7cHFIAAAAASUVORK5CYII=', 'base64');
const DATA_PX = `data:image/png;base64,${PX.toString('base64')}`;
const A = 'a', B = 'b';
const U1 = '11111111-1111-4111-8111-111111111111', U2 = '22222222-2222-4222-8222-222222222222';
function seed(a, b, photo) {
  let n = 0; const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  const E = (section, author, o) => ({ id: id(), section, author, created_at: `2026-10-${String(10 + n).padStart(2, '0')}T03:00:00.000Z`, category: null, title: '', body: '', date: null, lat: null, lng: null, photo: null, ...o });
  const entries = [
    E('place', a, { title: '江ノ島の水族館', body: 'クラゲがきれいだった', date: '2024-08-11', lat: 35.3094, lng: 139.4801, photo }),
    E('place', b, { title: '金沢21世紀美術館', date: '2025-03-02', lat: 36.5609, lng: 136.6582 }),
    E('place', a, { title: 'いつもの公園', body: '散歩' }),
    E('wish', b, { title: '富士急ハイランド', body: 'ええじゃないかに乗りたい', lat: 35.4872, lng: 138.7804 }),
    E('wish', a, { title: '北海道', photo }),
    E('like', a, { category: '食べ物', title: '抹茶ラテ', body: '甘さひかえめ', photo }),
    E('like', a, { category: '曲', title: 'Wonderwall Oasis' }),
    E('like', b, { category: '仕草', title: '笑うときに目を細める' }),
    E('like', b, { category: 'アニメ', title: 'ぼっち・ざ・ろっく！', photo }),
    E('gift', a, { title: '手編みのマフラー', date: '2024-12-24', photo }),
    E('gift', b, { title: '腕時計', date: '2025-01-28', body: '2周年' }),
    E('dislike', a, { title: '満員電車' }),
    E('dislike', b, { title: 'パクチー', body: 'においがだめ' }),
    E('value', a, { title: '理想の休日', body: '家でゆっくり' }),
    E('value', b, { title: '理想の休日', body: '外に出かけたい' }),
    E('value', b, { title: 'お金の使い方', body: '体験に使う' }),
    E('value', a, { title: '連絡の頻度', body: '毎日すこし' }),
    E('anniversary', a, { title: 'はじめて旅行した日', date: '2024-11-28' }),
    E('anniversary', b, { title: 'クリスマス', date: '2026-12-24' }),
    E('hero', a, { category: 'a', photo }),
    E('hero', b, { category: 'b', photo }),
  ];
  const M = (user_id, date, level, note = '', shared = false) => ({ id: id(), user_id, date, level, note, shared, created_at: `${date}T12:00:00.000Z` });
  const moods = [M(a, '2026-09-30', 2, 'テスト前'), M(a, '2026-10-20', 4), M(a, '2026-11-01', 5, '旅行'), M(a, '2026-11-15', 3), M(a, '2026-11-15', 1, '二重'), M(a, '2026-11-27', 4, 'あしたは記念日'),
    M(b, '2026-11-20', 2, 'ないしょ'), M(b, '2026-11-21', 4, '見せる', true)];
  const C = (entry_id, author, body) => ({ id: id(), entry_id, author, body, created_at: `2026-11-0${n % 9 + 1}T03:00:00.000Z` });
  const comments = [C(entries[0].id, b, 'また行こう'), C(entries[0].id, a, 'うん'), C(entries[5].id, b, '覚えててくれた')];
  return { entries, moods, comments };
}
const ITUNES = { results: [
  { trackId: 1, trackName: 'Wonderwall', artistName: 'Oasis', previewUrl: 'https://audio.example/1.m4a', artworkUrl100: 'https://img.example/a/100x100bb.jpg', trackViewUrl: 'https://music.apple.com/1' },
  { trackId: 2, trackName: 'Wonderwall (Live)', artistName: 'Oasis', previewUrl: 'https://audio.example/2.m4a', artworkUrl100: 'https://img.example/b/100x100bb.jpg', trackViewUrl: 'https://music.apple.com/2' }] };
const NOMINATIM = [
  { lat: '35.6586', lon: '139.7454', name: '東京タワー', display_name: '東京タワー, 芝公園, 港区, 東京都, 日本', extratags: { wikipedia: 'ja:東京タワー' } },
  { lat: '35.6600', lon: '139.7300', name: '東京タワー前', display_name: '東京タワー前, 港区, 東京都, 日本', extratags: {} }];

const errors = [];
async function newPage(browser, mode, lang) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, timezoneId: 'Asia/Tokyo', locale: 'ja-JP', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date('2026-11-28T10:00:00+09:00'));
  const demo = { me: A, profiles: [{ id: A, display_name: 'わく', notify: false }, { id: B, display_name: 'みく', notify: false }], ...seed(A, B, DATA_PX) };
  const live = { profiles: [{ id: U1, display_name: 'waku', notify: false }, { id: U2, display_name: 'miku', notify: false }], push_subscriptions: [], ...seed(U1, U2, `${U1}/p.jpg`) };
  await page.addInitScript(({ mode, lang, demo, live }) => {
    let n = 0; crypto.randomUUID = () => `99999999-0000-4000-8000-${String(++n).padStart(12, '0')}`;
    let s = 42; Math.random = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      if (lang === 'en') localStorage.setItem('our-odyssey-lang', 'en');
      if (mode === 'demo') localStorage.setItem('our-odyssey-demo', JSON.stringify(demo));
    }
    window.__seed = live;
  }, { mode, lang, demo, live });
  page.on('pageerror', (e) => errors.push(`[${mode}/${lang}] pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(`[${mode}/${lang}] console: ${m.text()}`); });
  await ctx.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
    if (url.origin === BASE.slice(0, -1)) {
      if (mode === 'demo' && url.pathname === '/js/config.js') {
        const src = fs.readFileSync(path.join(root, 'js/config.js'), 'utf8').replace(/SUPABASE_URL: '[^']*'/, "SUPABASE_URL: ''").replace(/SUPABASE_ANON_KEY: '[^']*'/, "SUPABASE_ANON_KEY: ''");
        return route.fulfill({ status: 200, contentType: 'text/javascript', body: src });
      }
      return route.continue();
    }
    if (url.hostname === 'esm.sh' && url.pathname.includes('supabase')) return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(path.join(here, 'fake-supabase.js'), 'utf8') });
    if (process.env.EXTRA && url.hostname === 'esm.sh' && url.pathname.includes('jszip')) return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(path.join(here, 'node_modules/jszip/dist/jszip.min.js'), 'utf8') + '\nexport default window.JSZip;' });
    if (url.hostname === 'unpkg.com' && url.pathname.includes('/leaflet@')) {
      const f = path.join(here, 'node_modules/leaflet/dist', url.pathname.split('/dist/')[1]);
      return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
    }
    if (url.hostname === 'tile.openstreetmap.org' || url.hostname === 'fake.supabase.co' || url.hostname === 'img.example') return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: PX });
    if (url.hostname === 'itunes.apple.com') {
      const cb = url.searchParams.get('callback');
      return cb ? route.fulfill({ status: 200, contentType: 'text/javascript', body: `${cb}(${JSON.stringify(ITUNES)})` }) : json(ITUNES);
    }
    if (url.hostname === 'nominatim.openstreetmap.org') return json(url.pathname.includes('reverse') ? { extratags: {} } : NOMINATIM);
    if (/wikipedia\.org|wikimedia\.org/.test(url.hostname)) return json({});
    return route.abort();
  });
  return { ctx, page };
}

const norm = (html) => html.replace(/blob:http:\/\/localhost:\d+\/[0-9a-f-]+/g, 'blob:X').replace(/ style=""/g, '').replace(/></g, '>\n<');
function snapper(page, prefix) {
  let i = 0;
  return async (name, wait = 450) => {
    await page.waitForTimeout(wait);
    const html = await page.evaluate(() => {
      const c = document.body.cloneNode(true);
      c.querySelectorAll('.leaflet-tile-pane').forEach((e) => e.replaceChildren());
      return `<!-- hash=${location.hash} htmlclass=${document.documentElement.className} htmlstyle=${document.documentElement.getAttribute('style') || ''} lang=${document.documentElement.lang} -->\n${c.innerHTML}`;
    });
    fs.writeFileSync(path.join(out, `${prefix}-${String(++i).padStart(2, '0')}-${name}.html`), norm(html));
    if (process.env.SHOTS) await page.screenshot({ path: path.join(out, `${prefix}-${String(i).padStart(2, '0')}-${name}.png`) });
  };
}
const go = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); };
const btn = (page, text, scope = 'body') => page.locator(`${scope} >> role=button[name="${text}"]`).first();
async function fillForm(page, { title, body, chip }) {
  const dlg = page.locator('dialog.modal[open]').last();
  if (chip) await dlg.locator('.chips .chip', { hasText: chip }).first().click();
  if (title != null) await dlg.locator('.field input[type=text]:not([readonly])').last().fill(title);
  if (body != null) await dlg.locator('textarea').first().fill(body);
}
const submit = (page) => page.locator('dialog.modal[open] button[type=submit]').last().click();

async function routesTour(page, snap) {
  for (const [name, hash] of [['home', '#/'], ['map', '#/map'], ['mood', '#/mood'], ['more', '#/more'], ['like', '#/more/like'], ['gift', '#/more/gift'],
    ['dislike', '#/more/dislike'], ['values', '#/more/values'], ['anniv', '#/more/anniv'], ['settings', '#/more/settings'], ['legacy', '#/s/like'], ['unknown', '#/more/nope']]) {
    await go(page, hash); await snap(name, name === 'map' ? 1200 : 450);
  }
}

async function demoFlow(browser, lang) {
  const { ctx, page } = await newPage(browser, 'demo', lang);
  const snap = snapper(page, `demo-${lang}`);
  await page.goto(BASE); await snap('start', 900);
  if (process.env.STRESS) {   // 年表の「ふわっと出す」のタイミングだけを何度もためす
    const counts = [];
    for (let k = 0; k < 14; k++) {
      await go(page, '#/more/nope'); await page.waitForTimeout(300); await go(page, '#/'); await page.waitForTimeout(300);
      await page.evaluate(() => window.scrollTo(0, 99999)); await page.waitForTimeout(700);
      await page.locator('.home-tl button.it').first().click(); await page.waitForTimeout(450);
      counts.push(await page.evaluate(() => document.querySelectorAll('.fade.in').length));
      await page.locator('dialog[open] .x').click(); await page.waitForTimeout(300);
    }
    console.log('fade.in counts:', counts.join(' ')); await ctx.close(); return;
  }
  await routesTour(page, snap);
  // ホームを下までスクロール（年表）
  await go(page, '#/'); await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo(0, 99999)); await snap('home-scrolled', 700);
  await page.locator('.home-tl button.it').first().click(); await snap('timeline-detail');
  await page.locator('dialog[open] .x').click(); await page.waitForTimeout(300);
  // MORE：ぜんぶ開く → 詳細 → ひとこと
  await go(page, '#/more'); await page.waitForTimeout(300);
  for (const b of await page.locator('button.acc-head').all()) await b.click();
  await snap('more-open', 900);
  await page.locator('.cork-board .pol', { hasText: '抹茶ラテ' }).click(); await snap('detail-like');
  await page.locator('dialog[open] .talk summary').click().catch(() => {});
  await page.locator('dialog[open] .talk input').fill('テストのひとこと'); await page.locator('dialog[open] .talk button[type=submit]').click(); await snap('detail-commented');
  await page.locator('dialog[open] .talk .c button').last().click(); await snap('detail-comment-deleted');
  await page.locator('dialog[open] .x').click(); await page.waitForTimeout(300);
  await page.locator('.cork-board .pol', { hasText: 'Wonderwall' }).click(); await snap('detail-song', 900);
  await page.locator('dialog[open] .song .chip').first().click(); await snap('detail-song-next');
  await page.locator('dialog[open] .x').click(); await page.waitForTimeout(300);
  await page.locator('.cork-board .song-play').first().click(); await snap('song-badge-tap', 600);
  // MORE の + ADD（Values / Days）
  await page.locator('li', { hasText: 'Values' }).locator('button', { hasText: '+ ADD' }).click(); await snap('value-form');
  await fillForm(page, { title: '将来住みたい場所', body: '海の近く' }); await submit(page); await snap('value-added');
  await page.locator('li', { hasText: 'Days' }).first().locator('button', { hasText: '+ ADD' }).click(); await snap('anniv-form');
  await fillForm(page, { title: '花火を見た日' });
  await page.locator('dialog[open] .strip .day').nth(4).click(); await snap('anniv-form-picked');
  await submit(page); await snap('anniv-added');
  // LIKES：しぼりこみ → 追加（必須エラー → 保存）→ 編集 → 削除
  await go(page, '#/more/like'); await page.waitForTimeout(300);
  await page.locator('.chips .chip').nth(5).click(); await snap('like-filter');
  await page.locator('.head .btn').click(); await snap('like-form');
  await submit(page); await snap('like-form-error', 200);
  await fillForm(page, { title: 'ラーメン', body: 'しょうゆ', chip: lang === 'en' ? 'Food' : '食べ物' }); await snap('like-form-filled', 1300);
  await submit(page); await snap('like-added');
  await page.locator('.chips .chip').first().click(); await page.waitForTimeout(200);
  await page.locator('.card', { hasText: 'ラーメン' }).locator('button', { hasText: 'EDIT' }).click(); await snap('like-edit-form');
  await fillForm(page, { title: 'みそラーメン' });
  await page.locator('dialog[open] .x').click(); await snap('like-edit-guard', 300);
  await page.locator('dialog.ask[open] .btn.ghost').click(); await page.waitForTimeout(250);
  await submit(page); await snap('like-edited');
  await page.locator('.card', { hasText: 'みそラーメン' }).locator('button', { hasText: 'DELETE' }).click(); await snap('like-delete-ask', 300);
  await page.locator('dialog.ask[open] .btn').first().click(); await snap('like-deleted');
  // 写真を足す（編集画面を通す）
  await go(page, '#/more/dislike'); await page.waitForTimeout(300);
  await go(page, '#/more/gift'); await page.waitForTimeout(300);
  const card = page.locator('.card', { hasText: '腕時計' });
  await page.evaluate(() => document.querySelector('.view')?.scrollIntoView());
  // VALUES：書く
  await go(page, '#/more/values'); await page.waitForTimeout(300);
  await page.locator('.card', { hasText: 'お金の使い方' }).locator('button', { hasText: 'WRITE' }).click(); await snap('value-write-form');
  await fillForm(page, { body: '貯金もしたい' }); await submit(page); await snap('value-written');
  void card;
  // PLACES：ピン → 吹き出し → 詳細 → 行った！ → その場の追加フォーム
  await go(page, '#/map'); await page.waitForTimeout(1200);
  await page.locator('.chips .chip.wish').click(); await snap('map-wish', 900);
  await page.locator('.chips .chip.all').click(); await page.waitForTimeout(900);
  await page.locator('.leaflet-marker-icon').first().click({ force: true }); await snap('map-bubble');
  await page.locator('.mpop-more').click(); await snap('map-detail');
  await page.locator('dialog[open] .x').click(); await page.waitForTimeout(300);
  await page.locator('.lrow', { hasText: '富士急ハイランド' }).click(); await snap('wish-detail');
  await page.locator('dialog[open] button', { hasText: 'BEEN THERE' }).click(); await snap('went-form');
  await fillForm(page, { body: '行ってきた' }); await submit(page); await snap('went-done', 1200);
  await page.locator('dialog[open] .x').click().catch(() => {}); await page.waitForTimeout(300);
  await page.locator('.addbox .seg button').nth(1).click(); await snap('map-add-wish');
  await page.locator('.addbox .field input[type=text]').first().fill('東京タワー');
  await page.locator('.addbox button', { hasText: 'PICK ON MAP' }).click(); await snap('map-add-geo', 1800);
  await page.locator('.addbox .geo-hit').nth(1).click(); await snap('map-add-geo2', 600);
  await page.locator('.addbox button[type=submit]').click(); await snap('map-added', 1300);
  // MOOD：点 → 吹き出し → 編集 → 保存 → 拡大 → 削除
  await go(page, '#/mood'); await page.waitForTimeout(500);
  await page.locator('.mchart .pt').nth(1).locator('circle').nth(1).click({ force: true }); await snap('mood-pop');
  await page.locator('.mpop-edit').click(); await snap('mood-edit', 700);
  await page.locator('#mood-add .levels button').nth(1).click();
  await page.locator('#mood-add textarea').fill('書きなおし'); await page.locator('#mood-add button[type=submit]').click(); await snap('mood-saved');
  await page.locator('.mzoom button').last().click(); await snap('mood-zoom');
  await page.locator('#mood-add .daypick-foot .chip').first().click(); await page.waitForTimeout(200);
  await page.locator('#mood-add .strip .day').nth(14).click(); await snap('mood-dup-day');
  await page.locator('#mood-add button', { hasText: 'DELETE THIS DAY' }).click(); await page.locator('dialog.ask[open] .btn').first().click(); await snap('mood-deleted');
  await page.locator('#mood-add button[type=submit]').click(); await snap('mood-error', 200);
  // SETTINGS：名前・色・言語・人の切りかえ
  await go(page, '#/more/settings'); await page.waitForTimeout(300);
  await page.locator('.card input[type=text]').first().fill('わっくん'); await page.locator('.card .btn').first().click(); await snap('settings-name');
  await page.locator('.theme-chips .chip').nth(3).click(); await snap('settings-theme');
  await go(page, '#/mood'); await snap('mood-themed'); await go(page, '#/map'); await snap('map-themed', 1200);
  await go(page, '#/more/settings'); await page.waitForTimeout(300);
  await page.locator('.card .chips .chip', { hasText: lang === 'en' ? 'JP + EN' : 'ALL ENGLISH' }).click(); await snap('settings-lang');
  await page.locator('button', { hasText: 'SWITCH TO' }).click(); await snap('settings-switched');
  await routesTour(page, snap);
  // 再読みこみしても同じ
  await page.reload(); await snap('reloaded', 900);
  // 写真：追加フォームの写真欄 → 編集画面（切り取り・色味・飾り）→ 保存
  const IMG = path.join(root, 'assets/tulip-pink.webp');
  const choose = async (click) => { const fc = page.waitForEvent('filechooser'); await click(); await (await fc).setFiles(IMG); };
  const ed = () => page.locator('dialog[open]').last();
  await go(page, '#/more/gift'); await page.waitForTimeout(300);
  await page.locator('.head .btn').click(); await page.waitForTimeout(300);
  await choose(() => page.locator('dialog.modal[open] .drop').click()); await snap('editor-open', 900);
  await ed().locator('.chips .chip', { hasText: '1:1' }).click();
  await ed().locator('button', { hasText: 'ROTATE ⟳' }).click(); await snap('editor-crop');
  await ed().locator('.ed-tab').nth(1).click(); await ed().locator('.ed-filter').nth(2).click(); await snap('editor-filter');
  await ed().locator('.ed-tab').nth(2).click(); await ed().locator('.ed-stk').first().click();
  await ed().locator('button', { hasText: '+ TEXT' }).click(); await page.waitForTimeout(150);
  await ed().locator('.chips .chip', { hasText: 'POLAROID' }).click(); await snap('editor-deco');
  await ed().locator('button', { hasText: 'DONE' }).click(); await snap('editor-done', 800);
  await fillForm(page, { title: '写真つきの贈りもの' }); await submit(page); await snap('photo-added', 800);
  // カードの ADD PHOTO（写真のない記録に、あとから足す）
  await choose(() => page.locator('.card', { hasText: '腕時計' }).locator('button', { hasText: 'ADD PHOTO' }).click());
  await page.waitForTimeout(600); await ed().locator('button', { hasText: 'DONE' }).click(); await snap('card-photo-added', 900);
  // 編集フォームの EDIT PHOTO（続きから直す）→ やめる
  await page.locator('.card', { hasText: '写真つきの贈りもの' }).locator('button', { hasText: 'EDIT' }).first().click(); await page.waitForTimeout(400);
  await page.locator('dialog.modal[open] button', { hasText: 'EDIT PHOTO' }).click(); await snap('photo-reedit', 900);
  await ed().locator('button', { hasText: 'CANCEL' }).click(); await page.waitForTimeout(400);
  await page.locator('dialog.modal[open] button', { hasText: 'REMOVE PHOTO' }).click(); await submit(page); await snap('photo-removed', 700);
  // HOME の写真
  await go(page, '#/'); await page.waitForTimeout(400);
  await choose(() => page.locator('.slot.a').click());
  await page.waitForTimeout(600); await ed().locator('button', { hasText: 'DONE' }).click(); await snap('hero-set', 900);
  // バックアップ（まとめる部品は読みこめないので、文章だけのファイルになる）
  await go(page, '#/more/settings'); await page.waitForTimeout(300);
  const dl = page.waitForEvent('download');
  await page.locator('button', { hasText: 'SAVE BACKUP' }).click();
  const d = await dl; fs.writeFileSync(path.join(out, `demo-${lang}-backup-${d.suggestedFilename()}.json`), fs.readFileSync(await d.path()));
  await snap('backup', 500);
  await page.locator('dialog.ask[open] .btn').first().click().catch(() => {});
  if (process.env.EXTRA) {   // 追加した機能：バックアップから戻す、HOME の写真の入れかえで古い分を残さない
    const db = () => page.evaluate(() => JSON.parse(localStorage.getItem('our-odyssey-demo')));
    const log = (...a) => console.log(`[${lang}]`, ...a);
    const dz = page.waitForEvent('download');
    await page.locator('button', { hasText: 'SAVE BACKUP' }).click();
    const z = await dz; const zipPath = path.join(out, `demo-${lang}-${z.suggestedFilename()}`); await z.saveAs(zipPath);
    log('backup file:', z.suggestedFilename(), fs.statSync(zipPath).size, 'bytes');
    const before = await db();
    const target = before.entries.find((e) => e.title === '腕時計');
    const tc = before.comments.filter((c) => c.entry_id === target.id).length;
    await go(page, '#/more/gift'); await page.waitForTimeout(300);
    await page.locator('.card', { hasText: '腕時計' }).locator('button', { hasText: 'DELETE' }).click(); await page.waitForTimeout(300);
    await page.locator('dialog.ask[open] .btn').first().click(); await page.waitForTimeout(500);
    const mid = await db();
    log('deleted:', !mid.entries.some((e) => e.id === target.id), 'entries', before.entries.length, '→', mid.entries.length);
    await go(page, '#/more/settings'); await page.waitForTimeout(300);
    let fc = page.waitForEvent('filechooser');
    await page.locator('button', { hasText: 'RESTORE' }).click(); await (await fc).setFiles(zipPath);
    await snap('restore-ask', 900);
    log('ask text:', await page.locator('dialog.ask[open] .ask-text').textContent());
    await page.locator('dialog.ask[open] .btn').first().click(); await snap('restored', 900);
    const after = await db(); const back = after.entries.find((e) => e.id === target.id);
    log('restored:', !!back, 'same date/created:', back?.created_at === target.created_at && back?.date === target.date, 'photo:', String(back?.photo).slice(0, 22),
      'comments back:', after.comments.filter((c) => c.entry_id === target.id).length, 'of', tc, 'entries', after.entries.length);
    fc = page.waitForEvent('filechooser');
    await page.locator('button', { hasText: 'RESTORE' }).click(); await (await fc).setFiles(zipPath);
    await snap('restore-nothing', 900);
    log('2nd time:', await page.locator('dialog.ask[open] .ask-title, dialog.ask[open] h2').first().textContent());
    await page.locator('dialog.ask[open] .btn').first().click(); await page.waitForTimeout(300);
    // こわれたファイル
    const bad = path.join(out, 'bad.json'); fs.writeFileSync(bad, '{"x":1}');
    fc = page.waitForEvent('filechooser');
    await page.locator('button', { hasText: 'RESTORE' }).click(); await (await fc).setFiles(bad);
    await page.waitForTimeout(600);
    log('bad file:', await page.locator('dialog.ask[open] .ask-title, dialog.ask[open] h2').first().textContent());
    await page.locator('dialog.ask[open] .btn').first().click(); await page.waitForTimeout(300);
    // HOME の写真を2回入れかえる
    const heroes = async () => (await db()).entries.filter((e) => e.section === 'hero' && e.category === 'a').length;
    log('hero a before:', await heroes());
    for (let k = 0; k < 2; k++) {
      await go(page, '#/'); await page.waitForTimeout(400);
      await choose(() => page.locator('.slot.a').click());
      await page.waitForTimeout(600); await ed().locator('button', { hasText: 'DONE' }).click(); await page.waitForTimeout(900);
    }
    await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('our-odyssey-demo')); d.me = d.me === 'a' ? 'b' : 'a'; localStorage.setItem('our-odyssey-demo', JSON.stringify(d)); });
    await page.reload(); await page.waitForTimeout(900);
    for (let k = 0; k < 2; k++) {
      await choose(() => page.locator('.slot.a').click());
      await page.waitForTimeout(600); await ed().locator('button', { hasText: 'DONE' }).click(); await page.waitForTimeout(900);
    }
    await snap('hero-replaced', 500);
    log('hero a after 2 swaps each by both people:', await heroes(), '| slot shows photo:', await page.locator('.slot.a.has').count());
  }
  await ctx.close();
}

async function liveFlow(browser) {
  const { ctx, page } = await newPage(browser, 'live', 'ja');
  const snap = snapper(page, 'live');
  await page.goto(BASE); await snap('login', 900);
  await page.locator('input[type=text]').fill('waku'); await page.locator('input[type=password]').fill('wrong'); await page.locator('button[type=submit]').click(); await snap('login-error');
  await page.locator('input[type=password]').fill('password1'); await page.locator('button[type=submit]').click(); await snap('home', 1200);
  await routesTour(page, snap);
  // 相手が足す → NEW! が付く → 見たら消える
  await go(page, '#/'); await page.waitForTimeout(400);
  await page.evaluate((U2) => {
    const f = window.__fake;
    f.partnerInsert('entries', { id: 'aaaaaaaa-0000-4000-8000-000000000001', section: 'like', category: '食べ物', title: 'たこ焼き', body: '', date: null, lat: null, lng: null, photo: null, author: U2, created_at: '2026-11-28T00:30:00.000Z' });
    f.partnerInsert('comments', { id: 'aaaaaaaa-0000-4000-8000-000000000002', entry_id: '00000000-0000-4000-8000-000000000001', body: '新しいひとこと', author: U2, created_at: '2026-11-28T00:31:00.000Z' });
    f.partnerInsert('entries', { id: 'aaaaaaaa-0000-4000-8000-000000000003', section: 'place', category: null, title: '新しい場所', body: '', date: '2026-11-27', lat: 35.0, lng: 135.7, photo: null, author: U2, created_at: '2026-11-28T00:32:00.000Z' });
    f.partnerInsert('moods', { id: 'aaaaaaaa-0000-4000-8000-000000000004', user_id: U2, date: '2026-11-27', level: 5, note: '', shared: true, created_at: '2026-11-28T00:33:00.000Z' });
  }, U2);
  await snap('home-new', 1500);
  await go(page, '#/more'); await snap('more-new');
  await page.locator('button.acc-head').first().click(); await snap('more-new-open', 1300);
  await go(page, '#/map'); await snap('map-new', 1500);
  await page.locator('.lrow', { hasText: '江ノ島' }).click(); await snap('detail-new');
  await page.locator('dialog[open] .x').click(); await page.waitForTimeout(300);
  await go(page, '#/more'); await snap('more-seen');
  await go(page, '#/'); await snap('home-seen');
  // 自分で足す・ひとこと・行った！
  await go(page, '#/more/like'); await page.waitForTimeout(300);
  await page.locator('.head .btn').click(); await fillForm(page, { title: 'おにぎり', chip: '食べ物' }); await submit(page); await snap('like-added');
  await go(page, '#/map'); await page.waitForTimeout(1000);
  await page.locator('.lrow', { hasText: '富士急ハイランド' }).click(); await page.locator('dialog[open] button', { hasText: 'BEEN THERE' }).click();
  await submit(page); await snap('went', 1200);
  await page.locator('dialog[open] .x').click().catch(() => {}); await page.waitForTimeout(300);
  // つながらないとき：あずかる → つながったら送る
  await page.evaluate(() => { window.__fake.offline = true; });
  await go(page, '#/more/dislike'); await page.waitForTimeout(300);
  await page.locator('.head .btn').click(); await fillForm(page, { title: 'オフラインで書いた' }); await submit(page); await snap('offline-added', 900);
  await page.evaluate(() => { window.__fake.offline = false; window.dispatchEvent(new Event('online')); }); await snap('online-sent', 1300);
  await page.evaluate(() => JSON.stringify(window.__fake.tables.entries.map((e) => [e.section, e.title, e.author.slice(0, 2)]))).then((s) => fs.writeFileSync(path.join(out, 'live-db-entries.json'), s));
  // MOOD と設定、パスワード、ログアウト
  await go(page, '#/mood'); await page.waitForTimeout(400);
  await page.locator('#mood-add .levels button').nth(4).click(); await page.locator('#mood-add button[type=submit]').click(); await snap('mood-saved');
  await go(page, '#/more/settings'); await page.waitForTimeout(300);
  const pw = page.locator('.pwform input[type=password]');
  await pw.nth(0).fill('password1'); await pw.nth(1).fill('short'); await pw.nth(2).fill('short'); await page.locator('.pwform button[type=submit]').click(); await snap('pw-short', 200);
  await pw.nth(1).fill('password2'); await pw.nth(2).fill('password2'); await page.locator('.pwform button[type=submit]').click(); await snap('pw-changed');
  await page.locator('button', { hasText: 'LOG OUT' }).click(); await snap('logged-out', 700);
  await page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort())).then((s) => fs.writeFileSync(path.join(out, 'live-localstorage-keys.json'), s));
  await ctx.close();
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  const only = process.env.ONLY || 'ja,en,live';
  for (const f of [only.includes('ja') && (() => demoFlow(browser, 'ja')), only.includes('en') && (() => demoFlow(browser, 'en')), only.includes('live') && (() => liveFlow(browser))].filter(Boolean)) {
    try { await f(); } catch (e) { errors.push(`FLOW FAILED: ${e.message.split('\n')[0]}`); }
  }
} finally { await browser.close(); server.close(); }
fs.writeFileSync(path.join(out, 'errors.txt'), errors.join('\n') + '\n');
console.log(`${fs.readdirSync(out).length} files, ${errors.length} errors`);
if (errors.length) console.log(errors.slice(0, 12).join('\n'));
