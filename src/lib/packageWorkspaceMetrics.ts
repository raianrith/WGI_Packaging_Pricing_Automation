import type {
  Package,
  PackageSolutionTier,
  ImplementerHourGroupRow,
  PricingHourGroupKey,
  SolutionTierPricing,
  TaskRow,
} from "../types";
import type { TierPricingMathConfig } from "./tierPricingMath";
import {
  PKG_AGGREGATE_SYNTHETIC_TIER_ID,
  applyUniformHourDiscount,
  stripRebuildablePricingOverrideKeys,
} from "./packageAggregatePricing";
import { vaultSellPriceUsd } from "./vaultTierMetrics";
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

/** Parse user-entered discount % (0–100); non-finite or negative → 0. */
export function parsePackageDiscountPct(raw: string): number {
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(100, n);
}

export type PackageWizardDiscountPreview = {
  hourPct: number;
  sellPct: number;
  catalogHours: number;
  catalogSell: number;
  hoursAfter: number | null;
  /** Sum of vault catalog sell for selected tiers (matches step 3 table). */
  modeledSellBeforeHourDiscount: number | null;
  /** Vault catalog sell after uniform hour discount % (scaled per tier when hours known). */
  modeledSellAfterHourDiscount: number | null;
  /** After hour discount, then sell discount %. */
  netSellAfterSellDiscount: number | null;
};

/**
 * Build-a-Package step 4: match step 3 running totals (vault hours + sell per tier).
 * Hour discount scales each tier’s sell in proportion to its hours (uniform %).
 */
export function computePackageWizardDiscountPreview(args: {
  tierIdsSorted: string[];
  pricingRows: SolutionTierPricing[];
  vaultTasks: TaskRow[];
  catalogHours: number;
  catalogSell: number;
  missingHours: boolean;
  missingPrice: boolean;
  hourPct: number;
  sellPct: number;
}): PackageWizardDiscountPreview {
  const hourPct = Math.min(100, Math.max(0, args.hourPct));
  const sellPct = Math.min(100, Math.max(0, args.sellPct));
  const catalogHours = args.catalogHours;
  const catalogSell = args.catalogSell;
  const hourFactor = 1 - hourPct / 100;

  const hoursAfter =
    args.missingHours || catalogHours <= 0
      ? null
      : Math.round(catalogHours * hourFactor * 10) / 10;

  let modeledSellBeforeHourDiscount: number | null = null;
  let modeledSellAfterHourDiscount: number | null = null;

  if (!args.missingPrice && catalogSell > 0) {
    const pricingByTierId = new Map(args.pricingRows.map((p) => [p.solution_tier_id, p]));
    let beforeSum = 0;
    let afterSum = 0;
    let pricedTierCount = 0;

    for (const id of args.tierIdsSorted) {
      const pr = pricingByTierId.get(id) ?? null;
      const sell = vaultSellPriceUsd(pr);
      if (sell == null) continue;
      pricedTierCount += 1;
      beforeSum += sell;
      afterSum += sell * hourFactor;
    }

    if (pricedTierCount > 0) {
      modeledSellBeforeHourDiscount = Math.round(beforeSum);
      modeledSellAfterHourDiscount = Math.round(afterSum);
    } else {
      modeledSellBeforeHourDiscount = Math.round(catalogSell);
      modeledSellAfterHourDiscount =
        hoursAfter != null && catalogHours > 0
          ? Math.round(catalogSell * (hoursAfter / catalogHours))
          : Math.round(catalogSell);
    }
  }

  const netSellAfterSellDiscount =
    modeledSellAfterHourDiscount != null
      ? Math.round(modeledSellAfterHourDiscount * (1 - sellPct / 100))
      : null;

  return {
    hourPct,
    sellPct,
    catalogHours,
    catalogSell,
    hoursAfter,
    modeledSellBeforeHourDiscount,
    modeledSellAfterHourDiscount,
    netSellAfterSellDiscount,
  };
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
      /** Resource hours + fixed add-ons (account mgmt + continuous improvement; matches billable-hours pipeline). */
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

/** Catalog / proposal display: workspace resource hours and net sell (rounded), matching package hub cards. */
export function computePackageWorkspaceCatalogNumbers(
  args: Parameters<typeof computePackageWorkspaceFormMetrics>[0]
): { resourceHours: number; netSellUsd: number } | null {
  const ws = computePackageWorkspaceFormMetrics(args);
  if (!ws.ok) return null;
  return {
    resourceHours: ws.totalResourceHoursAfterDiscount,
    netSellUsd: Math.round(ws.netSellAfterSellDiscount),
  };
}
