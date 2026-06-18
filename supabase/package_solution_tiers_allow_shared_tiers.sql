-- Allow the same vault tier to appear in multiple packages (preset + custom).
-- Previously solution_tier_id was globally unique, so saving one package would
-- unlink tiers from every other package that used them.
--
-- Run once in Supabase → SQL Editor.

drop index if exists public.package_solution_tiers_solution_tier_id_key;

comment on table public.package_solution_tiers is
  'Many-to-many: which tiers belong to a package. The same vault tier may appear in multiple packages.';

notify pgrst, 'reload schema';
