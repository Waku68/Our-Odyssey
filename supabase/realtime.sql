-- 相手が書いたものをすぐ画面に出すための設定（Supabase の Realtime）。
-- Supabase の SQL Editor に貼りつけて Run するだけ。何回実行しても大丈夫。
do $$
declare t text;
begin
  foreach t in array array['entries', 'comments', 'moods', 'profiles'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
