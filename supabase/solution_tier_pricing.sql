-- Pricing rows: one row per solution tier (links to public.solution_tiers).
-- Run in Supabase → SQL Editor after solution_tiers (and solutions) exist.
-- If you use RLS, add policies (see bottom) or merge into read_policies_for_dashboard.sql.

create table if not exists public.solution_tier_pricing (
  solution_tier_id text not null primary key
    references public.solution_tiers (solution_tier_id) on delete cascade,

  -- Optional: spreadsheet “Solution ID” column if it stores a label, not solutions.solution_id.
  offering_label text null,

  -- Spreadsheet "Tier" (e.g. Basic, Standard); may differ from solution_tier_name.
  tier_label text null,

  scope text null,

  -- Role / discipline hours (spreadsheet hour columns)
  hours_client_services numeric(12, 2) null default 0,
  hours_copy numeric(12, 2) null default 0,
  hours_design numeric(12, 2) null default 0,
  hours_web_dev numeric(12, 2) null default 0,
  hours_video numeric(12, 2) null default 0,
  hours_data numeric(12, 2) null default 0,
  hours_paid_media numeric(12, 2) null default 0,
  hours_hubspot numeric(12, 2) null default 0,
  hours_other numeric(12, 2) null default 0,

  total_hours numeric(12, 2) null,

  expected_effort_base_price numeric(14, 2) null,
  scope_risk numeric(12, 4) null default 0,
  internal_coordination numeric(12, 4) null default 0,
  client_revision_risk numeric(12, 4) null default 0,
  risk_multiplier numeric(12, 4) null default 1,
  risk_mitigated_base_price numeric(14, 2) null,

  strategic_value_score numeric(12, 4) null,
  strategic_value_multiplier numeric(12, 4) null default 1,

  sell_price numeric(14, 2) null,
  standalone_sell_price numeric(14, 2) null,
  old_price numeric(14, 2) null,
  -- Store display values like "-2.05%" or "n/a" from spreadsheets
  percent_change text null,

  requires_customization boolean not null default false,
  taxable boolean not null default false,

  notes text null,
  tags text null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.solution_tier_pricing is
  'Per–solution-tier pricing: hours, costs, multipliers, sell prices (spreadsheet import).';

-- Resolve solution_id in queries: join solution_tiers st on st.solution_tier_id = pricing.solution_tier_id

-- Keep updated_at fresh on row changes (optional)
create or replace function public.set_solution_tier_pricing_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_solution_tier_pricing_updated_at on public.solution_tier_pricing;
create trigger trg_solution_tier_pricing_updated_at
  before update on public.solution_tier_pricing
  for each row execute procedure public.set_solution_tier_pricing_updated_at();

-- Optional: notify PostgREST to reload schema after DDL
-- select pg_notify('pgrst', 'reload schema');

-- ---------------------------------------------------------------------------
-- Optional RLS (mirror other knowledge-base tables — tighten for production)
-- ---------------------------------------------------------------------------
-- alter table public.solution_tier_pricing enable row level security;
--
-- drop policy if exists "Allow public read solution_tier_pricing" on public.solution_tier_pricing;
-- create policy "Allow public read solution_tier_pricing"
--   on public.solution_tier_pricing for select using (true);
--
-- drop policy if exists "Allow insert solution_tier_pricing" on public.solution_tier_pricing;
-- drop policy if exists "Allow update solution_tier_pricing" on public.solution_tier_pricing;
-- drop policy if exists "Allow delete solution_tier_pricing" on public.solution_tier_pricing;
-- create policy "Allow insert solution_tier_pricing"
--   on public.solution_tier_pricing for insert with check (true);
-- create policy "Allow update solution_tier_pricing"
--   on public.solution_tier_pricing for update using (true);
-- create policy "Allow delete solution_tier_pricing"
--   on public.solution_tier_pricing for delete using (true);
