-- Standalone solutions: not tied to a package. Run once in SQL Editor.
-- PostgreSQL foreign keys allow NULL; orphaned checks are skipped when package_id is null.

alter table public.solutions alter column package_id drop not null;

comment on column public.solutions.package_id is 'Optional. NULL = standalone solution (tiers/tasks still apply).';

notify pgrst, 'reload schema';
