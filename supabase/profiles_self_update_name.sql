-- Allow signed-in users to edit their own display name on public.profiles.
-- Non-admins cannot change is_admin, email, or id.

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create or replace function public.profiles_guard_self_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.is_app_admin() then
    new.is_admin := old.is_admin;
    new.email := old.email;
    new.id := old.id;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_self_update on public.profiles;
create trigger profiles_guard_self_update
  before update on public.profiles
  for each row execute function public.profiles_guard_self_update();
