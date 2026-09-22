export const CUSTOM_SCOPING_DELIVERABLE_TYPES = [
  "Video",
  "Paid Ads",
  "Design",
  "Content",
  "Web / Development",
  "Email / Marketing Automation",
  "Strategy / Consulting",
  "Other",
] as const;

export type CustomScopingDeliverableType =
  (typeof CUSTOM_SCOPING_DELIVERABLE_TYPES)[number];

export type CustomScopingRequest = {
  id: string;
  name: string;
  deliverableType: CustomScopingDeliverableType | "";
  deliverableTypeOther: string;
  overviewAndGoal: string;
  clientComponents: string;
  examplesAndResources: string;
  budget: string;
  deadline: string;
  expectations: string;
  otherNotes: string;
  createdAt: string;
  updatedAt: string;
};

export type CustomScopingFormInput = {
  name: string;
  deliverableType: CustomScopingDeliverableType | "";
  deliverableTypeOther: string;
  overviewAndGoal: string;
  clientComponents: string;
  examplesAndResources: string;
  budget: string;
  deadline: string;
  expectations: string;
  otherNotes: string;
};

export type CustomScopingState = {
  required: boolean;
  requests: CustomScopingRequest[];
};

export function emptyCustomScopingForm(): CustomScopingFormInput {
  return {
    name: "",
    deliverableType: "",
    deliverableTypeOther: "",
    overviewAndGoal: "",
    clientComponents: "",
    examplesAndResources: "",
    budget: "",
    deadline: "",
    expectations: "",
    otherNotes: "",
  };
}

export function emptyCustomScopingState(): CustomScopingState {
  return { required: false, requests: [] };
}

function newRequestId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `csr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function normalizeCustomScopingForm(
  input: CustomScopingFormInput
): CustomScopingFormInput {
  return {
    name: input.name.trim(),
    deliverableType: input.deliverableType,
    deliverableTypeOther: input.deliverableTypeOther.trim(),
    overviewAndGoal: input.overviewAndGoal.trim(),
    clientComponents: input.clientComponents.trim(),
    examplesAndResources: input.examplesAndResources.trim(),
    budget: input.budget.trim(),
    deadline: input.deadline.trim(),
    expectations: input.expectations.trim(),
    otherNotes: input.otherNotes.trim(),
  };
}

export function validateCustomScopingForm(
  input: CustomScopingFormInput
): { ok: true } | { ok: false; error: string } {
  const n = normalizeCustomScopingForm(input);
  if (!n.name) return { ok: false, error: "Name of request is required." };
  if (!n.deliverableType) {
    return { ok: false, error: "Select the type of deliverable to scope." };
  }
  if (n.deliverableType === "Other" && !n.deliverableTypeOther) {
    return { ok: false, error: "Describe the deliverable type (Other)." };
  }
  if (!n.overviewAndGoal) {
    return {
      ok: false,
      error: "Add an overview/description and the main goal of this deliverable.",
    };
  }
  return { ok: true };
}

export function formToCustomScopingRequest(
  input: CustomScopingFormInput,
  existing?: CustomScopingRequest | null
): CustomScopingRequest {
  const n = normalizeCustomScopingForm(input);
  const now = new Date().toISOString();
  return {
    id: existing?.id ?? newRequestId(),
    name: n.name,
    deliverableType: n.deliverableType,
    deliverableTypeOther: n.deliverableType === "Other" ? n.deliverableTypeOther : "",
    overviewAndGoal: n.overviewAndGoal,
    clientComponents: n.clientComponents,
    examplesAndResources: n.examplesAndResources,
    budget: n.budget,
    deadline: n.deadline,
    expectations: n.expectations,
    otherNotes: n.otherNotes,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export function customScopingRequestToForm(
  request: CustomScopingRequest
): CustomScopingFormInput {
  return {
    name: request.name,
    deliverableType: request.deliverableType,
    deliverableTypeOther: request.deliverableTypeOther,
    overviewAndGoal: request.overviewAndGoal,
    clientComponents: request.clientComponents,
    examplesAndResources: request.examplesAndResources,
    budget: request.budget,
    deadline: request.deadline,
    expectations: request.expectations,
    otherNotes: request.otherNotes,
  };
}

export function customScopingDeliverableLabel(request: CustomScopingRequest): string {
  if (request.deliverableType === "Other") {
    return request.deliverableTypeOther.trim() || "Other";
  }
  return request.deliverableType.trim() || "—";
}

function isDeliverableType(value: unknown): value is CustomScopingDeliverableType {
  return (
    typeof value === "string" &&
    (CUSTOM_SCOPING_DELIVERABLE_TYPES as readonly string[]).includes(value)
  );
}

function parseOneRequest(raw: unknown): CustomScopingRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" && r.id.trim() ? r.id.trim() : newRequestId();
  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (!name) return null;
  const deliverableType = isDeliverableType(r.deliverableType) ? r.deliverableType : "";
  return {
    id,
    name,
    deliverableType,
    deliverableTypeOther:
      typeof r.deliverableTypeOther === "string" ? r.deliverableTypeOther.trim() : "",
    overviewAndGoal: typeof r.overviewAndGoal === "string" ? r.overviewAndGoal.trim() : "",
    clientComponents: typeof r.clientComponents === "string" ? r.clientComponents.trim() : "",
    examplesAndResources:
      typeof r.examplesAndResources === "string" ? r.examplesAndResources.trim() : "",
    budget: typeof r.budget === "string" ? r.budget.trim() : "",
    deadline: typeof r.deadline === "string" ? r.deadline.trim() : "",
    expectations: typeof r.expectations === "string" ? r.expectations.trim() : "",
    otherNotes: typeof r.otherNotes === "string" ? r.otherNotes.trim() : "",
    createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date().toISOString(),
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : new Date().toISOString(),
  };
}

export function parseCustomScopingState(raw: unknown): CustomScopingState {
  if (!raw || typeof raw !== "object") return emptyCustomScopingState();
  const o = raw as Record<string, unknown>;
  const requests = Array.isArray(o.requests)
    ? o.requests.map(parseOneRequest).filter((x): x is CustomScopingRequest => x != null)
    : [];
  return {
    required: o.required === true || (o.required !== false && requests.length > 0),
    requests,
  };
}

export function customScopingSummaryLines(request: CustomScopingRequest): {
  label: string;
  value: string;
}[] {
  const rows: { label: string; value: string }[] = [
    { label: "Deliverable type", value: customScopingDeliverableLabel(request) },
    { label: "Overview & goal", value: request.overviewAndGoal },
  ];
  if (request.clientComponents) {
    rows.push({ label: "Client-provided components", value: request.clientComponents });
  }
  if (request.examplesAndResources) {
    rows.push({ label: "Examples / resources", value: request.examplesAndResources });
  }
  if (request.budget) rows.push({ label: "Budget", value: request.budget });
  if (request.deadline) rows.push({ label: "Deadline / dates", value: request.deadline });
  if (request.expectations) {
    rows.push({ label: "Expectations / assumptions", value: request.expectations });
  }
  if (request.otherNotes) rows.push({ label: "Other notes", value: request.otherNotes });
  return rows;
}
