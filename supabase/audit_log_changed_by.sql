-- Capture who performed each audit_log insert (run in SQL Editor after audit_log exists).

alter table public.audit_log
  add column if not exists changed_by_user_id uuid references auth.users (id) on delete set null;

alter table public.audit_log
  add column if not exists changed_by_email text;

comment on column public.audit_log.changed_by_user_id is 'Authenticated user id at insert time (from Supabase Auth).';
comment on column public.audit_log.changed_by_email is 'Email copied at insert time for Change History display.';

notify pgrst, 'reload schema';
