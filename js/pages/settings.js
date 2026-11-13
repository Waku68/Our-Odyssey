// SETTINGS：名前、言語、色のテーマ、パスワード、通知、バックアップ、ログアウト。
import { CONFIG } from '../config.js?v=38';
import { h } from '../dom.js?v=38';
import { lang, tr, setLang } from '../i18n.js?v=38';
import { today } from '../dates.js?v=38';
import { store, data, me, nameOf, partner } from '../state.js?v=38';
import { ask, notice } from '../ask.js?v=38';
import * as theme from '../theme.js?v=38';
import { act, refresh, draw, pageNav, pageHead, tellSwLang, start } from '../shell.js?v=38';

const b64ToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error(tr('このブラウザでは通知を受け取れません。iPhoneの場合は、共有ボタンから「ホーム画面に追加」して、そのアイコンから開いてください。', "This browser can't receive notifications. On iPhone, use Share → Add to Home Screen and open the app from that icon."));
  }
  if ((await Notification.requestPermission()) !== 'granted') throw new Error(tr('通知が許可されませんでした。端末の設定で許可してください。', 'Notifications were not allowed. Please allow them in your device settings.'));
  await navigator.serviceWorker.register('sw.js');
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(CONFIG.VAPID_PUBLIC_KEY) });
  await store.savePush(sub);
  await store.saveProfile({ notify: true });
}
async function disablePush() {
  const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
  const sub = reg && (await reg.pushManager.getSubscription());
  if (sub) { await store.removePush(sub.endpoint); await sub.unsubscribe(); }
  await store.saveProfile({ notify: false });
}
function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
}
async function backup() {
  const stamp = today();
  const entries = data.entries.map((e) => ({ ...e, photo: e.photo ? `photos/${e.id}.jpg` : null }));
  const json = JSON.stringify({ exported_at: new Date().toISOString(), start_date: CONFIG.START_DATE,
    profiles: data.profiles.map((p) => ({ id: p.id, display_name: p.display_name })), entries, moods: data.moods, comments: data.comments }, null, 2);
  try {
    const JSZip = (await import('https://esm.sh/jszip@3.10.1')).default;
    const zip = new JSZip();
    zip.file('our-odyssey.json', json);
    for (const e of data.entries.filter((x) => x.photo)) {
      const blob = await (await fetch(await store.photoUrl(e.photo))).blob();
      zip.file(`photos/${e.id}.jpg`, blob);
    }
    download(await zip.generateAsync({ type: 'blob' }), `our-odyssey-${stamp}.zip`);
  } catch {
    download(new Blob([json], { type: 'application/json' }), `our-odyssey-${stamp}.json`);
    notice(tr('写真をまとめられなかったので、文章だけを保存しました', "Couldn't bundle the photos, so only the text was saved"));
  }
}
// バックアップのファイル（.zip か .json）から、なくなった記録を戻す。いまある記録は変えない。
// 戻せるのは自分が書いた分だけ（相手の分は、相手の端末から戻す）。
const ENTRY_COLS = ['id', 'section', 'category', 'title', 'body', 'date', 'lat', 'lng', 'author', 'created_at'];
const MOOD_COLS = ['id', 'user_id', 'date', 'level', 'note', 'shared', 'created_at'];
const COMMENT_COLS = ['id', 'entry_id', 'body', 'author', 'created_at'];
const only = (row, cols) => Object.fromEntries(cols.filter((c) => row[c] !== undefined).map((c) => [c, row[c]]));
function pickBackup() {
  return new Promise((res) => {
    const i = h('input', { type: 'file', accept: '.zip,.json,application/zip,application/json' });
    i.onchange = () => res(i.files[0] || null);
    i.click();
  });
}
async function restore() {
  const file = await pickBackup(); if (!file) return;
  let b, photoOf = async () => null;
  try {
    if (/\.json$/i.test(file.name)) b = JSON.parse(await file.text());
    else {
      const JSZip = (await import('https://esm.sh/jszip@3.10.1')).default;
      const zip = await JSZip.loadAsync(file);
      b = JSON.parse(await zip.file('our-odyssey.json').async('string'));
      photoOf = async (id) => { const f = zip.file(`photos/${id}.jpg`); return f ? new Blob([await f.async('arraybuffer')], { type: 'image/jpeg' }) : null; };
    }
    if (!Array.isArray(b?.entries)) throw new Error('entries');
  } catch {
    notice(tr('バックアップを読めませんでした', "Couldn't read the backup"), { text: tr('SAVE BACKUP で保存したファイル（.zip か .json）をえらんでください。', 'Choose a file saved with SAVE BACKUP (.zip or .json).') });
    return;
  }
  const has = (list) => new Set(list.map((x) => x.id));
  const hadE = has(data.entries), hadM = has(data.moods), hadC = has(data.comments);
  const lostE = b.entries.filter((e) => e?.id && !hadE.has(e.id));
  const lostM = (b.moods || []).filter((m) => m?.id && !hadM.has(m.id) && m.user_id === me());
  const myE = lostE.filter((e) => e.author === me());
  const alive = new Set([...hadE, ...myE.map((e) => e.id)]);
  const lostC = (b.comments || []).filter((c) => c?.id && !hadC.has(c.id));
  const myC = lostC.filter((c) => c.author === me() && alive.has(c.entry_id));
  const others = lostE.length - myE.length + lostC.filter((c) => c.author !== me()).length;
  const othersNote = others ? tr(`相手が書いた ${others}件は、相手の端末から戻してください。`, `${others} item(s) written by your partner have to be restored from their device.`) : '';
  if (!myE.length && !lostM.length && !myC.length) {
    notice(tr('戻すものはありませんでした', 'Nothing to restore'), { text: othersNote || tr('このバックアップの中身は、ぜんぶいまもあります。', 'Everything in this backup is still here.') });
    return;
  }
  const count = tr(`記録 ${myE.length}件、気分 ${lostM.length}件、ひとこと ${myC.length}件`, `${myE.length} entries, ${lostM.length} moods, ${myC.length} comments`);
  if (!(await ask(tr('なくなった記録を戻しますか？', 'Restore the missing items?'), { text: `${count}${tr('を戻します。いまある記録は変わりません。', ' will be restored. Nothing that exists now will change.')}${othersNote ? ` ${othersNote}` : ''}`, ok: 'RESTORE' }))) return;
  await act(async () => {
    for (const e of myE) {
      const blob = e.photo ? await photoOf(e.id) : null;
      await store.restore('entries', { ...only(e, ENTRY_COLS), photo: blob ? await store.uploadPhoto(blob) : null });
    }
    for (const m of lostM) await store.restore('moods', only(m, MOOD_COLS));
    for (const c of myC) await store.restore('comments', only(c, COMMENT_COLS));
  });
}
function settingsPage() {
  const my = data.profiles.find((p) => p.id === me()) || {};
  const name = h('input', { type: 'text', value: my.display_name || '' });
  const canPush = store.mode === 'supabase' && !!CONFIG.VAPID_PUBLIC_KEY;
  const toggle = h('input', { type: 'checkbox', disabled: !canPush, onchange: (ev) => act(ev.target.checked ? enablePush : disablePush) });
  if (canPush && my.notify && 'serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistration().then((r) => r?.pushManager.getSubscription()).then((s) => { toggle.checked = !!s; }).catch(() => {});
  }
  const backupBtn = h('button', { class: 'btn ghost', onclick: async () => { backupBtn.disabled = true; try { await backup(); } finally { backupBtn.disabled = false; } } }, 'SAVE BACKUP');
  const restoreBtn = h('button', { class: 'btn ghost', onclick: async () => { restoreBtn.disabled = true; try { await restore(); } finally { restoreBtn.disabled = false; } } }, 'RESTORE');
  return h('div', {}, pageNav(true), pageHead('Settings'),
    h('div', { class: 'cards' },
      h('section', { class: 'card' }, h('h2', {}, tr('名前', 'Name')),
        h('div', { class: 'row', style: 'flex-wrap: nowrap' }, name,
          h('button', { class: 'btn', onclick: () => act(() => store.saveProfile({ display_name: name.value.trim() })) }, 'SAVE'))),
      langCard(),
      themeCard(),
      store.mode === 'supabase' && passwordCard(),
      h('section', { class: 'card' }, h('h2', {}, tr('記念日の通知', 'Anniversary notifications')),
        h('label', { class: 'check' }, toggle, tr('この端末で通知を受け取る', 'Get notifications on this device')),
        h('p', { class: 'muted' }, canPush
          ? tr('月ごとの記念日・100日ごと・足した記念日の当日、朝8時ごろに届きます。iPhoneは「ホーム画面に追加」したアイコンから開いてオンにしてください。', 'Sent around 8 AM on monthly anniversaries, every 100 days, and on days you added. On iPhone, open the app from the Home Screen icon to turn this on.')
          : tr('通知は、本番の保存先と通知の鍵を設定すると使えるようになります。', 'Notifications work once the live database and notification keys are set up.'))),
      h('section', { class: 'card' }, h('h2', {}, tr('バックアップ', 'Backup')),
        h('p', {}, tr('書いた内容と写真を、ひとつのファイルにまとめてこの端末に保存します。', 'Saves everything you wrote and all photos into one file on this device.')),
        h('p', { class: 'muted' }, tr('RESTORE は、保存したファイルから、消えてしまった自分の記録だけを戻します。気分の記録は本人の分しか入らないので、ふたりそれぞれ保存してください。', 'RESTORE brings back only your own items that are missing, from a saved file. Mood records are saved per person, so each of you should save a backup.')),
        h('div', { class: 'row' }, backupBtn, restoreBtn)),
      store.mode === 'demo'
        ? h('section', { class: 'card' }, h('h2', {}, tr('お試しモード', 'Demo mode')),
          h('p', {}, tr(`いまは「${nameOf(me())}」として見ています。`, `You're viewing as ${nameOf(me())}.`)),
          h('div', { class: 'row' },
            h('button', { class: 'btn ghost', onclick: () => { store.switchUser(); refresh(); } }, `SWITCH TO ${partner() ? nameOf(partner().id) : 'PARTNER'}`),
            h('button', { class: 'link', onclick: async () => { if (await ask(tr('お試しで書いた内容をぜんぶ消しますか？', 'Delete everything written in demo mode?'), { ok: 'DELETE ALL', danger: true })) { localStorage.removeItem('our-odyssey-demo'); location.reload(); } } }, 'CLEAR DEMO DATA')))
        : h('section', { class: 'card' }, h('h2', {}, tr('ログアウト', 'Log out')),
          h('button', { class: 'btn ghost', onclick: async () => { await store.signOut(); location.hash = '#/'; start(); } }, 'LOG OUT'))));
}
function passwordCard() {
  const login = (store.user()?.email || '').split('@')[0];
  const input = (ac) => h('input', { type: 'password', autocomplete: ac, required: true });
  const cur = input('current-password'), next = input('new-password'), again = input('new-password');
  const msg = h('p', { class: 'muted', role: 'status' });
  const btn = h('button', { class: 'btn', type: 'submit' }, 'CHANGE PASSWORD');
  const form = h('form', { class: 'pwform', onsubmit: async (ev) => {
    ev.preventDefault(); msg.classList.remove('err'); msg.textContent = '';
    const fail = (t) => { msg.classList.add('err'); msg.textContent = t; };
    if (!cur.value || !next.value) return fail(tr('いまのパスワードと新しいパスワードを入れてください。', 'Enter your current and new password.'));
    if (next.value.length < 8) return fail(tr('新しいパスワードは8文字以上にしてください。', 'Use at least 8 characters.'));
    if (next.value !== again.value) return fail(tr('確認用のパスワードが一致しません。', "The two new passwords don't match."));
    btn.disabled = true;
    try {
      await store.changePassword(cur.value, next.value);
      cur.value = next.value = again.value = '';
      msg.textContent = tr('パスワードを変えました。次からは新しいパスワードでログインしてください。', 'Password changed. Use the new one next time you log in.');
    } catch (e) { fail(e.message || String(e)); } finally { btn.disabled = false; }
  } },
  // パスワード管理アプリが「どのアカウントのパスワードか」わかるように、ログイン名も入れておく（見えない）
  h('input', { type: 'text', autocomplete: 'username', value: login, hidden: true, readonly: true, 'aria-hidden': 'true', tabindex: '-1' }),
  h('label', {}, tr('いまのパスワード', 'Current password'), cur),
  h('label', {}, tr('新しいパスワード（8文字以上）', 'New password (8+ characters)'), next),
  h('label', {}, tr('新しいパスワード（もう一度）', 'New password (again)'), again),
  msg, h('div', { class: 'row' }, btn));
  return h('section', { class: 'card' }, h('h2', {}, tr('パスワード', 'Password')), form);
}
function themeCard() {
  let cur = theme.load();
  const swatch = (t) => { const c = theme.colors(t); return h('span', { class: 'sw', style: `background:${c.pink};box-shadow:inset 0 0 0 6px ${c.paper}, 0 0 0 1.5px ${c.navy}` }); };
  const chips = h('div', { class: 'chips theme-chips' });
  const slider = h('input', { type: 'range', min: '0', max: '359', step: '1', class: 'hue', 'aria-label': tr('色相', 'Hue') });
  const ink = h('input', { type: 'checkbox' });
  const set = (t, save) => {
    cur = { hue: Math.round(t.hue) % 360, ink: !!t.ink };
    theme.apply(cur, save);
    slider.value = String(cur.hue); ink.checked = cur.ink;
    chips.replaceChildren(...theme.PRESETS.map((p) => {
      const on = p.hue === cur.hue;
      return h('button', { type: 'button', class: `chip${on ? ' on' : ''}`, 'aria-pressed': String(on), onclick: () => set({ hue: p.hue, ink: cur.ink }, true) },
        swatch({ hue: p.hue, ink: cur.ink }), lang === 'en' ? p.en : p.jp);
    }));
  };
  slider.addEventListener('input', () => set({ hue: +slider.value, ink: cur.ink }, false));
  slider.addEventListener('change', () => set({ hue: +slider.value, ink: cur.ink }, true));
  ink.addEventListener('change', () => set({ hue: cur.hue, ink: ink.checked }, true));
  set(cur, false);
  return h('section', { class: 'card' }, h('h2', {}, tr('色のテーマ', 'Color theme')),
    chips,
    h('label', { class: 'hue-row' }, tr('色相をこまかく', 'Fine-tune hue'), slider),
    h('label', { class: 'check' }, ink, tr('文字の紺色もいっしょに変える', 'Shift the navy text color too')),
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'link', onclick: () => set({ hue: theme.PRESETS[0].hue, ink: false }, true) }, 'RESET')),
    h('p', { class: 'muted' }, tr('写真や花・コルクボードの色はそのまま。この端末だけに反映されます。', 'Photos, flowers and the cork board keep their colors. Applies to this device only.')));
}
function langCard() {
  const opt = (v, label) => h('button', { type: 'button', class: `chip${lang === v ? ' on' : ''}`, 'aria-pressed': String(lang === v), onclick: () => { setLang(v); tellSwLang(); draw(); } }, label);
  return h('section', { class: 'card' }, h('h2', {}, tr('表示の言語', 'Language')),
    h('div', { class: 'chips' }, opt('ja', 'JP + EN'), opt('en', 'ALL ENGLISH')),
    h('p', { class: 'muted' }, tr('ふだんは日本語で、ボタンだけ英語。「ALL ENGLISH」にすると全部英語になります（この端末だけ）。', 'ALL ENGLISH shows every screen in English; JP + EN shows Japanese text with English buttons. Applies to this device only.')));
}

export { settingsPage };
