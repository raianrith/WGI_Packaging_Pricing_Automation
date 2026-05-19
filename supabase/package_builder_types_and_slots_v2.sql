-- Build-a-Package v2: package types → tier slots with optional ceilings, tier count limits, and allowed vault tiers.
-- Run after package_builder_slot_templates.sql (and uuid migration if applicable).

-- 1) Package types (e.g. Market Position Guide)
create table if not exists public.package_builder_package_types (
  id uuid primary key default gen_random_uuid(),
  sort_order int not null,
  name text not null,
  updated_at timestamptz not null default now(),
  unique (sort_order)
);

comment on table public.package_builder_package_types is
  'Top-level “package type” for Build a Package; each type has its own tier slots.';

-- 2) Extend slot templates
alter table public.package_builder_slot_templates
  add column if not exists package_type_id uuid references public.package_builder_package_types (id) on delete cascade;

alter table public.package_builder_slot_templates
  add column if not exists solution_tier_limit int;

alter table public.package_builder_slot_templates
  alter column hour_ceiling drop not null;

alter table public.package_builder_slot_templates
  alter column price_ceiling drop not null;

-- Backfill a default package type and attach existing slots
insert into public.package_builder_package_types (sort_order, name)
select 1, 'General'
where not exists (select 1 from public.package_builder_package_types);

update public.package_builder_slot_templates s
set package_type_id = (select id from public.package_builder_package_types order by sort_order limit 1)
where s.package_type_id is null;

alter table public.package_builder_slot_templates
  alter column package_type_id set not null;

-- Per-type slot order (replaces global unique on sort_order)
alter table public.package_builder_slot_templates
  drop constraint if exists package_builder_slot_templates_sort_order_key;

drop index if exists public.package_builder_slot_templates_sort_order_ux;

create unique index if not exists package_builder_slot_templates_type_sort_ux
  on public.package_builder_slot_templates (package_type_id, sort_order);

-- 3) Which vault solution tiers each slot may include (empty = all tiers allowed)
create table if not exists public.package_builder_slot_allowed_tiers (
  slot_id uuid not null references public.package_builder_slot_templates (id) on delete cascade,
  solution_tier_id text not null,
  primary key (slot_id, solution_tier_id)
);

comment on table public.package_builder_slot_allowed_tiers is
  'Allow-list of vault solution_tier_id values for a Build-a-Package slot; no rows means any tier is allowed.';

-- RLS
alter table public.package_builder_package_types enable row level security;
alter table public.package_builder_slot_allowed_tiers enable row level security;

drop policy if exists "Allow public read package_builder_package_types" on public.package_builder_package_types;
create policy "Allow public read package_builder_package_types"
  on public.package_builder_package_types for select using (true);
drop policy if exists "Allow insert package_builder_package_types" on public.package_builder_package_types;
drop policy if exists "Allow update package_builder_package_types" on public.package_builder_package_types;
drop policy if exists "Allow delete package_builder_package_types" on public.package_builder_package_types;
create policy "Allow insert package_builder_package_types"
  on public.package_builder_package_types for insert with check (true);
create policy "Allow update package_builder_package_types"
  on public.package_builder_package_types for update using (true);
create policy "Allow delete package_builder_package_types"
  on public.package_builder_package_types for delete using (true);

drop policy if exists "Allow public read package_builder_slot_allowed_tiers"
  on public.package_builder_slot_allowed_tiers;
create policy "Allow public read package_builder_slot_allowed_tiers"
  on public.package_builder_slot_allowed_tiers for select using (true);
drop policy if exists "Allow insert package_builder_slot_allowed_tiers"
  on public.package_builder_slot_allowed_tiers;
drop policy if exists "Allow update package_builder_slot_allowed_tiers"
  on public.package_builder_slot_allowed_tiers;
drop policy if exists "Allow delete package_builder_slot_allowed_tiers"
  on public.package_builder_slot_allowed_tiers;
create policy "Allow insert package_builder_slot_allowed_tiers"
  on public.package_builder_slot_allowed_tiers for insert with check (true);
create policy "Allow update package_builder_slot_allowed_tiers"
  on public.package_builder_slot_allowed_tiers for update using (true);
create policy "Allow delete package_builder_slot_allowed_tiers"
  on public.package_builder_slot_allowed_tiers for delete using (true);

notify pgrst, 'reload schema';
