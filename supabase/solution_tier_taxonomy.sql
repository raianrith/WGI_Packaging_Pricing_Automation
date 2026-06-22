-- Phase, category, and tactic lookup lists + columns on solution_tiers.
-- Run in Supabase SQL Editor after public.solution_tiers exists.

alter table public.solution_tiers
  add column if not exists solution_tier_phase text,
  add column if not exists solution_tier_tactic text;

comment on column public.solution_tiers.solution_tier_phase is
  'Lifecycle phase label for this tier (admin-managed list).';
comment on column public.solution_tiers.solution_tier_tactic is
  'Tactic label for this tier (admin-managed list).';

create table if not exists public.solution_tier_taxonomy_options (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  label text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, label),
  constraint solution_tier_taxonomy_options_kind_check
    check (kind in ('phase', 'category', 'tactic'))
);

create index if not exists solution_tier_taxonomy_options_kind_label_idx
  on public.solution_tier_taxonomy_options (kind, label);

-- Remove sort_order if an earlier version of this migration created it
alter table public.solution_tier_taxonomy_options
  drop column if exists sort_order;

drop index if exists public.solution_tier_taxonomy_options_kind_sort_idx;

create or replace function public.set_solution_tier_taxonomy_options_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tr_solution_tier_taxonomy_options_updated_at
  on public.solution_tier_taxonomy_options;

create trigger tr_solution_tier_taxonomy_options_updated_at
  before update on public.solution_tier_taxonomy_options
  for each row execute procedure public.set_solution_tier_taxonomy_options_updated_at();

comment on table public.solution_tier_taxonomy_options is
  'Admin-managed dropdown values for solution tier phase, category, and tactic.';

-- Seed option lists (idempotent)
insert into public.solution_tier_taxonomy_options (kind, label) values
  ('phase', 'Foundational'),
  ('phase', 'Acceleration Phase'),
  ('phase', 'Growth Engine'),
  ('phase', 'Other'),
  ('category', 'Discovery & Research'),
  ('category', 'Brand & Style Foundation'),
  ('category', 'Strategic Growth Playbook'),
  ('category', 'Data & Tech Enablement'),
  ('category', 'Website Optimization'),
  ('category', 'Core Market Presence'),
  ('category', 'Market Activation Campaigns'),
  ('category', 'Operational Optimization'),
  ('category', 'Asset Creation'),
  ('category', 'Billing & Engagement Modifiers'),
  ('tactic', 'Paid Demand Capture'),
  ('tactic', 'Search & AI Visibility')
on conflict (kind, label) do update
  set updated_at = now();

-- Backfill existing tiers (phase, category, tactic) from packaging spreadsheet
update public.solution_tiers st
set
  solution_tier_phase = v.phase,
  solution_tier_category = v.category,
  solution_tier_tactic = v.tactic
from (
  values
    ('3-75', 'Foundational', 'Strategic Growth Playbook', 'Search & AI Visibility'),
    ('3-74', 'Foundational', 'Strategic Growth Playbook', 'Search & AI Visibility'),
    ('3-14', 'Growth Engine', 'Asset Creation', null),
    ('3-13', 'Growth Engine', 'Asset Creation', null),
    ('3-12', 'Growth Engine', 'Asset Creation', null),
    ('3-16', 'Growth Engine', 'Asset Creation', null),
    ('3-10', 'Growth Engine', 'Asset Creation', null),
    ('3-11', 'Growth Engine', 'Asset Creation', null),
    ('3-40', 'Foundational', 'Brand & Style Foundation', null),
    ('3-38', 'Foundational', 'Brand & Style Foundation', null),
    ('3-39', 'Foundational', 'Brand & Style Foundation', null),
    ('3-34', 'Foundational', 'Brand & Style Foundation', null),
    ('3-32', 'Foundational', 'Brand & Style Foundation', null),
    ('3-33', 'Foundational', 'Brand & Style Foundation', null),
    ('3-6', 'Foundational', 'Discovery & Research', null),
    ('3-8', 'Foundational', 'Brand & Style Foundation', null),
    ('3-43', 'Foundational', 'Brand & Style Foundation', null),
    ('3-41', 'Foundational', 'Brand & Style Foundation', null),
    ('3-42', 'Foundational', 'Brand & Style Foundation', null),
    ('3-22', 'Foundational', 'Discovery & Research', null),
    ('3-20', 'Foundational', 'Discovery & Research', null),
    ('3-21', 'Foundational', 'Discovery & Research', null),
    ('3-5', 'Foundational', 'Discovery & Research', null),
    ('3-3', 'Foundational', 'Discovery & Research', null),
    ('3-4', 'Foundational', 'Discovery & Research', null),
    ('3-47', 'Foundational', 'Discovery & Research', null),
    ('3-45', 'Foundational', 'Discovery & Research', null),
    ('3-46', 'Foundational', 'Discovery & Research', null),
    ('3-25', 'Other', null, null),
    ('3-23', 'Other', null, null),
    ('3-24', 'Other', null, null),
    ('3-57', 'Foundational', 'Data & Tech Enablement', null),
    ('3-72', 'Foundational', 'Strategic Growth Playbook', 'Search & AI Visibility'),
    ('3-70', 'Foundational', 'Strategic Growth Playbook', 'Search & AI Visibility'),
    ('3-71', 'Foundational', 'Strategic Growth Playbook', 'Search & AI Visibility'),
    ('3-50', 'Foundational', 'Brand & Style Foundation', null),
    ('3-48', 'Foundational', 'Brand & Style Foundation', null),
    ('3-49', 'Foundational', 'Brand & Style Foundation', null),
    ('3-37', 'Foundational', 'Brand & Style Foundation', null),
    ('3-35', 'Foundational', 'Brand & Style Foundation', null),
    ('3-36', 'Foundational', 'Brand & Style Foundation', null),
    ('3-65', 'Other', null, null),
    ('3-63', 'Other', null, null),
    ('3-64', 'Other', null, null),
    ('3-28', 'Foundational', 'Strategic Growth Playbook', 'Search & AI Visibility'),
    ('3-26', 'Foundational', 'Strategic Growth Playbook', 'Search & AI Visibility'),
    ('3-27', 'Foundational', 'Strategic Growth Playbook', 'Search & AI Visibility'),
    ('3-62', 'Growth Engine', 'Core Market Presence', 'Paid Demand Capture'),
    ('3-59', 'Growth Engine', 'Core Market Presence', 'Paid Demand Capture'),
    ('3-58', 'Growth Engine', 'Core Market Presence', 'Paid Demand Capture'),
    ('3-60', 'Growth Engine', 'Core Market Presence', 'Paid Demand Capture'),
    ('3-61', 'Foundational', 'Core Market Presence', 'Paid Demand Capture'),
    ('3-44', 'Foundational', 'Brand & Style Foundation', null),
    ('3-56', 'Growth Engine', 'Operational Optimization', null),
    ('3-54', 'Growth Engine', 'Operational Optimization', null),
    ('3-55', 'Growth Engine', 'Operational Optimization', null),
    ('3-67', 'Other', 'Billing & Engagement Modifiers', null),
    ('3-66', 'Other', 'Billing & Engagement Modifiers', null),
    ('3-73', 'Foundational', 'Strategic Growth Playbook', 'Search & AI Visibility'),
    ('3-18', 'Foundational', 'Discovery & Research', null),
    ('3-7', 'Foundational', 'Discovery & Research', null),
    ('3-17', 'Foundational', 'Discovery & Research', null),
    ('3-31', 'Foundational', 'Brand & Style Foundation', null),
    ('3-29', 'Foundational', 'Brand & Style Foundation', null),
    ('3-30', 'Foundational', 'Brand & Style Foundation', null),
    ('3-68', 'Other', 'Billing & Engagement Modifiers', null),
    ('3-52', 'Growth Engine', 'Asset Creation', null),
    ('3-19', 'Growth Engine', 'Asset Creation', null),
    ('3-69', 'Other', 'Billing & Engagement Modifiers', null)
) as v(tier_id, phase, category, tactic)
where st.solution_tier_id = v.tier_id;

alter table public.solution_tier_taxonomy_options enable row level security;

drop policy if exists "Allow read solution_tier_taxonomy_options" on public.solution_tier_taxonomy_options;
drop policy if exists "Allow insert solution_tier_taxonomy_options" on public.solution_tier_taxonomy_options;
drop policy if exists "Allow update solution_tier_taxonomy_options" on public.solution_tier_taxonomy_options;
drop policy if exists "Allow delete solution_tier_taxonomy_options" on public.solution_tier_taxonomy_options;

create policy "Allow read solution_tier_taxonomy_options"
  on public.solution_tier_taxonomy_options for select using (true);
create policy "Allow insert solution_tier_taxonomy_options"
  on public.solution_tier_taxonomy_options for insert with check (true);
create policy "Allow update solution_tier_taxonomy_options"
  on public.solution_tier_taxonomy_options for update using (true);
create policy "Allow delete solution_tier_taxonomy_options"
  on public.solution_tier_taxonomy_options for delete using (true);
