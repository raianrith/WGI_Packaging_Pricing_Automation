import { useCallback, useId, useMemo, useState, type ReactNode } from "react";
import type {
  Package,
  PackageBuilderPackageType,
  PackageBuilderSlotTemplate,
  Solution,
  SolutionTier,
  SolutionTierPricing,
  TaskRow,
} from "../../types";
import { slotsForPackageType } from "../../lib/packageBuilderSlots";
import { PackageBuilderFamilyDetail } from "../PackageBuilderFamilyDetail";
import { PackageBuildWizard } from "../PackageBuildWizard";
import { ProposalCatalogListSearch } from "./ProposalCatalogLineRow";

type Props = {
  packageTypes: PackageBuilderPackageType[];
  slots: PackageBuilderSlotTemplate[];
  packages: Package[];
  solutions: Solution[];
  tiers: SolutionTier[];
  tasks: TaskRow[];
  pricing: SolutionTierPricing[];
  canBuild: boolean;
  catalogReloading?: boolean;
  onReloadCatalog?: () => Promise<void>;
  /** Fires once the wizard saves the new package. */
  onPackageBuilt: (pkg: Package) => void;
  prompt?: string;
  hint?: ReactNode;
  buildLabel?: string;
  wizardTitle?: string;
};

/** Configurable-template grid + build wizard shared by "Build new" and Playbook Package flows. */
export function ProposalPackageTemplatePicker({
  packageTypes,
  slots,
  packages,
  solutions,
  tiers,
  tasks,
  pricing,
  canBuild,
  catalogReloading,
  onReloadCatalog,
  onPackageBuilt,
  prompt = "Pick A Template",
  hint,
  buildLabel = "Build & add",
  wizardTitle = "Build & add package",
}: Props) {
  const searchId = useId();
  const [search, setSearch] = useState("");
  const [launchPackageTypeId, setLaunchPackageTypeId] = useState<string | null>(null);
  const [detailTypeId, setDetailTypeId] = useState<string | null>(null);

  const searchLower = search.trim().toLowerCase();
  const filteredTypes = useMemo(() => {
    if (!searchLower) return packageTypes;
    return packageTypes.filter((pt) => pt.name.toLowerCase().includes(searchLower));
  }, [packageTypes, searchLower]);

  const detailType = useMemo(
    () => (detailTypeId ? packageTypes.find((t) => t.id === detailTypeId) ?? null : null),
    [detailTypeId, packageTypes]
  );

  const detailSlots = useMemo(
    () => (detailType ? slotsForPackageType(slots, detailType.id) : []),
    [detailType, slots]
  );

  const closeFamilyDetail = useCallback(() => setDetailTypeId(null), []);

  const startBuild = (typeId: string) => {
    if (!canBuild) return;
    setLaunchPackageTypeId(typeId);
  };

  const handlePackageCreated = useCallback(
    (_packageId: string, createdPackage?: Package) => {
      if (!createdPackage || !canBuild) return;
      onPackageBuilt(createdPackage);
    },
    [canBuild, onPackageBuilt]
  );

  return (
    <>
      <div className="proposal-catalog-offerings">
        <div className="proposal-configurable-packages__head">
          <div>
            <p className="proposal-catalog-step-prompt">{prompt}</p>
            {hint ? <p className="proposal-catalog-offerings__hint">{hint}</p> : null}
          </div>
          {onReloadCatalog ? (
            <button
              type="button"
              className="proposal-catalog-mode-link"
              onClick={() => void onReloadCatalog()}
              disabled={catalogReloading}
            >
              {catalogReloading ? "Refreshing…" : "Refresh solutions"}
            </button>
          ) : null}
        </div>

        <ProposalCatalogListSearch
          id={searchId}
          value={search}
          onChange={setSearch}
          placeholder="Search templates…"
          label="Search templates"
        />

        {packageTypes.length === 0 ? (
          <p className="proposal-configurable-packages__empty">
            No configurable templates are set up yet. Add them in Admin → Configurable Package.
          </p>
        ) : filteredTypes.length === 0 ? (
          <p className="proposal-configurable-packages__empty">No templates match your search.</p>
        ) : (
          <ul className="proposal-catalog-lines proposal-configurable-packages__list">
            {filteredTypes.map((pt) => {
              const typeSlots = slotsForPackageType(slots, pt.id);
              let hoursCap = 0;
              let priceCap = 0;
              let hasHours = false;
              let hasPrice = false;
              for (const slot of typeSlots) {
                if (slot.hour_ceiling != null) {
                  hoursCap += slot.hour_ceiling;
                  hasHours = true;
                }
                if (slot.price_ceiling != null) {
                  priceCap += slot.price_ceiling;
                  hasPrice = true;
                }
              }
              const hours = hasHours ? `${hoursCap} h` : "—";
              const price = hasPrice
                ? new Intl.NumberFormat("en-US", {
                    style: "currency",
                    currency: "USD",
                    maximumFractionDigits: 0,
                  }).format(priceCap)
                : "Configure";
              return (
                <li key={pt.id} className="proposal-catalog-line">
                  <span className="proposal-catalog-line__kind proposal-catalog-line__kind--package">
                    Template
                  </span>
                  <div className="proposal-catalog-line__copy">
                    <strong className="proposal-catalog-line__title">{pt.name}</strong>
                    {pt.card_description?.trim() ? (
                      <span className="proposal-catalog-line__detail">{pt.card_description.trim()}</span>
                    ) : null}
                  </div>
                  <div className="proposal-catalog-line__stats" aria-label="Hours and price">
                    <span className="proposal-catalog-line__stat">
                      <span className="proposal-catalog-line__stat-label">Hours</span>
                      <span className="proposal-catalog-line__stat-value">{hours}</span>
                    </span>
                    <span className="proposal-catalog-line__stat proposal-catalog-line__stat--price">
                      <span className="proposal-catalog-line__stat-label">Price</span>
                      <span className="proposal-catalog-line__stat-value">{price}</span>
                    </span>
                  </div>
                  <button
                    type="button"
                    className="proposal-catalog-line__add proposal-catalog-line__add--ghost"
                    onClick={() => setDetailTypeId(pt.id)}
                  >
                    Detail
                  </button>
                  <button
                    type="button"
                    className="proposal-catalog-line__add"
                    disabled={!canBuild}
                    onClick={() => startBuild(pt.id)}
                  >
                    {buildLabel}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {detailType ? (
        <div className="pkg-family-detail-overlay" role="presentation" onClick={closeFamilyDetail}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="proposal-pkg-family-detail-title"
            className="pkg-family-detail-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="pkg-family-detail-modal__header">
              <div className="pkg-family-detail-modal__head-copy">
                <p className="pkg-family-detail-modal__eyebrow">Template</p>
                <h2 id="proposal-pkg-family-detail-title" className="pkg-family-detail-modal__title">
                  {detailType.name}
                </h2>
              </div>
              <button
                type="button"
                className="pkg-family-detail-modal__close"
                onClick={closeFamilyDetail}
                aria-label="Close"
              >
                ×
              </button>
            </header>
            <div className="pkg-family-detail-modal__body">
              <PackageBuilderFamilyDetail slots={detailSlots} />
            </div>
            <footer className="pkg-family-detail-modal__footer">
              <button
                type="button"
                className="pkg-family-detail-modal__btn pkg-family-detail-modal__btn--secondary"
                onClick={closeFamilyDetail}
              >
                Close
              </button>
              <button
                type="button"
                className="pkg-family-detail-modal__btn pkg-family-detail-modal__btn--primary"
                disabled={!canBuild}
                onClick={() => {
                  closeFamilyDetail();
                  startBuild(detailType.id);
                }}
              >
                {buildLabel}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      <PackageBuildWizard
        variant="proposal"
        packageTypes={packageTypes}
        slots={slots}
        packages={packages}
        solutions={solutions}
        tiers={tiers}
        tasks={tasks}
        pricing={pricing}
        onReload={onReloadCatalog}
        onCreated={handlePackageCreated}
        launchPackageTypeId={launchPackageTypeId}
        onLaunchPackageTypeConsumed={() => setLaunchPackageTypeId(null)}
        wizardTitle={wizardTitle}
      />
    </>
  );
}
