import type { RoadmapCard } from "./roadmapModel";
import { tryParseUsdRough } from "./roadmapModel";
import {
  ACCOUNT_MGMT_HOURS_ADDON_RATE,
  CONTINUOUS_IMPROVEMENT_HOURS_ADDON_RATE,
  TIER_PRICING_HOURLY_RATE,
} from "./tierPricingMath";

/** Match vault "Flex Budget" solution / tier (proposal-only sell price). */
export function isFlexBudgetName(name: string | null | undefined): boolean {
  return Boolean(name?.trim() && /^flex\s*budget$/i.test(name.trim()));
}

export function isFlexBudgetTier(tier: {
  solution_tier_name?: string | null;
  solution_tier_id?: string | null;
}): boolean {
  return isFlexBudgetName(tier.solution_tier_name) || isFlexBudgetName(tier.solution_tier_id);
}

export function isFlexBudgetCard(
  card: Pick<RoadmapCard, "kind" | "refId" | "headline" | "isFlexBudget">
): boolean {
  if (card.isFlexBudget) return true;
  if (card.kind !== "tier") return false;
  return isFlexBudgetName(card.refId) || isFlexBudgetName(card.headline);
}

/** Parses user-entered budget: $, commas, optional `150k` style. */
export function parseFlexBudgetPriceInput(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const k = t.match(/^(\d+(?:\.\d+)?)\s*k$/i);
  if (k) {
    const n = Number(k[1]) * 1000;
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  const cleaned = t.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function flexBudgetSellUsd(card: Pick<RoadmapCard, "price" | "priceOverride">): number | null {
  const fromOverride = card.priceOverride?.trim() ? tryParseUsdRough(card.priceOverride) : null;
  if (fromOverride != null && fromOverride > 0) return fromOverride;
  const fromPrice = card.price?.trim() ? tryParseUsdRough(card.price) : null;
  if (fromPrice != null && fromPrice > 0) return fromPrice;
  return null;
}

/** Convert Flex Budget sell $ into AM / CI hour equivalents (same rates as vault add-ons). */
export function flexBudgetAddonHoursFromSellUsd(
  sellUsd: number,
  hourlyRate: number = TIER_PRICING_HOURLY_RATE
): { accountMgmtHours: number; continuousImprovementHours: number } {
  const rate = hourlyRate > 0 ? hourlyRate : TIER_PRICING_HOURLY_RATE;
  const accountMgmtHours =
    Math.round(((sellUsd * ACCOUNT_MGMT_HOURS_ADDON_RATE) / rate) * 100) / 100;
  const continuousImprovementHours =
    Math.round(((sellUsd * CONTINUOUS_IMPROVEMENT_HOURS_ADDON_RATE) / rate) * 100) / 100;
  return { accountMgmtHours, continuousImprovementHours };
}
