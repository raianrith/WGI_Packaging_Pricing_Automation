-- Add editable duration defaults to task-group template lines.
-- Run this after supabase/task_groups_v2.sql.

alter table public.task_group_lines
  add column if not exists duration numeric(12, 2) null;

comment on column public.task_group_lines.duration is
  'Default task duration used when a task-group template line creates or syncs tier tasks.';

notify pgrst, 'reload schema';
