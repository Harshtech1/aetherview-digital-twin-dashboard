create extension if not exists pgcrypto;

create table if not exists public.captures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'ready')),
  source_folder text not null default 'raw_uploads' check (source_folder in ('raw_uploads')),
  output_folder text not null default 'optimized_sogs' check (output_folder in ('optimized_sogs')),
  original_filename text,
  original_asset_id text,
  optimized_asset_id text,
  content_type text,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists captures_user_id_created_at_idx
  on public.captures (user_id, created_at desc);

create index if not exists captures_status_idx
  on public.captures (status);

alter table public.captures enable row level security;

drop policy if exists "captures_select_own" on public.captures;
create policy "captures_select_own"
  on public.captures
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "captures_insert_own" on public.captures;
create policy "captures_insert_own"
  on public.captures
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "captures_update_own" on public.captures;
create policy "captures_update_own"
  on public.captures
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "captures_delete_own" on public.captures;
create policy "captures_delete_own"
  on public.captures
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
