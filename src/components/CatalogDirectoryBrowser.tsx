import { useEffect, useId, useMemo } from "react";
import { filterCatalogTierRows, PLAYBOOK_UNSET, type PlaybookFilterValue } from "./CatalogPlaybookBrowser";
import { compareTierPhaseLabels } from "../lib/tierTaxonomy";
import { compareTierCategoryLabels } from "../lib/tierCategories";
import { isCatalogSolutionType, type CatalogDirectoryRow, type CatalogDirectoryItemType } from "../lib/buildCatalogDirectoryRows";
import {
  CatalogDirectoryTable,
  TYPE_SORT_RANK,
  type CatalogDirectorySortCol,
} from "./CatalogDirectoryTable";

type FilterOption = { value: PlaybookFilterValue; label: string; count: number };

export type CatalogDirectoryTypeFilter = CatalogDirectoryItemType | null;

type TypeFilterOption = { value: CatalogDirectoryTypeFilter; label: string; count: number };

const TYPE_FILTER_ORDER: CatalogDirectoryItemType[] = [
  "solution_module",
  "configured_solution",
  "preset_package",
  "configurable_package",
];

const TYPE_FILTER_LABELS: Record<CatalogDirectoryItemType, string> = {
  solution_module: "Solution Modules",
  configured_solution: "Configured Solutions",
  preset_package: "Custom Package",
  configurable_package: "Configurable Package",
};

function buildTypeFilterOptions(rows: CatalogDirectoryRow[]): TypeFilterOption[] {
  const counts: Record<CatalogDirectoryItemType, number> = {
    solution_module: 0,
    configured_solution: 0,
    preset_package: 0,
    configurable_package: 0,
  };
  for (const row of rows) counts[row.type] += 1;
  return [
    { value: null, label: "All", count: rows.length },
    ...TYPE_FILTER_ORDER.map((type) => ({
      value: type,
      label: TYPE_FILTER_LABELS[type],
      count: counts[type],
    })),
  ];
}

function typeFilterToSelectString(value: CatalogDirectoryTypeFilter): string {
  return value ?? "";
}

function selectStringToTypeFilter(raw: string): CatalogDirectoryTypeFilter {
  if (raw === "") return null;
  if (
    raw === "solution_module" ||
    raw === "configured_solution" ||
    raw === "preset_package" ||
    raw === "configurable_package"
  ) {
    return raw;
  }
  return null;
}

function compareLabels(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function fieldMatches(rowValue: string, filter: PlaybookFilterValue): boolean {
  const raw = rowValue.trim();
  if (filter === null) return true;
  if (filter === PLAYBOOK_UNSET) return !raw;
  return raw === filter;
}

function buildFilterOptions(
  tierRows: { phaseRaw: string; categoryRaw: string; tacticRaw: string }[],
  getter: (r: { phaseRaw: string; categoryRaw: string; tacticRaw: string }) => string,
  includeUnset: boolean,
  compareFn: (a: string, b: string) => number = compareLabels
): FilterOption[] {
  const counts = new Map<string, number>();
  let unsetCount = 0;
  for (const r of tierRows) {
    const v = getter(r).trim();
    if (!v) {
      unsetCount++;
      continue;
    }
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const options: FilterOption[] = [
    { value: null, label: "All", count: tierRows.length },
    ...[...counts.entries()]
      .sort(([a], [b]) => compareFn(a, b))
      .map(([label, count]) => ({ value: label, label, count })),
  ];
  if (includeUnset && unsetCount > 0) {
    options.push({ value: PLAYBOOK_UNSET, label: "Not Defined", count: unsetCount });
  }
  return options;
}

function valueToSelectString(value: PlaybookFilterValue): string {
  if (value === null) return "";
  return value;
}

function selectStringToValue(raw: string): PlaybookFilterValue {
  if (raw === "") return null;
  return raw;
}

function PlaybookFilterSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: PlaybookFilterValue;
  options: FilterOption[];
  onChange: (v: PlaybookFilterValue) => void;
}) {
  const active = value !== null;
  return (
    <div className={`agency-tier-filter-field agency-tier-filter-field--select${active ? " agency-tier-filter-field--active" : ""}`}>
      <label className="agency-tier-filter-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="agency-tier-filter-field__control">
        <select
          id={id}
          className="agency-tier-filter-field__select"
          value={valueToSelectString(value)}
          onChange={(e) => onChange(selectStringToValue(e.target.value))}
        >
          {options.map((opt) => (
            <option
              key={opt.value === null ? "__all__" : String(opt.value)}
              value={valueToSelectString(opt.value)}
            >
              {opt.label} ({opt.count})
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function TypeFilterSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: CatalogDirectoryTypeFilter;
  options: TypeFilterOption[];
  onChange: (v: CatalogDirectoryTypeFilter) => void;
}) {
  const active = value !== null;
  return (
    <div className={`agency-tier-filter-field agency-tier-filter-field--select agency-tier-filter-field--type${active ? " agency-tier-filter-field--active" : ""}`}>
      <label className="agency-tier-filter-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="agency-tier-filter-field__control">
        <select
          id={id}
          className="agency-tier-filter-field__select"
          value={typeFilterToSelectString(value)}
          onChange={(e) => onChange(selectStringToTypeFilter(e.target.value))}
        >
          {options.map((opt) => (
            <option key={opt.value ?? "__all__"} value={typeFilterToSelectString(opt.value)}>
              {opt.label} ({opt.count})
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function filterCatalogDirectoryRows(
  rows: CatalogDirectoryRow[],
  itemType: CatalogDirectoryTypeFilter,
  phase: PlaybookFilterValue,
  category: PlaybookFilterValue,
  tactic: PlaybookFilterValue,
  tableSearch: string,
  solutionsOnly = false
): CatalogDirectoryRow[] {
  const q = tableSearch.trim().toLowerCase();
  const hasTaxonomy = phase !== null || category !== null || tactic !== null;
  const out: CatalogDirectoryRow[] = [];

  for (const row of rows) {
    if (solutionsOnly) {
      if (!isCatalogSolutionType(row.type)) continue;
    } else if (itemType !== null && row.type !== itemType) {
      continue;
    }

    if (row.type === "configurable_package") {
      const rowBlob = `${row.name} ${row.meta} ${row.typeLabel}`.toLowerCase().replace(/\$/g, "");
      if (q && !rowBlob.includes(q)) continue;
      out.push(row);
      continue;
    }

    const filteredTiers = filterCatalogTierRows(row.tierRows, phase, category, tactic, tableSearch);
    const rowBlob = `${row.name} ${row.meta} ${row.typeLabel} ${row.packageId ?? ""} ${row.solutionId ?? ""}`
      .toLowerCase()
      .replace(/\$/g, "");
    const rowMatchesSearch = !q || rowBlob.includes(q);

    if (hasTaxonomy && filteredTiers.length === 0) continue;
    if (q && !rowMatchesSearch && filteredTiers.length === 0) continue;

    const tierRows =
      isCatalogSolutionType(row.type) && q && rowMatchesSearch && filteredTiers.length === 0
        ? row.tierRows
        : hasTaxonomy || q
          ? filteredTiers
          : row.tierRows;

    out.push({ ...row, tierRows });
  }
  return out;
}

type Props = {
  allRows: CatalogDirectoryRow[];
  itemType: CatalogDirectoryTypeFilter;
  phase: PlaybookFilterValue;
  category: PlaybookFilterValue;
  tactic: PlaybookFilterValue;
  onItemTypeChange: (v: CatalogDirectoryTypeFilter) => void;
  onPhaseChange: (v: PlaybookFilterValue) => void;
  onCategoryChange: (v: PlaybookFilterValue) => void;
  onTacticChange: (v: PlaybookFilterValue) => void;
  tableSearch: string;
  onTableSearchChange: (q: string) => void;
  sort: { col: CatalogDirectorySortCol; dir: "asc" | "desc" };
  onToggleSort: (col: CatalogDirectorySortCol) => void;
  expandedSolutionIds: ReadonlySet<string>;
  onToggleSolution: (solutionId: string) => void;
  onOpenTier: (solutionId: string, tierId: string) => void;
  onOpenPresetPackage: (packageId: string) => void;
  onOpenConfigurablePackage: (packageBuilderTypeId: string) => void;
  hideTypeFilter?: boolean;
  hidePackageStats?: boolean;
  searchPlaceholder?: string;
  footerHint?: string;
  tierInteraction?: "open" | "add";
  onAddTier?: (solutionId: string, tierId: string) => void;
  addedTierRefIds?: ReadonlySet<string>;
  justAddedTierId?: string | null;
  canAdd?: boolean;
};

export function CatalogDirectoryBrowser({
  allRows,
  itemType,
  phase,
  category,
  tactic,
  onItemTypeChange,
  onPhaseChange,
  onCategoryChange,
  onTacticChange,
  tableSearch,
  onTableSearchChange,
  sort,
  onToggleSort,
  expandedSolutionIds,
  onToggleSolution,
  onOpenTier,
  onOpenPresetPackage,
  onOpenConfigurablePackage,
  hideTypeFilter = false,
  hidePackageStats = false,
  searchPlaceholder = "Solution, package, tier, tags…",
  footerHint = "Expand a solution for tiers · Custom opens overview · Configurable opens package builder",
  tierInteraction = "open",
  onAddTier,
  addedTierRefIds,
  justAddedTierId,
  canAdd,
}: Props) {
  const phaseId = useId();
  const typeId = useId();
  const categoryId = useId();
  const tacticId = useId();
  const searchId = useId();

  const rowsForTypeScope = useMemo(() => {
    if (hideTypeFilter) return allRows.filter((r) => isCatalogSolutionType(r.type));
    if (itemType === null) return allRows;
    return allRows.filter((r) => r.type === itemType);
  }, [allRows, hideTypeFilter, itemType]);

  const allTierRows = useMemo(() => rowsForTypeScope.flatMap((r) => r.tierRows), [rowsForTypeScope]);

  const rowsAfterPhase = useMemo(() => {
    if (phase === null) return allTierRows;
    return allTierRows.filter((r) => fieldMatches(r.phaseRaw, phase));
  }, [allTierRows, phase]);

  const rowsAfterCategory = useMemo(() => {
    if (category === null) return rowsAfterPhase;
    return rowsAfterPhase.filter((r) => fieldMatches(r.categoryRaw, category));
  }, [rowsAfterPhase, category]);

  const filteredRows = useMemo(
    () => filterCatalogDirectoryRows(allRows, itemType, phase, category, tactic, tableSearch, hideTypeFilter),
    [allRows, itemType, phase, category, tactic, tableSearch, hideTypeFilter]
  );

  const typeOptions = useMemo(() => buildTypeFilterOptions(allRows), [allRows]);

  const phaseOptions = useMemo(
    () => buildFilterOptions(allTierRows, (r) => r.phaseRaw, true, compareTierPhaseLabels),
    [allTierRows]
  );

  const categoryOptions = useMemo(
    () => buildFilterOptions(rowsAfterPhase, (r) => r.categoryRaw, true, compareTierCategoryLabels),
    [rowsAfterPhase]
  );

  const tacticOptions = useMemo(
    () => buildFilterOptions(rowsAfterCategory, (r) => r.tacticRaw, true),
    [rowsAfterCategory]
  );

  useEffect(() => {
    if (category === null || category === PLAYBOOK_UNSET) return;
    if (!categoryOptions.some((o) => o.value === category)) onCategoryChange(null);
  }, [category, categoryOptions, onCategoryChange]);

  useEffect(() => {
    if (tactic === null || tactic === PLAYBOOK_UNSET) return;
    if (!tacticOptions.some((o) => o.value === tactic)) onTacticChange(null);
  }, [tactic, tacticOptions, onTacticChange]);

  const sortedRows = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    const cmpNum = (a: number | null, b: number | null): number => {
      const aa = a == null || !Number.isFinite(a) ? null : a;
      const bb = b == null || !Number.isFinite(b) ? null : b;
      if (aa == null && bb == null) return 0;
      if (aa == null) return 1;
      if (bb == null) return -1;
      return (aa - bb) * dir;
    };
    const cmpStr = (a: string, b: string) =>
      (a || "\uffff").localeCompare(b || "\uffff", undefined, { sensitivity: "base" }) * dir;

    return [...filteredRows].sort((a, b) => {
      let c = 0;
      switch (sort.col) {
        case "name":
        case "tier":
          c = cmpStr(a.name, b.name);
          break;
        case "type":
          c = (TYPE_SORT_RANK[a.type] - TYPE_SORT_RANK[b.type]) * dir || cmpStr(a.name, b.name);
          break;
        case "phase":
          c = compareTierPhaseLabels(a.phaseRaw, b.phaseRaw) * dir;
          break;
        case "category":
          c = compareTierCategoryLabels(a.categoryRaw, b.categoryRaw) * dir;
          break;
        case "tactic":
          c = cmpStr(a.tacticRaw, b.tacticRaw);
          break;
        case "price":
          c = cmpNum(a.priceNum, b.priceNum);
          break;
        case "hours":
          c = cmpNum(a.hoursNum, b.hoursNum);
          break;
        case "taxable":
          c =
            (a.taxableSort - b.taxableSort) * dir || a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
          break;
        case "tags":
          c = cmpStr(a.tagsRaw, b.tagsRaw);
          break;
        default:
          c = 0;
      }
      if (c !== 0) return c;
      return a.id.localeCompare(b.id, undefined, { sensitivity: "base" });
    });
  }, [filteredRows, sort]);

  const hasFilters =
    (!hideTypeFilter && itemType !== null) || phase !== null || category !== null || tactic !== null;
  const moduleCount = allRows.filter((r) => r.type === "solution_module").length;
  const configuredCount = allRows.filter((r) => r.type === "configured_solution").length;
  const presetCount = allRows.filter((r) => r.type === "preset_package").length;
  const configurableCount = allRows.filter((r) => r.type === "configurable_package").length;

  const clearFilters = () => {
    if (!hideTypeFilter) onItemTypeChange(null);
    onPhaseChange(null);
    onCategoryChange(null);
    onTacticChange(null);
  };

  return (
    <div className="agency-playbook-browser agency-playbook-browser--directory">
      <div className="agency-tier-filters agency-tier-filters--directory" role="search" aria-label="Filter solutions directory">
        <div className="agency-tier-filters__row agency-tier-filters__row--directory">
          {hideTypeFilter ? null : (
            <>
              <TypeFilterSelect
                id={typeId}
                label="Type"
                value={itemType}
                options={typeOptions}
                onChange={onItemTypeChange}
              />
              <span className="agency-tier-filters__chev agency-tier-filters__chev--directory" aria-hidden>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path d="M5 3.5 9 7l-4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </>
          )}
          <PlaybookFilterSelect
            id={phaseId}
            label="Phase"
            value={phase}
            options={phaseOptions}
            onChange={(v) => {
              onPhaseChange(v);
              onCategoryChange(null);
              onTacticChange(null);
            }}
          />
          <span className="agency-tier-filters__chev agency-tier-filters__chev--directory" aria-hidden>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M5 3.5 9 7l-4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <PlaybookFilterSelect
            id={categoryId}
            label="Category"
            value={category}
            options={categoryOptions}
            onChange={(v) => {
              onCategoryChange(v);
              onTacticChange(null);
            }}
          />
          <span className="agency-tier-filters__chev agency-tier-filters__chev--directory" aria-hidden>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M5 3.5 9 7l-4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <PlaybookFilterSelect
            id={tacticId}
            label="Tactic"
            value={tactic}
            options={tacticOptions}
            onChange={onTacticChange}
          />
          <div
            className={`agency-tier-filter-field agency-tier-filter-field--search agency-tier-filter-field--search-directory${tableSearch.trim() ? " agency-tier-filter-field--active" : ""}`}
          >
            <label className="agency-tier-filter-field__label" htmlFor={searchId}>
              Search
            </label>
            <div className="agency-tier-filter-field__control agency-tier-filter-field__control--search">
              <span className="agency-tier-filter-field__search-icon" aria-hidden>
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                  <circle cx="6.5" cy="6.5" r="4.25" stroke="currentColor" strokeWidth="1.4" />
                  <path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </span>
              <input
                id={searchId}
                type="search"
                className="agency-tier-filter-field__input"
                value={tableSearch}
                onChange={(e) => onTableSearchChange(e.target.value)}
                placeholder={searchPlaceholder}
                autoComplete="off"
              />
            </div>
          </div>
        </div>
        <div className="agency-tier-filters__footer agency-tier-filters__footer--directory" role="status" aria-live="polite">
          <div className="agency-tier-filters__stats">
            <span className="agency-tier-filters__count">
              <strong>{sortedRows.length}</strong>
              <span className="agency-tier-filters__count-of"> of {allRows.length}</span>
            </span>
            <span className="agency-directory-stat agency-directory-stat--module">{moduleCount} solution modules</span>
            <span className="agency-directory-stat agency-directory-stat--solution">
              {configuredCount} configured solutions
            </span>
            {hidePackageStats ? null : (
              <>
                <span className="agency-directory-stat agency-directory-stat--preset">{presetCount} custom packages</span>
                <span className="agency-directory-stat agency-directory-stat--configurable">
                  {configurableCount} configurable packages
                </span>
              </>
            )}
          </div>
          <span className="agency-tier-filters__hint agency-tier-filters__hint--directory">{footerHint}</span>
          {hasFilters ? (
            <button type="button" className="agency-tier-filters__clear agency-tier-filters__clear--directory" onClick={clearFilters}>
              Clear filters
            </button>
          ) : null}
        </div>
      </div>

      <section className="agency-catalog-tier-sheet agency-catalog-tier-sheet--directory" aria-label="Solutions directory table">
        <CatalogDirectoryTable
          rows={sortedRows}
          expandedSolutionIds={expandedSolutionIds}
          onToggleSolution={onToggleSolution}
          sort={sort}
          onToggleSort={onToggleSort}
          onOpenTier={onOpenTier}
          onOpenPresetPackage={onOpenPresetPackage}
          onOpenConfigurablePackage={onOpenConfigurablePackage}
          tierInteraction={tierInteraction}
          onAddTier={onAddTier}
          addedTierRefIds={addedTierRefIds}
          justAddedTierId={justAddedTierId}
          canAdd={canAdd}
          emptyMessage={
            allRows.length === 0
              ? "No solutions loaded."
              : hasFilters || tableSearch.trim()
                ? "No items match your filters."
                : "No items to show."
          }
        />
      </section>
    </div>
  );
}
