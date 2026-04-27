-- Run in Supabase SQL Editor if Row Level Security blocks the dashboard.
-- This allows anyone with the anon key to READ the knowledge-base tables.
-- For stricter access, use Supabase Auth and replace `true` with auth checks.

alter table public.packages enable row level security;
alter table public.solutions enable row level security;
alter table public.solution_tiers enable row level security;
alter table public.tasks enable row level security;
alter table public.solution_tier_pricing enable row level security;
alter table public.package_solution_tiers enable row level security;
alter table public.audit_log enable row level security;
-- Legacy table (dropped by task_groups_v2.sql migration, if run).
do $$
begin
  if to_regclass('public.task_group_templates') is not null then
    alter table public.task_group_templates enable row level security;
  end if;
end $$;

drop policy if exists "Allow public read packages" on public.packages;
drop policy if exists "Allow public read solutions" on public.solutions;
drop policy if exists "Allow public read solution_tiers" on public.solution_tiers;
drop policy if exists "Allow public read tasks" on public.tasks;

create policy "Allow public read packages"
  on public.packages for select using (true);

create policy "Allow public read solutions"
  on public.solutions for select using (true);

create policy "Allow public read solution_tiers"
  on public.solution_tiers for select using (true);

create policy "Allow public read tasks"
  on public.tasks for select using (true);

drop policy if exists "Allow public read solution_tier_pricing" on public.solution_tier_pricing;
create policy "Allow public read solution_tier_pricing"
  on public.solution_tier_pricing for select using (true);

drop policy if exists "Allow public read package_solution_tiers" on public.package_solution_tiers;
create policy "Allow public read package_solution_tiers"
  on public.package_solution_tiers for select using (true);

drop policy if exists "Allow public read audit_log" on public.audit_log;
create policy "Allow public read audit_log"
  on public.audit_log for select using (true);

do $$
begin
  if to_regclass('public.task_group_templates') is not null then
    execute 'drop policy if exists "Allow public read task_group_templates" on public.task_group_templates';
    execute 'create policy "Allow public read task_group_templates" on public.task_group_templates for select using (true)';
  end if;
end $$;

-- Task groups v2 (if migration has been run)
do $$
begin
  if to_regclass('public.task_groups') is not null then
    alter table public.task_groups enable row level security;
    execute 'drop policy if exists "Allow public read task_groups" on public.task_groups';
    execute 'create policy "Allow public read task_groups" on public.task_groups for select using (true)';
  end if;
  if to_regclass('public.task_group_lines') is not null then
    alter table public.task_group_lines enable row level security;
    execute 'drop policy if exists "Allow public read task_group_lines" on public.task_group_lines';
    execute 'create policy "Allow public read task_group_lines" on public.task_group_lines for select using (true)';
  end if;
  if to_regclass('public.solution_tier_task_group_applied') is not null then
    alter table public.solution_tier_task_group_applied enable row level security;
    execute 'drop policy if exists "Allow public read solution_tier_task_group_applied" on public.solution_tier_task_group_applied';
    execute 'create policy "Allow public read solution_tier_task_group_applied" on public.solution_tier_task_group_applied for select using (true)';
  end if;
end $$;

notify pgrst, 'reload schema';
