import type {
  PackagePricingOverrides,
  PackageSolutionTier,
  PricingHourGroupKey,
  SolutionTierPricing,
} from "../types";
import {
  computeSparsePricingOverrides,
  emptyPricingTemplate,
  mergePricingWithPackageOverrides,
  parsePricingOverrides,
  pricingFormStringsToPartial,
  PACKAGE_PRICING_OVERRIDE_KEYS,
  type PackagePricingOverrideKey,
} from "./packagePricingTaskOverrides";
import { PRICING_HOUR_GROUP_KEYS } from "./pricingHourGroups";

/** Synthetic id used only in admin UI + sparse override math for package aggregate pricing. */
export const PKG_AGGREGATE_SYNTHETIC_TIER_ID = "__package_aggregate__";

const HOUR_COL: Record<PricingHourGroupKey, keyof SolutionTierPricing> = {
  client_services: "hours_client_services",
  copy: "hours_copy",
  design: "hours_design",
  web_dev: "hours_web_dev",
  video: "hours_video",
  data: "hours_data",
  paid_media: "hours_paid_media",
  hubspot: "hours_hubspot",
  other: "hours_other",
};

function sortTierIds(a: string, b: string): number {
  const pa = a.split("-").map(Number);
  const pb = b.split("-").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return a.localeCompare(b);
}

export function mergedPricingForPackageTier(
  tierId: string,
  pricingRows: SolutionTierPricing[],
  link: PackageSolutionTier | undefined
): SolutionTierPricing {
  const base = pricingRows.find((p) => p.solution_tier_id === tierId) ?? null;
  return mergePricingWithPackageOverrides(base, tierId, parsePricingOverrides(link?.pricing_overrides));
}

export function sumHourBucketsAcrossTiers(args: {
  tierIds: string[];
  pricingRows: SolutionTierPricing[];
  linksByTierId: Map<string, PackageSolutionTier>;
}): SolutionTierPricing {
  const tmpl = emptyPricingTemplate(PKG_AGGREGATE_SYNTHETIC_TIER_ID);
  for (const k of PRICING_HOUR_GROUP_KEYS) {
    (tmpl[HOUR_COL[k]] as number | null) = 0;
  }
  for (const tid of [...args.tierIds].sort(sortTierIds)) {
    const merged = mergedPricingForPackageTier(tid, args.pricingRows, args.linksByTierId.get(tid));
    for (const g of PRICING_HOUR_GROUP_KEYS) {
      const col = HOUR_COL[g];
      const v = merged[col];
      if (typeof v === "number" && Number.isFinite(v)) {
        const cur = tmpl[col];
        const base = typeof cur === "number" && Number.isFinite(cur) ? cur : 0;
        (tmpl[col] as number | null) = base + v;
      }
    }
  }
  return tmpl;
}

export function pricingRowToHourRollup(row: SolutionTierPricing): Record<PricingHourGroupKey, number> {
  const out = {} as Record<PricingHourGroupKey, number>;
  for (const g of PRICING_HOUR_GROUP_KEYS) {
    const v = row[HOUR_COL[g]];
    out[g] = typeof v === "number" && Number.isFinite(v) ? v : 0;
  }
  return out;
}

export function applyUniformHourDiscount(
  rollup: Record<PricingHourGroupKey, number>,
  pct: number
): Record<PricingHourGroupKey, number> {
  const f = Math.max(0, 1 - pct / 100);
  const out = {} as Record<PricingHourGroupKey, number>;
  for (const g of PRICING_HOUR_GROUP_KEYS) out[g] = rollup[g] * f;
  return out;
}

export function hourRollupToPricingPartial(
  rollup: Record<PricingHourGroupKey, number>
): Partial<SolutionTierPricing> {
  const o: Partial<SolutionTierPricing> = {};
  for (const g of PRICING_HOUR_GROUP_KEYS) {
    (o[HOUR_COL[g]] as number | null) = rollup[g];
  }
  return o;
}

export function buildAggregatePrediscountBaseline(args: {
  tierIds: string[];
  pricingRows: SolutionTierPricing[];
  linksByTierId: Map<string, PackageSolutionTier>;
}): SolutionTierPricing {
  return sumHourBucketsAcrossTiers(args);
}

/** Remove fields that are recomputed from merged hours + hour-discount + pricing math. Keep scores, multipliers, labels, sell_price, etc. */
export function stripRebuildablePricingOverrideKeys(
  o: PackagePricingOverrides | null | undefined
): PackagePricingOverrides {
  if (!o || Object.keys(o).length === 0) return {};
  const stripKeys = new Set<string>([
    "hours_client_services",
    "hours_copy",
    "hours_design",
    "hours_web_dev",
    "hours_video",
    "hours_data",
    "hours_paid_media",
    "hours_hubspot",
    "hours_other",
    "total_hours",
    "expected_effort_base_price",
    "risk_multiplier",
    "risk_mitigated_base_price",
    "percent_change",
  ]);
  const out: PackagePricingOverrides = { ...o };
  for (const k of PACKAGE_PRICING_OVERRIDE_KEYS) {
    if (stripKeys.has(k)) delete (out as Record<string, unknown>)[k];
  }
  return out;
}

export function buildPackageAggregatePricingSeed(args: {
  tierIds: string[];
  pricingRows: SolutionTierPricing[];
  linksByTierId: Map<string, PackageSolutionTier>;
  hourDiscountPct: number;
  packagePricingOverrides: PackagePricingOverrides | null | undefined;
}): SolutionTierPricing {
  const baseline = buildAggregatePrediscountBaseline({
    tierIds: args.tierIds,
    pricingRows: args.pricingRows,
    linksByTierId: args.linksByTierId,
  });
  const discounted = applyUniformHourDiscount(
    pricingRowToHourRollup(baseline),
    args.hourDiscountPct
  );
  const withHours: SolutionTierPricing = {
    ...baseline,
    ...hourRollupToPricingPartial(discounted),
    solution_tier_id: PKG_AGGREGATE_SYNTHETIC_TIER_ID,
  };
  return mergePricingWithPackageOverrides(
    withHours,
    PKG_AGGREGATE_SYNTHETIC_TIER_ID,
    args.packagePricingOverrides ?? {}
  );
}

export function computePackageAggregatePricingOverrides(args: {
  tierIds: string[];
  pricingRows: SolutionTierPricing[];
  linksByTierId: Map<string, PackageSolutionTier>;
  hourDiscountPct: number;
  form: Record<PackagePricingOverrideKey, string>;
}): PackagePricingOverrides {
  const baseline = buildAggregatePrediscountBaseline({
    tierIds: args.tierIds,
    pricingRows: args.pricingRows,
    linksByTierId: args.linksByTierId,
  });
  return computeSparsePricingOverrides(
    baseline,
    PKG_AGGREGATE_SYNTHETIC_TIER_ID,
    pricingFormStringsToPartial(args.form)
  );
}

/**
 * Package pricing form seed for non-hour fields only. Hour buckets are driven by tasks + hour discount
 * in the parent; merge stored overrides (minus rebuildable keys) on top of an empty template.
 */
export function buildPackageAggregateMetadataSeed(
  packagePricingOverrides: PackagePricingOverrides | null | undefined
): SolutionTierPricing {
  const base = emptyPricingTemplate(PKG_AGGREGATE_SYNTHETIC_TIER_ID);
  return mergePricingWithPackageOverrides(
    base,
    PKG_AGGREGATE_SYNTHETIC_TIER_ID,
    stripRebuildablePricingOverrideKeys(packagePricingOverrides ?? {})
  );
}
