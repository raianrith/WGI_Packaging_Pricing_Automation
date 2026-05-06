-- Structured resources on solution_tiers: templates, dated examples, tools. Run in SQL Editor.

alter table public.solution_tiers
  add column if not exists solution_tier_resource_templates text;

alter table public.solution_tiers
  add column if not exists solution_tier_resource_tools text;

alter table public.solution_tiers
  add column if not exists solution_tier_resource_examples jsonb default '[]'::jsonb;

comment on column public.solution_tiers.solution_tier_resource_templates is 'Markdown/text: template links and names.';
comment on column public.solution_tiers.solution_tier_resource_tools is 'Markdown/text: tools list.';
comment on column public.solution_tiers.solution_tier_resource_examples is 'JSON array of { "example": string, "date": string }.';

-- One-time migration: copy legacy resources block into Templates.
update public.solution_tiers s
set solution_tier_resource_templates = s.solution_tier_resources
where (s.solution_tier_resource_templates is null or trim(s.solution_tier_resource_templates) = '')
  and s.solution_tier_resources is not null
  and trim(s.solution_tier_resources) <> '';

notify pgrst, 'reload schema';
