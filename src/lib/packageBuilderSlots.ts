import type { SupabaseClient } from "@supabase/supabase-js";
import type { PackageBuilderPackageType, PackageBuilderSlotTemplate } from "../types";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPersistedPackageBuilderId(id: string): boolean {
  return UUID_V4.test(id.trim());
}

export const isPersistedPackageBuilderSlotId = isPersistedPackageBuilderId;
export const isPersistedPackageBuilderTypeId = isPersistedPackageBuilderId;

export function newLocalPackageBuilderSlotId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return `local-${c.randomUUID()}`;
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function newLocalPackageBuilderTypeId(): string {
  return newLocalPackageBuilderSlotId();
}

function parseOptionalNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normType(r: Record<string, unknown>): PackageBuilderPackageType {
  return {
    id: String(r.id ?? ""),
    sort_order: Number(r.sort_order ?? 0),
    name: String(r.name ?? ""),
    updated_at: r.updated_at != null ? String(r.updated_at) : null,
  };
}

function normSlot(
  r: Record<string, unknown>,
  allowedIds: string[]
): PackageBuilderSlotTemplate {
  return {
    id: String(r.id ?? ""),
    package_type_id: String(r.package_type_id ?? ""),
    sort_order: Number(r.sort_order ?? 0),
    label: String(r.label ?? ""),
    hour_ceiling: parseOptionalNumber(r.hour_ceiling),
    price_ceiling: parseOptionalNumber(r.price_ceiling),
    solution_tier_limit: parseOptionalNumber(r.solution_tier_limit),
    allowed_solution_tier_ids: allowedIds,
    updated_at: r.updated_at != null ? String(r.updated_at) : null,
  };
}

export function defaultPackageBuilderTypes(): PackageBuilderPackageType[] {
  return [
    { id: "local-type-seed-1", sort_order: 1, name: "General", updated_at: null },
  ];
}

/** Default slots when the table is empty (client-only ids until first save). */
export function defaultPackageBuilderSlots(typeId: string): PackageBuilderSlotTemplate[] {
  return [
    {
      id: "local-seed-1",
      package_type_id: typeId,
      sort_order: 1,
      label: "Core",
      hour_ceiling: 40,
      price_ceiling: 50_000,
      solution_tier_limit: null,
      allowed_solution_tier_ids: [],
      updated_at: null,
    },
    {
      id: "local-seed-2",
      package_type_id: typeId,
      sort_order: 2,
      label: "Growth",
      hour_ceiling: 80,
      price_ceiling: 100_000,
      solution_tier_limit: null,
      allowed_solution_tier_ids: [],
      updated_at: null,
    },
    {
      id: "local-seed-3",
      package_type_id: typeId,
      sort_order: 3,
      label: "Enterprise",
      hour_ceiling: 160,
      price_ceiling: 200_000,
      solution_tier_limit: null,
      allowed_solution_tier_ids: [],
      updated_at: null,
    },
  ];
}

export type PackageBuilderCatalog = {
  types: PackageBuilderPackageType[];
  slots: PackageBuilderSlotTemplate[];
};

export async function fetchPackageBuilderCatalog(
  client: SupabaseClient
): Promise<{ catalog: PackageBuilderCatalog; error: string | null }> {
  const [typesRes, slotsRes, allowedRes] = await Promise.all([
    client
      .from("package_builder_package_types")
      .select("id,sort_order,name,updated_at")
      .order("sort_order", { ascending: true }),
    client
      .from("package_builder_slot_templates")
      .select(
        "id,package_type_id,sort_order,label,hour_ceiling,price_ceiling,solution_tier_limit,updated_at"
      )
      .order("package_type_id", { ascending: true })
      .order("sort_order", { ascending: true }),
    client.from("package_builder_slot_allowed_tiers").select("slot_id,solution_tier_id"),
  ]);

  if (typesRes.error) {
    const types = defaultPackageBuilderTypes();
    const typeId = types[0]?.id ?? "local-type-seed-1";
    return {
      catalog: { types, slots: defaultPackageBuilderSlots(typeId) },
      error: typesRes.error.message,
    };
  }

  const allowedBySlot = new Map<string, string[]>();
  if (!allowedRes.error && allowedRes.data) {
    for (const row of allowedRes.data as { slot_id: string; solution_tier_id: string }[]) {
      const sid = String(row.slot_id);
      const tid = String(row.solution_tier_id);
      const list = allowedBySlot.get(sid) ?? [];
      list.push(tid);
      allowedBySlot.set(sid, list);
    }
  }

  let types = (typesRes.data ?? []).map((r) => normType(r as Record<string, unknown>));
  types = types.filter((t) => t.id.length > 0);
  types.sort((a, b) => a.sort_order - b.sort_order);

  if (types.length === 0) {
    types = defaultPackageBuilderTypes();
  }

  const defaultTypeId = types[0]!.id;

  if (slotsRes.error) {
    return {
      catalog: { types, slots: defaultPackageBuilderSlots(defaultTypeId) },
      error: slotsRes.error.message,
    };
  }

  let slots = (slotsRes.data ?? []).map((r) => {
    const rec = r as Record<string, unknown>;
    const id = String(rec.id ?? "");
    return normSlot(rec, allowedBySlot.get(id) ?? []);
  });
  slots = slots.filter((s) => s.id.length > 0);
  slots.sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));

  if (slots.length === 0) {
    slots = defaultPackageBuilderSlots(defaultTypeId);
  }

  return { catalog: { types, slots }, error: null };
}

/** @deprecated Use fetchPackageBuilderCatalog */
export async function fetchPackageBuilderSlots(
  client: SupabaseClient
): Promise<{ rows: PackageBuilderSlotTemplate[]; error: string | null }> {
  const { catalog, error } = await fetchPackageBuilderCatalog(client);
  return { rows: catalog.slots, error };
}

export function slotsForPackageType(
  slots: PackageBuilderSlotTemplate[],
  packageTypeId: string
): PackageBuilderSlotTemplate[] {
  return slots
    .filter((s) => s.package_type_id === packageTypeId)
    .sort((a, b) => a.sort_order - b.sort_order);
}

export function slotEnforcesHourCeiling(slot: PackageBuilderSlotTemplate): boolean {
  return slot.hour_ceiling != null && Number.isFinite(slot.hour_ceiling);
}

export function slotEnforcesPriceCeiling(slot: PackageBuilderSlotTemplate): boolean {
  return slot.price_ceiling != null && Number.isFinite(slot.price_ceiling);
}

export function slotEnforcesTierCountLimit(slot: PackageBuilderSlotTemplate): boolean {
  return (
    slot.solution_tier_limit != null &&
    Number.isFinite(slot.solution_tier_limit) &&
    slot.solution_tier_limit > 0
  );
}

/** When the allow-list is empty, every vault tier is eligible. */
export function isVaultTierAllowedForSlot(
  slot: PackageBuilderSlotTemplate,
  solutionTierId: string
): boolean {
  if (slot.allowed_solution_tier_ids.length === 0) return true;
  return slot.allowed_solution_tier_ids.includes(solutionTierId);
}

/** Copy limit + allow-list fields from one tier slot to another (labels unchanged). */
export function copySlotLimitSettings(
  source: PackageBuilderSlotTemplate
): Pick<
  PackageBuilderSlotTemplate,
  "hour_ceiling" | "price_ceiling" | "solution_tier_limit" | "allowed_solution_tier_ids"
> {
  return {
    hour_ceiling: source.hour_ceiling,
    price_ceiling: source.price_ceiling,
    solution_tier_limit: source.solution_tier_limit,
    allowed_solution_tier_ids: [...source.allowed_solution_tier_ids],
  };
}

export function slotLimitSummary(slot: PackageBuilderSlotTemplate): string {
  const parts: string[] = [];
  if (slotEnforcesHourCeiling(slot)) {
    parts.push(`≤ ${slot.hour_ceiling} h`);
  }
  if (slotEnforcesPriceCeiling(slot)) {
    parts.push(`≤ $${Number(slot.price_ceiling).toLocaleString()} sell`);
  }
  if (slotEnforcesTierCountLimit(slot)) {
    parts.push(`≤ ${slot.solution_tier_limit} solution tier${slot.solution_tier_limit === 1 ? "" : "s"}`);
  }
  if (slot.allowed_solution_tier_ids.length > 0) {
    parts.push(`${slot.allowed_solution_tier_ids.length} allowed vault tier(s)`);
  }
  return parts.length > 0 ? parts.join(" · ") : "No limits configured";
}
