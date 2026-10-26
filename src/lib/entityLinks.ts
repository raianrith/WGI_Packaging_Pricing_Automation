import { isCatalogSolutionType, type CatalogDirectoryRow } from "./buildCatalogDirectoryRows";
import type { RoadmapCard } from "./roadmapModel";

export function proposalPath(proposalId: string): string {
  return `/roadmap/${encodeURIComponent(proposalId)}`;
}

export function solutionOverviewPath(solutionId: string, tierId?: string | null): string {
  const q = new URLSearchParams();
  q.set("sol", solutionId);
  if (tierId) q.set("tier", tierId);
  return `/directory-details?${q.toString()}`;
}

export function packageOverviewPath(packageId: string): string {
  return `/package/${encodeURIComponent(packageId)}`;
}

export function isProposalBuilderPath(pathname: string): boolean {
  return pathname === "/roadmap" || pathname.startsWith("/roadmap/");
}

export function hrefForCatalogDirectoryRow(row: CatalogDirectoryRow): string | null {
  if (isCatalogSolutionType(row.type) && row.solutionId) {
    return solutionOverviewPath(row.solutionId, row.tierRows[0]?.tierId ?? null);
  }
  if (row.packageId) return packageOverviewPath(row.packageId);
  return null;
}

export function hrefForRoadmapCard(
  card: Pick<RoadmapCard, "kind" | "refId">,
  tiers?: Array<{ solution_tier_id: string; solution_id: string }> | null
): string | null {
  if (card.kind === "package") return packageOverviewPath(card.refId);
  if (card.kind === "tier" || card.kind === "solution") {
    const tier = tiers?.find((t) => t.solution_tier_id === card.refId);
    if (tier) return solutionOverviewPath(tier.solution_id, tier.solution_tier_id);
    return solutionOverviewPath(card.refId);
  }
  return null;
}
