// Likes の種類（食べ物・曲 など）。
import { lang } from './i18n.js?v=39';
import { data } from './state.js?v=39';

const LIKE_CATS = ['食べ物', '飲み物', '仕草', '場所', '曲', 'その他'];
const LIKE_CATS_EN = ['Food', 'Drinks', 'Habits', 'Places', 'Songs', 'Other'];
const OTHER_CAT = 'その他';
// 決まった種類は日本語で保存して、表示だけ英語にする（ふたりの言語設定がちがっても同じ種類になる）
const catLabel = (c) => { const i = LIKE_CATS.indexOf(c); return lang === 'en' && i >= 0 ? LIKE_CATS_EN[i] : c; };
const catKey = (label) => { const i = LIKE_CATS_EN.indexOf(label.trim()); return lang === 'en' && i >= 0 ? LIKE_CATS[i] : label; };

// 「その他」は自分で足した種類よりも後ろ、いちばん最後に並べる
const likeCats = () => [...new Set([...LIKE_CATS, ...data.entries.filter((e) => e.section === 'like' && e.category).map((e) => e.category)])]
  .filter((c) => c !== OTHER_CAT).concat(OTHER_CAT);

const SONG_CAT = '曲';
const isSong = (e) => e?.section === 'like' && e.category === SONG_CAT;

export { catLabel, catKey, likeCats, SONG_CAT, isSong };
