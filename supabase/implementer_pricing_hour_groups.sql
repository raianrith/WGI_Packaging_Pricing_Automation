-- Maps task implementer labels (task_implementer) to pricing hour buckets.
-- Run in Supabase SQL Editor after other packaging migrations.

create table if not exists public.implementer_pricing_hour_groups (
  id uuid primary key default gen_random_uuid(),
  implementer_name text not null,
  hour_group text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (implementer_name)
);

alter table public.implementer_pricing_hour_groups
  add constraint implementer_pricing_hour_groups_hour_group_check
  check (hour_group in (
    'client_services',
    'copy',
    'design',
    'web_dev',
    'video',
    'data',
    'paid_media',
    'hubspot',
    'other'
  ));

create index if not exists implementer_pricing_hour_groups_name_idx
  on public.implementer_pricing_hour_groups (implementer_name);

-- Keep updated_at fresh on change (reuses public schema if a generic trigger exists; else inline)
create or replace function public.set_implementer_pricing_hour_groups_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tr_implementer_pricing_hour_groups_updated_at
  on public.implementer_pricing_hour_groups;

create trigger tr_implementer_pricing_hour_groups_updated_at
  before update on public.implementer_pricing_hour_groups
  for each row execute procedure public.set_implementer_pricing_hour_groups_updated_at();

comment on table public.implementer_pricing_hour_groups is
  'Maps task_implementer string to solution_tier_pricing hour column group.';

-- Seed (idempotent)
insert into public.implementer_pricing_hour_groups (implementer_name, hour_group) values
  ('CM', 'client_services'),
  ('CSM', 'client_services'),
  ('Interviewer', 'client_services'),
  ('Lead Creative', 'copy'),
  ('Lead Strategist', 'client_services'),
  ('Ops', 'web_dev'),
  ('Proofer', 'copy'),
  ('Strategist', 'web_dev'),
  ('Web Dev', 'web_dev')
on conflict (implementer_name) do update
  set
    hour_group = excluded.hour_group,
    updated_at = now();

alter table public.implementer_pricing_hour_groups enable row level security;

drop policy if exists "Allow read implementer_pricing_hour_groups" on public.implementer_pricing_hour_groups;
drop policy if exists "Allow insert implementer_pricing_hour_groups" on public.implementer_pricing_hour_groups;
drop policy if exists "Allow update implementer_pricing_hour_groups" on public.implementer_pricing_hour_groups;
drop policy if exists "Allow delete implementer_pricing_hour_groups" on public.implementer_pricing_hour_groups;

create policy "Allow read implementer_pricing_hour_groups"
  on public.implementer_pricing_hour_groups for select using (true);
create policy "Allow insert implementer_pricing_hour_groups"
  on public.implementer_pricing_hour_groups for insert with check (true);
create policy "Allow update implementer_pricing_hour_groups"
  on public.implementer_pricing_hour_groups for update using (true);
create policy "Allow delete implementer_pricing_hour_groups"
  on public.implementer_pricing_hour_groups for delete using (true);
