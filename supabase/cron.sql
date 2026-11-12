-- 毎朝8時（日本時間）に通知の関数を呼ぶ設定。
-- 先に Database > Extensions で「pg_cron」と「pg_net」を有効にしてから、
-- 下の <プロジェクトID> と <CRON_SECRET> を自分の値に書きかえて SQL Editor で実行します。
-- （23:00 UTC = 翌日 8:00 日本時間）

select cron.schedule(
  'our-odyssey-notify',
  '0 23 * * *',
  $$
  select net.http_post(
    url := 'https://<プロジェクトID>.supabase.co/functions/v1/notify',
    headers := '{"Content-Type": "application/json", "x-cron-secret": "<CRON_SECRET>"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- 止めたいとき： select cron.unschedule('our-odyssey-notify');
