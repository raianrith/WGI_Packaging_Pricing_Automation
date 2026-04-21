export type Package = {
  package_id: string;
  package_name: string;
  package_create_date: string;
  package_modified_date: string;
};

export type Solution = {
  solution_id: string;
  /** Null when the solution is standalone (no parent package). */
  package_id: string | null;
  solution_name: string;
  solution_created_date: string;
  solution_modified_date: string;
};

export type SolutionTier = {
  solution_tier_id: string;
  solution_id: string;
  solution_tier_name: string;
  solution_tier_owner: string | null;
  solution_tier_overview: string | null;
  solution_tier_overview_link: string | null;
  solution_tier_direction: string | null;
  solution_tier_sop: string | null;
  solution_tier_resources: string | null;
  solution_tier_created_date: string;
  solution_tier_modified_date: string;
};

export type TaskRow = {
  task_id: string;
  solution_tier_id: string;
  task_name: string;
  task_implementer: string | null;
  task_time: number | null;
  task_duration: number | null;
  task_dependencies: string | null;
  task_notes: string | null;
  task_create_date: string;
  task_modified_date: string;
};

/** One pricing row per `solution_tier_id` (table `solution_tier_pricing`). */
export type SolutionTierPricing = {
  solution_tier_id: string;
  solution_label: string | null;
  tier: string | null;
  scope: string | null;
  hours_client_services: number | null;
  hours_copy: number | null;
  hours_design: number | null;
  hours_web_dev: number | null;
  hours_video: number | null;
  hours_data: number | null;
  hours_paid_media: number | null;
  hours_hubspot: number | null;
  hours_other: number | null;
  total_hours: number | null;
  expected_effort_base_price: number | null;
  scope_risk: number | null;
  internal_coordination: number | null;
  client_revision_risk: number | null;
  risk_multiplier: number | null;
  risk_mitigated_base_price: number | null;
  strategic_value_score: number | null;
  strategic_value_multiplier: number | null;
  sell_price: number | null;
  standalone_sell_price: number | null;
  old_price: number | null;
  percent_change: string | null;
  requires_customization: boolean;
  taxable: boolean;
  notes: string | null;
  tags: string | null;
  created_at?: string;
  updated_at?: string;
};

export type AuditLogRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  created_at: string;
};

/** Row in `public.profiles` (linked to `auth.users`). */
export type ProfileRow = {
  id: string;
  full_name: string;
  email: string | null;
  is_admin: boolean;
  created_at?: string;
  updated_at?: string;
};
