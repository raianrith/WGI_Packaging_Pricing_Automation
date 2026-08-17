-- Remove the Asset Creation split "Content" solution (2-57).
-- Keep the original Content solution as "Content (Old)" (2-41) with tiers 3-112–3-117.
-- Tiers 3-106–3-109 and their tasks/pricing are deleted. Package links to those
-- tiers (1-39, 1-40, 1-41, 1-43, 1-53) are removed by cascade/delete.

update public.task_group_lines
set
  line_type = 'archetype',
  source_task_id = null
where source_task_id in (
  select task_id from public.tasks where solution_tier_id in ('3-106', '3-107', '3-108', '3-109')
);

delete from public.tasks
where solution_tier_id in ('3-106', '3-107', '3-108', '3-109');

delete from public.package_solution_tiers
where solution_tier_id in ('3-106', '3-107', '3-108', '3-109');

delete from public.solution_tier_pricing
where solution_tier_id in ('3-106', '3-107', '3-108', '3-109');

delete from public.solution_tiers
where solution_tier_id in ('3-106', '3-107', '3-108', '3-109')
  and solution_id = '2-57';

delete from public.solutions
where solution_id = '2-57'
  and not exists (
    select 1 from public.solution_tiers t where t.solution_id = '2-57'
  );
