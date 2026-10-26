-- Productive.io task list created when a Solutions Directory request is approved.
-- Apply via SQL editor after solution_requests.sql.

alter table public.solution_requests
  add column if not exists productive_task_list_id text null,
  add column if not exists productive_task_list_url text null;

comment on column public.solution_requests.productive_task_list_id is
  'Productive.io task list id created when this request is approved.';

comment on column public.solution_requests.productive_task_list_url is
  'Deep link to the Productive task list created on approval.';

notify pgrst, 'reload schema';
