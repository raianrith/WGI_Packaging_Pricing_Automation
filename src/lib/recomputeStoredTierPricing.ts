import type { SolutionTierPricing } from "../types";
import { percentChangeFromSellAndOld } from "./pricingPercentChange";
import {
  computeTierPricing,
  type HourBreakdown,
  type TierPricingMathConfig,
} from "./tierPricingMath";

function n(h: number | null | undefined): number {
  if (h == null || !Number.isFinite(h)) return 0;
  return h;
}

export function hourBreakdownFromPricingRow(row: SolutionTierPricing): HourBreakdown {
  return {
    client: n(row.hours_client_services),
    copy: n(row.hours_copy),
    design: n(row.hours_design),
    web: n(row.hours_web_dev),
    video: n(row.hours_video),
    data: n(row.hours_data),
    paidMedia: n(row.hours_paid_media),
    hubspot: n(row.hours_hubspot),
    other: n(row.hours_other),
  };
}

/** Supabase `solution_tier_pricing` update body (snake_case) from row inputs + workspace math. */
export function buildSolutionTierPricingMathUpdate(
  row: SolutionTierPricing,
  config: TierPricingMathConfig
): {
  solution_tier_id: string;
  total_hours: number;
  expected_effort_base_price: number;
  scope_risk: number;
  internal_coordination: number;
  client_revision_risk: number;
  risk_multiplier: number;
  risk_mitigated_base_price: number;
  strategic_value_score: number;
  strategic_value_multiplier: number;
  sell_price: number;
  percent_change: string | null;
} {
  const hours = hourBreakdownFromPricingRow(row);
  const d = computeTierPricing(
    {
      hours,
      scopeRisk: row.scope_risk,
      internalCoordination: row.internal_coordination,
      clientRevisionRisk: row.client_revision_risk,
      strategicValueScore: row.strategic_value_score,
    },
    config
  );
  const oldStr =
    row.old_price != null && Number.isFinite(row.old_price) && row.old_price > 0
      ? String(row.old_price)
      : "";
  const pc = percentChangeFromSellAndOld(d.sellPrice, oldStr);
  return {
    solution_tier_id: row.solution_tier_id,
    total_hours: d.totalHours,
    expected_effort_base_price: d.expectedEffortBase,
    scope_risk: d.scopeRisk,
    internal_coordination: d.internalCoordination,
    client_revision_risk: d.clientRevisionRisk,
    risk_multiplier: d.riskMultiplier,
    risk_mitigated_base_price: d.riskMitigatedBase,
    strategic_value_score: d.strategicValueScore,
    strategic_value_multiplier: d.strategicMultiplier,
    sell_price: d.sellPrice,
    percent_change: pc.forDb,
  };
}

function closeNumber(a: number | null | undefined, b: number, eps: number): boolean {
  const x = a == null || !Number.isFinite(a) ? NaN : a;
  if (!Number.isFinite(x)) return false;
  return Math.abs(x - b) <= eps;
}

function closeScore(a: number | null | undefined, b: number): boolean {
  const x = a == null || !Number.isFinite(a) ? 0 : a;
  return Math.round(x) === Math.round(b);
}

const EPS_MONEY = 0.5;
const EPS_HOURS = 1e-4;
const EPS_MULT = 1e-6;

/** True if persisted math columns differ from a fresh `computeTierPricing` result. */
export function storedTierPricingMathDiffersFromCompute(
  row: SolutionTierPricing,
  config: TierPricingMathConfig
): boolean {
  const next = buildSolutionTierPricingMathUpdate(row, config);
  if (!closeNumber(row.total_hours, next.total_hours, EPS_HOURS)) return true;
  if (!closeNumber(row.expected_effort_base_price, next.expected_effort_base_price, EPS_MONEY)) return true;
  if (!closeScore(row.scope_risk, next.scope_risk)) return true;
  if (!closeScore(row.internal_coordination, next.internal_coordination)) return true;
  if (!closeScore(row.client_revision_risk, next.client_revision_risk)) return true;
  if (!closeNumber(row.risk_multiplier, next.risk_multiplier, EPS_MULT)) return true;
  if (!closeNumber(row.risk_mitigated_base_price, next.risk_mitigated_base_price, EPS_MONEY)) return true;
  if (!closeScore(row.strategic_value_score, next.strategic_value_score)) return true;
  if (!closeNumber(row.strategic_value_multiplier, next.strategic_value_multiplier, EPS_MULT)) return true;
  if (!closeNumber(row.sell_price, next.sell_price, EPS_MONEY)) return true;
  const prevPct = row.percent_change == null ? null : String(row.percent_change).trim();
  const nextPct = next.percent_change == null ? null : String(next.percent_change).trim();
  if (prevPct !== nextPct) return true;
  return false;
}
