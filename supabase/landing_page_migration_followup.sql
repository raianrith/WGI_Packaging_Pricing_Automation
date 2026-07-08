-- Follow-up after convert_landing_page_packages_to_solution.sql has already run.
-- 1) Creates package_migrations (if needed)
-- 2) Backfills redirects from audit_log so old /package/… links open the new tiers
-- 3) Copies playbook tags from the deleted packages onto the new tiers

-- ---------------------------------------------------------------------------
-- package_migrations table
-- ---------------------------------------------------------------------------
create table if not exists public.package_migrations (
  former_package_id text primary key,
  solution_id text not null references public.solutions (solution_id) on delete cascade,
  solution_tier_id text null references public.solution_tiers (solution_tier_id) on delete set null,
  former_package_name text null,
  created_at timestamptz not null default now()
);

alter table public.package_migrations enable row level security;

drop policy if exists "Allow public read package_migrations" on public.package_migrations;
create policy "Allow public read package_migrations"
  on public.package_migrations for select using (true);

-- ---------------------------------------------------------------------------
-- Redirect rows: former package id → new solution tier (name match via audit_log)
-- ---------------------------------------------------------------------------
insert into public.package_migrations (former_package_id, solution_id, solution_tier_id, former_package_name)
select distinct on (al.entity_id)
  al.entity_id,
  st.solution_id,
  st.solution_tier_id,
  coalesce(al.after_data->>'package_name', al.before_data->>'package_name')
from public.audit_log al
inner join public.solution_tiers st
  on lower(trim(st.solution_tier_name)) = lower(trim(coalesce(al.after_data->>'package_name', al.before_data->>'package_name')))
where al.entity_type = 'packages'
  and lower(trim(coalesce(al.after_data->>'package_name', al.before_data->>'package_name'))) in (
    'landing page - new',
    'landing page - template'
  )
order by al.entity_id, al.created_at desc
on conflict (former_package_id) do update
  set solution_id = excluded.solution_id,
      solution_tier_id = excluded.solution_tier_id,
      former_package_name = excluded.former_package_name;

-- ---------------------------------------------------------------------------
-- Playbook tags: first tag from each package array → tier phase/category/tactic
-- ---------------------------------------------------------------------------
update public.solution_tiers st
set
  solution_tier_phase = nullif(trim(tags.phase), ''),
  solution_tier_category = nullif(trim(tags.category), ''),
  solution_tier_tactic = nullif(trim(tags.tactic), ''),
  solution_tier_modified_date = current_date
from (
  select distinct on (lower(trim(coalesce(al.after_data->>'package_name', al.before_data->>'package_name'))))
    lower(trim(coalesce(al.after_data->>'package_name', al.before_data->>'package_name'))) as pkg_name,
    coalesce(al.after_data->'phase_tags', al.before_data->'phase_tags')->>0 as phase,
    coalesce(al.after_data->'category_tags', al.before_data->'category_tags')->>0 as category,
    coalesce(al.after_data->'tactic_tags', al.before_data->'tactic_tags')->>0 as tactic
  from public.audit_log al
  where al.entity_type = 'packages'
    and lower(trim(coalesce(al.after_data->>'package_name', al.before_data->>'package_name'))) in (
      'landing page - new',
      'landing page - template'
    )
  order by lower(trim(coalesce(al.after_data->>'package_name', al.before_data->>'package_name'))), al.created_at desc
) tags
where lower(trim(st.solution_tier_name)) = tags.pkg_name;

-- Verify redirects + tags
select pm.former_package_id, pm.former_package_name, pm.solution_id, pm.solution_tier_id,
       st.solution_tier_phase, st.solution_tier_category, st.solution_tier_tactic
from public.package_migrations pm
left join public.solution_tiers st on st.solution_tier_id = pm.solution_tier_id
where lower(coalesce(pm.former_package_name, '')) like 'landing page%'
order by pm.former_package_id;

notify pgrst, 'reload schema';
