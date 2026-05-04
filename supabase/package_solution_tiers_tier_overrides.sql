-- Optional package-specific copy for linked tiers (does not mutate solution_tiers).
-- Run in Supabase SQL Editor after package_solution_tiers exists.

alter table public.package_solution_tiers
  add column if not exists tier_overrides jsonb not null default '{}'::jsonb;

comment on column public.package_solution_tiers.tier_overrides is
  'Sparse JSON: only keys that differ from the vault tier. Shown when viewing this package; solution_tiers row stays canonical.';

notify pgrst, 'reload schema';
