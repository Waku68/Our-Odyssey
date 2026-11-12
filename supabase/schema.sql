-- Our Odyssey のデータベース設定。
-- Supabase の SQL Editor にぜんぶ貼りつけて、一度だけ実行します。

-- 1) テーブル ---------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null default '',
  notify boolean not null default false
);

create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  section text not null check (section in ('place','like','wish','gift','dislike','value','anniversary','hero')),
  category text,
  title text not null default '',
  body text not null default '',
  date date,
  lat double precision,
  lng double precision,
  photo text,
  author uuid not null default auth.uid() references auth.users,
  created_at timestamptz not null default now()
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.entries on delete cascade,
  body text not null,
  author uuid not null default auth.uid() references auth.users,
  created_at timestamptz not null default now()
);

create table if not exists public.moods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users,
  date date not null,
  level int not null check (level between 1 and 5),
  note text not null default '',
  shared boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- 2) ユーザーが作られたらプロフィールも作る -----------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id, display_name)
select id, split_part(email, '@', 1) from auth.users
on conflict (id) do nothing;

-- 3) だれが何をできるか（RLS） ------------------------------------------------
alter table public.profiles enable row level security;
alter table public.entries enable row level security;
alter table public.comments enable row level security;
alter table public.moods enable row level security;
alter table public.push_subscriptions enable row level security;

-- プロフィール：ログインした2人は読める。書けるのは自分の分だけ。
create policy "profiles read" on public.profiles for select to authenticated using (true);
create policy "profiles insert own" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "profiles update own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- 投稿：2人とも読める・足せる。なおす／消すのは書いた本人だけ。
-- 例外：「行きたいところ」は、どちらでも「行った！」で「過ごした場所」に移せる。
create policy "entries read" on public.entries for select to authenticated using (true);
create policy "entries insert own" on public.entries for insert to authenticated with check (author = auth.uid());
create policy "entries update own or wish" on public.entries for update to authenticated
  using (author = auth.uid() or section = 'wish')
  with check (author = auth.uid() or section = 'place');
create policy "entries delete own" on public.entries for delete to authenticated using (author = auth.uid());

-- ひとこと：2人とも読める・書ける。消せるのは本人だけ。
create policy "comments read" on public.comments for select to authenticated using (true);
create policy "comments insert own" on public.comments for insert to authenticated with check (author = auth.uid());
create policy "comments delete own" on public.comments for delete to authenticated using (author = auth.uid());

-- メンタルの記録：本人だけ。shared を入れた記録だけ相手も読める。
create policy "moods read own or shared" on public.moods for select to authenticated using (user_id = auth.uid() or shared);
create policy "moods insert own" on public.moods for insert to authenticated with check (user_id = auth.uid());
create policy "moods update own" on public.moods for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "moods delete own" on public.moods for delete to authenticated using (user_id = auth.uid());

-- 通知の宛先：本人だけ。
create policy "push own" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 4) 写真の置き場（非公開） ---------------------------------------------------
insert into storage.buckets (id, name, public) values ('photos', 'photos', false)
on conflict (id) do nothing;

create policy "photos read" on storage.objects for select to authenticated using (bucket_id = 'photos');
create policy "photos upload" on storage.objects for insert to authenticated with check (bucket_id = 'photos');
create policy "photos delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and owner = auth.uid());
