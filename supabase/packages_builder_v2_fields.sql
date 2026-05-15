-- Package Builder v2: package-level narratives, aggregated tasks JSON, aggregated pricing overrides, discounts.
-- Run once in Supabase SQL Editor against existing `packages` table.

alter table public.packages
  add column if not exists package_category text,
  add column if not exists package_owner text,
  add column if not exists package_overview text,
  add column if not exists package_overview_link text,
  add column if not exists package_direction text,
  add column if not exists package_what_is_it text,
  add column if not exists package_why_is_it_valuable text,
  add column if not exists package_when_should_it_be_used text,
  add column if not exists package_assumption_prerequisites text,
  add column if not exists package_in_scope text,
  add column if not exists package_out_of_scope text,
  add column if not exists package_final_deliverable text,
  add column if not exists package_how_do_we_get_this_work_done text,
  add column if not exists package_sop text,
  add column if not exists package_resources text,
  add column if not exists package_resource_templates text,
  add column if not exists package_resource_tools text,
  add column if not exists package_resource_examples jsonb,
  add column if not exists package_hour_discount_pct numeric default 0
    constraint packages_hour_discount_pct_chk check (package_hour_discount_pct >= 0 and package_hour_discount_pct <= 100),
  add column if not exists package_sell_discount_pct numeric default 0
    constraint packages_sell_discount_pct_chk check (package_sell_discount_pct >= 0 and package_sell_discount_pct <= 100),
  add column if not exists package_pricing_overrides jsonb,
  add column if not exists package_combined_tasks jsonb;

comment on column public.packages.package_hour_discount_pct is
  'Applied uniformly to summed hour buckets across all tiers in this package before pricing math.';
comment on column public.packages.package_sell_discount_pct is
  'Reduction applied to computed sell price for the package aggregate.';
comment on column public.packages.package_pricing_overrides is
  'Sparse JSON overrides for package-level aggregated pricing (primarily multipliers / scores; hours come from summed tiers × hour discount).';
comment on column public.packages.package_combined_tasks is
  'Canonical combined task ordering + package-only extras + hidden vault tasks for Package Builder UX.';
