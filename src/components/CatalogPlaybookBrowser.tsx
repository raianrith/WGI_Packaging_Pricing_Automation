import { useEffect, useId, useMemo } from "react";
import type { CatalogTierTableRow, CatalogTierSortCol } from "./CatalogTierTable";
import { CatalogTierTable } from "./CatalogTierTable";
import { compareTierPhaseLabels } from "../lib/tierTaxonomy";
import { compareTierCategoryLabels } from "../lib/tierCategories";

/** Filter sentinel for tiers with no value on a taxonomy field. */
export const PLAYBOOK_UNSET = "__unset__";

/** Display label for blank taxonomy values in filters and guided browse. */
export const TAXONOMY_NOT_DEFINED_LABEL = "Not Defined";

export type PlaybookFilterValue = string | null | typeof PLAYBOOK_UNSET;

export function taxonomyDisplayLabel(value: string | PlaybookFilterValue | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (value === PLAYBOOK_UNSET) return TAXONOMY_NOT_DEFINED_LABEL;
  const v = String(value).trim();
  return v || TAXONOMY_NOT_DEFINED_LABEL;
}

type Props = {
  allRows: CatalogTierTableRow[];
  phase: PlaybookFilterValue;
  category: PlaybookFilterValue;
  tactic: PlaybookFilterValue;
  onPhaseChange: (v: PlaybookFilterValue) => void;
  onCategoryChange: (v: PlaybookFilterValue) => void;
  onTacticChange: (v: PlaybookFilterValue) => void;
  tableSearch: string;
  onTableSearchChange: (q: string) => void;
  sort: { col: CatalogTierSortCol; dir: "asc" | "desc" };
  onToggleSort: (col: CatalogTierSortCol) => void;
  onOpenTier: (solutionId: string, tierId: string) => void;
  /** Footer hint when a row is selected (e.g. proposal builder vs. catalog detail). */
  rowSelectHint?: string;
};

function compareLabels(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function fieldMatches(rowValue: string, filter: PlaybookFilterValue): boolean {
  const raw = rowValue.trim();
  if (filter === null) return true;
  if (filter === PLAYBOOK_UNSET) return !raw;
  return raw === filter;
}

type FilterOption = { value: PlaybookFilterValue; label: string; count: number };

function buildFilterOptions(
  rows: CatalogTierTableRow[],
  getter: (r: CatalogTierTableRow) => string,
  includeUnset: boolean,
  compareFn: (a: string, b: string) => number = compareLabels
): FilterOption[] {
  const counts = new Map<string, number>();
  let unsetCount = 0;
  for (const r of rows) {
    const v = getter(r).trim();
    if (!v) {
      unsetCount++;
      continue;
    }
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const options: FilterOption[] = [
    { value: null, label: "All", count: rows.length },
    ...[...counts.entries()]
      .sort(([a], [b]) => compareFn(a, b))
      .map(([label, count]) => ({ value: label, label, count })),
  ];
  if (includeUnset && unsetCount > 0) {
    options.push({ value: PLAYBOOK_UNSET, label: TAXONOMY_NOT_DEFINED_LABEL, count: unsetCount });
  }
  return options;
}

function valueToSelectString(value: PlaybookFilterValue): string {
  if (value === null) return "";
  if (value === PLAYBOOK_UNSET) return PLAYBOOK_UNSET;
  return value;
}

function selectStringToValue(raw: string): PlaybookFilterValue {
  if (raw === "") return null;
  if (raw === PLAYBOOK_UNSET) return PLAYBOOK_UNSET;
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
  return (
    <div className="agency-tier-filter-field">
      <label className="agency-tier-filter-field__label" htmlFor={id}>
        {label}
      </label>
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
  );
}

/** Apply phase / category / tactic filters and text search (no sort). */
export function filterCatalogTierRows(
  allRows: CatalogTierTableRow[],
  phase: PlaybookFilterValue,
  category: PlaybookFilterValue,
  tactic: PlaybookFilterValue,
  tableSearch: string
): CatalogTierTableRow[] {
  let rows = allRows;
  if (phase !== null) rows = rows.filter((r) => fieldMatches(r.phaseRaw, phase));
  if (category !== null) rows = rows.filter((r) => fieldMatches(r.categoryRaw, category));
  if (tactic !== null) rows = rows.filter((r) => fieldMatches(r.tacticRaw, tactic));
  const q = tableSearch.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => {
    const blob = `${r.pname} ${r.tierName} ${r.solutionName} ${r.phaseRaw} ${r.categoryRaw} ${r.tacticRaw} ${r.tagsRaw} ${r.taxableLabel} ${r.tierId} ${r.priceDisplay} ${r.hoursDisplay}`
      .toLowerCase()
      .replace(/\$/g, "");
    return blob.includes(q);
  });
}

export function CatalogPlaybookBrowser({
  allRows,
  phase,
  category,
  tactic,
  onPhaseChange,
  onCategoryChange,
  onTacticChange,
  tableSearch,
  onTableSearchChange,
  sort,
  onToggleSort,
  onOpenTier,
  rowSelectHint = "Select a row to open tier detail view",
}: Props) {
  const phaseId = useId();
  const categoryId = useId();
  const tacticId = useId();
  const searchId = useId();

  const rowsAfterPhase = useMemo(() => {
    if (phase === null) return allRows;
    return allRows.filter((r) => fieldMatches(r.phaseRaw, phase));
  }, [allRows, phase]);

  const rowsAfterCategory = useMemo(() => {
    if (category === null) return rowsAfterPhase;
    return rowsAfterPhase.filter((r) => fieldMatches(r.categoryRaw, category));
  }, [rowsAfterPhase, category]);

  const filteredRows = useMemo(
    () => filterCatalogTierRows(allRows, phase, category, tactic, tableSearch),
    [allRows, phase, category, tactic, tableSearch]
  );

  const phaseOptions = useMemo(
    () => buildFilterOptions(allRows, (r) => r.phaseRaw, true, compareTierPhaseLabels),
    [allRows]
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
        case "tier":
          c =
            a.tierName.localeCompare(b.tierName, undefined, { sensitivity: "base" }) * dir ||
            a.solutionName.localeCompare(b.solutionName, undefined, { sensitivity: "base" }) * dir;
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
            (a.taxableSort - b.taxableSort) * dir ||
            a.tierName.localeCompare(b.tierName, undefined, { sensitivity: "base" });
          break;
        case "tags":
          c = cmpStr(a.tagsRaw, b.tagsRaw);
          break;
        default:
          c = 0;
      }
      if (c !== 0) return c;
      return a.tierId.localeCompare(b.tierId, undefined, { sensitivity: "base" });
    });
  }, [filteredRows, sort]);

  const hasFilters = phase !== null || category !== null || tactic !== null;

  const clearFilters = () => {
    onPhaseChange(null);
    onCategoryChange(null);
    onTacticChange(null);
  };

  return (
    <div className="agency-playbook-browser">
      <div className="agency-tier-filters" role="search" aria-label="Filter solution tiers">
        <div className="agency-tier-filters__row">
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
          <span className="agency-tier-filters__chev" aria-hidden>
            ›
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
          <span className="agency-tier-filters__chev" aria-hidden>
            ›
          </span>
          <PlaybookFilterSelect
            id={tacticId}
            label="Tactic"
            value={tactic}
            options={tacticOptions}
            onChange={onTacticChange}
          />
          <div className="agency-tier-filter-field agency-tier-filter-field--search">
            <label className="agency-tier-filter-field__label" htmlFor={searchId}>
              Search
            </label>
            <input
              id={searchId}
              type="search"
              className="agency-tier-filter-field__input"
              value={tableSearch}
              onChange={(e) => onTableSearchChange(e.target.value)}
              placeholder="Tier, solution, tags…"
              autoComplete="off"
            />
          </div>
        </div>
        <div className="agency-tier-filters__footer" role="status" aria-live="polite">
          <span className="agency-tier-filters__count">
            <strong>{sortedRows.length}</strong>
            <span className="agency-tier-filters__count-of">
              {" "}
              of {allRows.length} tiers
            </span>
          </span>
          <span className="agency-tier-filters__hint">{rowSelectHint}</span>
          {hasFilters ? (
            <button type="button" className="agency-tier-filters__clear" onClick={clearFilters}>
              Clear filters
            </button>
          ) : null}
        </div>
      </div>

      <CatalogTierTable
        rows={sortedRows}
        totalVaultCount={allRows.length}
        sort={sort}
        onToggleSort={onToggleSort}
        onOpenTier={onOpenTier}
        showTaxonomyColumns
        emptyMessage={
          allRows.length === 0
            ? "No tiers loaded."
            : hasFilters || tableSearch.trim()
              ? "No tiers match your filters."
              : "No tiers to show."
        }
      />
    </div>
  );
}
