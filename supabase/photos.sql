-- 過ごした場所・行きたいところに、写真を何枚もつけられるようにする欄。
-- 表紙の1枚は今までどおり photo に入り、ほかの写真の置き場所（photos の中の名前）をここに並べて覚えておく。
-- すでに schema.sql を実行済みのデータベースに足すためのもの。SQL Editor に貼りつけて Run する。何回実行しても大丈夫。
-- ※ サイトを更新する前に、これを先に実行しておくこと（実行していないと、「ほかの写真」を足して保存したときにエラーになる。
--    ほかの写真を足さなければ、今までどおり保存できる）。
alter table public.entries add column if not exists more_photos jsonb;
-- 足した欄を、サイトからすぐ使えるようにする（Supabase が覚えている表の形を読みなおさせる）
notify pgrst, 'reload schema';
