-- Locked preselected vault tiers + pick-N choice buckets per Build-a-Package slot.
-- Run after package_builder_types_and_slots_v2.sql.

-- Always-included solution tiers (min qty locked; users may increase).
create table if not exists public.package_builder_slot_preselected_tiers (
  slot_id uuid not null references public.package_builder_slot_templates (id) on delete cascade,
  solution_tier_id text not null,
  default_qty int not null default 1 check (default_qty >= 1),
  primary key (slot_id, solution_tier_id)
);

comment on table public.package_builder_slot_preselected_tiers is
  'Vault tiers always included when building from this slot; default_qty is the locked minimum quantity.';

-- Named choice buckets: pick N distinct members from the member list.
create table if not exists public.package_builder_slot_buckets (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.package_builder_slot_templates (id) on delete cascade,
  name text not null,
  pick_count int not null default 1 check (pick_count >= 1),
  sort_order int not null default 1
);

create index if not exists package_builder_slot_buckets_slot_sort_idx
  on public.package_builder_slot_buckets (slot_id, sort_order);

comment on table public.package_builder_slot_buckets is
  'Pick-N choice groups for a Build-a-Package slot; members may be any vault solution tier.';

create table if not exists public.package_builder_slot_bucket_members (
  bucket_id uuid not null references public.package_builder_slot_buckets (id) on delete cascade,
  solution_tier_id text not null,
  sort_order int not null default 1,
  primary key (bucket_id, solution_tier_id)
);

comment on table public.package_builder_slot_bucket_members is
  'Vault solution_tier_id options inside a slot choice bucket.';

-- RLS
alter table public.package_builder_slot_preselected_tiers enable row level security;
alter table public.package_builder_slot_buckets enable row level security;
alter table public.package_builder_slot_bucket_members enable row level security;

drop policy if exists "Allow read package_builder_slot_preselected_tiers"
  on public.package_builder_slot_preselected_tiers;
create policy "Allow read package_builder_slot_preselected_tiers"
  on public.package_builder_slot_preselected_tiers for select using (true);
drop policy if exists "Allow insert package_builder_slot_preselected_tiers"
  on public.package_builder_slot_preselected_tiers;
drop policy if exists "Allow update package_builder_slot_preselected_tiers"
  on public.package_builder_slot_preselected_tiers;
drop policy if exists "Allow delete package_builder_slot_preselected_tiers"
  on public.package_builder_slot_preselected_tiers;
create policy "Allow insert package_builder_slot_preselected_tiers"
  on public.package_builder_slot_preselected_tiers for insert with check (true);
create policy "Allow update package_builder_slot_preselected_tiers"
  on public.package_builder_slot_preselected_tiers for update using (true);
create policy "Allow delete package_builder_slot_preselected_tiers"
  on public.package_builder_slot_preselected_tiers for delete using (true);

drop policy if exists "Allow read package_builder_slot_buckets"
  on public.package_builder_slot_buckets;
create policy "Allow read package_builder_slot_buckets"
  on public.package_builder_slot_buckets for select using (true);
drop policy if exists "Allow insert package_builder_slot_buckets"
  on public.package_builder_slot_buckets;
drop policy if exists "Allow update package_builder_slot_buckets"
  on public.package_builder_slot_buckets;
drop policy if exists "Allow delete package_builder_slot_buckets"
  on public.package_builder_slot_buckets;
create policy "Allow insert package_builder_slot_buckets"
  on public.package_builder_slot_buckets for insert with check (true);
create policy "Allow update package_builder_slot_buckets"
  on public.package_builder_slot_buckets for update using (true);
create policy "Allow delete package_builder_slot_buckets"
  on public.package_builder_slot_buckets for delete using (true);

drop policy if exists "Allow read package_builder_slot_bucket_members"
  on public.package_builder_slot_bucket_members;
create policy "Allow read package_builder_slot_bucket_members"
  on public.package_builder_slot_bucket_members for select using (true);
drop policy if exists "Allow insert package_builder_slot_bucket_members"
  on public.package_builder_slot_bucket_members;
drop policy if exists "Allow update package_builder_slot_bucket_members"
  on public.package_builder_slot_bucket_members;
drop policy if exists "Allow delete package_builder_slot_bucket_members"
  on public.package_builder_slot_bucket_members;
create policy "Allow insert package_builder_slot_bucket_members"
  on public.package_builder_slot_bucket_members for insert with check (true);
create policy "Allow update package_builder_slot_bucket_members"
  on public.package_builder_slot_bucket_members for update using (true);
create policy "Allow delete package_builder_slot_bucket_members"
  on public.package_builder_slot_bucket_members for delete using (true);

notify pgrst, 'reload schema';
