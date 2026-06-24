import type { Package } from "../types";
import { isConfigurablePackage } from "./buildCatalogDirectoryRows";
import { normalizePackageTypeTags } from "./packageBuilderSlots";
import type { PackageBuilderPackageType } from "../types";

export type TaggedPlaybookItem = {
  phase_tags: readonly string[];
  category_tags: readonly string[];
  tactic_tags: readonly string[];
};

export function normalizePackageTaxonomyTags(pkg: Package): Package {
  return {
    ...pkg,
    phase_tags: normalizePackageTypeTags(pkg.phase_tags ?? []),
    category_tags: normalizePackageTypeTags(pkg.category_tags ?? []),
    tactic_tags: normalizePackageTypeTags(pkg.tactic_tags ?? []),
  };
}

export function filterPresetPackages(
  packages: readonly Package[],
  packageTypes: readonly PackageBuilderPackageType[]
): Package[] {
  const typeNames = packageTypeNameSet(packageTypes);
  return packages
    .filter((pkg) => !isConfigurablePackage(pkg, typeNames))
    .map(normalizePackageTaxonomyTags);
}

export function filterConfigurablePackages(
  packages: readonly Package[],
  packageTypes: readonly PackageBuilderPackageType[]
): Package[] {
  const typeNames = packageTypeNameSet(packageTypes);
  return packages
    .filter((pkg) => isConfigurablePackage(pkg, typeNames))
    .map(normalizePackageTaxonomyTags);
}

function packageTypeNameSet(packageTypes: readonly PackageBuilderPackageType[]): Set<string> {
  return new Set(packageTypes.map((pt) => pt.name.trim().toLowerCase()).filter(Boolean));
}

export function packageTaxonomyPayload(pkg: Package): Pick<Package, "phase_tags" | "category_tags" | "tactic_tags"> {
  return {
    phase_tags: normalizePackageTypeTags(pkg.phase_tags ?? []),
    category_tags: normalizePackageTypeTags(pkg.category_tags ?? []),
    tactic_tags: normalizePackageTypeTags(pkg.tactic_tags ?? []),
  };
}
