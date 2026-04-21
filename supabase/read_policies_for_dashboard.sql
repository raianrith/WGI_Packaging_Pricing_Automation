-- Run in Supabase SQL Editor if Row Level Security blocks the dashboard.
-- This allows anyone with the anon key to READ the knowledge-base tables.
-- For stricter access, use Supabase Auth and replace `true` with auth checks.

alter table public.packages enable row level security;
alter table public.solutions enable row level security;
alter table public.solution_tiers enable row level security;
alter table public.tasks enable row level security;
alter table public.solution_tier_pricing enable row level security;
alter table public.audit_log enable row level security;

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

drop policy if exists "Allow public read audit_log" on public.audit_log;
create policy "Allow public read audit_log"
  on public.audit_log for select using (true);
