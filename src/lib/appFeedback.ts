export type AppFeedbackStatus =
  | "pending"
  | "reviewing"
  | "in_progress"
  | "resolved"
  | "deferred";

export type AppFeedbackPriority = "low" | "medium" | "high" | "urgent";

export type AppFeedbackCategory =
  | "bug"
  | "app_upgrade"
  | "task_alignment"
  | "solution_content"
  | "package"
  | "new_solution"
  | "proposal_builder"
  | "pricing"
  | "other";

export type AppFeedbackArea =
  | "home"
  | "solutions_catalog"
  | "solutions_overview"
  | "package_builder"
  | "proposal_builder"
  | "admin"
  | "pricing"
  | "auth"
  | "other"
  | "not_sure";

export type AppFeedback = {
  id: string;
  status: AppFeedbackStatus;
  priority: AppFeedbackPriority;
  category: AppFeedbackCategory;
  area: AppFeedbackArea;
  title: string;
  details: string;
  page_or_url: string | null;
  steps_to_reproduce: string | null;
  expected_behavior: string | null;
  actual_behavior: string | null;
  related_name: string | null;
  impact: string | null;
  client_need: string | null;
  typical_use_case: string | null;
  desired_deliverables: string | null;
  why_productize: string | null;
  suggested_phase: string | null;
  suggested_category: string | null;
  suggested_tactic: string | null;
  additional_notes: string | null;
  review_notes: string | null;
  requested_by_name: string;
  requested_by_email: string;
  requested_by_user_id: string | null;
  status_updated_by_email: string | null;
  status_updated_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AppFeedbackFormInput = {
  category: AppFeedbackCategory | "";
  area: AppFeedbackArea;
  priority: AppFeedbackPriority;
  title: string;
  details: string;
  pageOrUrl: string;
  stepsToReproduce: string;
  expectedBehavior: string;
  actualBehavior: string;
  relatedName: string;
  impact: string;
  clientNeed: string;
  typicalUseCase: string;
  desiredDeliverables: string;
  whyProductize: string;
  suggestedPhase: string;
  suggestedCategory: string;
  suggestedTactic: string;
  additionalNotes: string;
  requestedByName: string;
  requestedByEmail: string;
};

export const APP_FEEDBACK_STATUSES: AppFeedbackStatus[] = [
  "pending",
  "reviewing",
  "in_progress",
  "resolved",
  "deferred",
];

export const APP_FEEDBACK_PRIORITIES: AppFeedbackPriority[] = [
  "low",
  "medium",
  "high",
  "urgent",
];

export const APP_FEEDBACK_CATEGORIES: AppFeedbackCategory[] = [
  "bug",
  "app_upgrade",
  "task_alignment",
  "solution_content",
  "package",
  "new_solution",
  "proposal_builder",
  "pricing",
  "other",
];

export const APP_FEEDBACK_AREAS: AppFeedbackArea[] = [
  "home",
  "solutions_catalog",
  "solutions_overview",
  "package_builder",
  "proposal_builder",
  "admin",
  "pricing",
  "auth",
  "other",
  "not_sure",
];

export function appFeedbackStatusLabel(status: AppFeedbackStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "reviewing":
      return "Reviewing";
    case "in_progress":
      return "In progress";
    case "resolved":
      return "Resolved";
    case "deferred":
      return "Deferred";
    default:
      return status;
  }
}

export function appFeedbackPriorityLabel(priority: AppFeedbackPriority): string {
  switch (priority) {
    case "low":
      return "Low";
    case "medium":
      return "Medium";
    case "high":
      return "High";
    case "urgent":
      return "Urgent";
    default:
      return priority;
  }
}

export function appFeedbackCategoryLabel(category: AppFeedbackCategory): string {
  switch (category) {
    case "bug":
      return "Something broken / bug";
    case "app_upgrade":
      return "App upgrade / new feature";
    case "task_alignment":
      return "Task not aligning";
    case "solution_content":
      return "Solution needs overview / content";
    case "package":
      return "Package issue or change";
    case "new_solution":
      return "Request a new solution";
    case "proposal_builder":
      return "Proposal Builder";
    case "pricing":
      return "Pricing / hours / sell";
    case "other":
      return "Other";
    default:
      return category;
  }
}

export function appFeedbackCategoryShort(category: AppFeedbackCategory): string {
  switch (category) {
    case "bug":
      return "Bug";
    case "app_upgrade":
      return "Upgrade";
    case "task_alignment":
      return "Tasks";
    case "solution_content":
      return "Content";
    case "package":
      return "Package";
    case "new_solution":
      return "New solution";
    case "proposal_builder":
      return "Proposal";
    case "pricing":
      return "Pricing";
    case "other":
      return "Other";
    default:
      return category;
  }
}

export function appFeedbackAreaLabel(area: AppFeedbackArea): string {
  switch (area) {
    case "home":
      return "Home";
    case "solutions_catalog":
      return "Solutions Catalog";
    case "solutions_overview":
      return "Solutions Overview";
    case "package_builder":
      return "Package Builder";
    case "proposal_builder":
      return "Proposal Builder";
    case "admin":
      return "Admin / Vault";
    case "pricing":
      return "Pricing";
    case "auth":
      return "Login / access";
    case "other":
      return "Other";
    case "not_sure":
      return "Not sure";
    default:
      return area;
  }
}

/** Suggested area defaults when a category is picked. */
export function defaultAreaForCategory(category: AppFeedbackCategory | ""): AppFeedbackArea {
  switch (category) {
    case "new_solution":
    case "solution_content":
    case "task_alignment":
      return "solutions_catalog";
    case "package":
      return "package_builder";
    case "proposal_builder":
      return "proposal_builder";
    case "pricing":
      return "pricing";
    case "bug":
    case "app_upgrade":
    case "other":
    default:
      return "not_sure";
  }
}

export function emptyAppFeedbackForm(
  requestedByName = "",
  requestedByEmail = "",
  category: AppFeedbackCategory | "" = ""
): AppFeedbackFormInput {
  return {
    category,
    area: defaultAreaForCategory(category),
    priority: "medium",
    title: "",
    details: "",
    pageOrUrl: "",
    stepsToReproduce: "",
    expectedBehavior: "",
    actualBehavior: "",
    relatedName: "",
    impact: "",
    clientNeed: "",
    typicalUseCase: "",
    desiredDeliverables: "",
    whyProductize: "",
    suggestedPhase: "",
    suggestedCategory: "",
    suggestedTactic: "",
    additionalNotes: "",
    requestedByName,
    requestedByEmail,
  };
}

export function normalizeAppFeedbackForm(input: AppFeedbackFormInput): AppFeedbackFormInput {
  return {
    category: input.category,
    area: input.area,
    priority: input.priority,
    title: input.title.trim(),
    details: input.details.trim(),
    pageOrUrl: input.pageOrUrl.trim(),
    stepsToReproduce: input.stepsToReproduce.trim(),
    expectedBehavior: input.expectedBehavior.trim(),
    actualBehavior: input.actualBehavior.trim(),
    relatedName: input.relatedName.trim(),
    impact: input.impact.trim(),
    clientNeed: input.clientNeed.trim(),
    typicalUseCase: input.typicalUseCase.trim(),
    desiredDeliverables: input.desiredDeliverables.trim(),
    whyProductize: input.whyProductize.trim(),
    suggestedPhase: input.suggestedPhase.trim(),
    suggestedCategory: input.suggestedCategory.trim(),
    suggestedTactic: input.suggestedTactic.trim(),
    additionalNotes: input.additionalNotes.trim(),
    requestedByName: input.requestedByName.trim(),
    requestedByEmail: input.requestedByEmail.trim(),
  };
}

export function validateAppFeedbackForm(
  input: AppFeedbackFormInput
): { ok: true } | { ok: false; error: string } {
  const n = normalizeAppFeedbackForm(input);
  if (!n.requestedByName) return { ok: false, error: "Your name is required." };
  if (!n.requestedByEmail) return { ok: false, error: "Your email is required." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(n.requestedByEmail)) {
    return { ok: false, error: "Enter a valid email." };
  }
  if (!n.category) return { ok: false, error: "Choose what this feedback is for." };
  if (!n.title) return { ok: false, error: "Add a short title." };
  if (!n.details) return { ok: false, error: "Describe what you need or what went wrong." };

  if (n.category === "bug") {
    if (!n.stepsToReproduce && !n.actualBehavior) {
      return {
        ok: false,
        error: "For bugs, add steps to reproduce or what actually happened.",
      };
    }
  }

  if (n.category === "new_solution") {
    if (!n.typicalUseCase) return { ok: false, error: "Describe the typical use case." };
    if (!n.desiredDeliverables) {
      return { ok: false, error: "Describe the desired outcomes or deliverables." };
    }
    if (!n.whyProductize) {
      return { ok: false, error: "Explain why this should become a directory solution." };
    }
  }

  if (
    (n.category === "task_alignment" ||
      n.category === "solution_content" ||
      n.category === "package") &&
    !n.relatedName
  ) {
    return {
      ok: false,
      error:
        n.category === "package"
          ? "Name the package this is about."
          : "Name the solution, tier, or task this is about.",
    };
  }

  return { ok: true };
}

export function appFeedbackInsertRow(input: AppFeedbackFormInput, userId: string | null) {
  const n = normalizeAppFeedbackForm(input);
  const category = n.category as AppFeedbackCategory;
  const relatedName =
    category === "new_solution" ? n.relatedName || n.title : n.relatedName || null;
  const clientNeed =
    category === "new_solution" ? n.clientNeed || n.details : n.clientNeed || null;
  return {
    status: "pending" as const,
    priority: n.priority,
    category,
    area: n.area,
    title: n.title,
    details: n.details,
    page_or_url: n.pageOrUrl || null,
    steps_to_reproduce: n.stepsToReproduce || null,
    expected_behavior: n.expectedBehavior || null,
    actual_behavior: n.actualBehavior || null,
    related_name: relatedName,
    impact: n.impact || null,
    client_need: clientNeed,
    typical_use_case: n.typicalUseCase || null,
    desired_deliverables: n.desiredDeliverables || null,
    why_productize: n.whyProductize || null,
    suggested_phase: n.suggestedPhase || null,
    suggested_category: n.suggestedCategory || null,
    suggested_tactic: n.suggestedTactic || null,
    additional_notes: n.additionalNotes || null,
    requested_by_name: n.requestedByName,
    requested_by_email: n.requestedByEmail,
    requested_by_user_id: userId,
  };
}

export function formatAppFeedbackDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function parseAppFeedbackCategoryParam(
  raw: string | null | undefined
): AppFeedbackCategory | "" {
  if (!raw) return "";
  return (APP_FEEDBACK_CATEGORIES as string[]).includes(raw)
    ? (raw as AppFeedbackCategory)
    : "";
}

/** Board row that may come from `app_feedback` or legacy `solution_requests`. */
export type FeedbackBoardRow = AppFeedback & {
  source: "app_feedback" | "solution_request";
};

type LegacySolutionRequestRow = {
  id: string;
  status: string;
  priority: string;
  solution_name: string;
  requested_by_name: string;
  requested_by_email: string;
  requested_by_user_id: string | null;
  client_need: string;
  typical_use_case: string;
  suggested_phase: string | null;
  suggested_category: string | null;
  suggested_tactic: string | null;
  desired_deliverables: string;
  in_scope?: string | null;
  out_of_scope?: string | null;
  known_work?: string | null;
  why_productize: string;
  related_offerings?: string | null;
  additional_notes: string | null;
  review_notes: string | null;
  status_updated_by_email: string | null;
  status_updated_at: string | null;
  created_at: string;
  updated_at: string;
};

export function mapSolutionRequestToFeedbackBoardRow(
  row: LegacySolutionRequestRow
): FeedbackBoardRow {
  const status: AppFeedbackStatus =
    row.status === "approved"
      ? "reviewing"
      : row.status === "in_progress"
        ? "in_progress"
        : row.status === "not_approved"
          ? "deferred"
          : "pending";
  const priority: AppFeedbackPriority =
    row.priority === "high" ? "high" : row.priority === "low" ? "low" : "medium";
  const extras = [
    row.in_scope?.trim() ? `In scope: ${row.in_scope.trim()}` : "",
    row.out_of_scope?.trim() ? `Out of scope: ${row.out_of_scope.trim()}` : "",
    row.known_work?.trim() ? `Known work: ${row.known_work.trim()}` : "",
    row.related_offerings?.trim() ? `Related: ${row.related_offerings.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    id: row.id,
    source: "solution_request",
    status,
    priority,
    category: "new_solution",
    area: "solutions_catalog",
    title: row.solution_name,
    details: row.client_need || row.typical_use_case || "",
    page_or_url: null,
    steps_to_reproduce: null,
    expected_behavior: null,
    actual_behavior: null,
    related_name: row.solution_name,
    impact: null,
    client_need: row.client_need,
    typical_use_case: row.typical_use_case,
    desired_deliverables: row.desired_deliverables,
    why_productize: row.why_productize,
    suggested_phase: row.suggested_phase,
    suggested_category: row.suggested_category,
    suggested_tactic: row.suggested_tactic,
    additional_notes: [row.additional_notes?.trim(), extras].filter(Boolean).join("\n\n") || null,
    review_notes: row.review_notes,
    requested_by_name: row.requested_by_name,
    requested_by_email: row.requested_by_email,
    requested_by_user_id: row.requested_by_user_id,
    status_updated_by_email: row.status_updated_by_email,
    status_updated_at: row.status_updated_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Map feedback board stage back onto legacy `solution_requests.status`. */
export function feedbackStatusToSolutionRequestStatus(
  status: AppFeedbackStatus
): "pending" | "approved" | "in_progress" | "not_approved" {
  switch (status) {
    case "reviewing":
    case "resolved":
      return "approved";
    case "in_progress":
      return "in_progress";
    case "deferred":
      return "not_approved";
    case "pending":
    default:
      return "pending";
  }
}
