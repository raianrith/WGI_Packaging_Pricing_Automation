import type { SolutionTierTaxonomyOptionRow, TierTaxonomyKind } from "../types";
import { TIER_CATEGORY_OPTIONS } from "./tierCategories";

/** Fallback when taxonomy_options table is missing or empty. */
export const TIER_PHASE_FALLBACK = ["Foundational", "Growth Engine", "Other"] as const;

export const TIER_TACTIC_FALLBACK = ["Paid Demand Capture", "Search & AI Visibility"] as const;

function compareTaxonomyLabels(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

export function labelsForTaxonomyKind(
  rows: SolutionTierTaxonomyOptionRow[],
  kind: TierTaxonomyKind,
  fallback: readonly string[]
): string[] {
  const fromDb = rows
    .filter((r) => r.kind === kind)
    .map((r) => r.label)
    .sort(compareTaxonomyLabels);
  if (fromDb.length > 0) return fromDb;
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
export function tierTaxonomySelectOptions(currentValue: string, canonical: readonly string[]): string[] {
  const v = currentValue.trim();
  if (!v || canonical.includes(v)) {
    return [...canonical];
  }
  return [...canonical, v].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function normalizeTierTaxonomyLabel(
  value: string | null | undefined,
  canonical: readonly string[]
): string | null {
  const v = (value ?? "").trim();
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
