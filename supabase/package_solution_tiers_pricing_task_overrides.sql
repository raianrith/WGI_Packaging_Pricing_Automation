-- Package-scoped pricing and task copy (vault `solution_tier_pricing` + `tasks` unchanged).
-- Run after package_solution_tiers (and tier_overrides migration if used).

alter table public.package_solution_tiers
  add column if not exists pricing_overrides jsonb not null default '{}'::jsonb;

alter table public.package_solution_tiers
  add column if not exists task_overrides jsonb not null default '{}'::jsonb;

comment on column public.package_solution_tiers.pricing_overrides is
  'Sparse JSON vs solution_tier_pricing for this package link only.';

comment on column public.package_solution_tiers.task_overrides is
  'Sparse JSON map task_id → { task_name?, task_time?, ... } vs vault tasks.';

notify pgrst, 'reload schema';
