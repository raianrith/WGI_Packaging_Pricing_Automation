import type { CatalogTierTableRow } from "../components/CatalogTierTable";
import type {
  Package,
  PackageSolutionTier,
  Solution,
  SolutionTier,
  SolutionTierPricing,
  TaskRow,
} from "../types";
import { displayTierCategoryLabel } from "./tierCategories";

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

function sellPriceNumber(pricing: SolutionTierPricing | null): number | null {
  if (!pricing) return null;
  const primary = pricing.sell_price;
  const fallback = pricing.standalone_sell_price;
  if (primary != null && Number.isFinite(Number(primary))) return Number(primary);
  if (fallback != null && Number.isFinite(Number(fallback))) return Number(fallback);
  return null;
}

function sellPriceDisplay(pricing: SolutionTierPricing | null): string {
  const n = sellPriceNumber(pricing);
  if (n != null) return formatUsd(n);
  return "—";
}

export type VaultCatalogData = {
  packages: Package[];
  solutions: Solution[];
  tiers: SolutionTier[];
  packageTiers: PackageSolutionTier[];
  tasks: TaskRow[];
  pricing: SolutionTierPricing[];
};

/** One row per vault tier (vault pricing only). */
export function buildCatalogTierTableRows(data: VaultCatalogData): CatalogTierTableRow[] {
  const taskTimeSumByTierId = new Map<string, number>();
  for (const k of data.tasks) {
    if (k.task_time == null || !Number.isFinite(Number(k.task_time))) continue;
    const tid = k.solution_tier_id;
    taskTimeSumByTierId.set(tid, (taskTimeSumByTierId.get(tid) ?? 0) + Number(k.task_time));
  }

  return [...data.tiers]
    .sort((a, b) => sortId(a.solution_tier_id, b.solution_tier_id))
    .map((tier) => {
      const pr = data.pricing.find((p) => p.solution_tier_id === tier.solution_tier_id) ?? null;
      const link = data.packageTiers.find((r) => r.solution_tier_id === tier.solution_tier_id);
      const pname = link
        ? data.packages.find((p) => p.package_id === link.package_id)?.package_name?.trim() ||
          link.package_id ||
          "Standalone"
        : "Standalone";
      const solution = data.solutions.find((s) => s.solution_id === tier.solution_id);
      const solutionName = solution?.solution_name ?? tier.solution_id;
      const tierName = tier.solution_tier_name;
      const phaseRaw = tier.solution_tier_phase?.trim() ?? "";
      const categoryRaw = displayTierCategoryLabel(tier.solution_tier_category ?? "");
      const tacticRaw = tier.solution_tier_tactic?.trim() ?? "";
      const priceNum = sellPriceNumber(pr);
      const priceDisplay = sellPriceDisplay(pr);
      const vaultHours =
        pr?.total_hours != null && Number.isFinite(Number(pr.total_hours))
          ? Number(pr.total_hours)
          : null;
      const sumTasks = taskTimeSumByTierId.get(tier.solution_tier_id) ?? null;
      const hoursNum = vaultHours ?? (sumTasks != null && sumTasks > 0 ? sumTasks : null);
      const hoursDisplay =
        hoursNum != null && Number.isFinite(hoursNum) ? formatKpiNumber(hoursNum) : "—";
      const taxable = pr?.taxable ?? false;
      const tagsRaw = pr?.tags?.trim() ?? "";
      return {
        tierId: tier.solution_tier_id,
        solutionId: tier.solution_id,
        pname,
        tierName,
        solutionName,
        phaseRaw,
        categoryRaw,
        tacticRaw,
        priceNum,
        priceDisplay,
        hoursNum,
        hoursDisplay,
        taxable,
        taxableSort: taxable ? 1 : 0,
        taxableLabel: taxable ? "Taxable" : "Non-taxable",
        tagsRaw,
      };
    });
}
