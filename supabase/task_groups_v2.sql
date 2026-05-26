-- Task groups (v2): reusable named templates; lines are definitions (not live tier tasks).
-- Apply to a solution_tier inserts rows into public.tasks.
-- Run in Supabase SQL Editor after public.tasks exists.
-- If upgrading from task_group_templates, migrates data and drops the old table.

-- ---------------------------------------------------------------------------
-- 1) Core tables
-- ---------------------------------------------------------------------------

create table if not exists public.task_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists task_groups_name_key on public.task_groups (name);

comment on table public.task_groups is
  'Reusable task group template (name + description). Lines live in task_group_lines.';

create table if not exists public.task_group_lines (
  id uuid primary key default gen_random_uuid(),
  task_group_id uuid not null references public.task_groups (id) on delete cascade,
  sort_order int not null default 0,
  line_type text not null
    check (line_type in ('archetype', 'copy_from_task')),
  -- copy_from_task: point to a row in tasks to clone at apply time
  source_task_id text null references public.tasks (task_id) on delete set null,
  -- Display / archetype: required for archetype; snapshot for copy lines (optional)
  task_name text not null,
  task_implementer text null,
  hours numeric(12, 2) null,
  duration numeric(12, 2) null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_group_lines_shape_check check (
    (line_type = 'copy_from_task' and source_task_id is not null)
    or (line_type = 'archetype' and length(trim(task_name)) > 0)
  )
);

create index if not exists task_group_lines_group_idx on public.task_group_lines (task_group_id, sort_order);

comment on table public.task_group_lines is
  'Definition line: archetype (name/hours/duration defaults) or copy_from_task (seeded from source_task_id).';

create table if not exists public.solution_tier_task_group_applied (
  id uuid primary key default gen_random_uuid(),
  solution_tier_id text not null references public.solution_tiers (solution_tier_id) on delete cascade,
  task_group_id uuid not null references public.task_groups (id) on delete cascade,
  applied_at timestamptz not null default now()
);

create index if not exists solution_tier_task_group_applied_tier_idx
  on public.solution_tier_task_group_applied (solution_tier_id);

-- ---------------------------------------------------------------------------
-- 2) updated_at triggers
-- ---------------------------------------------------------------------------

create or replace function public.set_task_groups_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_task_groups_updated_at on public.task_groups;
create trigger trg_task_groups_updated_at
  before update on public.task_groups
  for each row execute function public.set_task_groups_updated_at();

create or replace function public.set_task_group_lines_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_task_group_lines_updated_at on public.task_group_lines;
create trigger trg_task_group_lines_updated_at
  before update on public.task_group_lines
  for each row execute function public.set_task_group_lines_updated_at();

-- ---------------------------------------------------------------------------
-- 3) RLS (match other packaging tables)
-- ---------------------------------------------------------------------------

alter table public.task_groups enable row level security;
alter table public.task_group_lines enable row level security;
alter table public.solution_tier_task_group_applied enable row level security;

drop policy if exists "Allow read task_groups" on public.task_groups;
drop policy if exists "Allow insert task_groups" on public.task_groups;
drop policy if exists "Allow update task_groups" on public.task_groups;
drop policy if exists "Allow delete task_groups" on public.task_groups;

create policy "Allow read task_groups" on public.task_groups for select using (true);
create policy "Allow insert task_groups" on public.task_groups for insert with check (true);
create policy "Allow update task_groups" on public.task_groups for update using (true);
create policy "Allow delete task_groups" on public.task_groups for delete using (true);

drop policy if exists "Allow read task_group_lines" on public.task_group_lines;
drop policy if exists "Allow insert task_group_lines" on public.task_group_lines;
drop policy if exists "Allow update task_group_lines" on public.task_group_lines;
drop policy if exists "Allow delete task_group_lines" on public.task_group_lines;

create policy "Allow read task_group_lines" on public.task_group_lines for select using (true);
create policy "Allow insert task_group_lines" on public.task_group_lines for insert with check (true);
create policy "Allow update task_group_lines" on public.task_group_lines for update using (true);
create policy "Allow delete task_group_lines" on public.task_group_lines for delete using (true);

drop policy if exists "Allow read solution_tier_task_group_applied" on public.solution_tier_task_group_applied;
drop policy if exists "Allow insert solution_tier_task_group_applied" on public.solution_tier_task_group_applied;
drop policy if exists "Allow delete solution_tier_task_group_applied" on public.solution_tier_task_group_applied;

create policy "Allow read solution_tier_task_group_applied"
  on public.solution_tier_task_group_applied for select using (true);
create policy "Allow insert solution_tier_task_group_applied"
  on public.solution_tier_task_group_applied for insert with check (true);
create policy "Allow delete solution_tier_task_group_applied"
  on public.solution_tier_task_group_applied for delete using (true);

-- ---------------------------------------------------------------------------
-- 4) Migrate from legacy task_group_templates (if present), then drop legacy
-- ---------------------------------------------------------------------------

do $$
declare
  gname text;
  new_group_id uuid;
  tpl record;
  sort_i int;
begin
  if to_regclass('public.task_group_templates') is null then
    raise notice 'task_group_templates not found; skipping migration.';
    return;
  end if;

  for gname in
    select distinct trim(task_group_name) as n from public.task_group_templates order by 1
  loop
    insert into public.task_groups (name, description)
    values (gname, null)
    on conflict (name) do nothing;

    select id into new_group_id from public.task_groups where name = gname;

    sort_i := 0;
    for tpl in
      select *
      from public.task_group_templates
      where trim(task_group_name) = gname
      order by created_at nulls last, id
    loop
      insert into public.task_group_lines (
        task_group_id,
        sort_order,
        line_type,
        source_task_id,
        task_name,
        task_implementer,
        hours
      )
      values (
        new_group_id,
        sort_i,
        case when tpl.task_id is not null then 'copy_from_task' else 'archetype' end,
        tpl.task_id,
        tpl.task_name,
        tpl.task_implementer,
        tpl.hours
      );
      sort_i := sort_i + 1;
    end loop;
  end loop;

  drop table public.task_group_templates cascade;
  raise notice 'Migrated task_group_templates into task_groups / task_group_lines; dropped legacy table.';
end $$;

notify pgrst, 'reload schema';
