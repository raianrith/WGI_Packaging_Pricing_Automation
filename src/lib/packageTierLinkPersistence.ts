import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PackagePricingOverrides,
  PackageSolutionTier,
  PackageTaskExtensions,
  PackageTaskOverridesMap,
  PackageTierOverrides,
} from "../types";
import {
  normalizeTierQuantity,
  tierIdsFromQuantities,
  type PackageTierQuantities,
} from "./packageTierQuantities";
import {
  sanitizePricingOverridesForDb,
  sanitizeTaskOverridesMapForDb,
} from "./packagePricingTaskOverrides";
import { sanitizeOverridesForDb } from "./packageTierOverrides";
import { emptyTaskExtensions, sanitizeTaskExtensionsForDb } from "./packageTaskLayout";
import { friendlyMutationMessage } from "./supabaseErrors";

export type PackageLinkSavePayload = {
  tier_overrides: PackageTierOverrides;
  pricing_overrides: PackagePricingOverrides;
  task_overrides: PackageTaskOverridesMap;
  task_extensions: PackageTaskExtensions;
};

export function emptyPackageLinkPayload(): PackageLinkSavePayload {
  return {
    tier_overrides: {},
    pricing_overrides: {},
    task_overrides: {},
    task_extensions: emptyTaskExtensions(),
  };
}

export function packPackageLinkRowForDb(p: PackageLinkSavePayload): Record<string, unknown> {
  return {
    tier_overrides: sanitizeOverridesForDb(p.tier_overrides),
    pricing_overrides: sanitizePricingOverridesForDb(p.pricing_overrides),
    task_overrides: sanitizeTaskOverridesMapForDb(p.task_overrides),
    task_extensions: sanitizeTaskExtensionsForDb(p.task_extensions),
  };
}

/**
 * Sync `package_solution_tiers` rows for one package: delete removed tiers, insert new links,
 * update overrides and quantity for existing links.
 */
export async function applyPackageTierMembership(
  client: SupabaseClient,
  packageId: string,
  wantedQuantities: PackageTierQuantities,
  payloadByTier: Record<string, PackageLinkSavePayload>
): Promise<string | null> {
  const wantedTierIds = tierIdsFromQuantities(wantedQuantities);
  const { data: curRows, error: fetchErr } = await client
    .from("package_solution_tiers")
    .select("*")
    .eq("package_id", packageId);
  if (fetchErr) return friendlyMutationMessage(fetchErr.message);
  const cur = (curRows ?? []) as PackageSolutionTier[];
  const curSet = new Set(cur.map((r) => r.solution_tier_id));
  const wantedSet = new Set(wantedTierIds);

  for (const r of cur) {
    if (!wantedSet.has(r.solution_tier_id)) {
      const { error } = await client
        .from("package_solution_tiers")
        .delete()
        .eq("package_id", packageId)
        .eq("solution_tier_id", r.solution_tier_id);
      if (error) return friendlyMutationMessage(error.message);
    }
  }

  for (const tid of wantedTierIds) {
    const payload = payloadByTier[tid] ?? emptyPackageLinkPayload();
    const rowPayload = {
      ...packPackageLinkRowForDb(payload),
      quantity: normalizeTierQuantity(wantedQuantities[tid]),
    };
    if (!curSet.has(tid)) {
      const { error: e2 } = await client.from("package_solution_tiers").insert({
        package_id: packageId,
        solution_tier_id: tid,
        ...rowPayload,
      });
      if (e2) return friendlyMutationMessage(e2.message);
    } else {
      const { error: e3 } = await client
        .from("package_solution_tiers")
        .update(rowPayload)
        .eq("package_id", packageId)
        .eq("solution_tier_id", tid);
      if (e3) return friendlyMutationMessage(e3.message);
    }
  }
  return null;
}

/** @deprecated Pass `PackageTierQuantities` instead of a flat tier id list. */
export async function applyPackageTierMembershipByIds(
  client: SupabaseClient,
  packageId: string,
  wantedTierIds: string[],
  payloadByTier: Record<string, PackageLinkSavePayload>
): Promise<string | null> {
  const wantedQuantities: PackageTierQuantities = {};
  for (const tid of wantedTierIds) wantedQuantities[tid] = 1;
  return applyPackageTierMembership(client, packageId, wantedQuantities, payloadByTier);
}
