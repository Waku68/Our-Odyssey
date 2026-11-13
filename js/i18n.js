// 言語（ふだんは日本語＋ボタンだけ英語、設定で全部英語）。この端末だけに覚えておく。

const LANG_KEY = 'our-odyssey-lang';
let lang = (() => { try { return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'ja'; } catch { return 'ja'; } })();
const tr = (ja, en) => (lang === 'en' ? en : ja);
document.documentElement.lang = lang;
function setLang(v) {
  lang = v === 'en' ? 'en' : 'ja';
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* 保存できなくても今回は切りかえる */ }
  document.documentElement.lang = lang;
}

export { lang, tr, setLang };
