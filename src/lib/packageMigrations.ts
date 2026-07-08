import type { SolutionTier } from "../types";
import type { CatalogTierNavTarget } from "./catalogTierNavigation";

export type PackageMigrationRow = {
  former_package_id: string;
  solution_id: string;
  solution_tier_id: string | null;
  former_package_name: string | null;
};

/** Resolve a deleted package id to its replacement solution tier (if migrated). */
export function resolveMigratedPackageTarget(
  packageId: string,
  migrations: readonly PackageMigrationRow[],
  tiers: readonly SolutionTier[]
): CatalogTierNavTarget | null {
  const id = packageId.trim();
  if (!id) return null;

  const row = migrations.find((m) => m.former_package_id === id);
  if (row?.solution_tier_id) {
    const tier = tiers.find((t) => t.solution_tier_id === row.solution_tier_id);
    if (tier) return { solutionId: tier.solution_id, tierId: tier.solution_tier_id };
  }

  if (row?.solution_id && !row.solution_tier_id) {
    const tier = tiers.find((t) => t.solution_id === row.solution_id);
    if (tier) return { solutionId: tier.solution_id, tierId: tier.solution_tier_id };
  }

  return null;
}
