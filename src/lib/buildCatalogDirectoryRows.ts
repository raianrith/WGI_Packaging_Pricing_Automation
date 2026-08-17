import type { CatalogTierTableRow } from "../components/CatalogTierTable";
import { computePackageWorkspaceFormMetrics } from "./packageWorkspaceMetrics";
import {
  buildCatalogTierTableRows,
  type VaultCatalogData,
} from "./buildCatalogTierTableRows";
import { slotsForPackageType } from "./packageBuilderSlots";
import type {
  ImplementerHourGroupRow,
  Package,
  PackageBuilderPackageType,
  PackageBuilderSlotTemplate,
} from "../types";
import type { TierPricingMathConfig } from "./tierPricingMath";

export type CatalogDirectoryItemType = "solution" | "preset_package" | "configurable_package";

export type CatalogDirectoryRow = {
  id: string;
  type: CatalogDirectoryItemType;
  typeLabel: string;
  name: string;
  meta: string;
  phaseRaw: string;
  categoryRaw: string;
  tacticRaw: string;
  priceNum: number | null;
  priceDisplay: string;
  hoursNum: number | null;
  hoursDisplay: string;
  taxableSort: number;
  taxableLabel: string;
  tagsRaw: string;
  solutionId?: string;
  packageId?: string;
  packageBuilderTypeId?: string;
  tierRows: CatalogTierTableRow[];
};

function sortId(a: string, b: string): number {
  const pa = a.split("-").map(Number);
  const pb = b.split("-").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return a.localeCompare(b);
}

function compareTierName(a: CatalogTierTableRow, b: CatalogTierTableRow): number {
  return (
    (a.tierName || "").localeCompare(b.tierName || "", undefined, { sensitivity: "base" }) ||
    sortId(a.tierId, b.tierId)
  );
}

function formatKpiNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(n));
}

function sumTierRollup(tierRows: CatalogTierTableRow[]): {
  priceNum: number | null;
  priceDisplay: string;
  hoursNum: number | null;
  hoursDisplay: string;
  taxableSort: number;
  taxableLabel: string;
} {
  let priceSum = 0;
  let priceCount = 0;
  let hoursSum = 0;
  let hoursCount = 0;
  let anyTaxable = false;
  let anyNonTaxable = false;

  for (const row of tierRows) {
    if (row.priceNum != null && Number.isFinite(row.priceNum)) {
      priceSum += row.priceNum;
      priceCount += 1;
    }
    if (row.hoursNum != null && Number.isFinite(row.hoursNum)) {
      hoursSum += row.hoursNum;
      hoursCount += 1;
    }
    if (row.taxable) anyTaxable = true;
    else anyNonTaxable = true;
  }

  const priceNum = priceCount > 0 ? priceSum : null;
  const hoursNum = hoursCount > 0 ? hoursSum : null;
  const taxableLabel =
    tierRows.length === 0 ? "—" : anyTaxable && anyNonTaxable ? "Mixed" : anyTaxable ? "Taxable" : "Non-taxable";
  const taxableSort = anyTaxable && anyNonTaxable ? 1 : anyTaxable ? 2 : 0;

  return {
    priceNum,
    priceDisplay: priceNum != null ? formatUsd(priceNum) : "—",
    hoursNum,
    hoursDisplay: hoursNum != null ? formatKpiNumber(hoursNum) : "—",
    taxableSort,
    taxableLabel,
  };
}

export function isConfigurablePackage(
  pkg: Package,
  packageTypeNameSet: ReadonlySet<string>
): boolean {
  return packageTypeNameSet.has((pkg.package_category ?? "").trim().toLowerCase());
}

export function buildSolutionDirectoryRowsFromTier(
  tierRows: readonly CatalogTierTableRow[]
): CatalogDirectoryRow[] {
  const tiersBySolutionId = new Map<string, CatalogTierTableRow[]>();
  for (const row of tierRows) {
    const prev = tiersBySolutionId.get(row.solutionId) ?? [];
    prev.push(row);
    tiersBySolutionId.set(row.solutionId, prev);
  }

  return [...tiersBySolutionId.entries()]
    .sort(([a], [b]) => sortId(a, b))
    .map(([solutionId, rows]) => {
      const sorted = [...rows].sort(compareTierName);
      const rollup = sumTierRollup(sorted);
      const tierCount = sorted.length;
      const name = sorted[0]?.solutionName?.trim() || solutionId;
      return {
        id: `solution:${solutionId}`,
        type: "solution" as const,
        typeLabel: "Solution",
        name,
        meta: tierCount === 0 ? "No tiers" : tierCount === 1 ? "1 tier" : `${tierCount} tiers`,
        phaseRaw: "",
        categoryRaw: "",
        tacticRaw: "",
        tagsRaw: "",
        solutionId,
        tierRows: sorted,
        ...rollup,
      };
    });
}

export function buildCatalogDirectoryRows(
  data: VaultCatalogData,
  packageTypes: readonly PackageBuilderPackageType[],
  slots: readonly PackageBuilderSlotTemplate[],
  implementerHourGroups: ImplementerHourGroupRow[],
  mathConfig: TierPricingMathConfig
): CatalogDirectoryRow[] {
  const packageTypeNameSet = new Set(
    packageTypes.map((pt) => pt.name.trim().toLowerCase()).filter(Boolean)
  );
  const allTierRows = buildCatalogTierTableRows(data);
  const tiersBySolutionId = new Map<string, CatalogTierTableRow[]>();
  for (const row of allTierRows) {
    const prev = tiersBySolutionId.get(row.solutionId) ?? [];
    prev.push(row);
    tiersBySolutionId.set(row.solutionId, prev);
  }

  const packageTierRowsByPackageId = new Map<string, CatalogTierTableRow[]>();
  const tierRowById = new Map(allTierRows.map((r) => [r.tierId, r]));
  const tiersByPkg = new Map<string, string[]>();
  for (const link of data.packageTiers) {
    const prev = tiersByPkg.get(link.package_id) ?? [];
    prev.push(link.solution_tier_id);
    tiersByPkg.set(link.package_id, prev);
  }
  for (const pkg of data.packages) {
    const ids = [...new Set(tiersByPkg.get(pkg.package_id) ?? [])].sort(sortId);
    const tierRows = ids
      .map((id) => tierRowById.get(id))
      .filter((r): r is CatalogTierTableRow => r != null);
    packageTierRowsByPackageId.set(pkg.package_id, tierRows);
  }

  const solutionRows: CatalogDirectoryRow[] = [...data.solutions]
    .sort((a, b) => sortId(a.solution_id, b.solution_id))
    .map((solution) => {
      const tierRows = [...(tiersBySolutionId.get(solution.solution_id) ?? [])].sort(compareTierName);
      const rollup = sumTierRollup(tierRows);
      const tierCount = tierRows.length;
      return {
        id: `solution:${solution.solution_id}`,
        type: "solution" as const,
        typeLabel: "Solution",
        name: solution.solution_name?.trim() || solution.solution_id,
        meta: tierCount === 0 ? "No tiers" : tierCount === 1 ? "1 tier" : `${tierCount} tiers`,
        phaseRaw: "",
        categoryRaw: "",
        tacticRaw: "",
        tagsRaw: "",
        solutionId: solution.solution_id,
        tierRows,
        ...rollup,
      };
    });

  const packageRows: CatalogDirectoryRow[] = [...data.packages]
    .filter((pkg) => !isConfigurablePackage(pkg, packageTypeNameSet))
    .sort((a, b) => sortId(a.package_id, b.package_id))
    .map((pkg) => {
      const links = data.packageTiers.filter((r) => r.package_id === pkg.package_id);
      const tierIds = [...new Set(links.map((r) => r.solution_tier_id))].sort(sortId);
      const tierRows = packageTierRowsByPackageId.get(pkg.package_id) ?? [];
      const ws = computePackageWorkspaceFormMetrics({
        pkg,
        tierIdsSorted: tierIds,
        packageTierLinksForPackage: links,
        vaultTasks: data.tasks,
        implementerHourGroups,
        mathConfig,
      });
      const vaultRollup = sumTierRollup(tierRows);
      const priceNum =
        ws.ok && tierIds.length > 0 ? Math.round(ws.netSellAfterSellDiscount) : vaultRollup.priceNum;
      const hoursNum =
        ws.ok && tierIds.length > 0 ? ws.totalResourceHoursAfterDiscount : vaultRollup.hoursNum;
      const tierLineCount = links.reduce(
        (sum, link) => sum + (link.quantity != null && link.quantity > 0 ? link.quantity : 1),
        0
      );
      const meta =
        tierLineCount === 0 ? "No tiers" : tierLineCount === 1 ? "1 tier" : `${tierLineCount} tiers`;

      return {
        id: `package:${pkg.package_id}`,
        type: "preset_package" as const,
        typeLabel: "Custom Package",
        name: pkg.package_name?.trim() || pkg.package_id,
        meta,
        phaseRaw: "",
        categoryRaw: "",
        tacticRaw: "",
        tagsRaw: "",
        packageId: pkg.package_id,
        tierRows,
        priceNum,
        priceDisplay: priceNum != null ? formatUsd(priceNum) : "—",
        hoursNum,
        hoursDisplay: hoursNum != null ? formatKpiNumber(hoursNum) : "—",
        taxableSort: vaultRollup.taxableSort,
        taxableLabel: vaultRollup.taxableLabel,
      };
    });

  const configurableRows: CatalogDirectoryRow[] = [...packageTypes]
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
    .map((pt) => {
      const slotCount = slotsForPackageType([...slots], pt.id).length;
      return {
        id: `package-type:${pt.id}`,
        type: "configurable_package" as const,
        typeLabel: "Configurable Package",
        name: pt.name.trim() || pt.id,
        meta: slotCount === 0 ? "No package tiers" : slotCount === 1 ? "1 package tier" : `${slotCount} package tiers`,
        phaseRaw: "",
        categoryRaw: "",
        tacticRaw: "",
        tagsRaw: "",
        packageBuilderTypeId: pt.id,
        tierRows: [],
        priceNum: null,
        priceDisplay: "—",
        hoursNum: null,
        hoursDisplay: "—",
        taxableSort: 0,
        taxableLabel: "—",
      };
    });

  return [...solutionRows, ...packageRows, ...configurableRows];
}
