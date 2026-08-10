import {
  cardPriceUsdForRollup,
  type RoadmapCard,
  type CatalogCtxLike,
} from "./roadmapModel";

/** Vault solution_tier_id values with proposal dynamic pricing. */
export const VARIABLE_TIER_REF_IDS = [
  "3-62",
  "3-66",
  "3-67",
  "3-68",
  "3-69",
  "3-76",
  "3-77",
] as const;

export type VariableTierRefId = (typeof VARIABLE_TIER_REF_IDS)[number];

const VARIABLE_TIER_SET = new Set<string>(VARIABLE_TIER_REF_IDS);

export type AddVariableTierOpts = {
  travelHours?: number;
  paidAdsSpendUsd?: number;
  linkedTierRefId?: string;
};

export function isVariableTierRefId(refId: string): boolean {
  return VARIABLE_TIER_SET.has(refId);
}

export function isTravelVariableTierRefId(refId: string): boolean {
  return refId === "3-68";
}

export function isPaidAdsVariableTierRefId(refId: string): boolean {
  return refId === "3-62";
}

export function isPercentVariableTierRefId(refId: string): boolean {
  return (
    isVariableTierRefId(refId) &&
    !isTravelVariableTierRefId(refId) &&
    !isPaidAdsVariableTierRefId(refId)
  );
}

type PercentRule = {
  kind: "percent";
  pct: number;
  minUsd?: number;
  maxUsd?: number;
};

type TravelRule = {
  kind: "travel";
  rateUsd: number;
};

type PaidAdsRule = {
  kind: "paid_ads";
};

type VariableTierRule = PercentRule | TravelRule | PaidAdsRule;

const RULES: Record<VariableTierRefId, VariableTierRule> = {
  "3-62": { kind: "paid_ads" },
  "3-67": { kind: "percent", pct: 35 },
  "3-66": { kind: "percent", pct: 15 },
  "3-68": { kind: "travel", rateUsd: 150 },
  "3-69": { kind: "percent", pct: 25, minUsd: 750, maxUsd: 10_000 },
  "3-76": { kind: "percent", pct: 30, minUsd: 750, maxUsd: 10_000 },
  "3-77": { kind: "percent", pct: 60, minUsd: 750, maxUsd: 10_000 },
};

export function variableTierRule(refId: string): VariableTierRule | null {
  if (!isVariableTierRefId(refId)) return null;
  return RULES[refId as VariableTierRefId] ?? null;
}

export function computePaidAdsOptimizationUsd(spendUsd: number): number | null {
  if (!Number.isFinite(spendUsd) || spendUsd <= 0) return null;
  if (spendUsd <= 2000) return (spendUsd / 1000) * 400;
  if (spendUsd <= 10_000) return (spendUsd / 1000) * 270;
  if (spendUsd < 40_000) return (spendUsd / 1000) * 200;
  return (spendUsd / 1000) * 175;
}

export function paidAdsOptimizationFormulaLabel(spendUsd: number): string | null {
  if (!Number.isFinite(spendUsd) || spendUsd <= 0) return null;
  const perK =
    spendUsd <= 2000 ? 400 : spendUsd <= 10_000 ? 270 : spendUsd < 40_000 ? 200 : 175;
  const spendLabel = formatUsd(spendUsd);
  return `${spendLabel} ÷ $1k × $${perK}`;
}

export function variableTierRuleSummary(refId: string): string {
  const rule = variableTierRule(refId);
  if (!rule) return "Dynamic pricing";
  if (rule.kind === "travel") {
    return `Total travel hours × ${formatUsd(rule.rateUsd)}/hr`;
  }
  if (rule.kind === "paid_ads") {
    return "Total paid ads spend (tiered rate per $1k)";
  }
  const pct = `${rule.pct}% of linked tier sell`;
  if (rule.minUsd != null && rule.maxUsd != null) {
    return `${pct} (${formatUsd(rule.minUsd)} min · ${formatUsd(rule.maxUsd)} max)`;
  }
  return pct;
}

function formatUsd(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function formatVariableTierPriceUsd(n: number): string {
  return formatUsd(Math.round(n));
}

/** Solution tier lines that can anchor a percent-based variable tier. */
export function isVariableTierLinkTarget(card: Pick<RoadmapCard, "kind" | "refId" | "scope">): boolean {
  if (card.scope !== "included") return false;
  if (isVariableTierRefId(card.refId)) return false;
  return card.kind === "tier" || card.kind === "custom_tier";
}

export type VariableTierLinkTarget = {
  refId: string;
  headline: string;
  sellUsd: number | null;
  priceDisplay: string;
  phaseTitle: string;
};

export function variableTierLinkTargetsForScenario(
  cards: RoadmapCard[],
  scenarioId: string,
  ctx: CatalogCtxLike | null,
  computeScratchSellPrice: (c: RoadmapCard, ctx: CatalogCtxLike | null) => string,
  phaseTitleById: Map<string, string>
): VariableTierLinkTarget[] {
  const out: VariableTierLinkTarget[] = [];
  for (const c of cards) {
    if (c.scenarioId !== scenarioId || !isVariableTierLinkTarget(c)) continue;
    const sellUsd = cardPriceUsdForRollup(c, ctx, computeScratchSellPrice);
    out.push({
      refId: c.refId,
      headline: c.headline.trim() || "Untitled tier",
      sellUsd: sellUsd != null && Number.isFinite(sellUsd) ? sellUsd : null,
      priceDisplay:
        sellUsd != null && Number.isFinite(sellUsd) ? formatVariableTierPriceUsd(sellUsd) : "—",
      phaseTitle: phaseTitleById.get(c.phaseId) ?? "Phase",
    });
  }
  return out.sort((a, b) => a.headline.localeCompare(b.headline, undefined, { sensitivity: "base" }));
}

function linkedTierSellUsd(
  card: RoadmapCard,
  cards: RoadmapCard[],
  ctx: CatalogCtxLike | null,
  computeScratchSellPrice: (c: RoadmapCard, ctx: CatalogCtxLike | null) => string
): number | null {
  const linkedRefId = card.variableLinkedTierRefId?.trim();
  if (!linkedRefId) return null;
  const linked = cards.find(
    (c) =>
      c.scenarioId === card.scenarioId &&
      c.refId === linkedRefId &&
      c.key !== card.key &&
      isVariableTierLinkTarget(c)
  );
  if (!linked) return null;
  const p = cardPriceUsdForRollup(linked, ctx, computeScratchSellPrice);
  return p != null && Number.isFinite(p) ? p : null;
}

export function computeVariableTierSellUsd(
  refId: string,
  baseSellUsd: number,
  opts?: Pick<AddVariableTierOpts, "travelHours" | "paidAdsSpendUsd">
): number | null {
  const rule = variableTierRule(refId);
  if (!rule) return null;
  if (rule.kind === "travel") {
    const travelHours = opts?.travelHours;
    if (travelHours == null || !Number.isFinite(travelHours) || travelHours <= 0) return null;
    return travelHours * rule.rateUsd;
  }
  if (rule.kind === "paid_ads") {
    return computePaidAdsOptimizationUsd(opts?.paidAdsSpendUsd ?? NaN);
  }
  if (!Number.isFinite(baseSellUsd) || baseSellUsd <= 0) return null;
  let usd = baseSellUsd * (rule.pct / 100);
  if (rule.minUsd != null) usd = Math.max(usd, rule.minUsd);
  if (rule.maxUsd != null) usd = Math.min(usd, rule.maxUsd);
  return usd;
}

function variablePriceFields(
  c: RoadmapCard,
  cards: RoadmapCard[],
  ctx: CatalogCtxLike | null,
  computeScratchSellPrice: (c: RoadmapCard, ctx: CatalogCtxLike | null) => string
): Pick<RoadmapCard, "price" | "priceOverride" | "hoursOverride"> | null {
  if (!isVariableTierRefId(c.refId) || c.scope !== "included") return null;
  const rule = variableTierRule(c.refId);
  if (!rule) return null;

  if (rule.kind === "travel") {
    const h = c.variableTravelHours;
    if (h == null || !Number.isFinite(h) || h <= 0) {
      return { price: "—", priceOverride: null, hoursOverride: null };
    }
    const usd = h * rule.rateUsd;
    const price = formatVariableTierPriceUsd(usd);
    const hoursLabel = Number.isInteger(h) ? String(h) : String(Math.round(h * 10) / 10);
    return { price, priceOverride: price, hoursOverride: `${hoursLabel} h` };
  }

  if (rule.kind === "paid_ads") {
    const spend = c.variablePaidAdsSpendUsd;
    if (spend == null || !Number.isFinite(spend) || spend <= 0) {
      return { price: "—", priceOverride: null, hoursOverride: c.hoursOverride ?? null };
    }
    const usd = computePaidAdsOptimizationUsd(spend);
    if (usd == null) return { price: "—", priceOverride: null, hoursOverride: c.hoursOverride ?? null };
    const price = formatVariableTierPriceUsd(usd);
    return { price, priceOverride: price, hoursOverride: c.hoursOverride ?? null };
  }

  const baseUsd = linkedTierSellUsd(c, cards, ctx, computeScratchSellPrice);
  if (baseUsd == null) {
    return { price: "—", priceOverride: null, hoursOverride: c.hoursOverride ?? null };
  }
  const usd = computeVariableTierSellUsd(c.refId, baseUsd, undefined);
  if (usd == null) return { price: "—", priceOverride: null, hoursOverride: c.hoursOverride ?? null };
  const price = formatVariableTierPriceUsd(usd);
  return { price, priceOverride: price, hoursOverride: c.hoursOverride ?? null };
}

export function variableTierAppliedToLabel(card: RoadmapCard, cards: RoadmapCard[]): string | null {
  if (!isVariableTierRefId(card.refId)) return null;
  if (isTravelVariableTierRefId(card.refId)) {
    const h = card.variableTravelHours;
    if (h == null || !Number.isFinite(h) || h <= 0) return null;
    const hoursLabel = Number.isInteger(h) ? String(h) : String(Math.round(h * 10) / 10);
    return `${hoursLabel} travel hrs`;
  }
  if (isPaidAdsVariableTierRefId(card.refId)) {
    const spend = card.variablePaidAdsSpendUsd;
    if (spend == null || !Number.isFinite(spend) || spend <= 0) return null;
    return `${formatUsd(spend)} paid ads spend`;
  }
  const linkedRefId = card.variableLinkedTierRefId?.trim();
  if (!linkedRefId) return null;
  const linked = cards.find(
    (c) => c.scenarioId === card.scenarioId && c.refId === linkedRefId && isVariableTierLinkTarget(c)
  );
  const name = linked?.headline.trim();
  return name || null;
}

/** Recompute dynamic sell prices for every variable tier card (all scenarios). */
export function applyVariableTierPricingToCards(
  cards: RoadmapCard[],
  ctx: CatalogCtxLike | null,
  computeScratchSellPrice: (c: RoadmapCard, ctx: CatalogCtxLike | null) => string
): RoadmapCard[] {
  return cards.map((c) => {
    const fields = variablePriceFields(c, cards, ctx, computeScratchSellPrice);
    if (!fields) return c;
    if (
      c.price === fields.price &&
      c.priceOverride === fields.priceOverride &&
      c.hoursOverride === fields.hoursOverride
    ) {
      return c;
    }
    return { ...c, ...fields };
  });
}
