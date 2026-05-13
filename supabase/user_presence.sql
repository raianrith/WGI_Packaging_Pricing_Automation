-- Heartbeat table for "who is active in the app right now" admin views.
-- Run after profiles_and_auth.sql so public.is_app_admin() already exists.

create table if not exists public.user_presence (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  current_path text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_presence_last_seen_idx
  on public.user_presence (last_seen_at desc);

create or replace function public.set_user_presence_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_presence_set_updated_at on public.user_presence;
create trigger user_presence_set_updated_at
  before update on public.user_presence
  for each row execute function public.set_user_presence_updated_at();

comment on table public.user_presence is
  'One heartbeat row per signed-in user so admins can see who is currently active in the app.';

alter table public.user_presence enable row level security;

drop policy if exists "user_presence_select_self_or_admin" on public.user_presence;
create policy "user_presence_select_self_or_admin"
  on public.user_presence for select
  to authenticated
  using (user_id = auth.uid() or public.is_app_admin());

drop policy if exists "user_presence_insert_self" on public.user_presence;
create policy "user_presence_insert_self"
  on public.user_presence for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "user_presence_update_self" on public.user_presence;
create policy "user_presence_update_self"
  on public.user_presence for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "user_presence_delete_self_or_admin" on public.user_presence;
create policy "user_presence_delete_self_or_admin"
  on public.user_presence for delete
  to authenticated
  using (user_id = auth.uid() or public.is_app_admin());

grant select, insert, update, delete on public.user_presence to authenticated;
grant all on public.user_presence to service_role;
