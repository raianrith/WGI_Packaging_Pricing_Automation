export type Package = {
  package_id: string;
  package_name: string;
  package_create_date: string;
  package_modified_date: string;
  /** Below: Package Builder narrative + aggregate pricing (see `supabase/packages_builder_v2_fields.sql`). */
  package_category?: string | null;
  package_owner?: string | null;
  package_overview?: string | null;
  package_overview_link?: string | null;
  package_direction?: string | null;
  package_what_is_it?: string | null;
  package_why_is_it_valuable?: string | null;
  package_when_should_it_be_used?: string | null;
  package_assumption_prerequisites?: string | null;
  package_in_scope?: string | null;
  package_out_of_scope?: string | null;
  package_final_deliverable?: string | null;
  package_how_do_we_get_this_work_done?: string | null;
  package_sop?: string | null;
  package_resources?: string | null;
  package_resource_templates?: string | null;
  package_resource_tools?: string | null;
  package_resource_examples?: TierResourceExampleRow[] | null;
  /** Uniform scale on summed hour buckets across all tiers in this package (0–100). */
  package_hour_discount_pct?: number | null;
  /** Applied to modeled sell price (0–100); stored overrides keep pre-discount sell. */
  package_sell_discount_pct?: number | null;
  package_pricing_overrides?: PackagePricingOverrides | null;
  package_combined_tasks?: unknown | null;
  /** Playbook phase labels for guided browse (preset packages only). */
  phase_tags?: string[];
  /** Playbook category labels for guided browse (preset packages only). */
  category_tags?: string[];
  /** Playbook tactic labels for guided browse (preset packages only). */
  tactic_tags?: string[];
};

/** Admin-editable package type for Build a Package (e.g. Market Position Guide). */
export type PackageBuilderPackageType = {
  id: string;
  sort_order: number;
  name: string;
  /** Shown on Custom Package Builder / configurable package cards. */
  card_description: string | null;
  /** Playbook phase labels (multi-select). */
  phase_tags: string[];
  /** Playbook category labels (multi-select). */
  category_tags: string[];
  /** Playbook tactic labels (multi-select). */
  tactic_tags: string[];
  updated_at?: string | null;
};

/** Always-included vault tier for a Build-a-Package slot (locked min qty). */
export type PackageBuilderSlotPreselectedTier = {
  solution_tier_id: string;
  default_qty: number;
};

/** Pick-N choice bucket under a Build-a-Package slot. */
export type PackageBuilderSlotBucket = {
  id: string;
  name: string;
  pick_count: number;
  sort_order: number;
  member_tier_ids: string[];
};

/** Tier slot under a package type — optional hour/price ceilings and/or solution tier count limit. */
export type PackageBuilderSlotTemplate = {
  id: string;
  package_type_id: string;
  sort_order: number;
  label: string;
  /** When set, vault hour total for selected tiers must not exceed this. */
  hour_ceiling: number | null;
  /** When set, vault sell sum for selected tiers must not exceed this (USD). */
  price_ceiling: number | null;
  /** When set, at most this many solution tiers may be selected. */
  solution_tier_limit: number | null;
  /**
   * Hour discount % (0–100) applied when creating a package from this slot.
   * Null = fall back to label-based Basic/Standard/Advanced defaults.
   */
  hour_discount_pct: number | null;
  /** Empty = any vault tier allowed; otherwise only listed solution_tier_id values. */
  allowed_solution_tier_ids: string[];
  /** Always included when building from this slot (cannot go below default_qty). */
  preselected_tiers: PackageBuilderSlotPreselectedTier[];
  /** Choice buckets: pick exactly pick_count distinct members. */
  buckets: PackageBuilderSlotBucket[];
  /** Shown as a disclaimer when this tier is selected in Build a Package. */
  tier_notes: string | null;
  /**
   * Preset package-level pricing scores (0–2). Copied to `packages.package_pricing_overrides`
   * when a package is created from this slot in Build a Package.
   */
  scope_risk: number | null;
  internal_coordination: number | null;
  client_revision_risk: number | null;
  strategic_value_score: number | null;
  /** Default package narratives copied when building from this slot (see `package_builder_slot_narrative_fields.sql`). */
  package_owner?: string | null;
  package_overview?: string | null;
  package_overview_link?: string | null;
  package_direction?: string | null;
  package_what_is_it?: string | null;
  package_why_is_it_valuable?: string | null;
  package_when_should_it_be_used?: string | null;
  package_assumption_prerequisites?: string | null;
  package_in_scope?: string | null;
  package_out_of_scope?: string | null;
  package_final_deliverable?: string | null;
  package_how_do_we_get_this_work_done?: string | null;
  package_sop?: string | null;
  package_resources?: string | null;
  package_resource_templates?: string | null;
  package_resource_tools?: string | null;
  updated_at?: string | null;
};

export type Solution = {
  solution_id: string;
  solution_name: string;
  solution_created_date: string;
  solution_modified_date: string;
};

/** One dated example pair for structured tier resources (`solution_tier_resource_examples`). */
export type TierResourceExampleRow = { example: string; date: string };

export type TierTaxonomyKind = "phase" | "category" | "tactic";

export type SolutionTierTaxonomyOptionRow = {
  id: string;
  kind: TierTaxonomyKind;
  label: string;
  created_at?: string;
  updated_at?: string;
};

export type SolutionTier = {
  solution_tier_id: string;
  solution_id: string;
  solution_tier_name: string;
  solution_tier_phase: string | null;
  solution_tier_category: string | null;
  solution_tier_tactic: string | null;
  solution_tier_owner: string | null;
  solution_tier_overview: string | null;
  solution_tier_overview_link: string | null;
  solution_tier_direction: string | null;
  solution_tier_sop: string | null;
  /** Legacy combined resources block; prefer structured fields below when editing. */
  solution_tier_resources: string | null;
  solution_tier_resource_templates: string | null;
  solution_tier_resource_tools: string | null;
  solution_tier_resource_examples: TierResourceExampleRow[] | null;
  solution_tier_what_is_it: string | null;
  solution_tier_why_is_it_valuable: string | null;
  solution_tier_when_should_it_be_used: string | null;
  solution_tier_assumption_prerequisites: string | null;
  solution_tier_in_scope: string | null;
  solution_tier_out_of_scope: string | null;
  solution_tier_final_deliverable: string | null;
  solution_tier_how_do_we_get_this_work_done: string | null;
  /** Legacy DB column; not shown or edited in the app (always cleared on tier save). */
  solution_tier_described_to_client: string | null;
  solution_tier_created_date: string;
  solution_tier_modified_date: string;
};

/** Sparse overrides for how a tier appears inside a package only (canonical row is `solution_tiers`). */
export type PackageTierOverrides = Partial<
  Pick<
    SolutionTier,
    | "solution_tier_name"
    | "solution_tier_phase"
    | "solution_tier_category"
    | "solution_tier_tactic"
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
  >
>;

export type TaskRow = {
  task_id: string;
  solution_tier_id: string;
  /** Display order within the tier (1-based recommended). Omitted / null sorts after set values in UI. */
  sort_order?: number | null;
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

/** Saved Proposal Builder snapshot (`public.roadmap_proposals`). */
export type RoadmapProposalRow = {
  id: string;
  client_label: string;
  roadmap_title: string;
  horizon: string | null;
  client_budget: string | null;
  proposal_state: unknown;
  created_by_user_id?: string | null;
  created_by_email?: string | null;
  updated_by_user_id?: string | null;
  updated_by_email?: string | null;
  created_at?: string;
  updated_at?: string;
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
  duration: number | null;
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

/** Links a tier to a package (same vault tier may appear in multiple packages). */
export type PackageSolutionTier = {
  package_id: string;
  solution_tier_id: string;
  /** How many times this tier is included in the package (default 1). */
  quantity?: number | null;
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

/** `public.user_presence` — heartbeat rows for showing who is active in the app now. */
export type UserPresenceRow = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  current_path: string | null;
  last_seen_at: string;
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
  /** Present on rows inserted after `audit_log_changed_by.sql`; null for older history. */
  changed_by_user_id?: string | null;
  changed_by_email?: string | null;
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

