-- Redirect map for packages converted into solutions (old package URLs → solution tiers).
-- Run once in Supabase → SQL Editor.

create table if not exists public.package_migrations (
  former_package_id text primary key,
  solution_id text not null references public.solutions (solution_id) on delete cascade,
  solution_tier_id text null references public.solution_tiers (solution_tier_id) on delete set null,
  former_package_name text null,
  created_at timestamptz not null default now()
);

comment on table public.package_migrations is
  'Maps deleted package ids to replacement solution tiers after package→solution conversions.';

alter table public.package_migrations enable row level security;

drop policy if exists "Allow public read package_migrations" on public.package_migrations;
create policy "Allow public read package_migrations"
  on public.package_migrations for select using (true);

notify pgrst, 'reload schema';
