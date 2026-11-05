-- App feedback / change-request queue (bugs, upgrades, content, new solutions, etc.).
-- Apply via Supabase SQL editor or migration.

create table if not exists public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pending'
    check (status in ('pending', 'reviewing', 'in_progress', 'resolved', 'deferred')),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  category text not null
    check (category in (
      'bug',
      'app_upgrade',
      'task_alignment',
      'solution_content',
      'package',
      'new_solution',
      'proposal_builder',
      'pricing',
      'other'
    )),
  area text not null default 'not_sure'
    check (area in (
      'home',
      'solutions_catalog',
      'solutions_overview',
      'package_builder',
      'proposal_builder',
      'admin',
      'pricing',
      'auth',
      'other',
      'not_sure'
    )),
  title text not null,
  details text not null default '',
  page_or_url text null,
  steps_to_reproduce text null,
  expected_behavior text null,
  actual_behavior text null,
  related_name text null,
  impact text null,
  client_need text null,
  typical_use_case text null,
  desired_deliverables text null,
  why_productize text null,
  suggested_phase text null,
  suggested_category text null,
  suggested_tactic text null,
  additional_notes text null,
  review_notes text null,
  requested_by_name text not null,
  requested_by_email text not null,
  requested_by_user_id uuid references auth.users (id) on delete set null,
  status_updated_by_email text null,
  status_updated_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.app_feedback is
  'User feedback and change requests across the Weidert packaging / solutions app.';

create index if not exists app_feedback_status_created_idx
  on public.app_feedback (status, created_at desc);

create index if not exists app_feedback_category_created_idx
  on public.app_feedback (category, created_at desc);

create index if not exists app_feedback_created_idx
  on public.app_feedback (created_at desc);

alter table public.app_feedback enable row level security;

drop policy if exists "Allow read app_feedback" on public.app_feedback;
drop policy if exists "Allow insert app_feedback" on public.app_feedback;
drop policy if exists "Allow update app_feedback" on public.app_feedback;
drop policy if exists "Allow delete app_feedback" on public.app_feedback;

create policy "Allow read app_feedback"
  on public.app_feedback for select to authenticated using (true);

create policy "Allow insert app_feedback"
  on public.app_feedback for insert to authenticated with check (true);

create policy "Allow update app_feedback"
  on public.app_feedback for update to authenticated using (true);

create policy "Allow delete app_feedback"
  on public.app_feedback for delete to authenticated using (true);

create or replace function public.set_app_feedback_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists app_feedback_updated_at on public.app_feedback;
create trigger app_feedback_updated_at
before update on public.app_feedback
for each row execute function public.set_app_feedback_updated_at();

notify pgrst, 'reload schema';
