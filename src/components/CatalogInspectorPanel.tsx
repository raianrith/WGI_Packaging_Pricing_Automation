import { useEffect, useMemo, useState } from "react";
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

type TierViewMode = "list" | "compare";

function overviewTextForTier(tierId: string | null | undefined, tiers: SolutionTier[]): string | null {
  if (!tierId) return null;
  const match = tiers.find((t) => t.solution_tier_id === tierId);
  const text = match?.solution_tier_overview?.trim() || match?.solution_tier_what_is_it?.trim() || "";
  return text || null;
}

function isHourAddonRow(row: CatalogDirectoryRow): boolean {
  if ((row.priceNum ?? 0) > 0) return false;
  return /account management|continuous improvement/i.test(row.name);
}

function shortTierLabel(name: string): string {
  if (!name.includes(" - ")) return name;
  return name.slice(name.lastIndexOf(" - ") + 3).trim() || name;
}

function solutionIdForTier(
  row: CatalogDirectoryRow,
  tierId: string,
  tiers: SolutionTier[]
): string | null {
  if (row.solutionId) return row.solutionId;
  return tiers.find((t) => t.solution_tier_id === tierId)?.solution_id ?? null;
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
  const [tierView, setTierView] = useState<TierViewMode>("list");
  const [focusedTierId, setFocusedTierId] = useState<string | null>(null);

  useEffect(() => {
    setMenuOpen(false);
    setTierView("list");
    setFocusedTierId(null);
  }, [row?.id]);

  const tierLines = useMemo(() => {
    if (!row) return [];
    return (
      row.tierLines ??
      row.tierRows.map((tier) => ({
        key: tier.tierId,
        name: tier.tierName,
        priceDisplay: tier.priceDisplay,
        hoursDisplay: tier.hoursDisplay,
      }))
    );
  }, [row]);

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

  const peopleLabel =
    row.peopleCount === 0 ? "—" : row.peopleCount === 1 ? "1" : String(row.peopleCount);
  const mixed = row.taxableLabel === "Mixed";
  const canDelete = Boolean(row.packageId && onDeletePackage);
  const showTiers =
    tierLines.length > 1 ||
    (tierLines.length === 1 && tierLines[0]?.name.trim() !== row.name.trim());
  const canCompare = tierLines.length > 1;
  const overviewTierId = focusedTierId ?? tierLines[0]?.key ?? row.tierRows[0]?.tierId ?? null;
  const overview = overviewTextForTier(overviewTierId, tiers);
  const overviewIsFocused = Boolean(focusedTierId);

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
      {row.ownerLabel ? <p className="catalog-inspector__owner">{row.ownerLabel}</p> : null}

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
            <div className="catalog-inspector__section-head">
              <h3 className="catalog-inspector__section-title">Tiers</h3>
              {canCompare ? (
                <div className="catalog-inspector__view-toggle" role="group" aria-label="Tier view">
                  <button
                    type="button"
                    className={
                      tierView === "list"
                        ? "catalog-inspector__view-btn is-active"
                        : "catalog-inspector__view-btn"
                    }
                    aria-pressed={tierView === "list"}
                    onClick={() => setTierView("list")}
                  >
                    List
                  </button>
                  <button
                    type="button"
                    className={
                      tierView === "compare"
                        ? "catalog-inspector__view-btn is-active"
                        : "catalog-inspector__view-btn"
                    }
                    aria-pressed={tierView === "compare"}
                    onClick={() => setTierView("compare")}
                  >
                    Compare
                  </button>
                </div>
              ) : null}
            </div>

            {tierView === "compare" && canCompare ? (
              <div className="catalog-inspector__compare-wrap">
                <table className="catalog-inspector__compare">
                  <thead>
                    <tr>
                      <th scope="col">Tier</th>
                      <th scope="col">Price</th>
                      <th scope="col">Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tierLines.map((tier) => {
                      const solId = solutionIdForTier(row, tier.key, tiers);
                      const href = solId ? solutionOverviewPath(solId, tier.key) : null;
                      const isFocused = focusedTierId === tier.key;
                      const label = shortTierLabel(tier.name);
                      return (
                        <tr
                          key={tier.key}
                          className={isFocused ? "is-focused" : undefined}
                          onMouseEnter={() => setFocusedTierId(tier.key)}
                          onFocus={() => setFocusedTierId(tier.key)}
                        >
                          <th scope="row">
                            {href ? (
                              <EntityLink
                                className="catalog-inspector__tier-link"
                                to={href}
                                title={`Open overview · ${tier.name}`}
                              >
                                {label}
                              </EntityLink>
                            ) : (
                              <span title={tier.name}>{label}</span>
                            )}
                          </th>
                          <td>{tier.priceDisplay}</td>
                          <td>{tier.hoursDisplay}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="catalog-inspector__compare-hint">
                  Click a tier name to open its solution overview. Hover to preview overview below.
                </p>
              </div>
            ) : (
              <ul className="catalog-inspector__tiers">
                {tierLines.map((tier) => {
                  const solId = solutionIdForTier(row, tier.key, tiers);
                  const href = solId ? solutionOverviewPath(solId, tier.key) : null;
                  const isFocused = focusedTierId === tier.key;
                  return (
                    <li
                      key={tier.key}
                      className={isFocused ? "is-focused" : undefined}
                      onMouseEnter={() => setFocusedTierId(tier.key)}
                      onFocus={() => setFocusedTierId(tier.key)}
                    >
                      {href ? (
                        <EntityLink
                          className="catalog-inspector__tier-link"
                          to={href}
                          title={`Open overview · ${tier.name}`}
                        >
                          {tier.name}
                        </EntityLink>
                      ) : (
                        <span className="catalog-inspector__tier-name">{tier.name}</span>
                      )}
                      <span className="catalog-inspector__tier-meta">
                        {tier.priceDisplay} · {tier.hoursDisplay}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}

        {overview ? (
          <section className="catalog-inspector__section">
            <h3 className="catalog-inspector__section-title">
              Overview
              {overviewIsFocused && overviewTierId
                ? ` · ${shortTierLabel(
                    tierLines.find((t) => t.key === overviewTierId)?.name ?? "Tier"
                  )}`
                : null}
            </h3>
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
            to={solutionOverviewPath(row.solutionId, overviewTierId)}
          >
            Open solution overview
          </EntityLink>
        ) : null}
      </div>
    </aside>
  );
}
