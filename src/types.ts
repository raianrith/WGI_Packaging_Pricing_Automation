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

/** Sparse overrides for how a tier appears inside a package only (canonical row is `solution_tiers`). */
export type PackageTierOverrides = Partial<
  Pick<
    SolutionTier,
    | "solution_tier_name"
    | "solution_tier_owner"
    | "solution_tier_overview"
    | "solution_tier_overview_link"
    | "solution_tier_direction"
    | "solution_tier_sop"
    | "solution_tier_resources"
    | "solution_tier_what_is_it"
    | "solution_tier_why_is_it_valuable"
    | "solution_tier_when_should_it_be_used"
    | "solution_tier_assumption_prerequisites"
    | "solution_tier_in_scope"
    | "solution_tier_out_of_scope"
    | "solution_tier_final_deliverable"
    | "solution_tier_how_do_we_get_this_work_done"
    | "solution_tier_described_to_client"
  >
>;

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
  /** Set when this row was created by applying a task-group template to a tier. */
  task_group_application_id?: string | null;
  spawned_from_task_group_line_id?: string | null;
};

/** Reusable task group template (library). Lines are in `task_group_lines`. */
export type TaskGroupRow = {
  id: string;
  name: string;
  description: string | null;
  created_at?: string;
  updated_at?: string;
};

export type TaskGroupLineType = "archetype" | "copy_from_task";

export type TaskGroupLineRow = {
  id: string;
  task_group_id: string;
  sort_order: number;
  line_type: TaskGroupLineType;
  source_task_id: string | null;
  task_name: string;
  task_implementer: string | null;
  hours: number | null;
  created_at?: string;
  updated_at?: string;
};

/** Optional audit row: a template was applied to a tier (creates `tasks` + this record). */
export type SolutionTierTaskGroupApplied = {
  id: string;
  solution_tier_id: string;
  task_group_id: string;
  applied_at: string;
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

/** Sparse overrides vs `solution_tier_pricing` for this package link only. */
export type PackagePricingOverrides = Partial<
  Omit<SolutionTierPricing, "solution_tier_id" | "created_at" | "updated_at">
>;

/** Per-field overrides for one vault task when viewed inside a package (`null` clears to empty in UI). */
export type PackageTaskOverride = Partial<{
  task_name: string | null;
  task_implementer: string | null;
  task_time: number | null;
  task_duration: number | null;
  task_dependencies: string | null;
  task_notes: string | null;
}>;

/** Map of `task_id` → sparse patch (vault `tasks` row unchanged). */
export type PackageTaskOverridesMap = Record<string, PackageTaskOverride>;

/** Package-only task line (not a row in `tasks`). */
export type PackageExtraTaskRow = {
  package_task_id: string;
  task_name: string;
  task_implementer: string | null;
  task_time: number | null;
  task_duration: number | null;
  task_dependencies: string | null;
  task_notes: string | null;
};

/** Hide vault tasks in this package and/or add tasks that exist only on the package link. */
export type PackageTaskExtensions = {
  hidden_task_ids?: string[];
  extra_tasks?: PackageExtraTaskRow[];
};

/** Links a tier to a package (tiers are assignable individually; each tier is in at most one package). */
export type PackageSolutionTier = {
  package_id: string;
  solution_tier_id: string;
  created_at?: string;
  /** Sparse JSON vs vault tier narrative (`solution_tiers`). */
  tier_overrides?: PackageTierOverrides | null;
  /** Sparse JSON vs vault pricing row (`solution_tier_pricing`). */
  pricing_overrides?: PackagePricingOverrides | null;
  /** Sparse JSON: task_id → patch vs vault `tasks`. */
  task_overrides?: PackageTaskOverridesMap | null;
  /** JSON: hidden vault task ids + package-only extra task rows. */
  task_extensions?: PackageTaskExtensions | null;
};

/** `public.profiles` — optional; used for admin UI access (see profiles_and_auth.sql). */
export type ProfileRow = {
  id: string;
  full_name: string;
  email: string | null;
  is_admin: boolean;
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

/** Column group in `solution_tier_pricing` hours (maps from task implementer). */
export type PricingHourGroupKey =
  | "client_services"
  | "copy"
  | "design"
  | "web_dev"
  | "video"
  | "data"
  | "paid_media"
  | "hubspot"
  | "other";

export type ImplementerHourGroupRow = {
  id: string;
  implementer_name: string;
  hour_group: PricingHourGroupKey;
  created_at?: string;
  updated_at?: string;
};

