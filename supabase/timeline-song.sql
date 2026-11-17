-- 年表に置く曲（section = 'song'）を保存できるようにする。
-- すでに schema.sql を実行済みのデータベースに足すためのもの。SQL Editor に貼りつけて Run する。何回実行しても大丈夫。
-- ※ サイトを更新する前に、これを先に実行しておくこと（実行していないと、年表に曲を足したときにエラーになる）。
-- ※ 曲をえらんで覚えておく欄（song）を使うので、まだなら song.sql も実行しておく。
alter table public.entries add column if not exists song jsonb;
-- section に入れてよい値の決まりを、'song' も入れて作りなおす（決まりの名前はデータベースによってちがうので、さがして消す）
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.entries'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%section%'
  loop
    execute format('alter table public.entries drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.entries add constraint entries_section_check
  check (section in ('place','like','wish','gift','dislike','value','anniversary','hero','secret','song'));
-- 変えた決まりを、サイトからすぐ使えるようにする
notify pgrst, 'reload schema';
