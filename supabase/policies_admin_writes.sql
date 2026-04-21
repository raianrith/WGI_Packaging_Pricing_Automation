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

-- Audit log: insert + read only (no updates/deletes from app)
drop policy if exists "Allow read changelog" on public.audit_log;
drop policy if exists "Allow insert changelog" on public.audit_log;
create policy "Allow read changelog" on public.audit_log for select using (true);
create policy "Allow insert changelog" on public.audit_log for insert with check (true);
