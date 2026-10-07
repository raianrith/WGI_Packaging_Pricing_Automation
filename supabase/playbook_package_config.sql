-- Admin → Assemblies → Playbook Packages: which configurable packages and solution tiers
-- proposal builders may bundle into a Playbook Package. Single row (id = 'default').
-- When a `limit_*` flag is false, every item of that kind is allowed.

create table if not exists public.playbook_package_config (
  id text primary key default 'default' check (id = 'default'),
  limit_package_types boolean not null default false,
  allowed_package_type_ids text[] not null default '{}',
  limit_solution_tiers boolean not null default false,
  allowed_solution_tier_ids text[] not null default '{}',
  updated_by_email text null,
  updated_at timestamptz not null default now()
);

comment on table public.playbook_package_config is
  'Allow-lists for Playbook Package building in Proposal Builder (configurable package types + solution tiers).';

insert into public.playbook_package_config (id) values ('default') on conflict (id) do nothing;

alter table public.playbook_package_config enable row level security;

drop policy if exists "Allow read playbook_package_config" on public.playbook_package_config;
drop policy if exists "Allow admin insert playbook_package_config" on public.playbook_package_config;
drop policy if exists "Allow admin update playbook_package_config" on public.playbook_package_config;

create policy "Allow read playbook_package_config"
  on public.playbook_package_config for select to authenticated using (true);

create policy "Allow admin insert playbook_package_config"
  on public.playbook_package_config for insert to authenticated
  with check (public.is_app_admin());

create policy "Allow admin update playbook_package_config"
  on public.playbook_package_config for update to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

create or replace function public.set_playbook_package_config_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists playbook_package_config_updated_at on public.playbook_package_config;
create trigger playbook_package_config_updated_at
before update on public.playbook_package_config
for each row execute function public.set_playbook_package_config_updated_at();

notify pgrst, 'reload schema';
