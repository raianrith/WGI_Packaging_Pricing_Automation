-- Productive.io task list link for new-solution feedback rows.
-- Apply via Supabase SQL editor after app_feedback.sql.

alter table public.app_feedback
  add column if not exists productive_task_list_id text null,
  add column if not exists productive_task_list_url text null;

comment on column public.app_feedback.productive_task_list_id is
  'Productive.io task list id created for new_solution feedback.';

comment on column public.app_feedback.productive_task_list_url is
  'Deep link to the Productive task list for this feedback row.';

notify pgrst, 'reload schema';
