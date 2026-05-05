/** Local-only types & helpers for Proposal Builder (roadmap) — no Supabase writes. */

export type RoadmapLineScope = "included" | "optional" | "deferred";

export type RoadmapCardKind = "package" | "solution" | "tier" | "task" | "task_group" | "custom_tier";

export type RoadmapScenario = {
  id: string;
  title: string;
  narrative: string;
};

export type RoadmapPhase = {
  id: string;
  scenarioId: string;
  title: string;
  sortOrder: number;
};

export type RoadmapCard = {
  key: string;
  kind: RoadmapCardKind;
  refId: string;
  scenarioId: string;
  phaseId: string;
  headline: string;
  description: string;
  hours: string;
  price: string;
  scope: RoadmapLineScope;
  /** When set (non-empty), used for rollup + display instead of `hours`. */
  hoursOverride?: string | null;
  /** When set (non-empty), used for rollup + display instead of catalog / computed `price`. */
  priceOverride?: string | null;
  /** Scratch tier: blended $/hr before multipliers */
  scratchBlendRateUsd?: number;
  scratchRiskMult?: number;
  scratchStrategicMult?: number;
  scratchAttachedTaskIds?: string[];
  scratchAttachedTaskGroupIds?: string[];
};

export type CatalogCtxLike = {
  tasks: Array<{ task_id: string; task_time: number | null }>;
  groupLinesMap: Map<string, Array<{ hours: number | null }>>;
};

/** Parse a single-line hours value from roadmap cards (e.g. `40 h`, `11.5`). */
export function tryParseRoadmapHours(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const withH = t.match(/([\d.]+)\s*h/i);
  if (withH) {
    const n = Number(withH[1]);
    return Number.isFinite(n) ? n : null;
  }
  const plain = t.match(/^\d+(\.\d+)?$/);
  if (plain) {
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function tryParseUsdRough(s: string): number | null {
  const cleaned = s.replace(/[(),]/g, " ").replace(/[^\d.]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function effectiveHoursStr(card: Pick<RoadmapCard, "hours" | "hoursOverride">): string {
  const o = card.hoursOverride?.trim();
  return o ?? card.hours;
}

export function effectivePriceStr(
  card: Pick<
    RoadmapCard,
    "kind" | "price" | "priceOverride" | "hours" | "scratchBlendRateUsd" | "scratchRiskMult" | "scratchStrategicMult" | "scratchAttachedTaskIds" | "scratchAttachedTaskGroupIds"
  >,
  ctx: CatalogCtxLike | null,
  computeScratchSellPrice: (c: RoadmapCard, ctx: CatalogCtxLike | null) => string
): string {
  const o = card.priceOverride?.trim();
  if (o) return o;
  if (card.kind === "custom_tier") return computeScratchSellPrice(card as RoadmapCard, ctx);
  return card.price;
}

export function extraHoursFromAttachmentsScratch(
  card: Pick<RoadmapCard, "scratchAttachedTaskIds" | "scratchAttachedTaskGroupIds">,
  ctx: CatalogCtxLike
): number {
  let sum = 0;
  for (const tid of card.scratchAttachedTaskIds ?? []) {
    const task = ctx.tasks.find((t) => t.task_id === tid);
    if (task?.task_time != null && Number.isFinite(Number(task.task_time))) {
      sum += Number(task.task_time);
    }
  }
  for (const gid of card.scratchAttachedTaskGroupIds ?? []) {
    const lines = ctx.groupLinesMap.get(gid) ?? [];
    for (const L of lines) {
      if (L.hours != null && Number.isFinite(Number(L.hours))) {
        sum += Number(L.hours);
      }
    }
  }
  return sum;
}

export function scratchEffectiveHoursBreakdown(
  card: Pick<RoadmapCard, "kind" | "hours" | "hoursOverride" | "scratchAttachedTaskIds" | "scratchAttachedTaskGroupIds">,
  ctx: CatalogCtxLike | null
): { manual: number; catalog: number; total: number } | null {
  if (card.kind !== "custom_tier") return null;
  const manualParsed = tryParseRoadmapHours(effectiveHoursStr(card));
  const manual = manualParsed ?? 0;
  const catalog = ctx ? extraHoursFromAttachmentsScratch(card, ctx) : 0;
  const total = manual + catalog;
  if (total <= 0) return null;
  return { manual, catalog, total };
}

/** Hours for rollup; respects hoursOverride string; excludes non-included scopes at call site */
export function cardHoursForScenarioRollup(card: RoadmapCard, ctx: CatalogCtxLike | null): number | null {
  if (card.scope !== "included") return null;
  if (card.kind === "custom_tier") {
    const b = scratchEffectiveHoursBreakdown(card, ctx);
    return b ? b.total : null;
  }
  return tryParseRoadmapHours(effectiveHoursStr(card));
}

export function cardPriceUsdForRollup(
  card: RoadmapCard,
  ctx: CatalogCtxLike | null,
  computeScratchSellPrice: (c: RoadmapCard, ctx: CatalogCtxLike | null) => string
): number | null {
  if (card.scope !== "included") return null;
  const pStr = effectivePriceStr(card, ctx, computeScratchSellPrice);
  return tryParseUsdRough(pStr);
}

export type BudgetScenarioStatus = "under" | "in_range" | "over";

/** Compare included-line subtotal to client budget (USD). */
export function budgetVsScenarioStatus(subtotal: number, budget: number): BudgetScenarioStatus {
  if (!(budget > 0) || !Number.isFinite(subtotal)) return "under";
  if (subtotal > budget) return "over";
  if (subtotal >= budget * 0.92) return "in_range";
  return "under";
}
