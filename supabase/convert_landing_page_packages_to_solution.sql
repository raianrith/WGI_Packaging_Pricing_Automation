-- Convert the two "Landing Page" custom packages into a single "Landing Page"
-- solution with two solution tiers.
--
--   Package "Landing Page - New"      -> tier "Landing Page - New"       ($5,000 / 18.4h)
--   Package "Landing Page - Template" -> tier "Landing Page - Template"  ($3,400 / 12.6h)
--
-- What this does (all in one transaction via a DO block):
--   1. Creates a "Landing Page" solution (id in the app's 2-n sequence).
--   2. Creates two tiers under it (ids in the app's 3-n sequence).
--   3. Seeds pricing rows using each package's current total (sell + hours).
--   4. Copies the combined tasks from each package's linked tiers into the
--      matching new tier (new ids in the app's 4-n sequence).
--   5. Deletes the two original packages (cascades package_solution_tiers).
--
-- Fail-safe: if either package can't be matched by name, or a "Landing Page"
-- solution already exists, the whole block aborts and changes nothing.
--
-- NOTE: Saved proposals (roadmap_proposals.proposal_state) are JSON snapshots.
-- Any already-saved proposal that referenced these packages keeps its snapshot
-- but the package will no longer resolve in the live catalog. New/edited
-- proposals will use the new solution + tiers.

-- Preview the packages that will be converted (run before executing if desired):
-- select package_id, package_name, package_category from public.packages
--   where lower(trim(package_name)) in ('landing page - new', 'landing page - template');

do $$
declare
  v_today          date := current_date;
  v_pkg_new_id     text;
  v_pkg_tpl_id     text;
  v_sol_id         text;
  v_tier_max       int;
  v_tier_new_id    text;
  v_tier_tpl_id    text;
  v_task_max       int;
  v_inserted       int;
  v_pkg_new_phase  text;
  v_pkg_new_cat    text;
  v_pkg_new_tac    text;
  v_pkg_tpl_phase  text;
  v_pkg_tpl_cat    text;
  v_pkg_tpl_tac    text;
begin
  -- 0. Guard: don't create a duplicate "Landing Page" solution on re-run.
  if exists (
    select 1 from public.solutions where lower(trim(solution_name)) = 'landing page'
  ) then
    raise exception 'A "Landing Page" solution already exists; aborting to avoid duplicates.';
  end if;

  -- 1. Resolve the two packages by name.
  select package_id into v_pkg_new_id
  from public.packages
  where lower(trim(package_name)) = 'landing page - new'
  limit 1;

  select package_id into v_pkg_tpl_id
  from public.packages
  where lower(trim(package_name)) = 'landing page - template'
  limit 1;

  if v_pkg_new_id is null or v_pkg_tpl_id is null then
    raise exception 'Could not match both packages (New=%, Template=%). Check exact names.',
      v_pkg_new_id, v_pkg_tpl_id;
  end if;

  select
    (phase_tags)[1], (category_tags)[1], (tactic_tags)[1]
  into v_pkg_new_phase, v_pkg_new_cat, v_pkg_new_tac
  from public.packages where package_id = v_pkg_new_id;

  select
    (phase_tags)[1], (category_tags)[1], (tactic_tags)[1]
  into v_pkg_tpl_phase, v_pkg_tpl_cat, v_pkg_tpl_tac
  from public.packages where package_id = v_pkg_tpl_id;

  create table if not exists public.package_migrations (
    former_package_id text primary key,
    solution_id text not null references public.solutions (solution_id) on delete cascade,
    solution_tier_id text null references public.solution_tiers (solution_tier_id) on delete set null,
    former_package_name text null,
    created_at timestamptz not null default now()
  );

  -- 2. Create the "Landing Page" solution (next id in the 2-n sequence).
  select '2-' || (coalesce(max(substring(solution_id from '^2-([0-9]+)$')::int), 0) + 1)
  into v_sol_id
  from public.solutions;

  insert into public.solutions
    (solution_id, solution_name, solution_created_date, solution_modified_date)
  values
    (v_sol_id, 'Landing Page', v_today, v_today);

  -- 3. Create the two tiers (next two ids in the 3-n sequence).
  select coalesce(max(substring(solution_tier_id from '^3-([0-9]+)$')::int), 0)
  into v_tier_max
  from public.solution_tiers;

  v_tier_new_id := '3-' || (v_tier_max + 1);
  v_tier_tpl_id := '3-' || (v_tier_max + 2);

  insert into public.solution_tiers
    (solution_tier_id, solution_id, solution_tier_name,
     solution_tier_phase, solution_tier_category, solution_tier_tactic,
     solution_tier_created_date, solution_tier_modified_date)
  values
    (v_tier_new_id, v_sol_id, 'Landing Page - New',
     nullif(trim(v_pkg_new_phase), ''), nullif(trim(v_pkg_new_cat), ''), nullif(trim(v_pkg_new_tac), ''),
     v_today, v_today),
    (v_tier_tpl_id, v_sol_id, 'Landing Page - Template',
     nullif(trim(v_pkg_tpl_phase), ''), nullif(trim(v_pkg_tpl_cat), ''), nullif(trim(v_pkg_tpl_tac), ''),
     v_today, v_today);

  -- 4. Seed pricing rows using each package's current totals.
  insert into public.solution_tier_pricing
    (solution_tier_id, total_hours, sell_price, standalone_sell_price)
  values
    (v_tier_new_id, 18.4, 5000, 5000),
    (v_tier_tpl_id, 12.6, 3400, 3400);

  -- 5. Copy tasks from each package's linked tiers into the matching new tier.
  select coalesce(max(substring(task_id from '^4-([0-9]+)$')::int), 0)
  into v_task_max
  from public.tasks;

  -- 5a. Landing Page - New
  insert into public.tasks
    (task_id, solution_tier_id, sort_order, task_name, task_implementer,
     task_time, task_duration, task_dependencies, task_notes,
     task_create_date, task_modified_date)
  select
    '4-' || (v_task_max + rn),
    v_tier_new_id,
    rn,
    src.task_name, src.task_implementer, src.task_time, src.task_duration,
    src.task_dependencies, src.task_notes, v_today, v_today
  from (
    select
      t.*,
      row_number() over (order by coalesce(t.sort_order, 1000000), t.task_id) as rn
    from public.tasks t
    join public.package_solution_tiers pst on pst.solution_tier_id = t.solution_tier_id
    where pst.package_id = v_pkg_new_id
  ) src;
  get diagnostics v_inserted = row_count;
  v_task_max := v_task_max + v_inserted;

  -- 5b. Landing Page - Template
  insert into public.tasks
    (task_id, solution_tier_id, sort_order, task_name, task_implementer,
     task_time, task_duration, task_dependencies, task_notes,
     task_create_date, task_modified_date)
  select
    '4-' || (v_task_max + rn),
    v_tier_tpl_id,
    rn,
    src.task_name, src.task_implementer, src.task_time, src.task_duration,
    src.task_dependencies, src.task_notes, v_today, v_today
  from (
    select
      t.*,
      row_number() over (order by coalesce(t.sort_order, 1000000), t.task_id) as rn
    from public.tasks t
    join public.package_solution_tiers pst on pst.solution_tier_id = t.solution_tier_id
    where pst.package_id = v_pkg_tpl_id
  ) src;

  -- 6. Record redirects so old /package/… links open the new tiers.
  insert into public.package_migrations (former_package_id, solution_id, solution_tier_id, former_package_name)
  values
    (v_pkg_new_id, v_sol_id, v_tier_new_id, 'Landing Page - New'),
    (v_pkg_tpl_id, v_sol_id, v_tier_tpl_id, 'Landing Page - Template')
  on conflict (former_package_id) do update
    set solution_id = excluded.solution_id,
        solution_tier_id = excluded.solution_tier_id,
        former_package_name = excluded.former_package_name;

  -- 7. Delete the original packages (cascades package_solution_tiers + overrides).
  delete from public.packages where package_id in (v_pkg_new_id, v_pkg_tpl_id);

  raise notice 'Created solution % ("Landing Page") with tiers % and %; deleted packages % and %.',
    v_sol_id, v_tier_new_id, v_tier_tpl_id, v_pkg_new_id, v_pkg_tpl_id;
end $$;

-- Verify the new solution, tiers, pricing, and task counts.
select s.solution_id, s.solution_name,
       st.solution_tier_id, st.solution_tier_name,
       p.total_hours, p.sell_price,
       (select count(*) from public.tasks t where t.solution_tier_id = st.solution_tier_id) as task_count
from public.solutions s
join public.solution_tiers st on st.solution_id = s.solution_id
left join public.solution_tier_pricing p on p.solution_tier_id = st.solution_tier_id
where lower(trim(s.solution_name)) = 'landing page'
order by st.solution_tier_id;

notify pgrst, 'reload schema';
