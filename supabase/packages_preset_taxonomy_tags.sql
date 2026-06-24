-- Phase / category / tactic tags per preset package (multi-select labels).
-- Run after packages_builder_v2_fields.sql.

alter table public.packages
  add column if not exists phase_tags text[] not null default '{}',
  add column if not exists category_tags text[] not null default '{}',
  add column if not exists tactic_tags text[] not null default '{}';

comment on column public.packages.phase_tags is
  'Playbook phase labels for this preset package (from solution_tier_taxonomy_options).';
comment on column public.packages.category_tags is
  'Playbook category labels for this preset package (from solution_tier_taxonomy_options).';
comment on column public.packages.tactic_tags is
  'Playbook tactic labels for this preset package (from solution_tier_taxonomy_options).';

notify pgrst, 'reload schema';
