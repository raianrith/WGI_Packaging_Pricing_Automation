-- Optional choice buckets: builders may skip (0..pick_count) instead of picking exactly N.
alter table public.package_builder_slot_buckets
  add column if not exists optional boolean not null default false;

comment on column public.package_builder_slot_buckets.optional is
  'When true, Build a Package may select 0..pick_count members. When false, exactly pick_count is required.';
