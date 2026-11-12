-- 2026-11-13 の追加。Supabase の SQL Editor にぜんぶ貼りつけて、一度だけ実行します（何度実行しても大丈夫）。
-- 1) 相手の投稿も、2人とも編集・削除できるようにする
-- 2) 相手が載せた写真も、差しかえ・削除のときに消せるようにする
-- 3) 「好きなもの」にリンク（曲の Spotify・YouTube・Apple Music など）を保存する欄を足す

drop policy if exists "entries update own or wish" on public.entries;
drop policy if exists "entries update both" on public.entries;
create policy "entries update both" on public.entries for update to authenticated using (true) with check (true);

drop policy if exists "entries delete own" on public.entries;
drop policy if exists "entries delete both" on public.entries;
create policy "entries delete both" on public.entries for delete to authenticated using (true);

drop policy if exists "photos delete own" on storage.objects;
drop policy if exists "photos delete both" on storage.objects;
create policy "photos delete both" on storage.objects for delete to authenticated using (bucket_id = 'photos');

alter table public.entries add column if not exists link text;

-- 新しい欄をすぐ使えるように、API の表の情報を読みなおさせる
notify pgrst, 'reload schema';
