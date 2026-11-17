-- Assign feedback / legacy solution-request rows to app account holders.
-- Apply via Supabase SQL editor after app_feedback.sql / solution_requests.sql.

alter table public.app_feedback
  add column if not exists assigned_to_user_id uuid null references auth.users (id) on delete set null,
  add column if not exists assigned_to_name text null,
  add column if not exists assigned_to_email text null;

alter table public.solution_requests
  add column if not exists assigned_to_user_id uuid null references auth.users (id) on delete set null,
  add column if not exists assigned_to_name text null,
  add column if not exists assigned_to_email text null;

create index if not exists app_feedback_assigned_to_user_idx
  on public.app_feedback (assigned_to_user_id)
  where assigned_to_user_id is not null;

create index if not exists solution_requests_assigned_to_user_idx
  on public.solution_requests (assigned_to_user_id)
  where assigned_to_user_id is not null;

comment on column public.app_feedback.assigned_to_user_id is
  'Auth user id of the coworker assigned to this feedback row.';

comment on column public.app_feedback.assigned_to_name is
  'Display name snapshot for the assignee at assign time.';

comment on column public.app_feedback.assigned_to_email is
  'Email snapshot for the assignee at assign time.';

comment on column public.solution_requests.assigned_to_user_id is
  'Auth user id of the coworker assigned to this legacy solution request.';

comment on column public.solution_requests.assigned_to_name is
  'Display name snapshot for the assignee at assign time.';

comment on column public.solution_requests.assigned_to_email is
  'Email snapshot for the assignee at assign time.';

-- Allow signed-in users to list coworkers for Assign to (and similar pickers).
drop policy if exists "profiles_select_authenticated_directory" on public.profiles;
create policy "profiles_select_authenticated_directory"
  on public.profiles for select
  to authenticated
  using (true);

notify pgrst, 'reload schema';

