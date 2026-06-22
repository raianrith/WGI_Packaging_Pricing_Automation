-- Add Acceleration Phase to the tier phase taxonomy list (idempotent).
insert into public.solution_tier_taxonomy_options (kind, label) values
  ('phase', 'Acceleration Phase')
on conflict (kind, label) do update
  set updated_at = now();
