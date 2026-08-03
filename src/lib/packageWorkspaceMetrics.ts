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
import { tierQuantitiesFromLinks, type PackageTierQuantities } from "./packageTierQuantities";
import {
  mergePricingWithPackageOverrides,
  emptyPricingTemplate,
  parsePricingOverrides,
} from "./packagePricingTaskOverrides";
import { buildImplementerToGroupMap, rollUpTaskTimesByPricingGroup } from "./taskHoursRollup";
import {
  clampScore012,
  computeTierPricing,
  normalizeTierPricingMathConfig,
  type HourBreakdown,
} from "./tierPricingMath";

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
  /** After hour discount, then sell discount %. Kept for callers; prefer packageModeledSell. */
  netSellAfterSellDiscount: number | null;
  /** Package-level risk / strategic breakdown from discounted hours + slot presets. */
  scopeRisk: number;
  internalCoordination: number;
  clientRevisionRisk: number;
  strategicValueScore: number;
  expectedEffortBase: number | null;
  riskMultiplier: number | null;
  riskMitigatedBase: number | null;
  strategicMultiplier: number | null;
  /** Modeled package sell after hour discount + risk/strategic math (ceiling). */
  packageModeledSell: number | null;
  /** Discounted resource hours before add-ons (same as hoursAfter when modeled). */
  resourceHours: number | null;
  accountMgmtAddonHours: number | null;
  continuousImprovementAddonHours: number | null;
  billableHours: number | null;
  hourlyRate: number | null;
};

function hourBreakdownFromTotal(total: number): HourBreakdown {
  return {
    client: 0,
    copy: 0,
    design: 0,
    web: 0,
    video: 0,
    data: 0,
    paidMedia: 0,
    hubspot: 0,
    other: total,
  };
}

/**
 * Build-a-Package step 4: match step 3 running totals (vault hours + sell per tier).
 * Hour discount scales each tier’s sell in proportion to its hours (uniform %).
 * Also models package sell from discounted hours + preset risk/strategic scores.
 */
export function computePackageWizardDiscountPreview(args: {
  tierQuantities: PackageTierQuantities;
  pricingRows: SolutionTierPricing[];
  vaultTasks: TaskRow[];
  catalogHours: number;
  catalogSell: number;
  missingHours: boolean;
  missingPrice: boolean;
  hourPct: number;
  sellPct: number;
  scopeRisk?: number | null;
  internalCoordination?: number | null;
  clientRevisionRisk?: number | null;
  strategicValueScore?: number | null;
  mathConfig?: TierPricingMathConfig | null;
}): PackageWizardDiscountPreview {
  const hourPct = Math.min(100, Math.max(0, args.hourPct));
  const sellPct = Math.min(100, Math.max(0, args.sellPct));
  const catalogHours = args.catalogHours;
  const catalogSell = args.catalogSell;
  const hourFactor = 1 - hourPct / 100;

  const scopeRisk = clampScore012(args.scopeRisk);
  const internalCoordination = clampScore012(args.internalCoordination);
  const clientRevisionRisk = clampScore012(args.clientRevisionRisk);
  const strategicValueScore = clampScore012(args.strategicValueScore);

  const hoursAfter =
    catalogHours <= 0
      ? null
      : Math.round(catalogHours * hourFactor * 10) / 10;

  let modeledSellBeforeHourDiscount: number | null = null;
  let modeledSellAfterHourDiscount: number | null = null;

  if (!args.missingPrice && catalogSell > 0) {
    const pricingByTierId = new Map(args.pricingRows.map((p) => [p.solution_tier_id, p]));
    let beforeSum = 0;
    let afterSum = 0;
    let pricedTierCount = 0;

    for (const [id, qty] of Object.entries(args.tierQuantities)) {
      if ((qty ?? 0) <= 0) continue;
      const pr = pricingByTierId.get(id) ?? null;
      const sell = vaultSellPriceUsd(pr);
      if (sell == null) continue;
      pricedTierCount += 1;
      beforeSum += sell * qty;
      afterSum += sell * qty * hourFactor;
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

  let expectedEffortBase: number | null = null;
  let riskMultiplier: number | null = null;
  let riskMitigatedBase: number | null = null;
  let strategicMultiplier: number | null = null;
  let packageModeledSell: number | null = null;
  let resourceHours: number | null = null;
  let accountMgmtAddonHours: number | null = null;
  let continuousImprovementAddonHours: number | null = null;
  let billableHours: number | null = null;
  let hourlyRate: number | null = null;

  if (hoursAfter != null && hoursAfter > 0) {
    const math = normalizeTierPricingMathConfig(args.mathConfig ?? null);
    const derived = computeTierPricing(
      {
        hours: hourBreakdownFromTotal(hoursAfter),
        scopeRisk,
        internalCoordination,
        clientRevisionRisk,
        strategicValueScore,
      },
      math
    );
    resourceHours = Math.round(derived.totalHours * 100) / 100;
    accountMgmtAddonHours = Math.round(derived.accountMgmtAddonHours * 100) / 100;
    continuousImprovementAddonHours =
      Math.round(derived.continuousImprovementAddonHours * 100) / 100;
    billableHours = Math.round(derived.hoursForExpectedEffort * 100) / 100;
    hourlyRate = math.hourlyRate;
    expectedEffortBase = Math.round(derived.expectedEffortBase);
    riskMultiplier = derived.riskMultiplier;
    riskMitigatedBase = Math.round(derived.riskMitigatedBase);
    strategicMultiplier = derived.strategicMultiplier;
    const afterSellPct = derived.sellPrice * (1 - sellPct / 100);
    packageModeledSell = Math.round(afterSellPct);
  }

  return {
    hourPct,
    sellPct,
    catalogHours,
    catalogSell,
    hoursAfter,
    modeledSellBeforeHourDiscount,
    modeledSellAfterHourDiscount,
    netSellAfterSellDiscount,
    scopeRisk,
    internalCoordination,
    clientRevisionRisk,
    strategicValueScore,
    expectedEffortBase,
    riskMultiplier,
    riskMitigatedBase,
    strategicMultiplier,
    packageModeledSell,
    resourceHours,
    accountMgmtAddonHours,
    continuousImprovementAddonHours,
    billableHours,
    hourlyRate,
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
  const linksByTier = new Map(args.packageTierLinksForPackage.map((r) => [r.solution_tier_id, r]));
  const quantities = tierQuantitiesFromLinks(args.packageTierLinksForPackage);
  const tierIdsSorted = [...args.tierIdsSorted].sort(sortTierIds);
  if (tierIdsSorted.length === 0) return [];

  const anchor = anchorTierForPackage(tierIdsSorted);
  if (!anchor) return [];

  let combined: PackageCombinedTasksState;

  const parsed = parsePackageCombinedTasks(args.pkg.package_combined_tasks);
  if (parsed !== null && hasCombinedTasksSignal(parsed)) {
    combined = reconcileCombinedTasksForTierSelection(parsed, quantities, args.vaultTasks);
  } else {
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
