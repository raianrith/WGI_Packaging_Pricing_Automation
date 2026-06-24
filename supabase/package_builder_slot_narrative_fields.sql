-- Package narrative fields on Build-a-Package tier slots (copied to custom packages on create).
-- Run after package_builder_types_and_slots_v2.sql and packages_builder_v2_fields.sql.

alter table public.package_builder_slot_templates
  add column if not exists package_owner text,
  add column if not exists package_overview text,
  add column if not exists package_overview_link text,
  add column if not exists package_direction text,
  add column if not exists package_what_is_it text,
  add column if not exists package_why_is_it_valuable text,
  add column if not exists package_when_should_it_be_used text,
  add column if not exists package_assumption_prerequisites text,
  add column if not exists package_in_scope text,
  add column if not exists package_out_of_scope text,
  add column if not exists package_final_deliverable text,
  add column if not exists package_how_do_we_get_this_work_done text,
  add column if not exists package_sop text,
  add column if not exists package_resources text,
  add column if not exists package_resource_templates text,
  add column if not exists package_resource_tools text;

comment on column public.package_builder_slot_templates.package_overview is
  'Default package overview copied when a user builds a package from this slot.';

notify pgrst, 'reload schema';
