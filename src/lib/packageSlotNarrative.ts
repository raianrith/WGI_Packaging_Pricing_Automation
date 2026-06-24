import type { PackageDetailFieldKey } from "../components/PackageDetailsFormBlock";
import type { Package, PackageBuilderSlotTemplate } from "../types";

/** Narrative fields stored on a slot and copied to `packages` when building. */
export const PACKAGE_SLOT_NARRATIVE_KEYS = [
  "package_owner",
  "package_overview",
  "package_overview_link",
  "package_direction",
  "package_what_is_it",
  "package_why_is_it_valuable",
  "package_when_should_it_be_used",
  "package_assumption_prerequisites",
  "package_in_scope",
  "package_out_of_scope",
  "package_final_deliverable",
  "package_how_do_we_get_this_work_done",
  "package_sop",
  "package_resources",
  "package_resource_templates",
  "package_resource_tools",
] as const satisfies readonly (keyof PackageBuilderSlotTemplate)[];

export type PackageSlotNarrativeKey = (typeof PACKAGE_SLOT_NARRATIVE_KEYS)[number];

const DETAIL_FORM_KEYS: PackageDetailFieldKey[] = [
  "package_owner",
  "package_overview",
  "package_overview_link",
  "package_direction",
  "package_what_is_it",
  "package_why_is_it_valuable",
  "package_when_should_it_be_used",
  "package_assumption_prerequisites",
  "package_in_scope",
  "package_out_of_scope",
  "package_final_deliverable",
  "package_how_do_we_get_this_work_done",
  "package_sop",
  "package_resources",
  "package_resource_templates",
  "package_resource_tools",
];

function normOptStr(v: unknown): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t || null;
}

export function emptySlotNarrativeFields(): Pick<PackageBuilderSlotTemplate, PackageSlotNarrativeKey> {
  return Object.fromEntries(PACKAGE_SLOT_NARRATIVE_KEYS.map((k) => [k, null])) as Pick<
    PackageBuilderSlotTemplate,
    PackageSlotNarrativeKey
  >;
}

export function narrativeFieldsFromRow(
  row: Record<string, unknown>
): Pick<PackageBuilderSlotTemplate, PackageSlotNarrativeKey> {
  const out = emptySlotNarrativeFields();
  for (const k of PACKAGE_SLOT_NARRATIVE_KEYS) {
    out[k] = normOptStr(row[k]);
  }
  return out;
}

export function normalizeSlotNarrativeFields(
  slot: PackageBuilderSlotTemplate
): Pick<PackageBuilderSlotTemplate, PackageSlotNarrativeKey> {
  const out = emptySlotNarrativeFields();
  for (const k of PACKAGE_SLOT_NARRATIVE_KEYS) {
    out[k] = normOptStr(slot[k]);
  }
  return out;
}

export function slotToDetailsFormValues(
  slot: PackageBuilderSlotTemplate
): Record<PackageDetailFieldKey, string> {
  const values = Object.fromEntries(DETAIL_FORM_KEYS.map((k) => [k, ""])) as Record<
    PackageDetailFieldKey,
    string
  >;
  for (const k of DETAIL_FORM_KEYS) {
    const v = slot[k as PackageSlotNarrativeKey];
    values[k] = typeof v === "string" && v ? v : "";
  }
  return values;
}

export function detailsFormPatchToSlot(
  key: PackageDetailFieldKey,
  value: string
): Partial<PackageBuilderSlotTemplate> {
  if (!(DETAIL_FORM_KEYS as readonly string[]).includes(key)) return {};
  const trimmed = value.trim();
  return { [key]: trimmed || null } as Partial<PackageBuilderSlotTemplate>;
}

export function packageNarrativeFromSlot(slot: PackageBuilderSlotTemplate): Partial<Package> {
  const out: Partial<Package> = {};
  for (const k of PACKAGE_SLOT_NARRATIVE_KEYS) {
    out[k] = normOptStr(slot[k]);
  }
  return out;
}

export function copySlotNarrativeSettings(
  source: PackageBuilderSlotTemplate
): Pick<PackageBuilderSlotTemplate, PackageSlotNarrativeKey> {
  return normalizeSlotNarrativeFields(source);
}
