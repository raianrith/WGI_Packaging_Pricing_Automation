import type {
  PackagePricingOverrides,
  PackageTaskOverride,
  PackageTaskOverridesMap,
  SolutionTierPricing,
  TaskRow,
} from "../types";

export const PACKAGE_PRICING_OVERRIDE_KEYS = [
  "solution_label",
  "tier",
  "scope",
  "hours_client_services",
  "hours_copy",
  "hours_design",
  "hours_web_dev",
  "hours_video",
  "hours_data",
  "hours_paid_media",
  "hours_hubspot",
  "hours_other",
  "total_hours",
  "expected_effort_base_price",
  "scope_risk",
  "internal_coordination",
  "client_revision_risk",
  "risk_multiplier",
  "risk_mitigated_base_price",
  "strategic_value_score",
  "strategic_value_multiplier",
  "sell_price",
  "standalone_sell_price",
  "old_price",
  "percent_change",
  "requires_customization",
  "taxable",
  "notes",
  "tags",
] as const;

export type PackagePricingOverrideKey = (typeof PACKAGE_PRICING_OVERRIDE_KEYS)[number];

export const PACKAGE_TASK_OVERRIDE_KEYS = [
  "task_name",
  "task_implementer",
  "task_time",
  "task_duration",
  "task_dependencies",
  "task_notes",
] as const;

export type PackageTaskOverrideKey = (typeof PACKAGE_TASK_OVERRIDE_KEYS)[number];

export function emptyPricingTemplate(tierId: string): SolutionTierPricing {
  return {
    solution_tier_id: tierId,
    solution_label: null,
    tier: null,
    scope: null,
    hours_client_services: null,
    hours_copy: null,
    hours_design: null,
    hours_web_dev: null,
    hours_video: null,
    hours_data: null,
    hours_paid_media: null,
    hours_hubspot: null,
    hours_other: null,
    total_hours: null,
    expected_effort_base_price: null,
    scope_risk: null,
    internal_coordination: null,
    client_revision_risk: null,
    risk_multiplier: null,
    risk_mitigated_base_price: null,
    strategic_value_score: null,
    strategic_value_multiplier: null,
    sell_price: null,
    standalone_sell_price: null,
    old_price: null,
    percent_change: null,
    requires_customization: false,
    taxable: false,
    notes: null,
    tags: null,
  };
}

export function parsePricingOverrides(raw: unknown): PackagePricingOverrides {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: PackagePricingOverrides = {};
  for (const k of PACKAGE_PRICING_OVERRIDE_KEYS) {
    if (!(k in o)) continue;
    const v = o[k];
    if (k === "requires_customization" || k === "taxable") {
      if (typeof v === "boolean") (out as Record<string, boolean>)[k] = v;
      continue;
    }
    if (v === null) {
      (out as Record<string, unknown>)[k] = null;
      continue;
    }
    if (typeof v === "number" && Number.isFinite(v)) {
      (out as Record<string, number>)[k] = v;
      continue;
    }
    if (typeof v === "string") {
      (out as Record<string, string>)[k] = v;
    }
  }
  return out;
}

export function mergePricingWithPackageOverrides(
  base: SolutionTierPricing | null,
  tierId: string,
  overrides: PackagePricingOverrides | null | undefined
): SolutionTierPricing {
  const tmpl = base ?? emptyPricingTemplate(tierId);
  if (!overrides || Object.keys(overrides).length === 0) return { ...tmpl };
  const next = { ...tmpl };
  for (const k of PACKAGE_PRICING_OVERRIDE_KEYS) {
    if (!(k in overrides)) continue;
    const v = overrides[k as keyof PackagePricingOverrides];
    (next as Record<string, unknown>)[k] = v === undefined ? tmpl[k as keyof SolutionTierPricing] : v;
  }
  next.solution_tier_id = tierId;
  return next;
}

export function pricingToFormStrings(p: SolutionTierPricing): Record<PackagePricingOverrideKey, string> {
  const row: Record<string, string> = {};
  for (const k of PACKAGE_PRICING_OVERRIDE_KEYS) {
    const v = p[k as keyof SolutionTierPricing];
    if (k === "requires_customization" || k === "taxable") {
      row[k] = v ? "true" : "false";
    } else if (v == null) row[k] = "";
    else row[k] = String(v);
  }
  return row as Record<PackagePricingOverrideKey, string>;
}

export function emptyPricingForm(): Record<PackagePricingOverrideKey, string> {
  const row: Record<string, string> = {};
  for (const k of PACKAGE_PRICING_OVERRIDE_KEYS) {
    row[k] = k === "requires_customization" || k === "taxable" ? "false" : "";
  }
  return row as Record<PackagePricingOverrideKey, string>;
}

function parseNum(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function pricingFormStringsToPartial(
  form: Record<PackagePricingOverrideKey, string>
): Partial<SolutionTierPricing> {
  const out: Partial<SolutionTierPricing> = {};
  for (const k of PACKAGE_PRICING_OVERRIDE_KEYS) {
    const s = form[k];
    if (k === "requires_customization" || k === "taxable") {
      (out as Record<string, boolean>)[k] = s === "true" || s === "1" || s.toLowerCase() === "yes";
      continue;
    }
    if (k === "percent_change" || k === "notes" || k === "tags" || k === "solution_label" || k === "tier" || k === "scope") {
      (out as Record<string, string | null>)[k] = s.trim() === "" ? null : s;
      continue;
    }
    (out as Record<string, number | null>)[k] = parseNum(s);
  }
  return out;
}

export function computeSparsePricingOverrides(
  template: SolutionTierPricing | null,
  tierId: string,
  edited: Partial<SolutionTierPricing>
): PackagePricingOverrides {
  const base = template ?? emptyPricingTemplate(tierId);
  const out: PackagePricingOverrides = {};
  for (const k of PACKAGE_PRICING_OVERRIDE_KEYS) {
    if (!(k in edited)) continue;
    const ev = edited[k as keyof SolutionTierPricing];
    const tv = base[k as keyof SolutionTierPricing];
    if (k === "requires_customization" || k === "taxable") {
      const eb = Boolean(ev);
      const bb = Boolean(tv);
      if (eb !== bb) (out as Record<string, boolean>)[k] = eb;
      continue;
    }
    if (
      k === "percent_change" ||
      k === "notes" ||
      k === "tags" ||
      k === "solution_label" ||
      k === "tier" ||
      k === "scope"
    ) {
      const es = ev == null ? "" : String(ev);
      const ts = tv == null ? "" : String(tv);
      if (es !== ts) (out as Record<string, string | null>)[k] = es === "" ? null : es;
      continue;
    }
    const en = ev == null || ev === ("" as unknown) ? null : Number(ev);
    const tn = tv == null || !Number.isFinite(Number(tv)) ? null : Number(tv);
    const enN = en != null && Number.isFinite(en) ? en : null;
    const tnN = tn != null && Number.isFinite(tn) ? tn : null;
    if (enN !== tnN) (out as Record<string, number | null>)[k] = enN;
  }
  return out;
}

export function sanitizePricingOverridesForDb(o: PackagePricingOverrides): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of PACKAGE_PRICING_OVERRIDE_KEYS) {
    if (!(k in o)) continue;
    const v = o[k as keyof PackagePricingOverrides];
    if (k === "requires_customization" || k === "taxable") {
      if (typeof v === "boolean") out[k] = v;
      continue;
    }
    if (v === null) {
      out[k] = null;
      continue;
    }
    if (typeof v === "number" && Number.isFinite(v)) {
      out[k] = v;
      continue;
    }
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export function parseTaskOverridesMap(raw: unknown): PackageTaskOverridesMap {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: PackageTaskOverridesMap = {};
  for (const [taskId, patch] of Object.entries(o)) {
    if (!taskId || typeof patch !== "object" || patch == null || Array.isArray(patch)) continue;
    const p = patch as Record<string, unknown>;
    const inner: PackageTaskOverride = {};
    for (const k of PACKAGE_TASK_OVERRIDE_KEYS) {
      if (!(k in p)) continue;
      const v = p[k];
      if (k === "task_time" || k === "task_duration") {
        if (v === null) inner[k] = null;
        else if (typeof v === "number" && Number.isFinite(v)) inner[k] = v;
        continue;
      }
      if (v === null) inner[k] = null;
      else if (typeof v === "string") inner[k] = v;
    }
    if (Object.keys(inner).length) out[taskId] = inner;
  }
  return out;
}

export function mergeTaskWithPackageOverride(task: TaskRow, override: PackageTaskOverride | null | undefined): TaskRow {
  if (!override || Object.keys(override).length === 0) return task;
  return {
    ...task,
    task_name:
      override.task_name !== undefined
        ? override.task_name === null
          ? ""
          : override.task_name
        : task.task_name,
    task_implementer:
      override.task_implementer !== undefined ? override.task_implementer : task.task_implementer,
    task_time: override.task_time !== undefined ? override.task_time : task.task_time,
    task_duration: override.task_duration !== undefined ? override.task_duration : task.task_duration,
    task_dependencies:
      override.task_dependencies !== undefined ? override.task_dependencies : task.task_dependencies,
    task_notes: override.task_notes !== undefined ? override.task_notes : task.task_notes,
  };
}

export type TaskOverrideFormRow = Record<PackageTaskOverrideKey, string>;

export function taskToOverrideFormStrings(t: TaskRow): TaskOverrideFormRow {
  const row: Record<string, string> = {};
  for (const k of PACKAGE_TASK_OVERRIDE_KEYS) {
    const v = t[k as keyof TaskRow];
    if (k === "task_time" || k === "task_duration") {
      row[k] = v == null || !Number.isFinite(Number(v)) ? "" : String(v);
    } else {
      row[k] = v == null ? "" : String(v);
    }
  }
  return row as TaskOverrideFormRow;
}

export function emptyTaskFormRow(): TaskOverrideFormRow {
  const row: Record<string, string> = {};
  for (const k of PACKAGE_TASK_OVERRIDE_KEYS) row[k] = "";
  return row as TaskOverrideFormRow;
}

export function taskFormToOverridePartial(form: TaskOverrideFormRow): PackageTaskOverride {
  const out: PackageTaskOverride = {};
  for (const k of PACKAGE_TASK_OVERRIDE_KEYS) {
    const s = form[k];
    if (k === "task_time" || k === "task_duration") {
      const n = parseNum(s);
      if (s.trim() !== "" && n == null) continue;
      if (s.trim() === "") out[k] = null;
      else out[k] = n;
      continue;
    }
    out[k] = s.trim() === "" ? null : s;
  }
  return out;
}

export function computeSparseTaskOverride(vault: TaskRow, edited: PackageTaskOverride): PackageTaskOverride {
  const out: PackageTaskOverride = {};
  for (const k of PACKAGE_TASK_OVERRIDE_KEYS) {
    if (!(k in edited)) continue;
    const ev = edited[k as keyof PackageTaskOverride];
    const tv = vault[k as keyof TaskRow];
    if (k === "task_time" || k === "task_duration") {
      const en = ev == null ? null : Number(ev);
      const tn = tv == null ? null : Number(tv);
      const enN = en != null && Number.isFinite(en) ? en : null;
      const tnN = tn != null && Number.isFinite(tn) ? tn : null;
      if (enN !== tnN) (out as Record<string, number | null>)[k] = enN;
      continue;
    }
    const es = ev == null ? "" : String(ev);
    const ts = tv == null ? "" : String(tv);
    if (es !== ts) (out as Record<string, string | null>)[k] = es === "" ? null : es;
  }
  return out;
}

export function computeSparseTaskOverridesMap(
  vaultTasks: TaskRow[],
  forms: Record<string, TaskOverrideFormRow>
): PackageTaskOverridesMap {
  const out: PackageTaskOverridesMap = {};
  for (const task of vaultTasks) {
    const form = forms[task.task_id];
    if (!form) continue;
    const partial = taskFormToOverridePartial(form);
    const sparse = computeSparseTaskOverride(task, partial);
    if (Object.keys(sparse).length > 0) out[task.task_id] = sparse;
  }
  return out;
}

export function sanitizeTaskOverridesMapForDb(o: PackageTaskOverridesMap): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [taskId, patch] of Object.entries(o)) {
    if (!patch || Object.keys(patch).length === 0) continue;
    const inner: Record<string, unknown> = {};
    for (const k of PACKAGE_TASK_OVERRIDE_KEYS) {
      if (!(k in patch)) continue;
      const v = patch[k as keyof PackageTaskOverride];
      if (k === "task_time" || k === "task_duration") {
        if (v === null) inner[k] = null;
        else if (typeof v === "number" && Number.isFinite(v)) inner[k] = v;
        continue;
      }
      if (v === null) inner[k] = null;
      else if (typeof v === "string") inner[k] = v;
    }
    if (Object.keys(inner).length) out[taskId] = inner;
  }
  return out;
}

export const PACKAGE_PRICING_FORM_FIELDS: {
  key: PackagePricingOverrideKey;
  label: string;
  kind: "text" | "number" | "bool" | "textarea";
}[] = [
  { key: "solution_label", label: "Solution label", kind: "text" },
  { key: "tier", label: "Tier label", kind: "text" },
  { key: "scope", label: "Scope", kind: "textarea" },
  { key: "hours_client_services", label: "Hours — client services", kind: "number" },
  { key: "hours_copy", label: "Hours — copy", kind: "number" },
  { key: "hours_design", label: "Hours — design", kind: "number" },
  { key: "hours_web_dev", label: "Hours — web dev", kind: "number" },
  { key: "hours_video", label: "Hours — video", kind: "number" },
  { key: "hours_data", label: "Hours — data", kind: "number" },
  { key: "hours_paid_media", label: "Hours — paid media", kind: "number" },
  { key: "hours_hubspot", label: "Hours — HubSpot", kind: "number" },
  { key: "hours_other", label: "Hours — other", kind: "number" },
  { key: "total_hours", label: "Total hours", kind: "number" },
  { key: "expected_effort_base_price", label: "Expected effort base price", kind: "number" },
  { key: "scope_risk", label: "Scope risk", kind: "number" },
  { key: "internal_coordination", label: "Internal coordination", kind: "number" },
  { key: "client_revision_risk", label: "Client revision risk", kind: "number" },
  { key: "risk_multiplier", label: "Risk multiplier", kind: "number" },
  { key: "risk_mitigated_base_price", label: "Risk-mitigated base price", kind: "number" },
  { key: "strategic_value_score", label: "Strategic value score", kind: "number" },
  { key: "strategic_value_multiplier", label: "Strategic value multiplier", kind: "number" },
  { key: "sell_price", label: "Sell price", kind: "number" },
  { key: "standalone_sell_price", label: "Standalone sell price", kind: "number" },
  { key: "old_price", label: "Old price", kind: "number" },
  { key: "percent_change", label: "Percent change", kind: "text" },
  { key: "requires_customization", label: "Requires customization", kind: "bool" },
  { key: "taxable", label: "Taxable", kind: "bool" },
  { key: "notes", label: "Notes", kind: "textarea" },
  { key: "tags", label: "Tags", kind: "text" },
];
