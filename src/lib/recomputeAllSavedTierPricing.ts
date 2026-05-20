import type { SupabaseClient } from "@supabase/supabase-js";
import type { SolutionTierPricing } from "../types";
import {
  buildSolutionTierPricingMathUpdate,
  storedTierPricingMathDiffersFromCompute,
} from "./recomputeStoredTierPricing";
import { normalizeTierPricingMathConfig, type TierPricingMathConfig } from "./tierPricingMath";

export type RecomputeAllSavedTierPricingResult = {
  updated: number;
  skipped: number;
  failures: string[];
};

/**
 * Recompute derived pricing columns for every `solution_tier_pricing` row using current math
 * (resource hours + account mgmt + continuous improvement add-ons → expected effort → sell).
 */
export async function recomputeAllSavedTierPricing(params: {
  client: SupabaseClient;
  rows: SolutionTierPricing[];
  config: TierPricingMathConfig;
  /** When true, write every row even if stored values already match (rarely needed). */
  force?: boolean;
  /** Called after each successful row update (e.g. audit log). */
  onRowUpdated?: (before: SolutionTierPricing, after: SolutionTierPricing) => Promise<void>;
}): Promise<RecomputeAllSavedTierPricingResult> {
  const { client, rows, force = false, onRowUpdated } = params;
  const math = normalizeTierPricingMathConfig(params.config);
  let updated = 0;
  let skipped = 0;
  const failures: string[] = [];

  for (const row of rows) {
    if (!force && !storedTierPricingMathDiffersFromCompute(row, math)) {
      skipped++;
      continue;
    }
    const payload = buildSolutionTierPricingMathUpdate(row, math);
    const { solution_tier_id, ...rest } = payload;
    const { error } = await client
      .from("solution_tier_pricing")
      .update(rest)
      .eq("solution_tier_id", solution_tier_id);
    if (error) {
      failures.push(`${solution_tier_id}: ${error.message}`);
      continue;
    }
    const after = { ...row, ...payload } as SolutionTierPricing;
    if (onRowUpdated) {
      await onRowUpdated(row, after);
    }
    updated++;
  }

  return { updated, skipped, failures };
}
