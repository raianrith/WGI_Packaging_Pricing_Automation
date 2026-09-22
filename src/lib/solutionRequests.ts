export type SolutionRequestStatus =
  | "pending"
  | "approved"
  | "not_approved"
  | "in_progress";

export type SolutionRequestPriority = "low" | "medium" | "high";

export type SolutionRequest = {
  id: string;
  status: SolutionRequestStatus;
  priority: SolutionRequestPriority;
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
  in_scope: string | null;
  out_of_scope: string | null;
  known_work: string | null;
  why_productize: string;
  related_offerings: string | null;
  additional_notes: string | null;
  review_notes: string | null;
  status_updated_by_email: string | null;
  status_updated_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SolutionRequestFormInput = {
  solutionName: string;
  requestedByName: string;
  requestedByEmail: string;
  clientNeed: string;
  typicalUseCase: string;
  suggestedPhase: string;
  suggestedCategory: string;
  suggestedTactic: string;
  desiredDeliverables: string;
  inScope: string;
  outOfScope: string;
  knownWork: string;
  whyProductize: string;
  relatedOfferings: string;
  additionalNotes: string;
  priority: SolutionRequestPriority;
};

export const SOLUTION_REQUEST_STATUSES: SolutionRequestStatus[] = [
  "pending",
  "approved",
  "in_progress",
  "not_approved",
];

export const SOLUTION_REQUEST_PRIORITIES: SolutionRequestPriority[] = [
  "low",
  "medium",
  "high",
];

export function emptySolutionRequestForm(
  requestedByName = "",
  requestedByEmail = ""
): SolutionRequestFormInput {
  return {
    solutionName: "",
    requestedByName,
    requestedByEmail,
    clientNeed: "",
    typicalUseCase: "",
    suggestedPhase: "",
    suggestedCategory: "",
    suggestedTactic: "",
    desiredDeliverables: "",
    inScope: "",
    outOfScope: "",
    knownWork: "",
    whyProductize: "",
    relatedOfferings: "",
    additionalNotes: "",
    priority: "medium",
  };
}

export function solutionRequestStatusLabel(status: SolutionRequestStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "approved":
      return "Approved";
    case "not_approved":
      return "Not Approved";
    case "in_progress":
      return "In Progress";
    default:
      return status;
  }
}

export function solutionRequestPriorityLabel(priority: SolutionRequestPriority): string {
  switch (priority) {
    case "low":
      return "Low";
    case "medium":
      return "Medium";
    case "high":
      return "High";
    default:
      return priority;
  }
}

export function normalizeSolutionRequestForm(
  input: SolutionRequestFormInput
): SolutionRequestFormInput {
  return {
    solutionName: input.solutionName.trim(),
    requestedByName: input.requestedByName.trim(),
    requestedByEmail: input.requestedByEmail.trim(),
    clientNeed: input.clientNeed.trim(),
    typicalUseCase: input.typicalUseCase.trim(),
    suggestedPhase: input.suggestedPhase.trim(),
    suggestedCategory: input.suggestedCategory.trim(),
    suggestedTactic: input.suggestedTactic.trim(),
    desiredDeliverables: input.desiredDeliverables.trim(),
    inScope: input.inScope.trim(),
    outOfScope: input.outOfScope.trim(),
    knownWork: input.knownWork.trim(),
    whyProductize: input.whyProductize.trim(),
    relatedOfferings: input.relatedOfferings.trim(),
    additionalNotes: input.additionalNotes.trim(),
    priority: input.priority,
  };
}

export function validateSolutionRequestForm(
  input: SolutionRequestFormInput
): { ok: true } | { ok: false; error: string } {
  const n = normalizeSolutionRequestForm(input);
  if (!n.requestedByName) return { ok: false, error: "Requested by name is required." };
  if (!n.requestedByEmail) return { ok: false, error: "Requested by email is required." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(n.requestedByEmail)) {
    return { ok: false, error: "Enter a valid requestor email." };
  }
  if (!n.solutionName) return { ok: false, error: "Proposed solution name is required." };
  if (!n.clientNeed) return { ok: false, error: "Describe the client or business need." };
  if (!n.typicalUseCase) return { ok: false, error: "Describe the typical use case." };
  if (!n.desiredDeliverables) {
    return { ok: false, error: "Describe the desired outcomes or deliverables." };
  }
  if (!n.whyProductize) {
    return { ok: false, error: "Explain why this should become a directory solution." };
  }
  return { ok: true };
}

export function solutionRequestInsertRow(
  input: SolutionRequestFormInput,
  userId: string | null
) {
  const n = normalizeSolutionRequestForm(input);
  return {
    status: "pending" as const,
    priority: n.priority,
    solution_name: n.solutionName,
    requested_by_name: n.requestedByName,
    requested_by_email: n.requestedByEmail,
    requested_by_user_id: userId,
    client_need: n.clientNeed,
    typical_use_case: n.typicalUseCase,
    suggested_phase: n.suggestedPhase || null,
    suggested_category: n.suggestedCategory || null,
    suggested_tactic: n.suggestedTactic || null,
    desired_deliverables: n.desiredDeliverables,
    in_scope: n.inScope || null,
    out_of_scope: n.outOfScope || null,
    known_work: n.knownWork || null,
    why_productize: n.whyProductize,
    related_offerings: n.relatedOfferings || null,
    additional_notes: n.additionalNotes || null,
  };
}

export function formatSolutionRequestDate(iso: string | null | undefined): string {
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
