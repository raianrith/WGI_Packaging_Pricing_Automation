-- Package card blurb for Custom Package Builder / configurable package cards.
-- Run in Supabase SQL editor after package_builder_package_types exists.

alter table public.package_builder_package_types
  add column if not exists card_description text null;

comment on column public.package_builder_package_types.card_description is
  'Short description shown on this template’s card in Custom Package Builder.';

notify pgrst, 'reload schema';
