import type { SupabaseClient } from "@supabase/supabase-js";
import type { PackageBuilderSlotTemplate } from "../types";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** True when `id` is a row persisted in Supabase (uuid), not a client-only placeholder. */
export function isPersistedPackageBuilderSlotId(id: string): boolean {
  return UUID_V4.test(id.trim());
}

export function newLocalPackageBuilderSlotId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return `local-${c.randomUUID()}`;
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normRow(r: Record<string, unknown>): PackageBuilderSlotTemplate {
  return {
    id: String(r.id ?? ""),
    sort_order: Number(r.sort_order ?? 0),
    label: String(r.label ?? ""),
    hour_ceiling: Number(r.hour_ceiling ?? 0),
    price_ceiling: Number(r.price_ceiling ?? 0),
    updated_at: r.updated_at != null ? String(r.updated_at) : null,
  };
}

/** Default rows when the table is empty (client-only ids until first save). */
export function defaultPackageBuilderSlots(): PackageBuilderSlotTemplate[] {
  return [
    { id: "local-seed-1", sort_order: 1, label: "Core", hour_ceiling: 40, price_ceiling: 50_000, updated_at: null },
    { id: "local-seed-2", sort_order: 2, label: "Growth", hour_ceiling: 80, price_ceiling: 100_000, updated_at: null },
    {
      id: "local-seed-3",
      sort_order: 3,
      label: "Enterprise",
      hour_ceiling: 160,
      price_ceiling: 200_000,
      updated_at: null,
    },
  ];
}

export async function fetchPackageBuilderSlots(
  client: SupabaseClient
): Promise<{ rows: PackageBuilderSlotTemplate[]; error: string | null }> {
  const { data, error } = await client
    .from("package_builder_slot_templates")
    .select("id,sort_order,label,hour_ceiling,price_ceiling,updated_at")
    .order("sort_order", { ascending: true });
  if (error) {
    return { rows: defaultPackageBuilderSlots().map((r) => ({ ...r })), error: error.message };
  }
  const raw = (data ?? []) as Record<string, unknown>[];
  if (raw.length === 0) {
    return { rows: defaultPackageBuilderSlots().map((r) => ({ ...r })), error: null };
  }
  const rows = raw.map(normRow).filter((r) => r.id.length > 0);
  rows.sort((a, b) => a.sort_order - b.sort_order);
  return { rows, error: null };
}
