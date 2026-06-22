import { useId, type ReactNode } from "react";

export type CatalogTierTableRow = {
  tierId: string;
  solutionId: string;
  pname: string;
  tierName: string;
  solutionName: string;
  phaseRaw: string;
  categoryRaw: string;
  tacticRaw: string;
  priceNum: number | null;
  priceDisplay: string;
  hoursNum: number | null;
  hoursDisplay: string;
  taxable: boolean;
  taxableSort: number;
  taxableLabel: string;
  tagsRaw: string;
};

export type CatalogTierSortCol =
  | "tier"
  | "phase"
  | "category"
  | "tactic"
  | "price"
  | "hours"
  | "taxable"
  | "tags";

type Props = {
  rows: CatalogTierTableRow[];
  totalVaultCount: number;
  sort: { col: CatalogTierSortCol; dir: "asc" | "desc" };
  onToggleSort: (col: CatalogTierSortCol) => void;
  onOpenTier: (solutionId: string, tierId: string) => void;
  searchQuery?: string;
  onSearchQueryChange?: (q: string) => void;
  searchPlaceholder?: string;
  hint?: string;
  emptyMessage?: string;
  showTaxonomyColumns?: boolean;
  toolbarExtra?: ReactNode;
};

export function CatalogTierTable({
  rows,
  totalVaultCount,
  sort,
  onToggleSort,
  onOpenTier,
  searchQuery,
  onSearchQueryChange,
  searchPlaceholder = "Tier, solution, package, tags…",
  hint = "Rows use vault pricing. Select a row to switch to tier detail view.",
  emptyMessage,
  showTaxonomyColumns = false,
  toolbarExtra,
}: Props) {
  const searchId = useId();
  const colCount = showTaxonomyColumns ? 8 : 6;

  const ThSort = ({ col, label, narrow }: { col: CatalogTierSortCol; label: string; narrow?: boolean }) => (
    <th scope="col" className={narrow ? "agency-catalog-tier-sheet__col--narrow" : undefined}>
      <button
        type="button"
        className="agency-catalog-tier-sheet__th-btn"
        onClick={() => onToggleSort(col)}
        aria-sort={sort.col === col ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      >
        {label}
        <span className="agency-catalog-tier-sheet__sort" aria-hidden>
          {sort.col === col ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
        </span>
      </button>
    </th>
  );

  return (
    <section className="agency-catalog-tier-sheet" aria-label="Solution tiers table">
      <div className="agency-catalog-tier-sheet__toolbar">
        {toolbarExtra}
        {onSearchQueryChange != null && searchQuery != null ? (
          <>
            <label className="agency-catalog-tier-sheet__filter-label" htmlFor={searchId}>
              Filter table
            </label>
            <div className="agency-catalog-tier-sheet__filter-row">
              <input
                id={searchId}
                type="search"
                className="agency-catalog-tier-sheet__filter-input"
                value={searchQuery}
                onChange={(e) => onSearchQueryChange(e.target.value)}
                placeholder={searchPlaceholder}
                autoComplete="off"
              />
              {searchQuery.trim() ? (
                <button
                  type="button"
                  className="agency-catalog-tier-sheet__clear"
                  onClick={() => onSearchQueryChange("")}
                >
                  Clear
                </button>
              ) : null}
            </div>
          </>
        ) : null}
        {hint ? <p className="agency-catalog-tier-sheet__hint">{hint}</p> : null}
      </div>
      <div className="agency-catalog-tier-sheet__scroll">
        <table className="agency-catalog-tier-sheet__table">
          <thead>
            <tr>
              <ThSort col="tier" label="Solution tier" />
              {showTaxonomyColumns ? (
                <>
                  <ThSort col="phase" label="Phase" narrow />
                  <ThSort col="category" label="Category" />
                  <ThSort col="tactic" label="Tactic" />
                </>
              ) : (
                <ThSort col="category" label="Category" />
              )}
              <ThSort col="price" label="Price" narrow />
              <ThSort col="hours" label="Hours" narrow />
              <th scope="col" className="agency-catalog-tier-sheet__col--tax">
                <button
                  type="button"
                  className="agency-catalog-tier-sheet__th-btn"
                  onClick={() => onToggleSort("taxable")}
                  aria-sort={
                    sort.col === "taxable" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
                  }
                >
                  Taxable
                  <span className="agency-catalog-tier-sheet__sort" aria-hidden>
                    {sort.col === "taxable" ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                  </span>
                </button>
              </th>
              <ThSort col="tags" label="Tags" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="agency-catalog-tier-sheet__empty">
                  {emptyMessage ??
                    (totalVaultCount === 0 ? "No tiers loaded." : "No tiers match your filters.")}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.tierId}
                  className="agency-catalog-tier-sheet__data-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenTier(r.solutionId, r.tierId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpenTier(r.solutionId, r.tierId);
                    }
                  }}
                  title={`${r.tierName} · ${r.solutionName}`}
                >
                  <td>
                    <div className="agency-catalog-tier-sheet__tier-title">{r.tierName}</div>
                    <div className="agency-catalog-tier-sheet__submeta">
                      <span className="agency-catalog-tier-sheet__sol-name">{r.solutionName}</span>
                    </div>
                  </td>
                  {showTaxonomyColumns ? (
                    <>
                      <td>
                        {r.phaseRaw ? (
                          <span className="agency-catalog-tier-sheet__category-pill agency-catalog-tier-sheet__category-pill--phase">
                            {r.phaseRaw}
                          </span>
                        ) : (
                          <span className="agency-catalog-tier-sheet__dash">—</span>
                        )}
                      </td>
                      <td>
                        {r.categoryRaw ? (
                          <span className="agency-catalog-tier-sheet__category-pill">{r.categoryRaw}</span>
                        ) : (
                          <span className="agency-catalog-tier-sheet__dash">—</span>
                        )}
                      </td>
                      <td>
                        {r.tacticRaw ? (
                          <span className="agency-catalog-tier-sheet__category-pill agency-catalog-tier-sheet__category-pill--tactic">
                            {r.tacticRaw}
                          </span>
                        ) : (
                          <span className="agency-catalog-tier-sheet__dash">—</span>
                        )}
                      </td>
                    </>
                  ) : (
                    <td>
                      {r.categoryRaw ? (
                        <span className="agency-catalog-tier-sheet__category-pill">{r.categoryRaw}</span>
                      ) : (
                        <span className="agency-catalog-tier-sheet__dash">—</span>
                      )}
                    </td>
                  )}
                  <td className="agency-catalog-tier-sheet__cell--num">{r.priceDisplay}</td>
                  <td className="agency-catalog-tier-sheet__cell--num">{r.hoursDisplay}</td>
                  <td>
                    <span
                      className={
                        r.taxable
                          ? "agency-catalog-tier-sheet__status-pill agency-catalog-tier-sheet__status-pill--taxable"
                          : "agency-catalog-tier-sheet__status-pill"
                      }
                    >
                      {r.taxableLabel}
                    </span>
                  </td>
                  <td className="agency-catalog-tier-sheet__tags">
                    {r.tagsRaw.trim() ? (
                      <span className="agency-catalog-tier-sheet__tags-text">{r.tagsRaw}</span>
                    ) : (
                      <span className="agency-catalog-tier-sheet__dash">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
