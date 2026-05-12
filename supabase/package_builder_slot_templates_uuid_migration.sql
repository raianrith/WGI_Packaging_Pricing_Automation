-- One-time migration: old `slot` int PK (1–3) → uuid `id` + `sort_order`.
-- Run in Supabase SQL Editor if you already applied the legacy `package_builder_slot_templates.sql`
-- (with `slot int primary key`). Safe to re-run: exits early when `id` column already exists.

do $$
begin
  if not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'package_builder_slot_templates'
  ) then
    return;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'package_builder_slot_templates'
      and column_name = 'id'
  ) then
    return;
  end if;

  alter table public.package_builder_slot_templates add column id uuid default gen_random_uuid();
  alter table public.package_builder_slot_templates add column sort_order int;

  update public.package_builder_slot_templates set sort_order = slot where sort_order is null;
  update public.package_builder_slot_templates set id = gen_random_uuid() where id is null;

  alter table public.package_builder_slot_templates drop constraint if exists package_builder_slot_templates_pkey;
  alter table public.package_builder_slot_templates drop constraint if exists package_builder_slot_templates_slot_check;

  alter table public.package_builder_slot_templates drop column if exists slot;

  alter table public.package_builder_slot_templates alter column id set not null;
  alter table public.package_builder_slot_templates alter column sort_order set not null;

  alter table public.package_builder_slot_templates add primary key (id);

  create unique index if not exists package_builder_slot_templates_sort_order_ux
    on public.package_builder_slot_templates (sort_order);
end $$;

notify pgrst, 'reload schema';
