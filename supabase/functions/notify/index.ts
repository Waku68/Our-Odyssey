// 記念日の朝に通知を送る Supabase Edge Function。
// 必要な Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (例 mailto:you@example.com),
//                 CRON_SECRET, START_DATE (例 2023-01-28)
// 「Verify JWT」はオフにして、x-cron-secret ヘッダーで守ります。
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const parse = (s: string) => { const [y, m, d] = s.split("-").map(Number); return { y, m, d }; };
const utc = (s: string) => { const { y, m, d } = parse(s); return Date.UTC(y, m - 1, d); };
const days = (a: string, b: string) => Math.round((utc(b) - utc(a)) / 864e5);
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
function addMonths(start: string, k: number) {
  const s = parse(start);
  const y = s.y + Math.floor((s.m - 1 + k) / 12);
  const m = ((s.m - 1 + k) % 12) + 1;
  return ymd(y, m, Math.min(s.d, lastDay(y, m)));
}
const span = (months: number) =>
  months % 12 === 0 ? `${months / 12}周年` : months > 12 ? `${Math.floor(months / 12)}年${months % 12}ヶ月` : `${months}ヶ月`;

// 今日（日本時間）に当てはまる記念日のメッセージを集める
export function messagesFor(today: string, start: string, custom: { title: string; date: string }[]) {
  const out: string[] = [];
  const t = parse(today), s = parse(start);
  const n = days(start, today);
  const months = (t.y - s.y) * 12 + (t.m - s.m);
  if (months > 0 && addMonths(start, months) === today) out.push(`今日は ${span(months)} の記念日です！`);
  if (n > 0 && n % 100 === 0) out.push(`今日で付き合って ${n}日です！`);
  for (const c of custom) {
    const cd = parse(c.date);
    const years = t.y - cd.y;
    if (years > 0 && addMonths(c.date, years * 12) === today) out.push(`今日は「${c.title}」から ${years}年です！`);
    const cn = days(c.date, today);
    if (cn > 0 && cn % 100 === 0) out.push(`今日は「${c.title}」から ${cn}日です！`);
    if (cn === 0) out.push(`今日は「${c.title}」の日です！`);
  }
  return out;
}

Deno.serve(async (req) => {
    if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) {
      return new Response("forbidden", { status: 403 });
    }
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const jst = new Date(Date.now() + 9 * 3600 * 1000);
    const today = ymd(jst.getUTCFullYear(), jst.getUTCMonth() + 1, jst.getUTCDate());
    const start = Deno.env.get("START_DATE") ?? "2023-01-28";

    const { data: custom } = await sb.from("entries").select("title,date").eq("section", "anniversary").not("date", "is", null);
    const msgs = messagesFor(today, start, custom ?? []);
    if (!msgs.length) return Response.json({ today, sent: 0, reason: "no anniversary today" });

    const { data: users } = await sb.from("profiles").select("id").eq("notify", true);
    const ids = (users ?? []).map((u) => u.id);
    if (!ids.length) return Response.json({ today, sent: 0, reason: "nobody wants notifications" });
    const { data: subs } = await sb.from("push_subscriptions").select("*").in("user_id", ids);

    webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT")!, Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);
    let sent = 0;
    for (const s of subs ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: "Our Odyssey", body: msgs.join("\n") }),
        );
        sent++;
      } catch (e) {
        // 期限切れの宛先は片づける
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await sb.from("push_subscriptions").delete().eq("id", s.id);
      }
    }
    return Response.json({ today, sent, messages: msgs });
  });
