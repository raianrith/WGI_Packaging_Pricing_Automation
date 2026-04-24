-- Add descriptive context columns to solution_tiers.
-- Run in Supabase → SQL Editor after public.solution_tiers exists.
-- Resources already map to solution_tier_resources (no duplicate column).
-- Column names: snake_case, PostgreSQL-idiomatic.

alter table public.solution_tiers
  add column if not exists solution_tier_what_is_it text,
  add column if not exists solution_tier_why_is_it_valuable text,
  add column if not exists solution_tier_when_should_it_be_used text,
  add column if not exists solution_tier_assumption_prerequisites text,
  add column if not exists solution_tier_in_scope text,
  add column if not exists solution_tier_out_of_scope text,
  add column if not exists solution_tier_final_deliverable text,
  add column if not exists solution_tier_how_do_we_get_this_work_done text,
  add column if not exists solution_tier_described_to_client text;

comment on column public.solution_tiers.solution_tier_what_is_it is 'What this tier is.';
comment on column public.solution_tiers.solution_tier_why_is_it_valuable is 'Why this tier is valuable.';
comment on column public.solution_tiers.solution_tier_when_should_it_be_used is 'When to use this tier.';
comment on column public.solution_tiers.solution_tier_assumption_prerequisites is 'Assumptions and prerequisites.';
comment on column public.solution_tiers.solution_tier_in_scope is 'In-scope definition.';
comment on column public.solution_tiers.solution_tier_out_of_scope is 'Out-of-scope definition.';
comment on column public.solution_tiers.solution_tier_final_deliverable is 'Final deliverable.';
comment on column public.solution_tiers.solution_tier_how_do_we_get_this_work_done is 'How the work is executed.';
comment on column public.solution_tiers.solution_tier_described_to_client is
  'How this solution can be described to the client (selling / positioning).';
