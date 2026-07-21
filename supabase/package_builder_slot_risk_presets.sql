-- Preset risk / strategic scores per Build-a-Package tier slot.
-- Copied onto packages.package_pricing_overrides when a package is created from the slot.

alter table public.package_builder_slot_templates
  add column if not exists scope_risk smallint,
  add column if not exists internal_coordination smallint,
  add column if not exists client_revision_risk smallint,
  add column if not exists strategic_value_score smallint;

comment on column public.package_builder_slot_templates.scope_risk is
  'Preset scope risk (0–2) applied to packages built from this slot.';
comment on column public.package_builder_slot_templates.internal_coordination is
  'Preset internal coordination (0–2) applied to packages built from this slot.';
comment on column public.package_builder_slot_templates.client_revision_risk is
  'Preset client revision risk (0–2) applied to packages built from this slot.';
comment on column public.package_builder_slot_templates.strategic_value_score is
  'Preset strategic value score (0–2) applied to packages built from this slot.';

alter table public.package_builder_slot_templates
  drop constraint if exists package_builder_slot_templates_scope_risk_check;
alter table public.package_builder_slot_templates
  add constraint package_builder_slot_templates_scope_risk_check
  check (scope_risk is null or scope_risk between 0 and 2);

alter table public.package_builder_slot_templates
  drop constraint if exists package_builder_slot_templates_internal_coordination_check;
alter table public.package_builder_slot_templates
  add constraint package_builder_slot_templates_internal_coordination_check
  check (internal_coordination is null or internal_coordination between 0 and 2);

alter table public.package_builder_slot_templates
  drop constraint if exists package_builder_slot_templates_client_revision_risk_check;
alter table public.package_builder_slot_templates
  add constraint package_builder_slot_templates_client_revision_risk_check
  check (client_revision_risk is null or client_revision_risk between 0 and 2);

alter table public.package_builder_slot_templates
  drop constraint if exists package_builder_slot_templates_strategic_value_score_check;
alter table public.package_builder_slot_templates
  add constraint package_builder_slot_templates_strategic_value_score_check
  check (strategic_value_score is null or strategic_value_score between 0 and 2);

notify pgrst, 'reload schema';
