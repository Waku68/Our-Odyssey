-- Likes の「曲」で、足すときにえらんだ曲を覚えておく欄。
-- すでに schema.sql を実行済みのデータベースに足すためのもの。SQL Editor に貼りつけて Run する。何回実行しても大丈夫。
-- ※ サイトを更新する前に、これを先に実行しておくこと（実行していないと、曲をえらんで保存したときにエラーになる）。
alter table public.entries add column if not exists song jsonb;
-- 足した欄を、サイトからすぐ使えるようにする（Supabase が覚えている表の形を読みなおさせる）
notify pgrst, 'reload schema';
