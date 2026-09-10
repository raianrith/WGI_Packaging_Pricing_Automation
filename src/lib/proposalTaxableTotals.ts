import type { PackageSolutionTier, SolutionTierPricing } from "../types";
import { mergePricingWithPackageOverrides, parsePricingOverrides } from "./packagePricingTaskOverrides";
import { normalizeTierQuantity } from "./packageTierQuantities";
import {
  cardHoursForScenarioRollup,
  cardPriceUsdForRollup,
  type CatalogCtxLike,
  type RoadmapCard,
} from "./roadmapModel";

export const PACKAGE_TAXABLE_SOLUTION_THRESHOLD = 0.1;

export type ProposalTaxabilityCtx = {
  packageTiers: PackageSolutionTier[];
  pricingByTierId: Map<string, SolutionTierPricing>;
};

export type ProposalDealTotals = {
  totalPrice: number;
  totalHours: number;
  taxablePrice: number;
  nonTaxablePrice: number;
  taxableHours: number;
  nonTaxableHours: number;
};

function vaultTierTaxable(
  tierId: string,
  pricingByTierId: Map<string, SolutionTierPricing>
): boolean {
  return Boolean(pricingByTierId.get(tierId)?.taxable);
}

/** Effective taxable flag for a package component (vault pricing + package overrides). */
export function packageComponentIsTaxable(
  link: PackageSolutionTier,
  pricingByTierId: Map<string, SolutionTierPricing>
): boolean {
  const base = pricingByTierId.get(link.solution_tier_id) ?? null;
  const merged = mergePricingWithPackageOverrides(
    base,
    link.solution_tier_id,
    parsePricingOverrides(link.pricing_overrides)
  );
  return Boolean(merged.taxable);
}

/**
 * A package is taxable when at least 10% of its component solutions (quantity-weighted) are taxable.
 */
export function packageIsTaxable(
  packageId: string,
  packageTiers: PackageSolutionTier[],
  pricingByTierId: Map<string, SolutionTierPricing>
): boolean {
  const links = packageTiers.filter((r) => r.package_id === packageId);
  if (links.length === 0) return false;

  let totalWeight = 0;
  let taxableWeight = 0;
  for (const link of links) {
    const qty = normalizeTierQuantity(link.quantity);
    totalWeight += qty;
    if (packageComponentIsTaxable(link, pricingByTierId)) {
      taxableWeight += qty;
    }
  }
  if (totalWeight <= 0) return false;
  return taxableWeight / totalWeight >= PACKAGE_TAXABLE_SOLUTION_THRESHOLD;
}

export function cardIsTaxable(card: RoadmapCard, taxCtx: ProposalTaxabilityCtx | null): boolean {
  if (!taxCtx) return false;
  if (card.kind === "package") {
    return packageIsTaxable(card.refId, taxCtx.packageTiers, taxCtx.pricingByTierId);
  }
  if (card.kind === "tier" || card.kind === "custom_tier") {
    return vaultTierTaxable(card.refId, taxCtx.pricingByTierId);
  }
  // Solutions / tasks / groups: no direct pricing taxable flag — treat as non-taxable.
  return false;
}

export function computeProposalDealTotals(args: {
  cards: RoadmapCard[];
  ctx: CatalogCtxLike | null;
  taxCtx: ProposalTaxabilityCtx | null;
  computeScratchSellPrice: (c: RoadmapCard, ctx: CatalogCtxLike | null) => string;
}): ProposalDealTotals {
  let totalPrice = 0;
  let totalHours = 0;
  let taxablePrice = 0;
  let nonTaxablePrice = 0;
  let taxableHours = 0;
  let nonTaxableHours = 0;

  for (const card of args.cards) {
    if (card.scope !== "included") continue;
    const taxable = cardIsTaxable(card, args.taxCtx);
    const price = cardPriceUsdForRollup(card, args.ctx, args.computeScratchSellPrice);
    const hours = cardHoursForScenarioRollup(card, args.ctx);
    if (price != null) {
      totalPrice += price;
      if (taxable) taxablePrice += price;
      else nonTaxablePrice += price;
    }
    if (hours != null) {
      totalHours += hours;
      if (taxable) taxableHours += hours;
      else nonTaxableHours += hours;
    }
  }

  return {
    totalPrice,
    totalHours,
    taxablePrice,
    nonTaxablePrice,
    taxableHours,
    nonTaxableHours,
  };
}
