-- Split solution "Asset Creation" (2-7) into Content / Copy / Design / Dev.
-- The pre-existing Content solution (2-41) is kept separate as "Content (Old)".
-- Later: the split Content solution (2-57) was deleted; see delete_content_solution_keep_content_old.sql.
-- Size suffixes: XXS → Extra Extra Small, XS → Extra Small, S → Small, M → Medium, L → Large; XL unchanged.
-- Tier IDs, tasks, pricing, and package links are preserved.

insert into public.solutions (solution_id, solution_name, solution_created_date, solution_modified_date)
values
  ('2-54', 'Copy', current_date, current_date),
  ('2-55', 'Design', current_date, current_date),
  ('2-56', 'Dev', current_date, current_date),
  ('2-57', 'Content', current_date, current_date)
on conflict (solution_id) do nothing;

update public.solutions
set
  solution_name = 'Content (Old)',
  solution_modified_date = current_date
where solution_id = '2-41';

-- Content (from Asset Creation) → new Content solution (not 2-41)
update public.solution_tiers
set
  solution_id = '2-57',
  solution_tier_modified_date = current_date
where solution_tier_id in ('3-106', '3-107', '3-108', '3-109');

-- Copy
update public.solution_tiers
set
  solution_id = '2-54',
  solution_tier_modified_date = current_date
where solution_tier_id in ('3-10', '3-79', '3-80', '3-81', '3-82');

-- Design
update public.solution_tiers
set
  solution_id = '2-55',
  solution_tier_modified_date = current_date
where solution_tier_id in ('3-11', '3-83', '3-84', '3-85', '3-86');

-- Dev
update public.solution_tiers
set
  solution_id = '2-56',
  solution_tier_modified_date = current_date
where solution_tier_id in ('3-87', '3-88', '3-89', '3-90');

-- Spell out size labels on Content (Old) + the four split solutions.
update public.solution_tiers
set
  solution_tier_name = regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(solution_tier_name, ' - XXS\b', ' - Extra Extra Small'),
          ' - XS\b',
          ' - Extra Small'
        ),
        ' - S\b',
        ' - Small'
      ),
      ' - M\b',
      ' - Medium'
    ),
    ' - L\b',
    ' - Large'
  ),
  solution_tier_modified_date = current_date
where solution_id in ('2-41', '2-54', '2-55', '2-56', '2-57');

delete from public.solutions
where solution_id = '2-7'
  and not exists (
    select 1 from public.solution_tiers t where t.solution_id = '2-7'
  );
