-- Move misplaced "Web Dev - L" (3-89) from Customer Interviews → Asset Creation.
-- Applied in production 2026-06-02. Safe to re-run only if tier is still on Customer Interviews.

-- Preview
select st.solution_tier_id, st.solution_tier_name, s.solution_name, p.sell_price
from public.solution_tiers st
join public.solutions s on s.solution_id = st.solution_id
left join public.solution_tier_pricing p on p.solution_tier_id = st.solution_tier_id
where st.solution_tier_id = '3-89';

-- Remove empty duplicate "Web Dev - L" on Asset Creation (no tasks/pricing)
delete from public.solution_tiers
where solution_tier_id = '3-91'
  and solution_id = (select solution_id from public.solutions where solution_name = 'Asset Creation' limit 1)
  and not exists (select 1 from public.tasks t where t.solution_tier_id = '3-91');

update public.solution_tiers
set
  solution_id = (select solution_id from public.solutions where solution_name = 'Asset Creation' limit 1),
  solution_tier_modified_date = current_date
where solution_tier_id = '3-89'
  and solution_id = (select solution_id from public.solutions where solution_name = 'Customer Interviews' limit 1);
