// 入口。色のテーマを当て、ページを登録して、起動する。
// ※ js/ の中の import と index.html の ?v= は、ぜんぶ同じ数字にそろえる（README の「つくり」を参照）。
import * as theme from './theme.js?v=72';
import { setPages, start } from './shell.js?v=72';
import { home } from './pages/home.js?v=72';
import { mapPage } from './pages/map.js?v=72';
import { moodPage } from './pages/mood.js?v=72';
import { morePage, sectionPage } from './pages/more.js?v=72';
import { valuesPage } from './pages/values.js?v=72';
import { annivPage } from './pages/anniv.js?v=72';
import { settingsPage } from './pages/settings.js?v=72';

// 2本指で縮めたとき、画面より小さくはならないようにする（iPhone で縮めすぎて外が見えてから戻る動きを止める）。
// 拡大と、拡大したところから元の大きさまで戻すのはそのまま。地図・気分・写真などの中のピンチは、それぞれが自分で受けとる。
const atFull = () => (window.visualViewport?.scale ?? 1) <= 1.01;
let pinchGap = 0;
const gapOf = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
document.addEventListener('touchstart', (ev) => { pinchGap = ev.touches.length === 2 ? gapOf(ev.touches) : 0; }, { passive: true });
document.addEventListener('touchmove', (ev) => {
  if (ev.touches.length !== 2 || !pinchGap) return;
  const gap = gapOf(ev.touches);
  if (gap < pinchGap && atFull() && ev.cancelable) ev.preventDefault();
  pinchGap = gap;
}, { passive: false });
document.addEventListener('gesturechange', (ev) => { if (ev.scale < 1 && atFull()) ev.preventDefault(); }, { passive: false }); // Safari

theme.apply();
setPages({
  home, map: mapPage, mood: moodPage, more: morePage,
  // MORE の下のページ（#/more/◯◯）
  sub: { like: () => sectionPage('like'), gift: () => sectionPage('gift'), dislike: () => sectionPage('dislike'), secret: () => sectionPage('secret'),
    values: valuesPage, anniv: annivPage, settings: settingsPage },
});
start();
