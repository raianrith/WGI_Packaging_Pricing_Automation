-- Persist Proposal Builder roadmaps by client and roadmap name.
-- Run after the core catalog tables/policies are in place.

create table if not exists public.roadmap_proposals (
  id uuid primary key default gen_random_uuid(),
  client_label text not null,
  roadmap_title text not null,
  horizon text null,
  client_budget text null,
  proposal_state jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references auth.users (id) on delete set null,
  created_by_email text null,
  updated_by_user_id uuid references auth.users (id) on delete set null,
  updated_by_email text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.roadmap_proposals is
  'Saved Proposal Builder snapshots grouped by client/opportunity and roadmap name.';

comment on column public.roadmap_proposals.proposal_state is
  'JSON snapshot of Proposal Builder UI state: scenarios, phases, cards, metadata.';

create index if not exists roadmap_proposals_client_updated_idx
  on public.roadmap_proposals (client_label, updated_at desc);

alter table public.roadmap_proposals enable row level security;

drop policy if exists "Allow read roadmap_proposals" on public.roadmap_proposals;
drop policy if exists "Allow insert roadmap_proposals" on public.roadmap_proposals;
drop policy if exists "Allow update roadmap_proposals" on public.roadmap_proposals;
drop policy if exists "Allow delete roadmap_proposals" on public.roadmap_proposals;

create policy "Allow read roadmap_proposals"
  on public.roadmap_proposals for select using (true);

create policy "Allow insert roadmap_proposals"
  on public.roadmap_proposals for insert with check (true);

create policy "Allow update roadmap_proposals"
  on public.roadmap_proposals for update using (true);

create policy "Allow delete roadmap_proposals"
  on public.roadmap_proposals for delete using (true);

create or replace function public.set_roadmap_proposals_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists roadmap_proposals_updated_at on public.roadmap_proposals;
create trigger roadmap_proposals_updated_at
before update on public.roadmap_proposals
for each row execute function public.set_roadmap_proposals_updated_at();

notify pgrst, 'reload schema';
