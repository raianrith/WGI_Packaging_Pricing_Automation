-- Backfill working-day duration from hours (ops standard bands).
-- Run in Supabase SQL editor after deploying the UI auto-fill.
--
--   hours < 4      → 3 days
--   hours 4–8      → 4 days
--   hours 8–12     → 5 days
--   hours 12–24    → 8 days
--   hours 24+      → 12 days
--
-- Overwrites existing duration values so the whole vault matches the standard.
-- Manual overrides remain possible afterward in Solutions Builder / Task groups / Packages.

update public.tasks
set task_duration = case
  when task_time < 4 then 3
  when task_time <= 8 then 4
  when task_time <= 12 then 5
  when task_time <= 24 then 8
  else 12
end
where task_time is not null
  and task_time >= 0;

update public.task_group_lines
set duration = case
  when hours < 4 then 3
  when hours <= 8 then 4
  when hours <= 12 then 5
  when hours <= 24 then 8
  else 12
end
where hours is not null
  and hours >= 0;

notify pgrst, 'reload schema';
