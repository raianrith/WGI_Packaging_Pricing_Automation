-- Solution type (Solution Module vs Configured Solution) and add-ons flag.
-- Run in Supabase → SQL Editor.

alter table public.solutions
  add column if not exists solution_type text not null default 'configured_solution';

alter table public.solutions
  drop constraint if exists solutions_solution_type_check;

alter table public.solutions
  add constraint solutions_solution_type_check
  check (solution_type in ('solution_module', 'configured_solution'));

alter table public.solutions
  add column if not exists add_ons_allowed boolean not null default false;

comment on column public.solutions.solution_type is
  'solution_module or configured_solution; used in All Solutions and Proposal Builder.';

comment on column public.solutions.add_ons_allowed is
  'When true, extras/add-ons may be used with this solution.';

update public.solutions
set solution_type = 'solution_module'
where lower(trim(solution_name)) in ('copy', 'design', 'dev')
   or lower(trim(solution_name)) = 'video'
   or lower(trim(solution_name)) like 'video -%';
