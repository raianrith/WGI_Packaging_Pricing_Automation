-- Package builder: three configurable "slots" (tier templates) with hour + price ceilings.
-- Used by Solutions Overview → Packages → Build a Package, and editable in Admin → Package Builder.

create table if not exists public.package_builder_slot_templates (
  slot int primary key check (slot >= 1 and slot <= 3),
  label text not null,
  hour_ceiling numeric not null default 0,
  price_ceiling numeric not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.package_builder_slot_templates is
  'Three named slots with hour/price ceilings for the agency “Build a Package” flow.';

insert into public.package_builder_slot_templates (slot, label, hour_ceiling, price_ceiling)
values
  (1, 'Core', 40, 50000),
  (2, 'Growth', 80, 100000),
  (3, 'Enterprise', 160, 200000)
on conflict (slot) do nothing;

alter table public.package_builder_slot_templates enable row level security;

drop policy if exists "Allow public read package_builder_slot_templates"
  on public.package_builder_slot_templates;
create policy "Allow public read package_builder_slot_templates"
  on public.package_builder_slot_templates for select using (true);

drop policy if exists "Allow insert package_builder_slot_templates"
  on public.package_builder_slot_templates;
drop policy if exists "Allow update package_builder_slot_templates"
  on public.package_builder_slot_templates;
drop policy if exists "Allow delete package_builder_slot_templates"
  on public.package_builder_slot_templates;

create policy "Allow insert package_builder_slot_templates"
  on public.package_builder_slot_templates for insert with check (true);
create policy "Allow update package_builder_slot_templates"
  on public.package_builder_slot_templates for update using (true);
create policy "Allow delete package_builder_slot_templates"
  on public.package_builder_slot_templates for delete using (true);

notify pgrst, 'reload schema';
