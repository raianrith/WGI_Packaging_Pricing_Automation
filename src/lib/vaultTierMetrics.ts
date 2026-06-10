import type { SolutionTierPricing, TaskRow } from "../types";

/** Primary sell USD from vault pricing row (same priority as Agency catalog table). */
export function vaultSellPriceUsd(pricing: SolutionTierPricing | null): number | null {
  if (!pricing) return null;
  const primary = pricing.sell_price;
  const fallback = pricing.standalone_sell_price;
  if (primary != null && Number.isFinite(Number(primary))) return Number(primary);
  if (fallback != null && Number.isFinite(Number(fallback))) return Number(fallback);
  return null;
}

export function sumTaskTimeForTier(tasks: TaskRow[], solutionTierId: string): number {
  let sum = 0;
  for (const k of tasks) {
    if (k.solution_tier_id !== solutionTierId) continue;
    if (k.task_time == null || !Number.isFinite(Number(k.task_time))) continue;
    sum += Number(k.task_time);
  }
  return sum;
}

/**
 * Hours for a tier: stored `total_hours` when set; otherwise sum of vault task times.
 */
export function vaultTierHours(pricing: SolutionTierPricing | null, tasks: TaskRow[], solutionTierId: string): number | null {
  const vault =
    pricing?.total_hours != null && Number.isFinite(Number(pricing.total_hours))
      ? Number(pricing.total_hours)
      : null;
  if (vault != null) return vault;
  const s = sumTaskTimeForTier(tasks, solutionTierId);
  return s > 0 ? s : null;
}

/**
 * Hours for catalog / proposal browse: sum of checklist task times when available
 * (matches Solutions tier detail “Sum of task time”); falls back to stored total_hours.
 */
export function catalogDisplayTierHours(
  pricing: SolutionTierPricing | null,
  tasks: TaskRow[],
  solutionTierId: string
): number | null {
  const sumTasks = sumTaskTimeForTier(tasks, solutionTierId);
  if (sumTasks > 0) return sumTasks;
  const vault =
    pricing?.total_hours != null && Number.isFinite(Number(pricing.total_hours))
      ? Number(pricing.total_hours)
      : null;
  return vault;
}

export function formatTierHoursDisplay(hours: number | null | undefined): string {
  if (hours == null || !Number.isFinite(hours)) return "—";
  return hours.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
