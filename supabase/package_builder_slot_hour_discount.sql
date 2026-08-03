-- Hour discount % applied when building a package from this slot (Build a Package).
-- Null = fall back to label-based defaults (Basic 20 / Standard 25 / Advanced 30).
-- Run after package_builder_slot_templates exists.

alter table public.package_builder_slot_templates
  add column if not exists hour_discount_pct numeric
    check (hour_discount_pct is null or (hour_discount_pct >= 0 and hour_discount_pct <= 100));

comment on column public.package_builder_slot_templates.hour_discount_pct is
  'Package hour discount % (0–100) when building from this tier; null uses label-based Basic/Standard/Advanced defaults.';

notify pgrst, 'reload schema';
