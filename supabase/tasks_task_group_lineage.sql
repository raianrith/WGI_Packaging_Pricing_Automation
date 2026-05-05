-- Links tasks spawned from "Apply task group to tier" to the apply batch + template line
-- so we can update existing tier tasks when the template changes (Update all existing tiers).
-- Run in Supabase SQL Editor after task_groups_v2.sql.

alter table public.tasks
  add column if not exists task_group_application_id uuid null
  references public.solution_tier_task_group_applied (id) on delete set null;

alter table public.tasks
  add column if not exists spawned_from_task_group_line_id uuid null
  references public.task_group_lines (id) on delete set null;

comment on column public.tasks.task_group_application_id is
  'FK to solution_tier_task_group_applied: the apply batch that created this task.';

comment on column public.tasks.spawned_from_task_group_line_id is
  'FK to task_group_lines: which template line produced this task.';

create index if not exists tasks_task_group_spawn_idx
  on public.tasks (task_group_application_id, spawned_from_task_group_line_id)
  where task_group_application_id is not null;
