-- Package builder: configurable tier slots (label + hour + price ceilings) for agency “Build a Package”.
-- Each row is one slot; order is `sort_order` (unique). Primary key is `id` (uuid) so slots can be added/removed.

create table if not exists public.package_builder_slot_templates (
  id uuid primary key default gen_random_uuid(),
  sort_order int not null,
  label text not null,
  hour_ceiling numeric not null default 0,
  price_ceiling numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique (sort_order)
);

comment on table public.package_builder_slot_templates is
  'Named slots with hour/price ceilings for the agency “Build a Package” flow; order by sort_order.';

insert into public.package_builder_slot_templates (sort_order, label, hour_ceiling, price_ceiling)
values
  (1, 'Core', 40, 50000),
  (2, 'Growth', 80, 100000),
  (3, 'Enterprise', 160, 200000)
on conflict (sort_order) do nothing;

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
