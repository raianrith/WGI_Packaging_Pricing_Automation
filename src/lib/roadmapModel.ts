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

export function sortedPhasesForScenario(phases: RoadmapPhase[], scenarioId: string): RoadmapPhase[] {
  return phases.filter((p) => p.scenarioId === scenarioId).sort((a, b) => a.sortOrder - b.sortOrder);
}

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
  /** Travel Time variable tier: hours entered at add time */
  variableTravelHours?: number | null;
  /** Paid Campaign Optimization variable tier: total paid ads spend entered at add time */
  variablePaidAdsSpendUsd?: number | null;
  /** Percent-based variable tiers: catalog refId of the tier whose sell price drives the calculation */
  variableLinkedTierRefId?: string | null;
  /** When set, this card is an add-on nested under the parent solution tier with this `key`. */
  addonOfCardKey?: string | null;
  /**
   * Proposal-only task edits for Client Service Review.
   * Does not mutate vault `tasks` or package link rows — sparse overlay on catalog tasks.
   */
  taskLayout?: RoadmapCardTaskLayout | null;
  /** Scheduled start (ISO `YYYY-MM-DD`). */
  startDate?: string | null;
  /** Scheduled end (ISO `YYYY-MM-DD`). */
  endDate?: string | null;
};

/** Sparse proposal-local task edits (vault / package catalog unchanged). */
export type RoadmapCardTaskLayout = {
  /** Catalog or package-extra task ids hidden on this proposal line. */
  hiddenIds?: string[];
  /** Per-task hours overrides (`task_id` → hours). */
  hourOverrides?: Record<string, number | null>;
  /** Client-facing display names for catalog/package tasks (`task_id` → label). */
  nameOverrides?: Record<string, string>;
  /** Explicit display order of visible task ids (catalog + extras). */
  taskOrder?: string[];
  /** Tasks that exist only on this proposal line. */
  extras?: RoadmapCardExtraTask[];
};

export type RoadmapCardExtraTask = {
  id: string;
  name: string;
  hours: number | null;
  implementer?: string | null;
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

export type ReorderCardDirection = "up" | "down";

/**
 * Keep package module add-ons immediately after their parent solution in phase order.
 * Parent order follows `orderedKeys` (from drag); sibling add-on order also follows `orderedKeys`.
 */
export function clusterPhaseCardKeysWithAddons(
  phaseCards: readonly RoadmapCard[],
  orderedKeys: readonly string[]
): string[] {
  if (phaseCards.length === 0) return [];
  const byKey = new Map(phaseCards.map((c) => [c.key, c]));
  const phaseKeySet = new Set(byKey.keys());

  const childrenByParent = new Map<string, string[]>();
  for (const key of orderedKeys) {
    const c = byKey.get(key);
    if (!c) continue;
    const parentKey = c.addonOfCardKey;
    if (!parentKey || !phaseKeySet.has(parentKey)) continue;
    const list = childrenByParent.get(parentKey) ?? [];
    list.push(key);
    childrenByParent.set(parentKey, list);
  }
  // Any add-ons missing from orderedKeys (shouldn't happen) — append in prior phase order
  for (const c of phaseCards) {
    const parentKey = c.addonOfCardKey;
    if (!parentKey || !phaseKeySet.has(parentKey)) continue;
    const list = childrenByParent.get(parentKey) ?? [];
    if (!list.includes(c.key)) {
      list.push(c.key);
      childrenByParent.set(parentKey, list);
    }
  }

  const used = new Set<string>();
  const out: string[] = [];
  for (const key of orderedKeys) {
    if (used.has(key)) continue;
    const c = byKey.get(key);
    if (!c) continue;
    if (c.addonOfCardKey && phaseKeySet.has(c.addonOfCardKey)) continue;
    out.push(key);
    used.add(key);
    for (const childKey of childrenByParent.get(key) ?? []) {
      if (used.has(childKey)) continue;
      out.push(childKey);
      used.add(childKey);
    }
  }
  for (const c of phaseCards) {
    if (used.has(c.key)) continue;
    out.push(c.key);
    used.add(c.key);
  }
  return out;
}

/** Apply a new key order for all lines in one scenario phase; other cards stay put. */
export function reorderPhaseCardsByKeys(
  cards: RoadmapCard[],
  scenarioId: string,
  phaseId: string,
  orderedKeys: string[]
): RoadmapCard[] {
  const phaseCards = cards.filter((c) => c.scenarioId === scenarioId && c.phaseId === phaseId);
  if (phaseCards.length <= 1) return cards;
  if (orderedKeys.length !== phaseCards.length) return cards;

  const phaseKeySet = new Set(phaseCards.map((c) => c.key));
  for (const key of orderedKeys) {
    if (!phaseKeySet.has(key)) return cards;
  }

  const clusteredKeys = clusterPhaseCardKeysWithAddons(phaseCards, orderedKeys);
  if (clusteredKeys.length !== phaseCards.length) return cards;

  const byKey = new Map(phaseCards.map((c) => [c.key, c]));
  const reordered = clusteredKeys.map((key) => byKey.get(key)!);
  let idx = 0;
  return cards.map((c) => {
    if (c.scenarioId !== scenarioId || c.phaseId !== phaseId) return c;
    return reordered[idx++]!;
  });
}

/** @deprecated Use drag reorder via reorderPhaseCardsByKeys */
export function reorderCardInPhase(
  cards: RoadmapCard[],
  cardKey: string,
  direction: ReorderCardDirection
): RoadmapCard[] {
  const card = cards.find((c) => c.key === cardKey);
  if (!card) return cards;

  const phaseKeys = cards
    .filter((c) => c.scenarioId === card.scenarioId && c.phaseId === card.phaseId)
    .map((c) => c.key);
  const idxInPhase = phaseKeys.indexOf(cardKey);
  if (idxInPhase < 0) return cards;

  const swapIdx = direction === "up" ? idxInPhase - 1 : idxInPhase + 1;
  if (swapIdx < 0 || swapIdx >= phaseKeys.length) return cards;

  const nextKeys = [...phaseKeys];
  [nextKeys[idxInPhase], nextKeys[swapIdx]] = [nextKeys[swapIdx]!, nextKeys[idxInPhase]!];
  return reorderPhaseCardsByKeys(cards, card.scenarioId, card.phaseId, nextKeys);
}
