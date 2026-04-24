export type Package = {
  package_id: string;
  package_name: string;
  package_create_date: string;
  package_modified_date: string;
};

export type Solution = {
  solution_id: string;
  solution_name: string;
  solution_created_date: string;
  solution_modified_date: string;
};

/** Links a tier to a package (tiers are assignable individually; each tier is in at most one package). */
export type PackageSolutionTier = {
  package_id: string;
  solution_tier_id: string;
  created_at?: string;
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
  solution_tier_what_is_it: string | null;
  solution_tier_why_is_it_valuable: string | null;
  solution_tier_when_should_it_be_used: string | null;
  solution_tier_assumption_prerequisites: string | null;
  solution_tier_in_scope: string | null;
  solution_tier_out_of_scope: string | null;
  solution_tier_final_deliverable: string | null;
  solution_tier_how_do_we_get_this_work_done: string | null;
  /** Selling: how the solution can be described to the client. */
  solution_tier_described_to_client: string | null;
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

