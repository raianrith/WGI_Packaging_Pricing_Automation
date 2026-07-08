-- Copy old Landing Page package narrative onto the new solution tiers.
-- v2: joins package_migrations by package id, picks the richest audit snapshot,
-- merges tier_overrides from package_solution_tiers audit, and falls back across
-- audit rows that only exist under before_data.
--
-- Safe to re-run.

-- Optional diagnostic (uncomment to inspect what audit has before updating):
-- select pm.former_package_id, pm.former_package_name, al.action, al.created_at,
--        nullif(trim(coalesce(al.after_data, al.before_data)->>'package_overview'), '') as overview,
--        nullif(trim(coalesce(al.after_data, al.before_data)->>'package_what_is_it'), '') is not null as has_what
-- from public.package_migrations pm
-- join public.audit_log al on al.entity_type = 'packages' and al.entity_id = pm.former_package_id
-- where lower(coalesce(pm.former_package_name, '')) like 'landing page%'
-- order by pm.former_package_name, al.created_at desc;

with migration as (
  select former_package_id, solution_tier_id, former_package_name
  from public.package_migrations
  where lower(coalesce(former_package_name, '')) like 'landing page%'
),
audit_rows as (
  select
    m.solution_tier_id,
    m.former_package_id,
    m.former_package_name,
    al.created_at,
    coalesce(al.after_data, al.before_data) as d,
    (
      (case when nullif(trim(coalesce(al.after_data, al.before_data)->>'package_overview'), '') is not null then 4 else 0 end) +
      (case when nullif(trim(coalesce(al.after_data, al.before_data)->>'package_direction'), '') is not null then 2 else 0 end) +
      (case when nullif(trim(coalesce(al.after_data, al.before_data)->>'package_what_is_it'), '') is not null then 1 else 0 end) +
      (case when nullif(trim(coalesce(al.after_data, al.before_data)->>'package_why_is_it_valuable'), '') is not null then 1 else 0 end) +
      (case when nullif(trim(coalesce(al.after_data, al.before_data)->>'package_when_should_it_be_used'), '') is not null then 1 else 0 end) +
      (case when nullif(trim(coalesce(al.after_data, al.before_data)->>'package_assumption_prerequisites'), '') is not null then 1 else 0 end) +
      (case when nullif(trim(coalesce(al.after_data, al.before_data)->>'package_in_scope'), '') is not null then 1 else 0 end) +
      (case when nullif(trim(coalesce(al.after_data, al.before_data)->>'package_out_of_scope'), '') is not null then 1 else 0 end) +
      (case when nullif(trim(coalesce(al.after_data, al.before_data)->>'package_final_deliverable'), '') is not null then 1 else 0 end) +
      (case when nullif(trim(coalesce(al.after_data, al.before_data)->>'package_how_do_we_get_this_work_done'), '') is not null then 1 else 0 end) +
      (case when nullif(trim(coalesce(al.after_data, al.before_data)->>'package_sop'), '') is not null then 1 else 0 end) +
      (case when nullif(trim(coalesce(al.after_data, al.before_data)->>'package_resources'), '') is not null then 1 else 0 end) +
      (case when nullif(trim(coalesce(al.after_data, al.before_data)->>'package_resource_templates'), '') is not null then 1 else 0 end) +
      (case when nullif(trim(coalesce(al.after_data, al.before_data)->>'package_resource_tools'), '') is not null then 1 else 0 end) +
      (case when coalesce(al.after_data, al.before_data)->'package_resource_examples' is not null
            and coalesce(al.after_data, al.before_data)->'package_resource_examples' <> '[]'::jsonb then 1 else 0 end)
    ) as score
  from migration m
  join public.audit_log al
    on al.entity_type = 'packages'
   and al.entity_id = m.former_package_id
),
best_package as (
  select distinct on (solution_tier_id)
    solution_tier_id,
    d
  from audit_rows
  order by solution_tier_id, score desc, created_at desc
),
override_rows as (
  select
    m.solution_tier_id,
    al.created_at,
    coalesce(al.after_data, al.before_data)->'tier_overrides' as ov,
    (
      (case when nullif(trim(coalesce(al.after_data, al.before_data)->'tier_overrides'->>'solution_tier_overview'), '') is not null then 4 else 0 end) +
      (case when nullif(trim(coalesce(al.after_data, al.before_data)->'tier_overrides'->>'solution_tier_direction'), '') is not null then 2 else 0 end) +
      (case when nullif(trim(coalesce(al.after_data, al.before_data)->'tier_overrides'->>'solution_tier_what_is_it'), '') is not null then 1 else 0 end) +
      (case when nullif(trim(coalesce(al.after_data, al.before_data)->'tier_overrides'->>'solution_tier_final_deliverable'), '') is not null then 1 else 0 end)
    ) as score
  from migration m
  join public.audit_log al
    on al.entity_type = 'package_solution_tiers'
   and coalesce(al.after_data, al.before_data)->>'package_id' = m.former_package_id
  where coalesce(al.after_data, al.before_data)->'tier_overrides' is not null
    and coalesce(al.after_data, al.before_data)->'tier_overrides' <> '{}'::jsonb
),
best_override as (
  select distinct on (solution_tier_id)
    solution_tier_id,
    ov
  from override_rows
  order by solution_tier_id, score desc, created_at desc
),
merged as (
  select
    m.solution_tier_id,
    nullif(trim(coalesce(p.d->>'package_overview', o.ov->>'solution_tier_overview')), '') as overview,
    nullif(trim(coalesce(p.d->>'package_overview_link', o.ov->>'solution_tier_overview_link')), '') as overview_link,
    nullif(trim(coalesce(p.d->>'package_direction', o.ov->>'solution_tier_direction')), '') as direction,
    nullif(trim(coalesce(p.d->>'package_sop', o.ov->>'solution_tier_sop')), '') as sop,
    nullif(trim(coalesce(p.d->>'package_resources', o.ov->>'solution_tier_resources')), '') as resources,
    nullif(trim(coalesce(p.d->>'package_resource_templates', o.ov->>'solution_tier_resource_templates')), '') as resource_templates,
    nullif(trim(coalesce(p.d->>'package_resource_tools', o.ov->>'solution_tier_resource_tools')), '') as resource_tools,
    coalesce(p.d->'package_resource_examples', o.ov->'solution_tier_resource_examples') as resource_examples,
    nullif(trim(coalesce(p.d->>'package_what_is_it', o.ov->>'solution_tier_what_is_it')), '') as what_is_it,
    nullif(trim(coalesce(p.d->>'package_why_is_it_valuable', o.ov->>'solution_tier_why_is_it_valuable')), '') as why_valuable,
    nullif(trim(coalesce(p.d->>'package_when_should_it_be_used', o.ov->>'solution_tier_when_should_it_be_used')), '') as when_used,
    nullif(trim(coalesce(p.d->>'package_assumption_prerequisites', o.ov->>'solution_tier_assumption_prerequisites')), '') as assumption_prerequisites,
    nullif(trim(coalesce(p.d->>'package_in_scope', o.ov->>'solution_tier_in_scope')), '') as in_scope,
    nullif(trim(coalesce(p.d->>'package_out_of_scope', o.ov->>'solution_tier_out_of_scope')), '') as out_of_scope,
    nullif(trim(coalesce(p.d->>'package_final_deliverable', o.ov->>'solution_tier_final_deliverable')), '') as final_deliverable,
    nullif(trim(coalesce(p.d->>'package_how_do_we_get_this_work_done', o.ov->>'solution_tier_how_do_we_get_this_work_done')), '') as how_work_done
  from migration m
  left join best_package p on p.solution_tier_id = m.solution_tier_id
  left join best_override o on o.solution_tier_id = m.solution_tier_id
)
update public.solution_tiers st
set
  solution_tier_overview                     = src.overview,
  solution_tier_overview_link                = src.overview_link,
  solution_tier_direction                    = src.direction,
  solution_tier_sop                          = src.sop,
  solution_tier_resources                    = src.resources,
  solution_tier_resource_templates           = src.resource_templates,
  solution_tier_resource_tools               = src.resource_tools,
  solution_tier_resource_examples            = src.resource_examples,
  solution_tier_what_is_it                   = src.what_is_it,
  solution_tier_why_is_it_valuable           = src.why_valuable,
  solution_tier_when_should_it_be_used       = src.when_used,
  solution_tier_assumption_prerequisites     = src.assumption_prerequisites,
  solution_tier_in_scope                     = src.in_scope,
  solution_tier_out_of_scope                 = src.out_of_scope,
  solution_tier_final_deliverable            = src.final_deliverable,
  solution_tier_how_do_we_get_this_work_done = src.how_work_done,
  solution_tier_modified_date                = current_date
from merged src
where st.solution_tier_id = src.solution_tier_id;

-- If Landing Page - New still has no overview, copy overview fields from Template
-- (some packages only had narrative saved on one variant).
update public.solution_tiers new_t
set
  solution_tier_overview      = coalesce(nullif(trim(new_t.solution_tier_overview), ''), nullif(trim(tpl.solution_tier_overview), '')),
  solution_tier_overview_link = coalesce(nullif(trim(new_t.solution_tier_overview_link), ''), nullif(trim(tpl.solution_tier_overview_link), '')),
  solution_tier_direction   = coalesce(nullif(trim(new_t.solution_tier_direction), ''), nullif(trim(tpl.solution_tier_direction), '')),
  solution_tier_what_is_it  = coalesce(nullif(trim(new_t.solution_tier_what_is_it), ''), nullif(trim(tpl.solution_tier_what_is_it), '')),
  solution_tier_why_is_it_valuable = coalesce(nullif(trim(new_t.solution_tier_why_is_it_valuable), ''), nullif(trim(tpl.solution_tier_why_is_it_valuable), '')),
  solution_tier_when_should_it_be_used = coalesce(nullif(trim(new_t.solution_tier_when_should_it_be_used), ''), nullif(trim(tpl.solution_tier_when_should_it_be_used), '')),
  solution_tier_assumption_prerequisites = coalesce(nullif(trim(new_t.solution_tier_assumption_prerequisites), ''), nullif(trim(tpl.solution_tier_assumption_prerequisites), '')),
  solution_tier_in_scope      = coalesce(nullif(trim(new_t.solution_tier_in_scope), ''), nullif(trim(tpl.solution_tier_in_scope), '')),
  solution_tier_out_of_scope  = coalesce(nullif(trim(new_t.solution_tier_out_of_scope), ''), nullif(trim(tpl.solution_tier_out_of_scope), '')),
  solution_tier_final_deliverable = coalesce(nullif(trim(new_t.solution_tier_final_deliverable), ''), nullif(trim(tpl.solution_tier_final_deliverable), '')),
  solution_tier_how_do_we_get_this_work_done = coalesce(nullif(trim(new_t.solution_tier_how_do_we_get_this_work_done), ''), nullif(trim(tpl.solution_tier_how_do_we_get_this_work_done), '')),
  solution_tier_sop           = coalesce(nullif(trim(new_t.solution_tier_sop), ''), nullif(trim(tpl.solution_tier_sop), '')),
  solution_tier_resources     = coalesce(nullif(trim(new_t.solution_tier_resources), ''), nullif(trim(tpl.solution_tier_resources), '')),
  solution_tier_resource_templates = coalesce(nullif(trim(new_t.solution_tier_resource_templates), ''), nullif(trim(tpl.solution_tier_resource_templates), '')),
  solution_tier_resource_tools = coalesce(nullif(trim(new_t.solution_tier_resource_tools), ''), nullif(trim(tpl.solution_tier_resource_tools), '')),
  solution_tier_modified_date = current_date
from public.solution_tiers tpl
where lower(trim(new_t.solution_tier_name)) = 'landing page - new'
  and lower(trim(tpl.solution_tier_name)) = 'landing page - template'
  and new_t.solution_id = tpl.solution_id
  and exists (
    select 1 from public.solutions s
    where s.solution_id = new_t.solution_id
      and lower(trim(s.solution_name)) = 'landing page'
  );

-- Verify
select st.solution_tier_id, st.solution_tier_name,
       left(coalesce(st.solution_tier_overview, ''), 80) as overview_preview,
       st.solution_tier_what_is_it is not null as has_what_is_it,
       st.solution_tier_final_deliverable is not null as has_deliverable,
       st.solution_tier_direction is not null as has_direction
from public.solution_tiers st
where lower(trim(st.solution_tier_name)) in ('landing page - new', 'landing page - template')
order by st.solution_tier_id;

notify pgrst, 'reload schema';
