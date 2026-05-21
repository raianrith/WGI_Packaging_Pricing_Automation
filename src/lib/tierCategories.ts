/** Canonical solution tier categories (alphabetical). Used for dropdowns app-wide. */
export const TIER_CATEGORY_OPTIONS = [
  "Asset Creation",
  "Brand & Style Foundation",
  "Core Market Presence",
  "Data & Tech Enablement",
  "Discovery & Research",
  "Market Activation Campaigns",
  "Operational Optimization",
  "Strategic Growth Playbook",
  "Website Optimization",
] as const;

export type TierCategory = (typeof TIER_CATEGORY_OPTIONS)[number];

/** Options for select menus, including a legacy value not in the canonical list. */
export function tierCategorySelectOptions(currentValue: string): string[] {
  const v = currentValue.trim();
  if (!v || (TIER_CATEGORY_OPTIONS as readonly string[]).includes(v)) {
    return [...TIER_CATEGORY_OPTIONS];
  }
  return [...TIER_CATEGORY_OPTIONS, v].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/** Normalize free-text import/spreadsheet values to a canonical option when possible. */
export function normalizeTierCategory(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  const exact = (TIER_CATEGORY_OPTIONS as readonly string[]).find(
    (o) => o.localeCompare(v, undefined, { sensitivity: "base" }) === 0
  );
  return exact ?? v;
}
