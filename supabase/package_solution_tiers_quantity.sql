-- Allow the same vault tier multiple times in one package (e.g. 3× Customer Interviews - Basic).
-- Run once in Supabase → SQL Editor after package_solution_tiers exists.

alter table public.package_solution_tiers
  add column if not exists quantity integer not null default 1;

alter table public.package_solution_tiers
  drop constraint if exists package_solution_tiers_quantity_check;

alter table public.package_solution_tiers
  add constraint package_solution_tiers_quantity_check check (quantity >= 1);

comment on column public.package_solution_tiers.quantity is
  'How many times this vault tier is included in the package (catalog hours/sell scale with quantity).';

notify pgrst, 'reload schema';
