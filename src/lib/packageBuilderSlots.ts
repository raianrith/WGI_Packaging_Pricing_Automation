import type { SupabaseClient } from "@supabase/supabase-js";
import type { PackageBuilderPackageType, PackageBuilderSlotTemplate, PackagePricingOverrides } from "../types";
import {
  emptySlotNarrativeFields,
  narrativeFieldsFromRow,
  normalizeSlotNarrativeFields,
} from "./packageSlotNarrative";

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

export function normalizePackageTypeTags(tags: readonly string[]): string[] {
  return normTagArray(tags);
}

function normTagArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of v) {
    const label = String(item ?? "").trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function normType(r: Record<string, unknown>): PackageBuilderPackageType {
  const cardRaw = r.card_description;
  return {
    id: String(r.id ?? ""),
    sort_order: Number(r.sort_order ?? 0),
    name: String(r.name ?? ""),
    card_description:
      cardRaw != null && String(cardRaw).trim() !== "" ? String(cardRaw).trim() : null,
    phase_tags: normTagArray(r.phase_tags),
    category_tags: normTagArray(r.category_tags),
    tactic_tags: normTagArray(r.tactic_tags),
    updated_at: r.updated_at != null ? String(r.updated_at) : null,
  };
}

function parseOptionalScore012(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  if (r < 0 || r > 2) return null;
  return r;
}

/** Default preset scores for new / seed slots (0 = lowest risk / Support). */
export function emptySlotRiskPresets(): Pick<
  PackageBuilderSlotTemplate,
  "scope_risk" | "internal_coordination" | "client_revision_risk" | "strategic_value_score"
> {
  return {
    scope_risk: 0,
    internal_coordination: 0,
    client_revision_risk: 0,
    strategic_value_score: 0,
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
    tier_notes:
      r.tier_notes != null && String(r.tier_notes).trim() !== ""
        ? String(r.tier_notes).trim()
        : null,
    scope_risk: parseOptionalScore012(r.scope_risk) ?? 0,
    internal_coordination: parseOptionalScore012(r.internal_coordination) ?? 0,
    client_revision_risk: parseOptionalScore012(r.client_revision_risk) ?? 0,
    strategic_value_score: parseOptionalScore012(r.strategic_value_score) ?? 0,
    ...narrativeFieldsFromRow(r),
    updated_at: r.updated_at != null ? String(r.updated_at) : null,
  };
}

export function slotTierNotes(slot: PackageBuilderSlotTemplate): string | null {
  const t = slot.tier_notes?.trim();
  return t ? t : null;
}

export function defaultPackageBuilderTypes(): PackageBuilderPackageType[] {
  return [
    {
      id: "local-type-seed-1",
      sort_order: 1,
      name: "General",
      card_description: null,
      phase_tags: [],
      category_tags: [],
      tactic_tags: [],
      updated_at: null,
    },
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
      tier_notes: null,
      ...emptySlotRiskPresets(),
      ...emptySlotNarrativeFields(),
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
      tier_notes: null,
      ...emptySlotRiskPresets(),
      ...emptySlotNarrativeFields(),
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
      tier_notes: null,
      ...emptySlotRiskPresets(),
      ...emptySlotNarrativeFields(),
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
      .select("id,sort_order,name,card_description,phase_tags,category_tags,tactic_tags,updated_at")
      .order("sort_order", { ascending: true }),
    client
      .from("package_builder_slot_templates")
      .select(
        "id,package_type_id,sort_order,label,hour_ceiling,price_ceiling,solution_tier_limit,tier_notes,scope_risk,internal_coordination,client_revision_risk,strategic_value_score,package_owner,package_overview,package_overview_link,package_direction,package_what_is_it,package_why_is_it_valuable,package_when_should_it_be_used,package_assumption_prerequisites,package_in_scope,package_out_of_scope,package_final_deliverable,package_how_do_we_get_this_work_done,package_sop,package_resources,package_resource_templates,package_resource_tools,updated_at"
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

/** Copy limit + allow-list + risk preset fields from one tier slot to another (labels unchanged). */
export function copySlotLimitSettings(
  source: PackageBuilderSlotTemplate
): Pick<
  PackageBuilderSlotTemplate,
  | "hour_ceiling"
  | "price_ceiling"
  | "solution_tier_limit"
  | "allowed_solution_tier_ids"
  | "scope_risk"
  | "internal_coordination"
  | "client_revision_risk"
  | "strategic_value_score"
> {
  return {
    hour_ceiling: source.hour_ceiling,
    price_ceiling: source.price_ceiling,
    solution_tier_limit: source.solution_tier_limit,
    allowed_solution_tier_ids: [...source.allowed_solution_tier_ids],
    scope_risk: source.scope_risk ?? 0,
    internal_coordination: source.internal_coordination ?? 0,
    client_revision_risk: source.client_revision_risk ?? 0,
    strategic_value_score: source.strategic_value_score ?? 0,
  };
}

/** Package-level pricing overrides written when creating a package from this slot. */
export function packagePricingOverridesFromSlot(
  slot: PackageBuilderSlotTemplate
): Pick<
  PackagePricingOverrides,
  "scope_risk" | "internal_coordination" | "client_revision_risk" | "strategic_value_score"
> {
  return {
    scope_risk: parseOptionalScore012(slot.scope_risk) ?? 0,
    internal_coordination: parseOptionalScore012(slot.internal_coordination) ?? 0,
    client_revision_risk: parseOptionalScore012(slot.client_revision_risk) ?? 0,
    strategic_value_score: parseOptionalScore012(slot.strategic_value_score) ?? 0,
  };
}

export function slotRiskPresetPayload(
  slot: PackageBuilderSlotTemplate
): Pick<
  PackageBuilderSlotTemplate,
  "scope_risk" | "internal_coordination" | "client_revision_risk" | "strategic_value_score"
> {
  return {
    scope_risk: parseOptionalScore012(slot.scope_risk) ?? 0,
    internal_coordination: parseOptionalScore012(slot.internal_coordination) ?? 0,
    client_revision_risk: parseOptionalScore012(slot.client_revision_risk) ?? 0,
    strategic_value_score: parseOptionalScore012(slot.strategic_value_score) ?? 0,
  };
}

export function slotNarrativePayload(
  slot: PackageBuilderSlotTemplate
): ReturnType<typeof normalizeSlotNarrativeFields> & { tier_notes: string | null } {
  return {
    ...normalizeSlotNarrativeFields(slot),
    tier_notes: slot.tier_notes?.trim() || null,
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
    parts.push(`≤ ${slot.solution_tier_limit} solution component${slot.solution_tier_limit === 1 ? "" : "s"}`);
  }
  if (slot.allowed_solution_tier_ids.length > 0) {
    parts.push(`${slot.allowed_solution_tier_ids.length} allowed solution component(s)`);
  }
  return parts.length > 0 ? parts.join(" · ") : "No limits configured";
}
