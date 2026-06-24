-- Phase / category / tactic tags per Build-a-Package package type (multi-select labels).
-- Run after package_builder_types_and_slots_v2.sql.

alter table public.package_builder_package_types
  add column if not exists phase_tags text[] not null default '{}',
  add column if not exists category_tags text[] not null default '{}',
  add column if not exists tactic_tags text[] not null default '{}';

comment on column public.package_builder_package_types.phase_tags is
  'Playbook phase labels for this package family (from solution_tier_taxonomy_options).';
comment on column public.package_builder_package_types.category_tags is
  'Playbook category labels for this package family (from solution_tier_taxonomy_options).';
comment on column public.package_builder_package_types.tactic_tags is
  'Playbook tactic labels for this package family (from solution_tier_taxonomy_options).';

notify pgrst, 'reload schema';
