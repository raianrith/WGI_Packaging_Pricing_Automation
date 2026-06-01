-- Optional: if you re-enable RLS on the packaging tables, grant the browser key
-- permission to mutate data used by the Admin app (internal tools only).
-- For production, replace `true` with auth checks, e.g. auth.role() = 'authenticated'
-- and an allowlist table or Supabase custom claims.

alter table public.packages enable row level security;
alter table public.solutions enable row level security;
alter table public.solution_tiers enable row level security;
alter table public.tasks enable row level security;
alter table public.audit_log enable row level security;
alter table public.solution_tier_pricing enable row level security;
alter table public.package_solution_tiers enable row level security;
do $$
begin
  if to_regclass('public.task_group_templates') is not null then
    alter table public.task_group_templates enable row level security;
  end if;
  if to_regclass('public.task_groups') is not null then
    alter table public.task_groups enable row level security;
    alter table public.task_group_lines enable row level security;
    alter table public.solution_tier_task_group_applied enable row level security;
  end if;
end $$;

-- Read policies (agency + admin)
drop policy if exists "Allow read packages" on public.packages;
drop policy if exists "Allow read solutions" on public.solutions;
drop policy if exists "Allow read solution_tiers" on public.solution_tiers;
drop policy if exists "Allow read tasks" on public.tasks;

create policy "Allow read packages" on public.packages for select using (true);
create policy "Allow read solutions" on public.solutions for select using (true);
create policy "Allow read solution_tiers" on public.solution_tiers for select using (true);
create policy "Allow read tasks" on public.tasks for select using (true);

drop policy if exists "Allow read solution_tier_pricing" on public.solution_tier_pricing;
create policy "Allow read solution_tier_pricing"
  on public.solution_tier_pricing for select using (true);

drop policy if exists "Allow read package_solution_tiers" on public.package_solution_tiers;
create policy "Allow read package_solution_tiers"
  on public.package_solution_tiers for select using (true);

-- Writes (treat as internal: tighten later)
drop policy if exists "Allow insert packages" on public.packages;
drop policy if exists "Allow update packages" on public.packages;
drop policy if exists "Allow delete packages" on public.packages;
create policy "Allow insert packages" on public.packages for insert with check (true);
create policy "Allow update packages" on public.packages for update using (true);
create policy "Allow delete packages" on public.packages for delete using (true);

drop policy if exists "Allow insert solutions" on public.solutions;
drop policy if exists "Allow update solutions" on public.solutions;
drop policy if exists "Allow delete solutions" on public.solutions;
create policy "Allow insert solutions" on public.solutions for insert with check (true);
create policy "Allow update solutions" on public.solutions for update using (true);
create policy "Allow delete solutions" on public.solutions for delete using (true);

drop policy if exists "Allow insert tiers" on public.solution_tiers;
drop policy if exists "Allow update tiers" on public.solution_tiers;
drop policy if exists "Allow delete tiers" on public.solution_tiers;
create policy "Allow insert tiers" on public.solution_tiers for insert with check (true);
create policy "Allow update tiers" on public.solution_tiers for update using (true);
create policy "Allow delete tiers" on public.solution_tiers for delete using (true);

drop policy if exists "Allow insert tasks" on public.tasks;
drop policy if exists "Allow update tasks" on public.tasks;
drop policy if exists "Allow delete tasks" on public.tasks;
create policy "Allow insert tasks" on public.tasks for insert with check (true);
create policy "Allow update tasks" on public.tasks for update using (true);
create policy "Allow delete tasks" on public.tasks for delete using (true);

drop policy if exists "Allow insert solution_tier_pricing" on public.solution_tier_pricing;
drop policy if exists "Allow update solution_tier_pricing" on public.solution_tier_pricing;
drop policy if exists "Allow delete solution_tier_pricing" on public.solution_tier_pricing;
create policy "Allow insert solution_tier_pricing"
  on public.solution_tier_pricing for insert with check (true);
create policy "Allow update solution_tier_pricing"
  on public.solution_tier_pricing for update using (true);
create policy "Allow delete solution_tier_pricing"
  on public.solution_tier_pricing for delete using (true);

drop policy if exists "Allow insert package_solution_tiers" on public.package_solution_tiers;
drop policy if exists "Allow update package_solution_tiers" on public.package_solution_tiers;
drop policy if exists "Allow delete package_solution_tiers" on public.package_solution_tiers;
create policy "Allow insert package_solution_tiers"
  on public.package_solution_tiers for insert with check (true);
create policy "Allow update package_solution_tiers"
  on public.package_solution_tiers for update using (true);
create policy "Allow delete package_solution_tiers"
  on public.package_solution_tiers for delete using (true);

do $$
begin
  if to_regclass('public.task_group_templates') is not null then
    execute 'drop policy if exists "Allow read task_group_templates" on public.task_group_templates';
    execute 'drop policy if exists "Allow insert task_group_templates" on public.task_group_templates';
    execute 'drop policy if exists "Allow update task_group_templates" on public.task_group_templates';
    execute 'drop policy if exists "Allow delete task_group_templates" on public.task_group_templates';
    execute 'create policy "Allow read task_group_templates" on public.task_group_templates for select using (true)';
    execute 'create policy "Allow insert task_group_templates" on public.task_group_templates for insert with check (true)';
    execute 'create policy "Allow update task_group_templates" on public.task_group_templates for update using (true)';
    execute 'create policy "Allow delete task_group_templates" on public.task_group_templates for delete using (true)';
  end if;
  if to_regclass('public.task_groups') is not null then
    execute 'drop policy if exists "Allow read task_groups" on public.task_groups';
    execute 'drop policy if exists "Allow insert task_groups" on public.task_groups';
    execute 'drop policy if exists "Allow update task_groups" on public.task_groups';
    execute 'drop policy if exists "Allow delete task_groups" on public.task_groups';
    execute 'create policy "Allow read task_groups" on public.task_groups for select using (true)';
    execute 'create policy "Allow insert task_groups" on public.task_groups for insert with check (true)';
    execute 'create policy "Allow update task_groups" on public.task_groups for update using (true)';
    execute 'create policy "Allow delete task_groups" on public.task_groups for delete using (true)';
  end if;
  if to_regclass('public.task_group_lines') is not null then
    execute 'drop policy if exists "Allow read task_group_lines" on public.task_group_lines';
    execute 'drop policy if exists "Allow insert task_group_lines" on public.task_group_lines';
    execute 'drop policy if exists "Allow update task_group_lines" on public.task_group_lines';
    execute 'drop policy if exists "Allow delete task_group_lines" on public.task_group_lines';
    execute 'create policy "Allow read task_group_lines" on public.task_group_lines for select using (true)';
    execute 'create policy "Allow insert task_group_lines" on public.task_group_lines for insert with check (true)';
    execute 'create policy "Allow update task_group_lines" on public.task_group_lines for update using (true)';
    execute 'create policy "Allow delete task_group_lines" on public.task_group_lines for delete using (true)';
  end if;
  if to_regclass('public.solution_tier_task_group_applied') is not null then
    execute 'drop policy if exists "Allow read solution_tier_task_group_applied" on public.solution_tier_task_group_applied';
    execute 'drop policy if exists "Allow insert solution_tier_task_group_applied" on public.solution_tier_task_group_applied';
    execute 'drop policy if exists "Allow delete solution_tier_task_group_applied" on public.solution_tier_task_group_applied';
    execute 'create policy "Allow read solution_tier_task_group_applied" on public.solution_tier_task_group_applied for select using (true)';
    execute 'create policy "Allow insert solution_tier_task_group_applied" on public.solution_tier_task_group_applied for insert with check (true)';
    execute 'create policy "Allow delete solution_tier_task_group_applied" on public.solution_tier_task_group_applied for delete using (true)';
  end if;
end $$;

-- Audit log: insert + read only (no updates/deletes from app)
drop policy if exists "Allow read changelog" on public.audit_log;
drop policy if exists "Allow insert changelog" on public.audit_log;
create policy "Allow read changelog" on public.audit_log for select using (true);
create policy "Allow insert changelog" on public.audit_log for insert with check (true);

-- After supabase/solution_tier_taxonomy.sql (table must exist)
do $$
begin
  if to_regclass('public.solution_tier_taxonomy_options') is not null then
    alter table public.solution_tier_taxonomy_options enable row level security;
    execute 'drop policy if exists "Allow read solution_tier_taxonomy_options" on public.solution_tier_taxonomy_options';
    execute 'drop policy if exists "Allow insert solution_tier_taxonomy_options" on public.solution_tier_taxonomy_options';
    execute 'drop policy if exists "Allow update solution_tier_taxonomy_options" on public.solution_tier_taxonomy_options';
    execute 'drop policy if exists "Allow delete solution_tier_taxonomy_options" on public.solution_tier_taxonomy_options';
    execute 'create policy "Allow read solution_tier_taxonomy_options" on public.solution_tier_taxonomy_options for select using (true)';
    execute 'create policy "Allow insert solution_tier_taxonomy_options" on public.solution_tier_taxonomy_options for insert with check (true)';
    execute 'create policy "Allow update solution_tier_taxonomy_options" on public.solution_tier_taxonomy_options for update using (true)';
    execute 'create policy "Allow delete solution_tier_taxonomy_options" on public.solution_tier_taxonomy_options for delete using (true)';
  end if;
end $$;

-- After supabase/implementer_pricing_hour_groups.sql (table must exist)
alter table public.implementer_pricing_hour_groups enable row level security;
drop policy if exists "Allow read implementer_pricing_hour_groups" on public.implementer_pricing_hour_groups;
drop policy if exists "Allow insert implementer_pricing_hour_groups" on public.implementer_pricing_hour_groups;
drop policy if exists "Allow update implementer_pricing_hour_groups" on public.implementer_pricing_hour_groups;
drop policy if exists "Allow delete implementer_pricing_hour_groups" on public.implementer_pricing_hour_groups;
create policy "Allow read implementer_pricing_hour_groups"
  on public.implementer_pricing_hour_groups for select using (true);
create policy "Allow insert implementer_pricing_hour_groups"
  on public.implementer_pricing_hour_groups for insert with check (true);
create policy "Allow update implementer_pricing_hour_groups"
  on public.implementer_pricing_hour_groups for update using (true);
create policy "Allow delete implementer_pricing_hour_groups"
  on public.implementer_pricing_hour_groups for delete using (true);
