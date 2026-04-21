/**
 * Tier pricing math for admin (matches spreadsheet logic).
 * Expected effort base = sum(hours) × hourly rate.
 * Risk multiplier from sum of three 0–2 scores; risk mitigated = base × risk mult.
 * Strategic multiplier from strategic value score 0–2; sell = CEILING(riskMit × stratMult, 100).
 */

export const TIER_PRICING_HOURLY_RATE = 210;

export type RiskStrategicScore = 0 | 1 | 2;

/** Clamp stored DB values to valid score inputs. */
export function clampScore012(n: number | null | undefined): RiskStrategicScore {
  if (n == null || !Number.isFinite(n)) return 0;
  const r = Math.round(n);
  if (r <= 0) return 0;
  if (r >= 2) return 2;
  return r as RiskStrategicScore;
}

export function scoreToString(s: RiskStrategicScore): string {
  return String(s);
}

/**
 * =IFS(SUM<=0,1, SUM<=2,1.1, SUM<=4,1.2, SUM<=6,1.3) for scope + internal coordination + client revision.
 */
export function riskMultiplierFromRiskSum(sum: number): number {
  const s = Math.max(0, sum);
  if (s <= 0) return 1;
  if (s <= 2) return 1.1;
  if (s <= 4) return 1.2;
  if (s <= 6) return 1.3;
  return 1.3;
}

/** =IFS(U=0,1, U=1,1.1, U=2,1.2) */
export function strategicMultiplierFromScore(score: RiskStrategicScore): number {
  if (score <= 0) return 1;
  if (score === 1) return 1.1;
  return 1.2;
}

/** CEILING.MATH(value, 100). */
export function ceilingToHundred(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil(value / 100) * 100;
}

export type HourBreakdown = {
  client: number;
  copy: number;
  design: number;
  web: number;
  video: number;
  data: number;
  paidMedia: number;
  hubspot: number;
  other: number;
};

export function sumHourBreakdown(h: HourBreakdown): number {
  return (
    h.client +
    h.copy +
    h.design +
    h.web +
    h.video +
    h.data +
    h.paidMedia +
    h.hubspot +
    h.other
  );
}

export type TierPricingDerived = {
  totalHours: number;
  expectedEffortBase: number;
  scopeRisk: RiskStrategicScore;
  internalCoordination: RiskStrategicScore;
  clientRevisionRisk: RiskStrategicScore;
  riskScoreSum: number;
  riskMultiplier: number;
  riskMitigatedBase: number;
  strategicValueScore: RiskStrategicScore;
  strategicMultiplier: number;
  sellPrice: number;
};

export function computeTierPricing(input: {
  hours: HourBreakdown;
  scopeRisk: number | null;
  internalCoordination: number | null;
  clientRevisionRisk: number | null;
  strategicValueScore: number | null;
}): TierPricingDerived {
  const totalHours = sumHourBreakdown(input.hours);
  const expectedEffortBase = totalHours * TIER_PRICING_HOURLY_RATE;

  const scopeRisk = clampScore012(input.scopeRisk);
  const internalCoordination = clampScore012(input.internalCoordination);
  const clientRevisionRisk = clampScore012(input.clientRevisionRisk);
  const riskScoreSum = scopeRisk + internalCoordination + clientRevisionRisk;
  const riskMultiplier = riskMultiplierFromRiskSum(riskScoreSum);
  const riskMitigatedBase = expectedEffortBase * riskMultiplier;

  const strategicValueScore = clampScore012(input.strategicValueScore);
  const strategicMultiplier = strategicMultiplierFromScore(strategicValueScore);
  const sellPrice = ceilingToHundred(riskMitigatedBase * strategicMultiplier);

  return {
    totalHours,
    expectedEffortBase,
    scopeRisk,
    internalCoordination,
    clientRevisionRisk,
    riskScoreSum,
    riskMultiplier,
    riskMitigatedBase,
    strategicValueScore,
    strategicMultiplier,
    sellPrice,
  };
}
