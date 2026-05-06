-- Per-tier display order for vault tasks. Run in SQL Editor after public.tasks exists.

alter table public.tasks add column if not exists sort_order integer not null default 0;

comment on column public.tasks.sort_order is 'Display order within solution_tier_id (lower = earlier). Tie-break task_id when equal.';

-- Backfill deterministic order within each tier from existing ids.
with ranked as (
  select
    task_id,
    row_number() over (
      partition by solution_tier_id
      order by task_id
    )::integer as ord
  from public.tasks
)
update public.tasks t
set sort_order = r.ord
from ranked r
where t.task_id = r.task_id;

notify pgrst, 'reload schema';
