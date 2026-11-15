// Likes の「曲」をさがす Supabase Edge Function（Apple Music の検索を、サイトの代わりに呼ぶ）。
// iPhone の Safari から itunes.apple.com/search を呼ぶと、ミュージックのアプリを開く宛先（musics://）へ
// 飛ばされて結果を読めない。サーバーから呼べば飛ばされないので、ここで呼んで結果をそのまま返す。
// 「Verify JWT」はオンのまま（ログインした2人だけが使える）。Secrets はいらない。
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let term = "";
  try { term = String((await req.json()).term ?? "").trim().slice(0, 100); } catch { /* 空のまま */ }
  if (!term) return Response.json({ results: [] }, { headers: cors });
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&country=jp&lang=ja_jp&media=music&entity=song&limit=8`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return Response.json({ error: `itunes ${r.status}` }, { status: 502, headers: cors });
    const j = await r.json();
    return Response.json({ results: j.results ?? [] }, { headers: cors });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 502, headers: cors });
  }
});
