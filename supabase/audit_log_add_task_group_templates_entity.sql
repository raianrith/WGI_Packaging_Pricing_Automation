-- Same as audit_log_task_groups_v2.sql; kept for older runbooks.
-- Widen audit_log entity_type for task groups v2 (run after task_groups_v2.sql).

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
      'package_solution_tiers',
      'task_groups',
      'task_group_lines',
      'solution_tier_task_group_applied'
    )
  );

notify pgrst, 'reload schema';
