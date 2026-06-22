/** Playbook order for solution tier categories (left-to-right on org chart). */
export const TIER_CATEGORY_CANONICAL_ORDER = [
  "Discovery & Research",
  "Brand & Style Foundation",
  "Strategic Growth Playbook",
  "Data & Tech Enablement",
  "Website Optimization",
  "Core Market Presence",
  "Market Activation Campaigns",
  "Operational Optimization",
  "Asset Creation",
  "Billing & Engagement Modifiers",
] as const;

/** Canonical solution tier categories in playbook order. */
export const TIER_CATEGORY_OPTIONS = [...TIER_CATEGORY_CANONICAL_ORDER] as const;

export type TierCategory = (typeof TIER_CATEGORY_OPTIONS)[number];

function compareLabels(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

/** Strip org-chart prefixes like "Track 1: Core Market Presence" → "Core Market Presence". */
export function stripTrackPrefix(label: string): string {
  return label.trim().replace(/^track\s*\d+\s*:\s*/i, "").trim();
}

/** Clean category text for display and grouping (no track numbers). */
export function displayTierCategoryLabel(value: string): string {
  const stripped = stripTrackPrefix(value);
  if (!stripped) return stripped;
  return normalizeTierCategory(stripped) ?? stripped;
}

function tierCategorySortRank(label: string): number {
  const v = displayTierCategoryLabel(label);
  if (!v) return 900;

  const exact = TIER_CATEGORY_CANONICAL_ORDER.findIndex(
    (o) => o.localeCompare(v, undefined, { sensitivity: "base" }) === 0
  );
  if (exact >= 0) return exact;

  const lower = v.toLowerCase();
  if (lower.includes("discovery") && lower.includes("research")) return 0;
  if (lower.includes("brand") && lower.includes("style")) return 1;
  if (lower.includes("strategic growth")) return 2;
  if (lower.includes("data") && lower.includes("tech")) return 3;
  if (lower.includes("website optimization")) return 4;
  if (lower.includes("core market presence")) return 5;
  if (lower.includes("market activation")) return 6;
  if (lower.includes("operational optimization")) return 7;
  if (lower.includes("asset creation")) return 8;
  if (lower.includes("billing") && lower.includes("engagement")) return 9;

  return 50;
}

/** Sort category labels in playbook order; unknown labels follow canonical list (A–Z among themselves). */
export function compareTierCategoryLabels(a: string, b: string): number {
  const ra = tierCategorySortRank(a);
  const rb = tierCategorySortRank(b);
  if (ra !== rb) return ra - rb;
  return compareLabels(a, b);
}

export function sortTierCategoryLabels(labels: readonly string[]): string[] {
  return [...labels].sort(compareTierCategoryLabels);
}

/** Options for select menus, including a legacy value not in the canonical list. */
export function tierCategorySelectOptions(
  currentValue: string,
  canonical: readonly string[] = TIER_CATEGORY_OPTIONS
): string[] {
  const v = displayTierCategoryLabel(currentValue);
  const hasExact = canonical.some((o) => o.localeCompare(v, undefined, { sensitivity: "base" }) === 0);
  const labels = !v || hasExact ? [...canonical] : [...canonical, v];
  return sortTierCategoryLabels(labels);
}

/** Normalize free-text import/spreadsheet values to a canonical option when possible. */
export function normalizeTierCategory(value: string | null | undefined): string | null {
  const v = stripTrackPrefix(value ?? "");
  if (!v) return null;
  const exact = (TIER_CATEGORY_OPTIONS as readonly string[]).find(
    (o) => o.localeCompare(v, undefined, { sensitivity: "base" }) === 0
  );
  return exact ?? v;
}
