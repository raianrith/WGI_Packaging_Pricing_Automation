-- Historical change log for admin edits. Run once in SQL Editor.

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null
    check (entity_type in ('packages', 'solutions', 'solution_tiers', 'tasks')),
  entity_id text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_log_created_at on public.audit_log (created_at desc);
create index if not exists idx_audit_log_entity on public.audit_log (entity_type, entity_id);

comment on table public.audit_log is 'Append-only history of packaging data changes from the Admin console.';

-- Nudge PostgREST to pick up the new table if you still see "schema cache" errors:
notify pgrst, 'reload schema';
