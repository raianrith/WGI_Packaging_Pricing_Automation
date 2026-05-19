-- Optional disclaimer note per Build-a-Package tier slot (shown in agency wizard).

alter table public.package_builder_slot_templates
  add column if not exists tier_notes text;

comment on column public.package_builder_slot_templates.tier_notes is
  'Optional disclaimer shown when users select this package tier in Build a Package (steps 2 and 3).';

notify pgrst, 'reload schema';
