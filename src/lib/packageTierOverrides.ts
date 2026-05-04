import type { PackageTierOverrides, SolutionTier } from "../types";

/** Text fields that may be overridden per package (vault tier row is unchanged). */
export const PACKAGE_TIER_OVERRIDE_KEYS = [
  "solution_tier_name",
  "solution_tier_owner",
  "solution_tier_overview",
  "solution_tier_overview_link",
  "solution_tier_direction",
  "solution_tier_sop",
  "solution_tier_resources",
  "solution_tier_what_is_it",
  "solution_tier_why_is_it_valuable",
  "solution_tier_when_should_it_be_used",
  "solution_tier_assumption_prerequisites",
  "solution_tier_in_scope",
  "solution_tier_out_of_scope",
  "solution_tier_final_deliverable",
  "solution_tier_how_do_we_get_this_work_done",
  "solution_tier_described_to_client",
] as const;

export type PackageTierOverrideKey = (typeof PACKAGE_TIER_OVERRIDE_KEYS)[number];

function strNorm(v: string | null | undefined): string {
  if (v == null) return "";
  return String(v);
}

export function parseTierOverrides(raw: unknown): PackageTierOverrides {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: PackageTierOverrides = {};
  for (const k of PACKAGE_TIER_OVERRIDE_KEYS) {
    if (!(k in o)) continue;
    const v = o[k];
    if (v === null) {
      (out as Record<string, unknown>)[k] = null;
    } else if (typeof v === "string") {
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

export function mergeTierWithPackageOverrides(
  template: SolutionTier,
  overrides: PackageTierOverrides | null | undefined
): SolutionTier {
  if (!overrides || Object.keys(overrides).length === 0) return template;
  const next = { ...template };
  for (const k of PACKAGE_TIER_OVERRIDE_KEYS) {
    if (!(k in overrides)) continue;
    const v = overrides[k];
    (next as Record<string, unknown>)[k] = v === undefined ? template[k] : v;
  }
  return next;
}

/** Build sparse overrides: only keys where the edited value differs from the vault tier. */
export function computeSparseOverrides(
  template: SolutionTier,
  edited: Partial<Pick<SolutionTier, PackageTierOverrideKey>>
): PackageTierOverrides {
  const out: PackageTierOverrides = {};
  for (const k of PACKAGE_TIER_OVERRIDE_KEYS) {
    if (!(k in edited)) continue;
    const ev = edited[k];
    const tv = template[k];
    const evs = strNorm(ev as string | null | undefined);
    const tvs = strNorm(tv as string | null | undefined);
    if (evs !== tvs) {
      (out as Record<string, unknown>)[k] = evs === "" ? null : ev;
    }
  }
  return out;
}

export function emptyOverrideForm(): Record<PackageTierOverrideKey, string> {
  const row: Record<string, string> = {};
  for (const k of PACKAGE_TIER_OVERRIDE_KEYS) row[k] = "";
  return row as Record<PackageTierOverrideKey, string>;
}

export function tierToOverrideFormStrings(t: SolutionTier): Record<PackageTierOverrideKey, string> {
  const row: Record<string, string> = {};
  for (const k of PACKAGE_TIER_OVERRIDE_KEYS) {
    const v = t[k as keyof SolutionTier];
    row[k] = v == null ? "" : String(v);
  }
  return row as Record<PackageTierOverrideKey, string>;
}

export function overrideFormStringsToPartial(
  form: Record<PackageTierOverrideKey, string>
): Partial<Pick<SolutionTier, PackageTierOverrideKey>> {
  const out: Partial<Pick<SolutionTier, PackageTierOverrideKey>> = {};
  for (const k of PACKAGE_TIER_OVERRIDE_KEYS) {
    (out as Record<string, string | null>)[k] = form[k];
  }
  return out;
}

export function sanitizeOverridesForDb(o: PackageTierOverrides): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const k of PACKAGE_TIER_OVERRIDE_KEYS) {
    if (!(k in o)) continue;
    const v = o[k as keyof PackageTierOverrides];
    if (v === null) out[k] = null;
    else if (typeof v === "string") out[k] = v;
  }
  return out;
}

/** Labels for Package Builder (same concepts as Solutions Builder tier template). */
export const PACKAGE_TIER_FORM_FIELDS: {
  key: PackageTierOverrideKey;
  label: string;
  multiline?: boolean;
}[] = [
  { key: "solution_tier_name", label: "Tier name" },
  { key: "solution_tier_owner", label: "Owner" },
  { key: "solution_tier_overview", label: "Overview", multiline: true },
  { key: "solution_tier_overview_link", label: "Overview link (URL or label)" },
  { key: "solution_tier_direction", label: "Direction", multiline: true },
  { key: "solution_tier_sop", label: "SOP", multiline: true },
  { key: "solution_tier_resources", label: "Resources", multiline: true },
  { key: "solution_tier_what_is_it", label: "What is it", multiline: true },
  { key: "solution_tier_why_is_it_valuable", label: "Why is it valuable", multiline: true },
  { key: "solution_tier_when_should_it_be_used", label: "When should it be used", multiline: true },
  { key: "solution_tier_assumption_prerequisites", label: "Assumptions / prerequisites", multiline: true },
  { key: "solution_tier_in_scope", label: "In scope", multiline: true },
  { key: "solution_tier_out_of_scope", label: "Out of scope", multiline: true },
  { key: "solution_tier_final_deliverable", label: "Final deliverable", multiline: true },
  { key: "solution_tier_how_do_we_get_this_work_done", label: "How we get this work done", multiline: true },
  { key: "solution_tier_described_to_client", label: "Described to client", multiline: true },
];
