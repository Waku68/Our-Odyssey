// 入口。色のテーマを当て、ページを登録して、起動する。
// ※ js/ の中の import と index.html の ?v= は、ぜんぶ同じ数字にそろえる（README の「つくり」を参照）。
import * as theme from './theme.js?v=39';
import { setPages, start } from './shell.js?v=39';
import { home } from './pages/home.js?v=39';
import { mapPage } from './pages/map.js?v=39';
import { moodPage } from './pages/mood.js?v=39';
import { morePage, sectionPage } from './pages/more.js?v=39';
import { valuesPage } from './pages/values.js?v=39';
import { annivPage } from './pages/anniv.js?v=39';
import { settingsPage } from './pages/settings.js?v=39';

theme.apply();
setPages({
  home, map: mapPage, mood: moodPage, more: morePage,
  // MORE の下のページ（#/more/◯◯）
  sub: { like: () => sectionPage('like'), gift: () => sectionPage('gift'), dislike: () => sectionPage('dislike'),
    values: valuesPage, anniv: annivPage, settings: settingsPage },
});
start();
