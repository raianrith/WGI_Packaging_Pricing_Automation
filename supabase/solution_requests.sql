-- Queue for new solution offering requests from Solutions Directory.
-- Apply via Supabase migration or run in SQL editor.

create table if not exists public.solution_requests (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'not_approved', 'in_progress')),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high')),
  solution_name text not null,
  requested_by_name text not null,
  requested_by_email text not null,
  requested_by_user_id uuid references auth.users (id) on delete set null,
  client_need text not null default '',
  typical_use_case text not null default '',
  suggested_phase text null,
  suggested_category text null,
  suggested_tactic text null,
  desired_deliverables text not null default '',
  in_scope text null,
  out_of_scope text null,
  known_work text null,
  why_productize text not null default '',
  related_offerings text null,
  additional_notes text null,
  review_notes text null,
  status_updated_by_email text null,
  status_updated_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.solution_requests is
  'Queue of new solution offering requests from Solutions Directory users.';

create index if not exists solution_requests_status_created_idx
  on public.solution_requests (status, created_at desc);

create index if not exists solution_requests_created_idx
  on public.solution_requests (created_at desc);

alter table public.solution_requests enable row level security;

drop policy if exists "Allow read solution_requests" on public.solution_requests;
drop policy if exists "Allow insert solution_requests" on public.solution_requests;
drop policy if exists "Allow update solution_requests" on public.solution_requests;
drop policy if exists "Allow delete solution_requests" on public.solution_requests;

create policy "Allow read solution_requests"
  on public.solution_requests for select to authenticated using (true);

create policy "Allow insert solution_requests"
  on public.solution_requests for insert to authenticated with check (true);

create policy "Allow update solution_requests"
  on public.solution_requests for update to authenticated using (true);

create policy "Allow delete solution_requests"
  on public.solution_requests for delete to authenticated using (public.is_app_admin());

create or replace function public.set_solution_requests_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists solution_requests_updated_at on public.solution_requests;
create trigger solution_requests_updated_at
before update on public.solution_requests
for each row execute function public.set_solution_requests_updated_at();

notify pgrst, 'reload schema';
