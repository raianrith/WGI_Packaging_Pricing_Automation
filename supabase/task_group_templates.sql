-- DEPRECATED: replaced by task_groups_v2.sql (task_groups + task_group_lines + migration).
-- This file is kept for reference only. New installs should run task_groups_v2.sql instead.
--
-- Legacy: Task Group Templates — catalog of reusable task definitions (group, name, implementer, hours)
-- with an optional link to a concrete row in public.tasks.
-- Run in Supabase SQL Editor after public.tasks exists.

create table if not exists public.task_group_templates (
  id uuid primary key default gen_random_uuid(),

  -- Optional link to an existing task instance (e.g. canonical example)
  task_id text null
    references public.tasks (task_id) on delete set null,

  task_group_name text not null,
  task_name text not null,
  task_implementer text null,
  hours numeric(12, 2) null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One template row per linked task (when task_id is set)
create unique index if not exists task_group_templates_task_id_key
  on public.task_group_templates (task_id)
  where task_id is not null;

-- Unique catalog line per group + name (when building the list without task_id)
create unique index if not exists task_group_templates_group_name_unique
  on public.task_group_templates (task_group_name, task_name);

create index if not exists task_group_templates_group_idx
  on public.task_group_templates (task_group_name);

comment on table public.task_group_templates is
  'Reusable task catalog: group, name, implementer, hours, optional FK to tasks.task_id.';

-- updated_at
create or replace function public.set_task_group_templates_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_task_group_templates_updated_at on public.task_group_templates;
create trigger trg_task_group_templates_updated_at
  before update on public.task_group_templates
  for each row execute function public.set_task_group_templates_updated_at();

-- RLS (same posture as other packaging tables in this project)
alter table public.task_group_templates enable row level security;

drop policy if exists "Allow read task_group_templates" on public.task_group_templates;
drop policy if exists "Allow insert task_group_templates" on public.task_group_templates;
drop policy if exists "Allow update task_group_templates" on public.task_group_templates;
drop policy if exists "Allow delete task_group_templates" on public.task_group_templates;

create policy "Allow read task_group_templates"
  on public.task_group_templates for select using (true);
create policy "Allow insert task_group_templates"
  on public.task_group_templates for insert with check (true);
create policy "Allow update task_group_templates"
  on public.task_group_templates for update using (true);
create policy "Allow delete task_group_templates"
  on public.task_group_templates for delete using (true);

notify pgrst, 'reload schema';
