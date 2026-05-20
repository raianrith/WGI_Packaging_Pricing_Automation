/**
 * Tier pricing math for admin (matches spreadsheet logic by default).
 * Resource hours = sum of hour buckets. Billable hours = resource + fixed add-ons (account mgmt, continuous improvement).
 * Expected effort base = billable hours × hourly rate.
 * Risk multiplier from sum of three 0–2 scores; risk mitigated = base × risk mult.
 * Strategic multiplier from strategic value score 0–2; sell = CEILING(riskMit × stratMult, step).
 */

/** Automatic account-management add-on applied to total resource hours before × hourly rate. */
export const ACCOUNT_MGMT_HOURS_ADDON_RATE = 0.15;

/** Automatic continuous-improvement add-on applied to total resource hours before × hourly rate. */
export const CONTINUOUS_IMPROVEMENT_HOURS_ADDON_RATE = 0.01;

/** Fixed hour add-ons on resource hours (account mgmt + continuous improvement). */
export function computeResourceHourAddons(resourceHours: number): {
  accountMgmtAddonHours: number;
  continuousImprovementAddonHours: number;
  billableHours: number;
} {
  const accountMgmtAddonHours = resourceHours * ACCOUNT_MGMT_HOURS_ADDON_RATE;
  const continuousImprovementAddonHours = resourceHours * CONTINUOUS_IMPROVEMENT_HOURS_ADDON_RATE;
  const billableHours = resourceHours + accountMgmtAddonHours + continuousImprovementAddonHours;
  return { accountMgmtAddonHours, continuousImprovementAddonHours, billableHours };
}

/** Combined add-on rate for billable hours (e.g. 0.16 for 15% + 1%). */
export function totalResourceHourAddonRate(): number {
  return ACCOUNT_MGMT_HOURS_ADDON_RATE + CONTINUOUS_IMPROVEMENT_HOURS_ADDON_RATE;
}

export type RiskStrategicScore = 0 | 1 | 2;

/** One row: multiplier applies when risk score sum S satisfies S <= sumMax (after prior rows). */
export type TierPricingRiskBand = { sumMax: number; multiplier: number };

export type TierPricingMathConfig = {
  hourlyRate: number;
  /** Upper bounds for risk sum S (0–6 in default). Sorted ascending when used. */
  riskBands: TierPricingRiskBand[];
  /** Multipliers for strategic scores 0, 1, 2 */
  strategicMultipliers: [number, number, number];
  /** e.g. 100 → round sell up to nearest $100 */
  sellCeilingStep: number;
};

export const DEFAULT_TIER_PRICING_MATH_CONFIG: TierPricingMathConfig = {
  hourlyRate: 210,
  riskBands: [
    { sumMax: 0, multiplier: 1 },
    { sumMax: 2, multiplier: 1.1 },
    { sumMax: 4, multiplier: 1.2 },
    { sumMax: 6, multiplier: 1.3 },
  ],
  strategicMultipliers: [1, 1.1, 1.2],
  sellCeilingStep: 100,
};

/** Legacy export — default hourly rate (use `tierPricingMathConfig.hourlyRate` when config is overridden). */
export const TIER_PRICING_HOURLY_RATE = DEFAULT_TIER_PRICING_MATH_CONFIG.hourlyRate;

const STORAGE_KEY = "wgi_admin_tier_pricing_math_config_v1";

function finitePos(n: unknown, fallback: number): number {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x) || x <= 0) return fallback;
  return x;
}

function clampBandSumMax(n: unknown): number {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x);
}

function clampMult(n: unknown, fallback: number): number {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x) || x <= 0) return fallback;
  return x;
}

/** Merge partial JSON from storage into a safe config (defaults fill gaps). */
export function normalizeTierPricingMathConfig(raw: unknown): TierPricingMathConfig {
  const d = DEFAULT_TIER_PRICING_MATH_CONFIG;
  if (!raw || typeof raw !== "object") return { ...d, riskBands: d.riskBands.map((b) => ({ ...b })) };
  const o = raw as Record<string, unknown>;

  const hourlyRate = finitePos(o.hourlyRate, d.hourlyRate);

  let riskBands: TierPricingRiskBand[] = d.riskBands.map((b) => ({ ...b }));
  if (Array.isArray(o.riskBands) && o.riskBands.length > 0) {
    const parsed: TierPricingRiskBand[] = [];
    for (const row of o.riskBands) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      parsed.push({
        sumMax: clampBandSumMax(r.sumMax),
        multiplier: clampMult(r.multiplier, 1),
      });
    }
    if (parsed.length > 0) {
      parsed.sort((a, b) => a.sumMax - b.sumMax);
      riskBands = parsed;
    }
  }

  let strategicMultipliers: [number, number, number] = [...d.strategicMultipliers] as [
    number,
    number,
    number,
  ];
  if (Array.isArray(o.strategicMultipliers) && o.strategicMultipliers.length >= 3) {
    strategicMultipliers = [
      clampMult(o.strategicMultipliers[0], d.strategicMultipliers[0]),
      clampMult(o.strategicMultipliers[1], d.strategicMultipliers[1]),
      clampMult(o.strategicMultipliers[2], d.strategicMultipliers[2]),
    ];
  }

  const sellCeilingStep = finitePos(o.sellCeilingStep, d.sellCeilingStep);

  return { hourlyRate, riskBands, strategicMultipliers, sellCeilingStep };
}

export function loadTierPricingMathConfigFromStorage(): TierPricingMathConfig {
  if (typeof localStorage === "undefined") {
    return normalizeTierPricingMathConfig(null);
  }
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (!s) return normalizeTierPricingMathConfig(null);
    return normalizeTierPricingMathConfig(JSON.parse(s));
  } catch {
    return normalizeTierPricingMathConfig(null);
  }
}

export function saveTierPricingMathConfigToStorage(c: TierPricingMathConfig): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeTierPricingMathConfig(c)));
}

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

/** `strategic_value_score` tier names (0–2). */
export const STRATEGIC_VALUE_SCORE_NAMES = ["Support", "Revenue", "Growth"] as const;

/** Short hint per score for dropdowns and reference tables. */
export const STRATEGIC_VALUE_SCORE_HINTS = [
  "BAU / sustainment",
  "Commercial priority",
  "Growth & upside",
] as const;

/** e.g. `0 — Support (BAU / sustainment)` — use in selects and compact sell tables. */
export function strategicValueScoreUiLabel(score: RiskStrategicScore): string {
  return `${score} — ${STRATEGIC_VALUE_SCORE_NAMES[score]} (${STRATEGIC_VALUE_SCORE_HINTS[score]})`;
}

/** Tooltip for the strategic value select (all three scores). */
export function strategicValueScoreSelectTitle(): string {
  return ([0, 1, 2] as const).map((s) => `${s}: ${STRATEGIC_VALUE_SCORE_HINTS[s]}`).join(" · ");
}

/** Short hint per level (0–2) for scope risk, internal coordination, and client revision risk selects. */
export type RiskScore012Hints = readonly [string, string, string];

export const SCOPE_RISK_SCORE_HINTS: RiskScore012Hints = [
  "Clear scope, predictable delivery",
  "Moderate ambiguity / dependencies",
  "Heavy unknowns or creep exposure",
];

export const INTERNAL_COORDINATION_SCORE_HINTS: RiskScore012Hints = [
  "Light handoffs, few stakeholders",
  "Typical cross-team work",
  "Heavy orchestration, many seats",
];

export const CLIENT_REVISION_RISK_SCORE_HINTS: RiskScore012Hints = [
  "Few revision cycles expected",
  "Normal feedback churn",
  "High rework or late-change risk",
];

export function riskScore012Options(hints: RiskScore012Hints): { value: string; label: string }[] {
  return ([0, 1, 2] as const).map((s) => ({
    value: String(s),
    label: `${s} (${hints[s]})`,
  }));
}

/** Tooltip summarizing all three levels for a risk-axis select. */
export function riskScore012SelectTitle(hints: RiskScore012Hints): string {
  return ([0, 1, 2] as const).map((s) => `${s}: ${hints[s]}`).join(" · ");
}

/**
 * Risk sum S = scope + internal coordination + client revision (each 0–2).
 * Uses upper-bound bands: first band where S <= sumMax wins; else last band multiplier.
 */
export function riskMultiplierFromRiskSum(
  sum: number,
  config: TierPricingMathConfig = DEFAULT_TIER_PRICING_MATH_CONFIG
): number {
  const s = Math.max(0, sum);
  const bands = [...config.riskBands].sort((a, b) => a.sumMax - b.sumMax);
  if (bands.length === 0) return 1;
  for (const b of bands) {
    if (s <= b.sumMax) return b.multiplier;
  }
  return bands[bands.length - 1].multiplier;
}

export function strategicMultiplierFromScore(
  score: RiskStrategicScore,
  config: TierPricingMathConfig = DEFAULT_TIER_PRICING_MATH_CONFIG
): number {
  const m = config.strategicMultipliers;
  if (score <= 0) return m[0];
  if (score === 1) return m[1];
  return m[2];
}

export function ceilingToStep(value: number, step: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!Number.isFinite(step) || step <= 0) return 0;
  return Math.ceil(value / step) * step;
}

/** CEILING.MATH(value, 100) — default step. */
export function ceilingToHundred(value: number): number {
  return ceilingToStep(value, DEFAULT_TIER_PRICING_MATH_CONFIG.sellCeilingStep);
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
  /** Sum of entered resource hour buckets (no account-mgmt add-on). */
  totalHours: number;
  /** Account-mgmt add-on hours (`totalHours` × `ACCOUNT_MGMT_HOURS_ADDON_RATE`). */
  accountMgmtAddonHours: number;
  /** Continuous-improvement add-on hours (`totalHours` × `CONTINUOUS_IMPROVEMENT_HOURS_ADDON_RATE`). */
  continuousImprovementAddonHours: number;
  /** Resource hours + all fixed add-ons — used for expected effort. */
  hoursForExpectedEffort: number;
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

export function computeTierPricing(
  input: {
    hours: HourBreakdown;
    scopeRisk: number | null;
    internalCoordination: number | null;
    clientRevisionRisk: number | null;
    strategicValueScore: number | null;
  },
  config: TierPricingMathConfig = DEFAULT_TIER_PRICING_MATH_CONFIG
): TierPricingDerived {
  const totalHours = sumHourBreakdown(input.hours);
  const { accountMgmtAddonHours, continuousImprovementAddonHours, billableHours: hoursForExpectedEffort } =
    computeResourceHourAddons(totalHours);
  const expectedEffortBase = hoursForExpectedEffort * config.hourlyRate;

  const scopeRisk = clampScore012(input.scopeRisk);
  const internalCoordination = clampScore012(input.internalCoordination);
  const clientRevisionRisk = clampScore012(input.clientRevisionRisk);
  const riskScoreSum = scopeRisk + internalCoordination + clientRevisionRisk;
  const riskMultiplier = riskMultiplierFromRiskSum(riskScoreSum, config);
  const riskMitigatedBase = expectedEffortBase * riskMultiplier;

  const strategicValueScore = clampScore012(input.strategicValueScore);
  const strategicMultiplier = strategicMultiplierFromScore(strategicValueScore, config);
  const sellPrice = ceilingToStep(riskMitigatedBase * strategicMultiplier, config.sellCeilingStep);

  return {
    totalHours,
    accountMgmtAddonHours,
    continuousImprovementAddonHours,
    hoursForExpectedEffort,
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

/** Deep copy for draft editors. */
export function cloneTierPricingMathConfig(c: TierPricingMathConfig): TierPricingMathConfig {
  return {
    hourlyRate: c.hourlyRate,
    riskBands: c.riskBands.map((b) => ({ ...b })),
    strategicMultipliers: [...c.strategicMultipliers] as [number, number, number],
    sellCeilingStep: c.sellCeilingStep,
  };
}

/**
 * Sorted bands with human-readable S ranges (inclusive), matching first-match row logic.
 */
export function sortedRiskBandRanges(
  config: TierPricingMathConfig
): { sRange: string; sumMax: number; multiplier: number }[] {
  const bands = [...config.riskBands].sort((a, b) => a.sumMax - b.sumMax);
  return bands.map((b, i) => {
    const lo = i === 0 ? 0 : bands[i - 1].sumMax + 1;
    const hi = b.sumMax;
    const sRange = lo >= hi ? `S = ${hi}` : `S from ${lo} to ${hi}`;
    return { sRange, sumMax: b.sumMax, multiplier: b.multiplier };
  });
}
