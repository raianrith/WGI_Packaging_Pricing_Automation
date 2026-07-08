import type { PlaybookFilterValue } from "../components/CatalogPlaybookBrowser";
import { PLAYBOOK_UNSET, taxonomyDisplayLabel } from "../components/CatalogPlaybookBrowser";
import type { CatalogTierTableRow } from "../components/CatalogTierTable";
import type { Package, PackageBuilderPackageType } from "../types";

function tagEquals(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: "base" }) === 0;
}

export type TaggedPlaybookItem = {
  phase_tags?: readonly string[];
  category_tags?: readonly string[];
  tactic_tags?: readonly string[];
};

export type GuidedBrowseOption = {
  value: PlaybookFilterValue;
  label: string;
  tierCount: number;
  configurablePackageCount: number;
  presetPackageCount: number;
};

/** Whether a tag list matches a guided-browse filter for one taxonomy dimension. */
export function tagListMatchesFilter(
  tags: readonly string[],
  filter: PlaybookFilterValue | null
): boolean {
  if (filter === null) return true;
  if (filter === PLAYBOOK_UNSET) return tags.length === 0;
  return tags.some((t) => tagEquals(t.trim(), filter));
}

/** Tagged catalog item matches the guided path selections on each configured tag dimension. */
export function taggedItemMatchesGuidedPath(
  item: TaggedPlaybookItem,
  phase: PlaybookFilterValue | null,
  category: PlaybookFilterValue | null,
  tactic: PlaybookFilterValue | null
): boolean {
  return (
    tagListMatchesFilter(item.phase_tags ?? [], phase) &&
    tagListMatchesFilter(item.category_tags ?? [], category) &&
    tagListMatchesFilter(item.tactic_tags ?? [], tactic)
  );
}

/** @deprecated Use taggedItemMatchesGuidedPath */
export function packageTypeMatchesGuidedPath(
  pt: PackageBuilderPackageType,
  phase: PlaybookFilterValue | null,
  category: PlaybookFilterValue | null,
  tactic: PlaybookFilterValue | null
): boolean {
  return taggedItemMatchesGuidedPath(pt, phase, category, tactic);
}

export function filterPackageTypesByGuidedPath(
  packageTypes: readonly PackageBuilderPackageType[],
  phase: PlaybookFilterValue | null,
  category: PlaybookFilterValue | null,
  tactic: PlaybookFilterValue | null
): PackageBuilderPackageType[] {
  return packageTypes.filter((pt) => taggedItemMatchesGuidedPath(pt, phase, category, tactic));
}

export function filterPresetPackagesByGuidedPath(
  packages: readonly Package[],
  phase: PlaybookFilterValue | null,
  category: PlaybookFilterValue | null,
  tactic: PlaybookFilterValue | null
): Package[] {
  return packages.filter((pkg) => taggedItemMatchesGuidedPath(pkg, phase, category, tactic));
}

type TaggedBrowseContributor<T extends TaggedPlaybookItem> = {
  items: readonly T[];
  eligible: (
    item: T,
    phase: PlaybookFilterValue | null,
    category: PlaybookFilterValue | null,
    dimension: "phase" | "category" | "tactic"
  ) => boolean;
  tagsForDimension: (
    item: T,
    dimension: "phase" | "category" | "tactic"
  ) => readonly string[];
  countField: "configurablePackageCount" | "presetPackageCount";
};

function taggedItemEligibleForOptionBuild(
  item: TaggedPlaybookItem,
  phase: PlaybookFilterValue | null,
  category: PlaybookFilterValue | null,
  dimension: "phase" | "category" | "tactic"
): boolean {
  if (dimension === "phase") return true;
  if (dimension === "category") return tagListMatchesFilter(item.phase_tags ?? [], phase);
  return (
    tagListMatchesFilter(item.phase_tags ?? [], phase) &&
    tagListMatchesFilter(item.category_tags ?? [], category)
  );
}

function optionKey(value: string): string {
  return value.trim().toLowerCase();
}

function incrementTaggedCounts<T extends TaggedPlaybookItem>(
  contributor: TaggedBrowseContributor<T>,
  phase: PlaybookFilterValue | null,
  category: PlaybookFilterValue | null,
  dimension: "phase" | "category" | "tactic",
  includeUnset: boolean,
  ensure: (value: PlaybookFilterValue, label: string) => GuidedBrowseOption
) {
  for (const item of contributor.items) {
    if (!contributor.eligible(item, phase, category, dimension)) continue;
    const tags = contributor
      .tagsForDimension(item, dimension)
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.length === 0) {
      if (!includeUnset) continue;
      ensure(PLAYBOOK_UNSET, taxonomyDisplayLabel(PLAYBOOK_UNSET))[contributor.countField] += 1;
      continue;
    }
    for (const tag of tags) {
      ensure(tag, tag)[contributor.countField] += 1;
    }
  }
}

/** Build guided step options from vault tiers plus tagged configurable and preset packages. */
export function buildGuidedBrowseOptions(
  tierRows: readonly CatalogTierTableRow[],
  configurablePackageTypes: readonly PackageBuilderPackageType[],
  presetPackages: readonly Package[],
  tierGetter: (r: CatalogTierTableRow) => string,
  includeUnset: boolean,
  compareFn: (a: string, b: string) => number,
  phase: PlaybookFilterValue | null,
  category: PlaybookFilterValue | null,
  dimension: "phase" | "category" | "tactic"
): GuidedBrowseOption[] {
  const byKey = new Map<string, GuidedBrowseOption>();

  const ensure = (value: PlaybookFilterValue, label: string) => {
    const key = value === PLAYBOOK_UNSET ? PLAYBOOK_UNSET : optionKey(String(value));
    const existing = byKey.get(key);
    if (existing) return existing;
    const created: GuidedBrowseOption = {
      value,
      label,
      tierCount: 0,
      configurablePackageCount: 0,
      presetPackageCount: 0,
    };
    byKey.set(key, created);
    return created;
  };

  for (const row of tierRows) {
    const raw = tierGetter(row).trim();
    if (!raw) {
      if (!includeUnset) continue;
      ensure(PLAYBOOK_UNSET, taxonomyDisplayLabel(PLAYBOOK_UNSET)).tierCount += 1;
      continue;
    }
    ensure(raw, raw).tierCount += 1;
  }

  const contributors: TaggedBrowseContributor<TaggedPlaybookItem>[] = [
    {
      items: configurablePackageTypes,
      eligible: (item, p, c, dim) => taggedItemEligibleForOptionBuild(item, p, c, dim),
      tagsForDimension: (item, dim) => {
        if (dim === "phase") return item.phase_tags ?? [];
        if (dim === "category") return item.category_tags ?? [];
        return item.tactic_tags ?? [];
      },
      countField: "configurablePackageCount",
    },
    {
      items: presetPackages,
      eligible: (item, p, c, dim) => taggedItemEligibleForOptionBuild(item, p, c, dim),
      tagsForDimension: (item, dim) => {
        if (dim === "phase") return item.phase_tags ?? [];
        if (dim === "category") return item.category_tags ?? [];
        return item.tactic_tags ?? [];
      },
      countField: "presetPackageCount",
    },
  ];

  for (const contributor of contributors) {
    incrementTaggedCounts(contributor, phase, category, dimension, includeUnset, ensure);
  }

  const options = [...byKey.values()].filter(
    (o) => o.tierCount + o.configurablePackageCount + o.presetPackageCount > 0
  );
  options.sort((a, b) => {
    if (a.value === PLAYBOOK_UNSET) return 1;
    if (b.value === PLAYBOOK_UNSET) return -1;
    return compareFn(a.label, b.label);
  });
  return options;
}

export type GuidedOptionStatSlot = {
  key: string;
  tone: string;
  label: string;
  visible: boolean;
};

const GUIDED_STAT_SLOT_ORDER = [
  { key: "tier", tone: "tier" as const },
  { key: "configurable", tone: "configurable" as const },
  { key: "preset", tone: "preset" as const },
] as const;

export function guidedOptionStatSlots(opt: GuidedBrowseOption): GuidedOptionStatSlot[] {
  const counts = {
    tier: opt.tierCount,
    configurable: opt.configurablePackageCount,
    preset: opt.presetPackageCount,
  };
  const labels = {
    tier: `${counts.tier} Solution Tier${counts.tier === 1 ? "" : "s"}`,
    configurable: `${counts.configurable} Configurable Package${
      counts.configurable === 1 ? "" : "s"
    }`,
    preset: `${counts.preset} Custom Package${counts.preset === 1 ? "" : "s"}`,
  };

  return GUIDED_STAT_SLOT_ORDER.map(({ key, tone }) => ({
    key,
    tone,
    label: labels[key],
    visible: counts[key] > 0,
  }));
}

export function guidedOptionStats(opt: GuidedBrowseOption): { key: string; label: string; tone: string }[] {
  return guidedOptionStatSlots(opt)
    .filter((slot) => slot.visible)
    .map(({ key, tone, label }) => ({ key, tone, label }));
}

export function guidedOptionMeta(opt: GuidedBrowseOption): string {
  const parts = guidedOptionStats(opt).map((s) => s.label);
  return parts.join(" · ") || "0 matches";
}
