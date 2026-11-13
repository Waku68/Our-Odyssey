// 日付の計算と表示。日付は 'YYYY-MM-DD' の文字で持つ。
import { lang, tr } from './i18n.js?v=38';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; };
const today = () => { const d = new Date(); return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
const utc = (s) => { const { y, m, d } = parse(s); return Date.UTC(y, m - 1, d); };
export const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
const dots = (s) => s.replaceAll('-', '.');
const md = (s) => { const { m, d } = parse(s); return tr(`${m}月${d}日`, `${MONTHS[m - 1]} ${d}`); };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// start から数えて k か月後の日付（月末は丸める）
function addMonths(start, k) {
  const s = parse(start);
  const y = s.y + Math.floor((s.m - 1 + k) / 12);
  const m = ((s.m - 1 + k) % 12) + 1;
  return ymd(y, m, Math.min(s.d, lastDay(y, m)));
}
// 次に来る「月ごとの記念日」。今日が当日なら今日を返す。
export function nextMonthly(start, t) {
  const s = parse(start), n = parse(t);
  let months = (n.y - s.y) * 12 + (n.m - s.m);
  if (addMonths(start, months) < t) months++;
  return { date: addMonths(start, months), months };
}
function nextYearly(start, t) {
  const s = parse(start), n = parse(t);
  let years = n.y - s.y;
  if (addMonths(start, years * 12) < t) years++;
  return { date: addMonths(start, years * 12), years };
}
export const spanLabel = (months) => {
  const y = Math.floor(months / 12), m = months % 12;
  if (lang === 'en') {
    if (m === 0) return plural(y, 'year');
    return y ? `${plural(y, 'year')} ${plural(m, 'month')}` : plural(m, 'month');
  }
  if (m === 0) return `${y}周年`;
  return months > 12 ? `${y}年${m}ヶ月` : `${months}ヶ月`;
};

function addDays(s, n) {
  const d = new Date(utc(s) + n * 864e5);
  return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export { MONTHS, WEEK, pad, ymd, parse, today, utc, dots, md, plural, lastDay, addMonths, nextYearly, addDays };
