import type {
  PackageBuilderSlotBucket,
  PackageBuilderSlotPreselectedTier,
  PackageBuilderSlotTemplate,
} from "../types";
import {
  emptyTierQuantities,
  totalTierLineCount,
  type PackageTierQuantities,
} from "./packageTierQuantities";

export function newLocalBucketId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return `local-bucket-${c.randomUUID()}`;
  return `local-bucket-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function emptySlotSelectionRules(): Pick<
  PackageBuilderSlotTemplate,
  "preselected_tiers" | "buckets"
> {
  return { preselected_tiers: [], buckets: [] };
}

export function normalizePreselectedTiers(
  rows: readonly PackageBuilderSlotPreselectedTier[] | null | undefined
): PackageBuilderSlotPreselectedTier[] {
  if (!rows?.length) return [];
  const seen = new Set<string>();
  const out: PackageBuilderSlotPreselectedTier[] = [];
  for (const r of rows) {
    const id = String(r.solution_tier_id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const q = Math.max(1, Math.floor(Number(r.default_qty) || 1));
    out.push({ solution_tier_id: id, default_qty: q });
  }
  return out.sort((a, b) => a.solution_tier_id.localeCompare(b.solution_tier_id));
}

export function normalizeSlotBuckets(
  rows: readonly PackageBuilderSlotBucket[] | null | undefined
): PackageBuilderSlotBucket[] {
  if (!rows?.length) return [];
  return [...rows]
    .map((b, i) => {
      const memberSeen = new Set<string>();
      const member_tier_ids: string[] = [];
      for (const tid of b.member_tier_ids ?? []) {
        const id = String(tid ?? "").trim();
        if (!id || memberSeen.has(id)) continue;
        memberSeen.add(id);
        member_tier_ids.push(id);
      }
      return {
        id: String(b.id ?? "").trim() || newLocalBucketId(),
        name: String(b.name ?? "").trim() || `Bucket ${i + 1}`,
        pick_count: Math.max(1, Math.floor(Number(b.pick_count) || 1)),
        sort_order: Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : i + 1,
        member_tier_ids,
      };
    })
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}

/** Seed qty map from locked preselects (does not clear other keys). */
export function seedQtyFromPreselected(
  slot: PackageBuilderSlotTemplate,
  prev?: PackageTierQuantities
): PackageTierQuantities {
  const next = prev ? { ...prev } : emptyTierQuantities();
  for (const p of slot.preselected_tiers) {
    const cur = next[p.solution_tier_id] ?? 0;
    next[p.solution_tier_id] = Math.max(cur, p.default_qty);
  }
  return next;
}

export function lockedMinQtyForTier(
  slot: PackageBuilderSlotTemplate,
  solutionTierId: string
): number {
  const row = slot.preselected_tiers.find((p) => p.solution_tier_id === solutionTierId);
  return row ? row.default_qty : 0;
}

export function isLockedPreselectedTier(
  slot: PackageBuilderSlotTemplate,
  solutionTierId: string
): boolean {
  return lockedMinQtyForTier(slot, solutionTierId) > 0;
}

/** Tier ids claimed by preselects or any bucket (exclude from “Additional” free catalog). */
export function reservedSolutionTierIds(slot: PackageBuilderSlotTemplate): Set<string> {
  const ids = new Set<string>();
  for (const p of slot.preselected_tiers) ids.add(p.solution_tier_id);
  for (const b of slot.buckets) {
    for (const tid of b.member_tier_ids) ids.add(tid);
  }
  return ids;
}

export function bucketSelectedCount(
  bucket: PackageBuilderSlotBucket,
  qty: PackageTierQuantities
): number {
  let n = 0;
  for (const tid of bucket.member_tier_ids) {
    if ((qty[tid] ?? 0) >= 1) n += 1;
  }
  return n;
}

export function isBucketComplete(
  bucket: PackageBuilderSlotBucket,
  qty: PackageTierQuantities
): boolean {
  return bucketSelectedCount(bucket, qty) === bucket.pick_count;
}

export function allBucketsComplete(
  slot: PackageBuilderSlotTemplate,
  qty: PackageTierQuantities
): boolean {
  return slot.buckets.every((b) => isBucketComplete(b, qty));
}

export function preselectsSatisfied(
  slot: PackageBuilderSlotTemplate,
  qty: PackageTierQuantities
): boolean {
  return slot.preselected_tiers.every((p) => (qty[p.solution_tier_id] ?? 0) >= p.default_qty);
}

export function selectionRulesValid(
  slot: PackageBuilderSlotTemplate,
  qty: PackageTierQuantities
): boolean {
  return preselectsSatisfied(slot, qty) && allBucketsComplete(slot, qty);
}

export function selectionRulesSummary(slot: PackageBuilderSlotTemplate): string {
  const parts: string[] = [];
  if (slot.preselected_tiers.length > 0) {
    parts.push(`${slot.preselected_tiers.length} always included`);
  }
  if (slot.buckets.length > 0) {
    parts.push(`${slot.buckets.length} choice bucket${slot.buckets.length === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}

export function cloneBucketsForDuplicate(
  buckets: readonly PackageBuilderSlotBucket[]
): PackageBuilderSlotBucket[] {
  return buckets.map((b, i) => ({
    ...b,
    id: newLocalBucketId(),
    sort_order: i + 1,
    member_tier_ids: [...b.member_tier_ids],
  }));
}

export function selectionLineCount(qty: PackageTierQuantities): number {
  return totalTierLineCount(qty);
}
