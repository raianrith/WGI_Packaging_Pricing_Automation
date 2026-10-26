import { useEffect, useState } from "react";
import { EntityLink } from "./EntityLink";
import { packageOverviewPath, solutionOverviewPath } from "../lib/entityLinks";
import type { CatalogDirectoryRow } from "../lib/buildCatalogDirectoryRows";
import { isCatalogSolutionType } from "../lib/buildCatalogDirectoryRows";
import type { SolutionTier } from "../types";

type Props = {
  row: CatalogDirectoryRow | null;
  tiers: SolutionTier[];
  onClose: () => void;
  onOpenPackage: (packageId: string) => void;
  onEditPackage: (packageId: string) => void;
  onOpenTemplate: (packageBuilderTypeId: string) => void;
  onOpenSolution?: (solutionId: string, tierId: string | null) => void;
  onDeletePackage?: (packageId: string, packageName: string) => void;
};

function overviewFor(row: CatalogDirectoryRow, tiers: SolutionTier[]): string | null {
  const firstId = row.tierRows[0]?.tierId;
  const match = firstId ? tiers.find((t) => t.solution_tier_id === firstId) : null;
  const text = match?.solution_tier_overview?.trim() || match?.solution_tier_what_is_it?.trim() || "";
  return text || null;
}

function isHourAddonRow(row: CatalogDirectoryRow): boolean {
  if ((row.priceNum ?? 0) > 0) return false;
  return /account management|continuous improvement/i.test(row.name);
}

export function CatalogInspectorPanel({
  row,
  tiers,
  onClose,
  onEditPackage,
  onOpenTemplate,
  onDeletePackage,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [row?.id]);

  if (!row) {
    return (
      <aside className="catalog-inspector is-empty" aria-label="Catalog details">
        <p className="catalog-inspector__empty">
          Select a row
          <span>Price, owner, and overview show up here.</span>
        </p>
      </aside>
    );
  }

  const overview = overviewFor(row, tiers);
  const peopleLabel =
    row.peopleCount === 0 ? "—" : row.peopleCount === 1 ? "1" : String(row.peopleCount);
  const mixed = row.taxableLabel === "Mixed";
  const canDelete = Boolean(row.packageId && onDeletePackage);
  const tierLines =
    row.tierLines ??
    row.tierRows.map((tier) => ({
      key: tier.tierId,
      name: tier.tierName,
      priceDisplay: tier.priceDisplay,
      hoursDisplay: tier.hoursDisplay,
    }));
  const showTiers =
    tierLines.length > 1 ||
    (tierLines.length === 1 && tierLines[0]?.name.trim() !== row.name.trim());

  return (
    <aside className="catalog-inspector" aria-label={`${row.name} details`}>
      <header className="catalog-inspector__head">
        <p className="catalog-inspector__type">{row.typeLabel}</p>
        <div className="catalog-inspector__head-actions">
          {canDelete ? (
            <div className="catalog-inspector__menu">
              <button
                type="button"
                className="catalog-inspector__menu-btn"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
              >
                More
              </button>
              {menuOpen ? (
                <div className="catalog-inspector__menu-list" role="menu">
                  <button
                    type="button"
                    className="catalog-inspector__menu-item catalog-inspector__menu-item--danger"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onDeletePackage?.(row.packageId!, row.name);
                    }}
                  >
                    Delete
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          <button type="button" className="catalog-inspector__close" onClick={onClose} aria-label="Close details">
            ×
          </button>
        </div>
      </header>

      <h2 className="catalog-inspector__title">{row.name}</h2>
      {row.ownerLabel ? (
        <p className="catalog-inspector__owner">
          {row.ownerLabel}
        </p>
      ) : null}

      <dl className="catalog-inspector__stats">
        <div>
          <dt>
            {isCatalogSolutionType(row.type)
              ? "Avg. price"
              : row.type === "preset_package"
                ? "Discounted sell price"
                : "Price"}
          </dt>
          <dd>{row.priceDisplay}</dd>
        </div>
        <div>
          <dt>Hours</dt>
          <dd>{row.hoursDisplay}</dd>
        </div>
        <div>
          <dt>People</dt>
          <dd>{peopleLabel}</dd>
        </div>
      </dl>

      {row.taxableLabel && row.taxableLabel !== "—" ? (
        <p className="catalog-inspector__tax">
          {row.taxableLabel}
          {mixed ? (
            <span title="Some items in this row are taxable and some are not."> · mixed items</span>
          ) : null}
        </p>
      ) : null}

      {isHourAddonRow(row) ? (
        <p className="catalog-inspector__note">
          Hour add-on priced into other work (18% of delivery hours), not a standalone sell price.
        </p>
      ) : null}

      <div className="catalog-inspector__body">
        {showTiers ? (
          <section className="catalog-inspector__section">
            <h3 className="catalog-inspector__section-title">Tiers</h3>
            <ul className="catalog-inspector__tiers">
              {tierLines.map((tier) => (
                <li key={tier.key}>
                  <span className="catalog-inspector__tier-name">{tier.name}</span>
                  <span className="catalog-inspector__tier-meta">
                    {tier.priceDisplay} · {tier.hoursDisplay}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {overview ? (
          <section className="catalog-inspector__section">
            <h3 className="catalog-inspector__section-title">Overview</h3>
            <p className="catalog-inspector__overview">{overview}</p>
          </section>
        ) : null}
      </div>

      <div className="catalog-inspector__actions">
        {row.packageId ? (
          <>
            <EntityLink
              className="catalog-inspector__btn catalog-inspector__btn--primary"
              to={packageOverviewPath(row.packageId)}
            >
              Open package
            </EntityLink>
            <button type="button" className="catalog-inspector__btn" onClick={() => onEditPackage(row.packageId!)}>
              Edit in builder
            </button>
          </>
        ) : null}
        {row.packageBuilderTypeId ? (
          <button
            type="button"
            className="catalog-inspector__btn catalog-inspector__btn--primary"
            onClick={() => onOpenTemplate(row.packageBuilderTypeId!)}
          >
            Edit in builder
          </button>
        ) : null}
        {isCatalogSolutionType(row.type) && row.solutionId ? (
          <EntityLink
            className="catalog-inspector__btn catalog-inspector__btn--primary"
            to={solutionOverviewPath(row.solutionId, row.tierRows[0]?.tierId ?? null)}
          >
            Open solution overview
          </EntityLink>
        ) : null}
      </div>
    </aside>
  );
}
