import type { CatalogTierSortCol } from "./CatalogTierTable";
import { isCatalogSolutionType, type CatalogDirectoryRow, type CatalogDirectoryItemType } from "../lib/buildCatalogDirectoryRows";
import { EntityLink } from "./EntityLink";
import { hrefForCatalogDirectoryRow, solutionOverviewPath } from "../lib/entityLinks";

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
  /** When "add", tier rows add to a proposal instead of opening directory detail. */
  tierInteraction?: "open" | "add";
  onAddTier?: (solutionId: string, tierId: string) => void;
  addedTierRefIds?: ReadonlySet<string>;
  justAddedTierId?: string | null;
  canAdd?: boolean;
  selectedRowId?: string | null;
  onSelectRow?: (row: CatalogDirectoryRow) => void;
  showTaxonomyColumns?: boolean;
  showTypeColumn?: boolean;
  priceColumnLabel?: string;
};

const TYPE_SORT_RANK: Record<CatalogDirectoryItemType, number> = {
  solution_module: 0,
  configured_solution: 1,
  preset_package: 2,
  configurable_package: 3,
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
  if (type === "solution_module") {
    return "agency-catalog-directory__type-pill agency-catalog-directory__type-pill--module";
  }
  if (type === "configured_solution") {
    return "agency-catalog-directory__type-pill agency-catalog-directory__type-pill--solution";
  }
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
  tierInteraction = "open",
  onAddTier,
  addedTierRefIds,
  justAddedTierId,
  canAdd = true,
  selectedRowId = null,
  onSelectRow,
  showTaxonomyColumns = true,
  showTypeColumn = true,
  priceColumnLabel,
}: Props) {
  const addMode = tierInteraction === "add";
  const catalogSelect = Boolean(onSelectRow);
  const colCount =
    4 +
    (showTypeColumn ? 1 : 0) +
    (showTaxonomyColumns ? 4 : 0) +
    (addMode ? 1 : 0);

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
      <td className="agency-catalog-tier-sheet__cell--num agency-catalog-directory__cell--hours">{row.hoursDisplay}</td>
      <td className="agency-catalog-directory__cell--tax">
        {catalogSelect ? (
          <span
            className={`agency-catalog-directory__tax${row.taxableLabel === "Mixed" ? " is-mixed" : ""}`}
            title={
              row.taxableLabel === "Mixed"
                ? "Some items in this row are taxable and some are not."
                : undefined
            }
          >
            {row.taxableLabel === "—" ? "" : row.taxableLabel}
          </span>
        ) : (
          <span
            className={
              row.taxable
                ? "agency-catalog-tier-sheet__status-pill agency-catalog-tier-sheet__status-pill--taxable"
                : "agency-catalog-tier-sheet__status-pill"
            }
            title={
              row.taxableLabel === "Mixed"
                ? "Some items in this row are taxable and some are not."
                : undefined
            }
          >
            {row.taxableLabel}
          </span>
        )}
      </td>
      {showTaxonomyColumns ? (
        <td className="agency-catalog-tier-sheet__tags">
          {row.tagsRaw.trim() ? (
            <span className="agency-catalog-tier-sheet__tags-text">{row.tagsRaw}</span>
          ) : (
            <span className="agency-catalog-tier-sheet__dash">—</span>
          )}
        </td>
      ) : null}
    </>
  );

  const handleParentActivate = (row: CatalogDirectoryRow) => {
    if (onSelectRow) {
      onSelectRow(row);
      return;
    }
    if (isCatalogSolutionType(row.type) && row.solutionId) onToggleSolution(row.solutionId);
    else if (row.type === "preset_package" && row.packageId) onOpenPresetPackage(row.packageId);
    else if (row.type === "configurable_package" && row.packageBuilderTypeId) {
      onOpenConfigurablePackage(row.packageBuilderTypeId);
    }
  };

  return (
    <div className="agency-catalog-tier-sheet__scroll agency-catalog-directory__scroll">
      <table className="agency-catalog-tier-sheet__table agency-catalog-directory__table">
        <thead>
          <tr>
            <ThSort col="name" label="Name" />
            {showTypeColumn ? <ThSort col="type" label="Type" narrow={catalogSelect} /> : null}
            {showTaxonomyColumns ? (
              <>
                <ThSort col="phase" label="Phase" narrow />
                <ThSort col="category" label="Category" />
                <ThSort col="tactic" label="Tactic" />
              </>
            ) : null}
            <ThSort
              col="price"
              label={priceColumnLabel ?? (catalogSelect ? "Avg. price" : "Price")}
              narrow
            />
            <ThSort col="hours" label={showTaxonomyColumns ? "Hours" : "Hrs"} narrow />
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
            {showTaxonomyColumns ? <ThSort col="tags" label="Tags" /> : null}
            {addMode ? (
              <th scope="col" className="agency-catalog-directory__col--add">
                Add
              </th>
            ) : null}
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
              const isSolution = isCatalogSolutionType(row.type);
              const expanded =
                !catalogSelect && isSolution && row.solutionId != null && expandedSolutionIds.has(row.solutionId);
              const selected = selectedRowId === row.id;
              const rowHref = hrefForCatalogDirectoryRow(row);
              const parentRow = (
                <tr
                  key={row.id}
                  className={
                    `agency-catalog-directory__parent${selected ? " is-selected" : ""} ` +
                    (isSolution
                      ? `agency-catalog-directory__parent--solution${expanded ? " agency-catalog-directory__parent--expanded" : ""}`
                      : row.type === "preset_package"
                        ? "agency-catalog-directory__parent--preset"
                        : "agency-catalog-directory__parent--configurable")
                  }
                  role="button"
                  tabIndex={0}
                  aria-expanded={isSolution ? expanded : undefined}
                  onClick={() => handleParentActivate(row)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    handleParentActivate(row);
                  }}
                >
                  <td>
                    <div className="agency-catalog-directory__name-cell">
                      {catalogSelect ? null : isSolution ? (
                        <span
                          className={`agency-catalog-directory__chevron${expanded ? " agency-catalog-directory__chevron--open" : ""}`}
                          aria-hidden
                        >
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <path
                              d="M3.5 2 7 5l-3.5 3"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </span>
                      ) : (
                        <span className="agency-catalog-directory__chevron agency-catalog-directory__chevron--spacer" aria-hidden />
                      )}
                      <div className="agency-catalog-directory__name-copy">
                        {rowHref ? (
                          <EntityLink
                            to={rowHref}
                            className="agency-catalog-tier-sheet__tier-title"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {row.name}
                          </EntityLink>
                        ) : (
                          <span className="agency-catalog-tier-sheet__tier-title">{row.name}</span>
                        )}
                        {row.meta ? (
                          <span className="agency-catalog-directory__inline-meta">{row.meta}</span>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  {showTypeColumn ? (
                    <td className="agency-catalog-directory__cell--type">
                      {catalogSelect ? (
                        <span className="agency-catalog-directory__type">{row.typeLabel}</span>
                      ) : (
                        <span className={typePillClass(row.type)}>{row.typeLabel}</span>
                      )}
                    </td>
                  ) : null}
                  {showTaxonomyColumns ? renderTaxonomy(row.phaseRaw, row.categoryRaw, row.tacticRaw) : null}
                  {renderMetrics({
                    priceDisplay: row.priceDisplay,
                    hoursDisplay: row.hoursDisplay,
                    taxable: row.taxableSort === 2,
                    taxableLabel: row.taxableLabel,
                    tagsRaw: row.tagsRaw,
                  })}
                  {addMode ? (
                    <td className="agency-catalog-directory__cell--add">
                      {isSolution && row.tierRows.length === 1 && row.solutionId && onAddTier ? (
                        <button
                          type="button"
                          className={`agency-catalog-directory__add-btn${
                            addedTierRefIds?.has(row.tierRows[0]!.tierId) ? " is-again" : ""
                          }${justAddedTierId === row.tierRows[0]!.tierId ? " is-done" : ""}`}
                          disabled={!canAdd || row.type === "solution_module"}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!canAdd || row.type === "solution_module") return;
                            onAddTier(row.solutionId!, row.tierRows[0]!.tierId);
                          }}
                        >
                          {justAddedTierId === row.tierRows[0]!.tierId
                            ? "Added"
                            : addedTierRefIds?.has(row.tierRows[0]!.tierId)
                              ? "Add again"
                              : "Add"}
                        </button>
                      ) : isSolution && row.tierRows.length > 1 ? (
                        <button
                          type="button"
                          className="agency-catalog-directory__add-btn agency-catalog-directory__add-btn--tiers"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (row.solutionId) onToggleSolution(row.solutionId);
                          }}
                        >
                          {expanded ? "Hide tiers" : "Tiers ▾"}
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );

              if (!isSolution || !expanded) return [parentRow];

              const childRows = row.tierRows.map((tier) => {
                const onProposal = addedTierRefIds?.has(tier.tierId) ?? false;
                const justAdded = justAddedTierId === tier.tierId;
                const selectTier = () => {
                  if (addMode) {
                    if (!canAdd || !onAddTier || row.type === "solution_module") return;
                    onAddTier(tier.solutionId, tier.tierId);
                    return;
                  }
                  onOpenTier(tier.solutionId, tier.tierId);
                };
                return (
                  <tr
                    key={`${row.id}:${tier.tierId}`}
                    className={`agency-catalog-directory__child${onProposal ? " agency-catalog-directory__child--on-proposal" : ""}${justAdded ? " agency-catalog-directory__child--just-added" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      selectTier();
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      selectTier();
                    }}
                  >
                    <td>
                      <div className="agency-catalog-directory__name-cell agency-catalog-directory__name-cell--child">
                        <span className="agency-catalog-directory__child-bar" aria-hidden />
                        <div>
                          <EntityLink
                            to={solutionOverviewPath(tier.solutionId, tier.tierId)}
                            className="agency-catalog-tier-sheet__tier-title"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {tier.tierName}
                          </EntityLink>
                          <div className="agency-catalog-tier-sheet__submeta">
                            <span className="agency-catalog-tier-sheet__sol-name">Solution tier</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    {showTypeColumn ? (
                      <td>
                        <span className="agency-catalog-directory__type-pill agency-catalog-directory__type-pill--tier">
                          Tier
                        </span>
                      </td>
                    ) : null}
                    {showTaxonomyColumns ? renderTaxonomy(tier.phaseRaw, tier.categoryRaw, tier.tacticRaw) : null}
                    {renderMetrics({
                      priceDisplay: tier.priceDisplay,
                      hoursDisplay: tier.hoursDisplay,
                      taxable: tier.taxable,
                      taxableLabel: tier.taxableLabel,
                      tagsRaw: tier.tagsRaw,
                    })}
                    {addMode ? (
                      <td className="agency-catalog-directory__cell--add">
                        <button
                          type="button"
                          className={`agency-catalog-directory__add-btn${justAdded ? " is-done" : ""}${onProposal && !justAdded ? " is-again" : ""}`}
                          disabled={!canAdd || row.type === "solution_module"}
                          onClick={(e) => {
                            e.stopPropagation();
                            selectTier();
                          }}
                        >
                          {justAdded ? "Added" : onProposal ? "Add again" : "Add"}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              });

              return [parentRow, ...childRows];
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

export { TYPE_SORT_RANK };
