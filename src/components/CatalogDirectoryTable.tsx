import type { CatalogTierSortCol } from "./CatalogTierTable";
import type { CatalogDirectoryRow, CatalogDirectoryItemType } from "../lib/buildCatalogDirectoryRows";

export type CatalogDirectorySortCol = CatalogTierSortCol | "type" | "name";

type Props = {
  rows: CatalogDirectoryRow[];
  expandedSolutionIds: ReadonlySet<string>;
  onToggleSolution: (solutionId: string) => void;
  sort: { col: CatalogDirectorySortCol; dir: "asc" | "desc" };
  onToggleSort: (col: CatalogDirectorySortCol) => void;
  onOpenTier: (solutionId: string, tierId: string) => void;
  onOpenPresetPackage: (packageId: string) => void;
  onOpenConfigurablePackage: (packageBuilderTypeId: string) => void;
  emptyMessage?: string;
};

const TYPE_SORT_RANK: Record<CatalogDirectoryItemType, number> = {
  solution: 0,
  preset_package: 1,
  configurable_package: 2,
};

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  return (
    <span className={`agency-catalog-directory__sort-icon${active ? " agency-catalog-directory__sort-icon--active" : ""}`} aria-hidden>
      <svg width="10" height="12" viewBox="0 0 10 12" fill="none">
        <path
          d="M5 1.5 8.5 5H1.5L5 1.5Z"
          fill="currentColor"
          className={active && dir === "asc" ? "agency-catalog-directory__sort-caret--lit" : undefined}
          opacity={active && dir === "asc" ? 1 : 0.28}
        />
        <path
          d="M5 10.5 1.5 7h7L5 10.5Z"
          fill="currentColor"
          className={active && dir === "desc" ? "agency-catalog-directory__sort-caret--lit" : undefined}
          opacity={active && dir === "desc" ? 1 : 0.28}
        />
      </svg>
    </span>
  );
}

function typePillClass(type: CatalogDirectoryItemType): string {
  if (type === "solution") return "agency-catalog-directory__type-pill agency-catalog-directory__type-pill--solution";
  if (type === "preset_package") return "agency-catalog-directory__type-pill agency-catalog-directory__type-pill--preset";
  return "agency-catalog-directory__type-pill agency-catalog-directory__type-pill--configurable";
}

export function CatalogDirectoryTable({
  rows,
  expandedSolutionIds,
  onToggleSolution,
  sort,
  onToggleSort,
  onOpenTier,
  onOpenPresetPackage,
  onOpenConfigurablePackage,
  emptyMessage,
}: Props) {
  const colCount = 9;

  const ThSort = ({
    col,
    label,
    narrow,
  }: {
    col: CatalogDirectorySortCol;
    label: string;
    narrow?: boolean;
  }) => (
    <th scope="col" className={narrow ? "agency-catalog-tier-sheet__col--narrow" : undefined}>
      <button
        type="button"
        className="agency-catalog-tier-sheet__th-btn agency-catalog-directory__th-btn"
        onClick={() => onToggleSort(col)}
        aria-sort={sort.col === col ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      >
        {label}
        <SortIcon active={sort.col === col} dir={sort.dir} />
      </button>
    </th>
  );

  const renderTaxonomy = (phaseRaw: string, categoryRaw: string, tacticRaw: string) => (
    <>
      <td>
        {phaseRaw ? (
          <span className="agency-catalog-tier-sheet__category-pill agency-catalog-tier-sheet__category-pill--phase">
            {phaseRaw}
          </span>
        ) : (
          <span className="agency-catalog-tier-sheet__dash">—</span>
        )}
      </td>
      <td>
        {categoryRaw ? (
          <span className="agency-catalog-tier-sheet__category-pill">{categoryRaw}</span>
        ) : (
          <span className="agency-catalog-tier-sheet__dash">—</span>
        )}
      </td>
      <td>
        {tacticRaw ? (
          <span className="agency-catalog-tier-sheet__category-pill agency-catalog-tier-sheet__category-pill--tactic">
            {tacticRaw}
          </span>
        ) : (
          <span className="agency-catalog-tier-sheet__dash">—</span>
        )}
      </td>
    </>
  );

  const renderMetrics = (row: {
    priceDisplay: string;
    hoursDisplay: string;
    taxable: boolean;
    taxableLabel: string;
    tagsRaw: string;
  }) => (
    <>
      <td className="agency-catalog-tier-sheet__cell--num agency-catalog-directory__cell--price">{row.priceDisplay}</td>
      <td className="agency-catalog-tier-sheet__cell--num">{row.hoursDisplay}</td>
      <td>
        <span
          className={
            row.taxable
              ? "agency-catalog-tier-sheet__status-pill agency-catalog-tier-sheet__status-pill--taxable"
              : "agency-catalog-tier-sheet__status-pill"
          }
        >
          {row.taxableLabel}
        </span>
      </td>
      <td className="agency-catalog-tier-sheet__tags">
        {row.tagsRaw.trim() ? (
          <span className="agency-catalog-tier-sheet__tags-text">{row.tagsRaw}</span>
        ) : (
          <span className="agency-catalog-tier-sheet__dash">—</span>
        )}
      </td>
    </>
  );

  return (
    <div className="agency-catalog-tier-sheet__scroll agency-catalog-directory__scroll">
      <table className="agency-catalog-tier-sheet__table agency-catalog-directory__table">
        <thead>
          <tr>
            <ThSort col="name" label="Name" />
            <ThSort col="type" label="Type" narrow />
            <ThSort col="phase" label="Phase" narrow />
            <ThSort col="category" label="Category" />
            <ThSort col="tactic" label="Tactic" />
            <ThSort col="price" label="Price" narrow />
            <ThSort col="hours" label="Hours" narrow />
            <th scope="col" className="agency-catalog-tier-sheet__col--tax">
              <button
                type="button"
                className="agency-catalog-tier-sheet__th-btn agency-catalog-directory__th-btn"
                onClick={() => onToggleSort("taxable")}
                aria-sort={sort.col === "taxable" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
              >
                Taxable
                <SortIcon active={sort.col === "taxable"} dir={sort.dir} />
              </button>
            </th>
            <ThSort col="tags" label="Tags" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={colCount} className="agency-catalog-tier-sheet__empty">
                {emptyMessage ?? "No items match your filters."}
              </td>
            </tr>
          ) : (
            rows.flatMap((row) => {
              const isSolution = row.type === "solution";
              const expanded = isSolution && row.solutionId != null && expandedSolutionIds.has(row.solutionId);
              const parentRow = (
                <tr
                  key={row.id}
                  className={
                    isSolution
                      ? `agency-catalog-directory__parent agency-catalog-directory__parent--solution${expanded ? " agency-catalog-directory__parent--expanded" : ""}`
                      : row.type === "preset_package"
                        ? "agency-catalog-directory__parent agency-catalog-directory__parent--preset"
                        : "agency-catalog-directory__parent agency-catalog-directory__parent--configurable"
                  }
                  role="button"
                  tabIndex={0}
                  aria-expanded={isSolution ? expanded : undefined}
                  onClick={() => {
                    if (isSolution && row.solutionId) onToggleSolution(row.solutionId);
                    else if (row.type === "preset_package" && row.packageId) onOpenPresetPackage(row.packageId);
                    else if (row.type === "configurable_package" && row.packageBuilderTypeId) {
                      onOpenConfigurablePackage(row.packageBuilderTypeId);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    if (isSolution && row.solutionId) onToggleSolution(row.solutionId);
                    else if (row.type === "preset_package" && row.packageId) onOpenPresetPackage(row.packageId);
                    else if (row.type === "configurable_package" && row.packageBuilderTypeId) {
                      onOpenConfigurablePackage(row.packageBuilderTypeId);
                    }
                  }}
                >
                  <td>
                    <div className="agency-catalog-directory__name-cell">
                      {isSolution ? (
                        <span
                          className={`agency-catalog-directory__chevron${expanded ? " agency-catalog-directory__chevron--open" : ""}`}
                          aria-hidden
                        >
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <path d="M3.5 2 7 5l-3.5 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </span>
                      ) : (
                        <span className="agency-catalog-directory__chevron agency-catalog-directory__chevron--spacer" aria-hidden />
                      )}
                      <div>
                        <div className="agency-catalog-tier-sheet__tier-title">{row.name}</div>
                        <div className="agency-catalog-tier-sheet__submeta">
                          <span className="agency-catalog-tier-sheet__sol-name">{row.meta}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={typePillClass(row.type)}>{row.typeLabel}</span>
                  </td>
                  {renderTaxonomy(row.phaseRaw, row.categoryRaw, row.tacticRaw)}
                  {renderMetrics({
                    priceDisplay: row.priceDisplay,
                    hoursDisplay: row.hoursDisplay,
                    taxable: row.taxableSort === 2,
                    taxableLabel: row.taxableLabel,
                    tagsRaw: row.tagsRaw,
                  })}
                </tr>
              );

              if (!isSolution || !expanded) return [parentRow];

              const childRows = row.tierRows.map((tier) => (
                <tr
                  key={`${row.id}:${tier.tierId}`}
                  className="agency-catalog-directory__child"
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenTier(tier.solutionId, tier.tierId);
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    onOpenTier(tier.solutionId, tier.tierId);
                  }}
                >
                  <td>
                    <div className="agency-catalog-directory__name-cell agency-catalog-directory__name-cell--child">
                      <span className="agency-catalog-directory__child-bar" aria-hidden />
                      <div>
                        <div className="agency-catalog-tier-sheet__tier-title">{tier.tierName}</div>
                        <div className="agency-catalog-tier-sheet__submeta">
                          <span className="agency-catalog-tier-sheet__sol-name">Solution tier</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="agency-catalog-directory__type-pill agency-catalog-directory__type-pill--tier">
                      Tier
                    </span>
                  </td>
                  {renderTaxonomy(tier.phaseRaw, tier.categoryRaw, tier.tacticRaw)}
                  {renderMetrics({
                    priceDisplay: tier.priceDisplay,
                    hoursDisplay: tier.hoursDisplay,
                    taxable: tier.taxable,
                    taxableLabel: tier.taxableLabel,
                    tagsRaw: tier.tagsRaw,
                  })}
                </tr>
              ));

              return [parentRow, ...childRows];
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

export { TYPE_SORT_RANK };
