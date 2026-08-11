import type { CatalogCtxLike, RoadmapCard } from "./roadmapModel";
import { cardHoursForScenarioRollup } from "./roadmapModel";
import { isVariableTierRefId } from "./proposalVariableTiers";
import { ACCOUNT_MGMT_HOURS_ADDON_RATE } from "./tierPricingMath";

export type ProposalAccountMgmtRollup = {
  resourceHours: number;
  accountMgmtHours: number;
  includedLineCount: number;
};

/** 18% of included resource hours across all scenarios (excludes variable extras). */
export function computeProposalAccountMgmtRollup(
  cards: RoadmapCard[],
  ctx: CatalogCtxLike | null
): ProposalAccountMgmtRollup {
  let resourceHours = 0;
  let includedLineCount = 0;
  for (const c of cards) {
    if (c.scope !== "included" || isVariableTierRefId(c.refId)) continue;
    const hh = cardHoursForScenarioRollup(c, ctx);
    if (hh == null || !(hh > 0)) continue;
    resourceHours += hh;
    includedLineCount += 1;
  }
  const accountMgmtHours =
    Math.round(resourceHours * ACCOUNT_MGMT_HOURS_ADDON_RATE * 100) / 100;
  return { resourceHours, accountMgmtHours, includedLineCount };
}
