import type { SupabaseClient } from "@supabase/supabase-js";
import type { PackageBuilderSlotTemplate } from "../types";

function normSlot(r: Record<string, unknown>): PackageBuilderSlotTemplate {
  return {
    slot: Number(r.slot),
    label: String(r.label ?? ""),
    hour_ceiling: Number(r.hour_ceiling ?? 0),
    price_ceiling: Number(r.price_ceiling ?? 0),
    updated_at: r.updated_at != null ? String(r.updated_at) : null,
  };
}

export const PACKAGE_BUILDER_DEFAULT_SLOTS: PackageBuilderSlotTemplate[] = [
  { slot: 1, label: "Core", hour_ceiling: 40, price_ceiling: 50_000, updated_at: null },
  { slot: 2, label: "Growth", hour_ceiling: 80, price_ceiling: 100_000, updated_at: null },
  { slot: 3, label: "Enterprise", hour_ceiling: 160, price_ceiling: 200_000, updated_at: null },
];

export async function fetchPackageBuilderSlots(
  client: SupabaseClient
): Promise<{ rows: PackageBuilderSlotTemplate[]; error: string | null }> {
  const { data, error } = await client
    .from("package_builder_slot_templates")
    .select("slot,label,hour_ceiling,price_ceiling,updated_at")
    .order("slot", { ascending: true });
  if (error) {
    return { rows: PACKAGE_BUILDER_DEFAULT_SLOTS.map((r) => ({ ...r })), error: error.message };
  }
  const raw = (data ?? []) as Record<string, unknown>[];
  if (raw.length === 0) {
    return { rows: PACKAGE_BUILDER_DEFAULT_SLOTS.map((r) => ({ ...r })), error: null };
  }
  const rows = raw.map(normSlot).filter((r) => r.slot >= 1 && r.slot <= 3);
  rows.sort((a, b) => a.slot - b.slot);
  if (rows.length < 3) {
    const bySlot = new Map(rows.map((r) => [r.slot, r]));
    const merged: PackageBuilderSlotTemplate[] = [];
    for (let s = 1; s <= 3; s++) {
      merged.push(bySlot.get(s) ?? PACKAGE_BUILDER_DEFAULT_SLOTS.find((d) => d.slot === s)!);
    }
    return { rows: merged, error: null };
  }
  return { rows, error: null };
}
