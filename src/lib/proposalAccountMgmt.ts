import type { CatalogCtxLike, RoadmapCard } from "./roadmapModel";
import { cardHoursForScenarioRollup } from "./roadmapModel";
import { isVariableTierRefId } from "./proposalVariableTiers";
import {
  flexBudgetAddonHoursFromSellUsd,
  flexBudgetSellUsd,
  isFlexBudgetCard,
} from "./proposalFlexBudget";
import {
  ACCOUNT_MGMT_HOURS_ADDON_RATE,
  CONTINUOUS_IMPROVEMENT_HOURS_ADDON_RATE,
  TIER_PRICING_HOURLY_RATE,
  loadTierPricingMathConfigFromStorage,
  normalizeTierPricingMathConfig,
} from "./tierPricingMath";

export type ProposalAccountMgmtRollup = {
  resourceHours: number;
  accountMgmtHours: number;
  continuousImprovementHours: number;
  includedLineCount: number;
  /** Sum of Flex Budget proposal sell prices that contribute AM/CI via 18%/1%. */
  flexBudgetUsd: number;
  hourlyRate: number;
};

export type ProposalAccountMgmtOptions = {
  /** Agency hourly rate used to turn Flex Budget $ into AM/CI hours. */
  hourlyRate?: number;
};

function resolveHourlyRate(opts?: ProposalAccountMgmtOptions): number {
  if (opts?.hourlyRate != null && opts.hourlyRate > 0) return opts.hourlyRate;
  try {
    const cfg = normalizeTierPricingMathConfig(loadTierPricingMathConfigFromStorage());
    if (cfg.hourlyRate > 0) return cfg.hourlyRate;
  } catch {
    /* ignore */
  }
  return TIER_PRICING_HOURLY_RATE;
}

/** Derived add-on hours from included resource hours + Flex Budget sell (excludes variable extras). */
export function computeProposalAccountMgmtRollup(
  cards: RoadmapCard[],
  ctx: CatalogCtxLike | null,
  opts?: ProposalAccountMgmtOptions
): ProposalAccountMgmtRollup {
  const hourlyRate = resolveHourlyRate(opts);

  let resourceHours = 0;
  let includedLineCount = 0;
  let flexBudgetUsd = 0;
  let flexAmHours = 0;
  let flexCiHours = 0;

  for (const c of cards) {
    if (c.scope !== "included" || isVariableTierRefId(c.refId)) continue;

    if (isFlexBudgetCard(c)) {
      const sell = flexBudgetSellUsd(c);
      if (sell == null || !(sell > 0)) continue;
      flexBudgetUsd += sell;
      const addons = flexBudgetAddonHoursFromSellUsd(sell, hourlyRate);
      flexAmHours += addons.accountMgmtHours;
      flexCiHours += addons.continuousImprovementHours;
      includedLineCount += 1;
      continue;
    }

    const hh = cardHoursForScenarioRollup(c, ctx);
    if (hh == null || !(hh > 0)) continue;
    resourceHours += hh;
    includedLineCount += 1;
  }

  const accountMgmtHours =
    Math.round((resourceHours * ACCOUNT_MGMT_HOURS_ADDON_RATE + flexAmHours) * 100) / 100;
  const continuousImprovementHours =
    Math.round((resourceHours * CONTINUOUS_IMPROVEMENT_HOURS_ADDON_RATE + flexCiHours) * 100) / 100;

  return {
    resourceHours,
    accountMgmtHours,
    continuousImprovementHours,
    includedLineCount,
    flexBudgetUsd,
    hourlyRate,
  };
}
