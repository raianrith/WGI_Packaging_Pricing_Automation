import type { SolutionTierPricing, TaskRow } from "../types";
import { vaultSellPriceUsd, vaultTierHours } from "./vaultTierMetrics";

/** Vault tier id → count in this package (0 = not included). */
export type PackageTierQuantities = Record<string, number>;

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

export function normalizeTierQuantity(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(999, Math.floor(n));
}

export function emptyTierQuantities(): PackageTierQuantities {
  return {};
}

export function tierIdsFromQuantities(q: PackageTierQuantities): string[] {
  return Object.keys(q)
    .filter((id) => (q[id] ?? 0) > 0)
    .sort(sortTierIds);
}

export function totalTierLineCount(q: PackageTierQuantities): number {
  let n = 0;
  for (const id of Object.keys(q)) {
    const c = q[id] ?? 0;
    if (c > 0) n += c;
  }
  return n;
}

export function tierQuantitiesFromLinks(
  links: readonly { solution_tier_id: string; quantity?: number | null }[]
): PackageTierQuantities {
  const out: PackageTierQuantities = {};
  for (const l of links) {
    out[l.solution_tier_id] = normalizeTierQuantity(l.quantity);
  }
  return out;
}

/** Flat list with repeated ids (one entry per included tier line). */
export function expandTierQuantities(q: PackageTierQuantities): string[] {
  const out: string[] = [];
  for (const id of tierIdsFromQuantities(q)) {
    const count = q[id] ?? 0;
    for (let i = 0; i < count; i++) out.push(id);
  }
  return out;
}

export type AdjustTierQuantityResult = {
  quantities: PackageTierQuantities;
  blockedByMaxTiers: boolean;
};

export function adjustTierQuantity(
  prev: PackageTierQuantities,
  tierId: string,
  delta: number,
  maxTotalLines: number | null | undefined
): AdjustTierQuantityResult {
  if (delta === 0) return { quantities: { ...prev }, blockedByMaxTiers: false };
  const cur = prev[tierId] ?? 0;
  const nextCount = Math.max(0, cur + delta);
  const next: PackageTierQuantities = { ...prev };
  if (nextCount <= 0) {
    delete next[tierId];
  } else {
    next[tierId] = nextCount;
  }
  const total = totalTierLineCount(next);
  if (
    delta > 0 &&
    maxTotalLines != null &&
    Number.isFinite(maxTotalLines) &&
    maxTotalLines > 0 &&
    total > maxTotalLines
  ) {
    return { quantities: { ...prev }, blockedByMaxTiers: true };
  }
  return { quantities: next, blockedByMaxTiers: false };
}

export function setTierQuantity(
  prev: PackageTierQuantities,
  tierId: string,
  count: number,
  maxTotalLines: number | null | undefined
): AdjustTierQuantityResult {
  const cur = prev[tierId] ?? 0;
  return adjustTierQuantity(prev, tierId, count - cur, maxTotalLines);
}

export type CatalogUsageFromQuantities = {
  hours: number;
  price: number;
  missingHours: boolean;
  missingPrice: boolean;
};

export function catalogUsageFromQuantities(
  q: PackageTierQuantities,
  pricingByTierId: Map<string, SolutionTierPricing>,
  tasks: TaskRow[]
): CatalogUsageFromQuantities {
  let hours = 0;
  let price = 0;
  let missingHours = false;
  let missingPrice = false;
  for (const id of tierIdsFromQuantities(q)) {
    const qty = q[id] ?? 0;
    if (qty <= 0) continue;
    const pr = pricingByTierId.get(id) ?? null;
    const h = vaultTierHours(pr, tasks, id);
    const usd = vaultSellPriceUsd(pr);
    if (h == null) missingHours = true;
    else hours += h * qty;
    if (usd == null) missingPrice = true;
    else price += usd * qty;
  }
  return { hours, price, missingHours, missingPrice };
}
