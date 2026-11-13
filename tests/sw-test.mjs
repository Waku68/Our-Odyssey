// 使い方: node sw-test.mjs <サイトのフォルダ> — お試しモードで開き、Service Worker が部品を覚えたあと、オフラインで開き直せるか確かめる
import { createRequire } from 'node:module';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const require = createRequire(import.meta.url);
// playwright は tests/ に入れたもの（npm install）を使う。なければ、作業環境に入っているものを使う
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = createRequire('/opt/npm-tools/node_modules/')('playwright')); }
const CHROME = process.env.CHROME || (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);
const root = path.resolve(process.argv[2]); const PORT = Number(process.env.PORT || 8130);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
let up = true;
const server = http.createServer((req, res) => {
  if (!up) { req.socket.destroy(); return; }
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  let body = fs.readFileSync(f);
  if (p === '/js/config.js') body = String(body).replace(/SUPABASE_URL: '[^']*'/, "SUPABASE_URL: ''").replace(/SUPABASE_ANON_KEY: '[^']*'/, "SUPABASE_ANON_KEY: ''");
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'max-age=600' }); res.end(body);
}).listen(PORT);
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://localhost:${PORT}/`);
await page.waitForSelector('.home .big', { timeout: 15000 });
await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 30000 }).catch(() => console.log('no controller yet'));
await page.waitForTimeout(6000);
const cached = await page.evaluate(async () => { const out = {}; for (const k of await caches.keys()) out[k] = (await (await caches.open(k)).keys()).length; return out; });
console.log('caches:', JSON.stringify(cached));
up = false; await ctx.setOffline(true);
await page.reload().catch((e) => console.log('reload error', e.message.split('\n')[0]));
const ok = await page.waitForSelector('.home .big', { timeout: 15000 }).then(() => true, () => false);
console.log('offline home rendered:', ok, '| days:', ok ? await page.locator('.home .big').first().textContent() : '-');
for (const h of ['#/mood', '#/more', '#/more/settings', '#/map']) { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForTimeout(500); console.log(h, '→', (await page.locator('.view h1').first().textContent().catch(() => 'NONE'))); }
console.log('page errors:', errs.length, errs.slice(0, 3).join(' | '));
await browser.close(); server.close();
