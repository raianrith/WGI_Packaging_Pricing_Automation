-- Links packages to individual solution tiers (not whole solutions).
-- Run once in Supabase → SQL Editor after packages, solutions, and solution_tiers exist.
-- 1) Creates junction + backfills from solutions.package_id
-- 2) Drops solutions.package_id
-- 3) Extends audit_log.entity_type check (includes values the app already uses)
-- 4) RLS policies (match other packaging tables)

-- ---------------------------------------------------------------------------
-- Junction table
-- ---------------------------------------------------------------------------
create table if not exists public.package_solution_tiers (
  package_id text not null references public.packages (package_id) on delete cascade,
  solution_tier_id text not null references public.solution_tiers (solution_tier_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (package_id, solution_tier_id)
);

comment on table public.package_solution_tiers is
  'Many-to-many: which tiers belong to a package. A tier may appear in at most one package.';

-- At most one package per tier (matches previous “solution in one package” rule at tier granularity).
create unique index if not exists package_solution_tiers_solution_tier_id_key
  on public.package_solution_tiers (solution_tier_id);

-- ---------------------------------------------------------------------------
-- Backfill from legacy solutions.package_id
-- ---------------------------------------------------------------------------
insert into public.package_solution_tiers (package_id, solution_tier_id)
select s.package_id, st.solution_tier_id
from public.solutions s
inner join public.solution_tiers st on st.solution_id = s.solution_id
where s.package_id is not null
on conflict (solution_tier_id) do nothing;

-- ---------------------------------------------------------------------------
-- Drop legacy column (requires no FK name portability — adjust if your DB differs)
-- ---------------------------------------------------------------------------
alter table public.solutions drop column if exists package_id;

-- ---------------------------------------------------------------------------
-- audit_log: widen entity_type check (drop + recreate; constraint name may vary)
-- ---------------------------------------------------------------------------
alter table public.audit_log drop constraint if exists audit_log_entity_type_check;

alter table public.audit_log
  add constraint audit_log_entity_type_check
  check (
    entity_type in (
      'packages',
      'solutions',
      'solution_tiers',
      'tasks',
      'solution_tier_pricing',
      'package_solution_tiers'
    )
  );

-- ---------------------------------------------------------------------------
-- Row level security (public read + admin writes — same posture as policies_admin_writes.sql)
-- ---------------------------------------------------------------------------
alter table public.package_solution_tiers enable row level security;

drop policy if exists "Allow public read package_solution_tiers" on public.package_solution_tiers;
create policy "Allow public read package_solution_tiers"
  on public.package_solution_tiers for select using (true);

drop policy if exists "Allow insert package_solution_tiers" on public.package_solution_tiers;
drop policy if exists "Allow update package_solution_tiers" on public.package_solution_tiers;
drop policy if exists "Allow delete package_solution_tiers" on public.package_solution_tiers;

create policy "Allow insert package_solution_tiers"
  on public.package_solution_tiers for insert with check (true);
create policy "Allow update package_solution_tiers"
  on public.package_solution_tiers for update using (true);
create policy "Allow delete package_solution_tiers"
  on public.package_solution_tiers for delete using (true);

notify pgrst, 'reload schema';
