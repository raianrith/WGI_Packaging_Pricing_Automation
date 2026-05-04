-- Package-level task layout: hide vault tasks, add package-only tasks (vault `tasks` unchanged).
-- Run after package_solution_tiers exists.

alter table public.package_solution_tiers
  add column if not exists task_extensions jsonb not null default '{}'::jsonb;

comment on column public.package_solution_tiers.task_extensions is
  'JSON: { hidden_task_ids?: string[], extra_tasks?: [{ package_task_id, task_name, ... }] }.';

notify pgrst, 'reload schema';
