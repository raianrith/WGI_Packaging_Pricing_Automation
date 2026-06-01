import type { ReactNode } from "react";

export type CatalogLineKind = "tier" | "package";

type Props = {
  kind: CatalogLineKind;
  title: string;
  detail: string;
  hours: string;
  price: string;
  onProposal: boolean;
  justAdded: boolean;
  canAdd: boolean;
  onAdd: () => void;
};

function kindLabel(kind: CatalogLineKind): string {
  return kind === "package" ? "Package" : "Tier";
}

function statValue(raw: string): string {
  const t = raw.trim();
  return t && t !== "—" ? t : "—";
}

export function ProposalCatalogLineRow({
  kind,
  title,
  detail,
  hours,
  price,
  onProposal,
  justAdded,
  canAdd,
  onAdd,
}: Props) {
  const addLabel = justAdded ? "Added" : onProposal ? "Add again" : "Add";

  return (
    <li
      className={`proposal-catalog-line${onProposal ? " proposal-catalog-line--on-proposal" : ""}${justAdded ? " proposal-catalog-line--just-added" : ""}`}
    >
      <span className={`proposal-catalog-line__kind proposal-catalog-line__kind--${kind}`}>
        {kindLabel(kind)}
      </span>

      <div className="proposal-catalog-line__copy">
        <strong className="proposal-catalog-line__title">{title}</strong>
        {detail.trim() ? <span className="proposal-catalog-line__detail">{detail}</span> : null}
      </div>

      <div className="proposal-catalog-line__stats" aria-label="Hours and price">
        <span className="proposal-catalog-line__stat">
          <span className="proposal-catalog-line__stat-label">Hours</span>
          <span className="proposal-catalog-line__stat-value">{statValue(hours)}</span>
        </span>
        <span className="proposal-catalog-line__stat proposal-catalog-line__stat--price">
          <span className="proposal-catalog-line__stat-label">Price</span>
          <span className="proposal-catalog-line__stat-value">{statValue(price)}</span>
        </span>
      </div>

      {onProposal ? <span className="proposal-catalog-line__badge">On proposal</span> : null}

      <button
        type="button"
        className={`proposal-catalog-line__add${justAdded ? " proposal-catalog-line__add--done" : ""}`}
        disabled={!canAdd}
        onClick={onAdd}
      >
        {justAdded ? (
          <>
            <span className="proposal-catalog-line__add-icon" aria-hidden>
              ✓
            </span>
            {addLabel}
          </>
        ) : (
          addLabel
        )}
      </button>
    </li>
  );
}

export function ProposalCatalogListSearch({
  id,
  value,
  onChange,
  placeholder,
  label,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <label className="proposal-catalog-list-search" htmlFor={id}>
      <svg className="proposal-catalog-list-search__icon" viewBox="0 0 20 20" fill="none" aria-hidden>
        <circle cx="9" cy="9" r="5.75" stroke="currentColor" strokeWidth="1.6" />
        <path d="M13.5 13.5 17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <input
        id={id}
        className="proposal-catalog-list-search__input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
      />
    </label>
  );
}

export function ProposalCatalogLinesPanel({
  children,
  count,
  emptyTitle,
  emptyText,
  isEmpty,
}: {
  children: ReactNode;
  count: number;
  emptyTitle?: string;
  emptyText?: string;
  isEmpty: boolean;
}) {
  return (
    <div className="proposal-catalog-lines">
      <div className="proposal-catalog-lines__head">
        <span className="proposal-catalog-lines__count">
          <strong>{count}</strong> {count === 1 ? "item" : "items"}
        </span>
      </div>
      {isEmpty && emptyTitle ? (
        <div className="proposal-catalog-lines__empty">
          <p className="proposal-catalog-lines__empty-title">{emptyTitle}</p>
          {emptyText ? <p className="proposal-catalog-lines__empty-text">{emptyText}</p> : null}
        </div>
      ) : (
        <ul className="proposal-catalog-lines__list">{children}</ul>
      )}
    </div>
  );
}
