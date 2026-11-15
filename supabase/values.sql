-- Values（価値観）のお題を、ふたりどちらでも「名前をなおす」「お題ごと消す」ことができるようにする設定。
-- すでに schema.sql を実行済みのデータベースに足すためのもの。SQL Editor に貼りつけて Run する。何回実行しても大丈夫。
-- ※ 実行していなくても壊れはしない（相手も答えたお題の RENAME / DELETE TOPIC が「書いた本人だけ」のエラーで止まり、何も変わらない）。

-- 1) value の記録は、ふたりどちらでもなおせる・消せる
drop policy if exists "entries update value topic" on public.entries;
create policy "entries update value topic" on public.entries for update to authenticated
  using (section = 'value') with check (section = 'value');
drop policy if exists "entries delete value topic" on public.entries;
create policy "entries delete value topic" on public.entries for delete to authenticated
  using (section = 'value');

-- 2) ただし相手の答えは、お題の名前（title）しか変えられない。ほかの欄を変えようとしても、元のままにもどす
create or replace function public.value_topic_only() returns trigger
language plpgsql set search_path = public as $$
declare t text := new.title;
begin
  if old.section = 'value' and auth.uid() is not null and old.author is distinct from auth.uid() then
    new := old;
    new.title := t;
  end if;
  return new;
end $$;
drop trigger if exists value_topic_only on public.entries;
create trigger value_topic_only before update on public.entries
  for each row execute function public.value_topic_only();
