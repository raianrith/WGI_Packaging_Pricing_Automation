import type {
  Package,
  PackageSolutionTier,
  ImplementerHourGroupRow,
  TaskRow,
  PricingHourGroupKey,
} from "../types";
import type { TierPricingMathConfig } from "./tierPricingMath";
import {
  PKG_AGGREGATE_SYNTHETIC_TIER_ID,
  applyUniformHourDiscount,
  stripRebuildablePricingOverrideKeys,
} from "./packageAggregatePricing";
import {
  deriveCombinedTasksFromLegacyLinks,
  parsePackageCombinedTasks,
  reconcileCombinedTasksForTierSelection,
  unifiedTasksToRows,
  anchorTierForPackage,
  type PackageCombinedTasksState,
} from "./packageCombinedTasks";
import {
  mergePricingWithPackageOverrides,
  emptyPricingTemplate,
  parsePricingOverrides,
} from "./packagePricingTaskOverrides";
import { buildImplementerToGroupMap, rollUpTaskTimesByPricingGroup } from "./taskHoursRollup";
import { computeTierPricing, normalizeTierPricingMathConfig } from "./tierPricingMath";

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

/** Package hour / sell discounts from DB (`packages` columns). */
function pctFromPkgField(n: unknown): number {
  if (n == null || !Number.isFinite(Number(n))) return 0;
  const x = Number(n);
  if (x < 0) return 0;
  return Math.min(100, x);
}

function hasCombinedTasksSignal(s: PackageCombinedTasksState | null): boolean {
  if (!s) return false;
  return (
    s.order.length > 0 ||
    s.extras.length > 0 ||
    Object.keys(s.task_patches).length > 0 ||
    s.hidden_vault.length > 0
  );
}

export type PackageWorkspaceFormMetrics =
  | { ok: false }
  | {
      ok: true;
      /** Sum of discounted hour buckets (matches Package Builder “Total resource hours”). */
      totalResourceHoursAfterDiscount: number;
      /** Resource hours + account mgmt add-on (matches billable-hours pipeline input). */
      billableHoursAfterDiscount: number;
      modeledSell: number;
      netSellAfterSellDiscount: number;
    };

/** Map pricing hour-group rollup into `computeTierPricing` hour shape. */
function hourRollupToBreakdown(h: Record<PricingHourGroupKey, number>) {
  return {
    client: h.client_services,
    copy: h.copy,
    design: h.design,
    web: h.web_dev,
    video: h.video,
    data: h.data,
    paidMedia: h.paid_media,
    hubspot: h.hubspot,
    other: h.other,
  };
}

/** Combined package task checklist rows (vault + extras), same ordering as Package Builder / workspace metrics. */
export function computePackageUnifiedTaskRows(args: {
  pkg: Package;
  tierIdsSorted: string[];
  packageTierLinksForPackage: PackageSolutionTier[];
  vaultTasks: TaskRow[];
}): TaskRow[] {
  const tierIdsSorted = [...args.tierIdsSorted].sort(sortTierIds);
  if (tierIdsSorted.length === 0) return [];

  const anchor = anchorTierForPackage(tierIdsSorted);
  if (!anchor) return [];

  let combined: PackageCombinedTasksState;

  const parsed = parsePackageCombinedTasks(args.pkg.package_combined_tasks);
  if (parsed !== null && hasCombinedTasksSignal(parsed)) {
    combined = reconcileCombinedTasksForTierSelection(parsed, tierIdsSorted, args.vaultTasks);
  } else {
    const linksByTier = new Map(args.packageTierLinksForPackage.map((r) => [r.solution_tier_id, r]));
    combined = deriveCombinedTasksFromLegacyLinks(tierIdsSorted, args.vaultTasks, linksByTier);
  }

  return unifiedTasksToRows(combined, args.vaultTasks, anchor);
}

export function computePackageWorkspaceFormMetrics(args: {
  pkg: Package;
  tierIdsSorted: string[];
  packageTierLinksForPackage: PackageSolutionTier[];
  vaultTasks: TaskRow[];
  implementerHourGroups: ImplementerHourGroupRow[];
  /** Raw config (e.g. from localStorage); normalized internally. */
  mathConfig?: TierPricingMathConfig | null;
}): PackageWorkspaceFormMetrics {
  const tierIdsSorted = [...args.tierIdsSorted].sort(sortTierIds);
  if (tierIdsSorted.length === 0) return { ok: false };

  const rows = computePackageUnifiedTaskRows({
    pkg: args.pkg,
    tierIdsSorted: args.tierIdsSorted,
    packageTierLinksForPackage: args.packageTierLinksForPackage,
    vaultTasks: args.vaultTasks,
  });
  const prediscount = rollUpTaskTimesByPricingGroup(
    rows,
    buildImplementerToGroupMap(args.implementerHourGroups)
  );
  const hourPct = pctFromPkgField(args.pkg.package_hour_discount_pct);
  const sellPct = pctFromPkgField(args.pkg.package_sell_discount_pct);
  const discounted = applyUniformHourDiscount(prediscount, hourPct);
  const hours = hourRollupToBreakdown(discounted);

  const math = normalizeTierPricingMathConfig(args.mathConfig ?? null);

  const baseRow = mergePricingWithPackageOverrides(
    emptyPricingTemplate(PKG_AGGREGATE_SYNTHETIC_TIER_ID),
    PKG_AGGREGATE_SYNTHETIC_TIER_ID,
    stripRebuildablePricingOverrideKeys(parsePricingOverrides(args.pkg.package_pricing_overrides ?? null))
  );

  const n = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  };

  const derived = computeTierPricing(
    {
      hours,
      scopeRisk: n(baseRow.scope_risk),
      internalCoordination: n(baseRow.internal_coordination),
      clientRevisionRisk: n(baseRow.client_revision_risk),
      strategicValueScore: n(baseRow.strategic_value_score),
    },
    math
  );

  const modeledSell = derived.sellPrice;
  const netSellAfterSellDiscount = modeledSell * (1 - sellPct / 100);

  return {
    ok: true,
    totalResourceHoursAfterDiscount: derived.totalHours,
    billableHoursAfterDiscount: derived.hoursForExpectedEffort,
    modeledSell,
    netSellAfterSellDiscount,
  };
}
