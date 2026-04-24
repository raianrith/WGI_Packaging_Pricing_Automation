import type { ImplementerHourGroupRow, PricingHourGroupKey, TaskRow } from "../types";
import { PRICING_HOUR_GROUP_KEYS } from "./pricingHourGroups";

function zeroRollup(): Record<PricingHourGroupKey, number> {
  return Object.fromEntries(PRICING_HOUR_GROUP_KEYS.map((k) => [k, 0])) as Record<
    PricingHourGroupKey,
    number
  >;
}

/** Case-insensitive lookup: first pass exact key, then lowercase. */
export function buildImplementerToGroupMap(
  rows: ImplementerHourGroupRow[]
): Map<string, PricingHourGroupKey> {
  const m = new Map<string, PricingHourGroupKey>();
  for (const r of rows) {
    const name = r.implementer_name.trim();
    if (!name) continue;
    m.set(name, r.hour_group);
    m.set(name.toLowerCase(), r.hour_group);
  }
  return m;
}

function resolveGroup(
  implementer: string | null | undefined,
  map: Map<string, PricingHourGroupKey>
): PricingHourGroupKey {
  const raw = (implementer ?? "").trim();
  if (!raw) return "other";
  return map.get(raw) ?? map.get(raw.toLowerCase()) ?? "other";
}

/**
 * Sum each task’s `task_time` into pricing hour buckets using the implementer → group map.
 * Unmapped or empty implementers count toward **other**.
 */
export function rollUpTaskTimesByPricingGroup(
  taskList: TaskRow[],
  implementerToGroup: Map<string, PricingHourGroupKey>
): Record<PricingHourGroupKey, number> {
  const out = zeroRollup();
  for (const t of taskList) {
    const tn = t.task_time;
    if (tn == null || !Number.isFinite(Number(tn))) continue;
    const h = Math.max(0, Number(tn));
    if (h === 0) continue;
    const g = resolveGroup(t.task_implementer, implementerToGroup);
    out[g] = (out[g] ?? 0) + h;
  }
  return out;
}
