-- 「自分だけの写真」（Secret）を使えるようにする設定。
-- すでに schema.sql を実行済みのデータベースに足すためのもの。SQL Editor に貼りつけて Run する。何回実行しても大丈夫。
-- ※ サイトを更新する前に、これを先に実行しておくこと（実行していないと、Secret に写真を載せようとしてもエラーで止まるだけで、相手に見えることはない）。

-- 1) 記録の種類に secret を足す
-- （前の決まりの名前がちがっていても外せるように、section を見ている決まりをさがして外す）
do $$
declare c text;
begin
  for c in select conname from pg_constraint
    where conrelid = 'public.entries'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%section%'
  loop
    execute format('alter table public.entries drop constraint %I', c);
  end loop;
end $$;
alter table public.entries add constraint entries_section_check
  check (section in ('place','like','wish','gift','dislike','value','anniversary','hero','secret'));

-- 2) secret の記録は、書いた本人だけが読める（相手には一覧にも出ない）
drop policy if exists "entries read" on public.entries;
create policy "entries read" on public.entries for select to authenticated
  using (section <> 'secret' or author = auth.uid());

-- ひとことも、読める記録についたものだけ読める
drop policy if exists "comments read" on public.comments;
create policy "comments read" on public.comments for select to authenticated
  using (exists (select 1 from public.entries e where e.id = entry_id));

-- 3) 自分だけの写真の置き場。ふたりで使う photos とは別にして、本人のフォルダしか読み書きできない
insert into storage.buckets (id, name, public) values ('secret', 'secret', false)
on conflict (id) do nothing;

drop policy if exists "secret read own" on storage.objects;
drop policy if exists "secret upload own" on storage.objects;
drop policy if exists "secret delete own" on storage.objects;
create policy "secret read own" on storage.objects for select to authenticated
  using (bucket_id = 'secret' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "secret upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'secret' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "secret delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'secret' and (storage.foldername(name))[1] = auth.uid()::text);
