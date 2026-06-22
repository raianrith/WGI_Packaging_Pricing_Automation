import type { SolutionTierTaxonomyOptionRow, TierTaxonomyKind } from "../types";
import { TIER_CATEGORY_OPTIONS, displayTierCategoryLabel, sortTierCategoryLabels, stripTrackPrefix } from "./tierCategories";

/** Canonical playbook order for tier lifecycle phases (first match wins). */
export const TIER_PHASE_CANONICAL_ORDER = [
  "Foundational",
  "Foundational Phase",
  "Acceleration",
  "Acceleration Phase",
  "Growth Engine",
  "Other",
] as const;

/** Fallback when taxonomy_options table is missing or empty. */
export const TIER_PHASE_FALLBACK = [
  "Foundational",
  "Acceleration Phase",
  "Growth Engine",
  "Other",
] as const;

export const TIER_TACTIC_FALLBACK = ["Paid Demand Capture", "Search & AI Visibility"] as const;

function compareTaxonomyLabels(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function tierPhaseSortRank(label: string): number {
  const v = label.trim();
  if (!v) return 900;

  const exact = TIER_PHASE_CANONICAL_ORDER.findIndex(
    (o) => o.localeCompare(v, undefined, { sensitivity: "base" }) === 0
  );
  if (exact >= 0) return exact;

  const lower = v.toLowerCase();
  if (lower.includes("foundational")) return 0;
  if (lower.includes("acceleration")) return 2;
  if (lower.includes("growth engine")) return 4;
  if (lower === "other") return 5;

  return 50;
}

/** Sort phase labels in playbook order; unknown labels follow canonical list (A–Z among themselves). */
export function compareTierPhaseLabels(a: string, b: string): number {
  const ra = tierPhaseSortRank(a);
  const rb = tierPhaseSortRank(b);
  if (ra !== rb) return ra - rb;
  return compareTaxonomyLabels(a, b);
}

export function sortTierPhaseLabels(labels: readonly string[]): string[] {
  return [...labels].sort(compareTierPhaseLabels);
}

export function labelsForTaxonomyKind(
  rows: SolutionTierTaxonomyOptionRow[],
  kind: TierTaxonomyKind,
  fallback: readonly string[]
): string[] {
  const fromDb = rows.filter((r) => r.kind === kind).map((r) => r.label);
  if (fromDb.length > 0) {
    if (kind === "phase") return sortTierPhaseLabels(fromDb);
    if (kind === "category") {
      const seen = new Map<string, string>();
      for (const raw of fromDb) {
        const clean = displayTierCategoryLabel(raw);
        if (!clean) continue;
        const key = clean.toLowerCase();
        if (!seen.has(key)) seen.set(key, clean);
      }
      return sortTierCategoryLabels([...seen.values()]);
    }
    return fromDb.sort(compareTaxonomyLabels);
  }
  if (kind === "phase") return [...TIER_PHASE_FALLBACK];
  if (kind === "category") return [...TIER_CATEGORY_OPTIONS];
  return [...fallback].sort(compareTaxonomyLabels);
}

export function tierTaxonomyOptionsFromRows(rows: SolutionTierTaxonomyOptionRow[]): {
  phase: string[];
  category: string[];
  tactic: string[];
} {
  return {
    phase: labelsForTaxonomyKind(rows, "phase", TIER_PHASE_FALLBACK),
    category: labelsForTaxonomyKind(rows, "category", TIER_CATEGORY_OPTIONS),
    tactic: labelsForTaxonomyKind(rows, "tactic", TIER_TACTIC_FALLBACK),
  };
}

/** Options for select menus, including a legacy value not in the canonical list. */
export function tierTaxonomySelectOptions(
  currentValue: string,
  canonical: readonly string[],
  compare: (a: string, b: string) => number = compareTaxonomyLabels
): string[] {
  const v = currentValue.trim();
  const hasExact = canonical.some((o) => o.localeCompare(v, undefined, { sensitivity: "base" }) === 0);
  const labels = !v || hasExact ? [...canonical] : [...canonical, v];
  return labels.sort(compare);
}

export function tierPhaseSelectOptions(currentValue: string, canonical: readonly string[]): string[] {
  return tierTaxonomySelectOptions(currentValue, canonical, compareTierPhaseLabels);
}

export function normalizeTierTaxonomyLabel(
  value: string | null | undefined,
  canonical: readonly string[]
): string | null {
  const v = stripTrackPrefix(value ?? "");
  if (!v || v === "(none)") return null;
  const exact = canonical.find((o) => o.localeCompare(v, undefined, { sensitivity: "base" }) === 0);
  return exact ?? v;
}

export function normalizeTierPhase(value: string | null | undefined, phaseOptions: readonly string[]): string | null {
  return normalizeTierTaxonomyLabel(value, phaseOptions);
}

export function normalizeTierTactic(value: string | null | undefined, tacticOptions: readonly string[]): string | null {
  return normalizeTierTaxonomyLabel(value, tacticOptions);
}
