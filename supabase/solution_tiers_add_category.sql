-- Add category for each solution tier.
-- Run in Supabase -> SQL Editor after public.solution_tiers exists.

alter table public.solution_tiers
  add column if not exists solution_tier_category text;

comment on column public.solution_tiers.solution_tier_category is
  'Admin-managed category label for this tier (for example: Strategy, Launch, Optimization).';
