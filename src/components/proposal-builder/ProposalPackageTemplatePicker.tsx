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
          <div className="proposal-configurable-packages__grid">
            {filteredTypes.map((pt, index) => {
              const tierCount = slotsForPackageType(slots, pt.id).length;
              return (
                <article
                  key={pt.id}
                  className="proposal-configurable-packages__card"
                  data-accent-index={String(index % 7)}
                >
                  <h3 className="proposal-configurable-packages__card-title">{pt.name}</h3>
                  {pt.card_description ? (
                    <p className="proposal-configurable-packages__card-desc">{pt.card_description}</p>
                  ) : null}
                  <p className="proposal-configurable-packages__card-meta">
                    {tierCount} package solution{tierCount === 1 ? "" : "s"}
                  </p>
                  <div className="proposal-configurable-packages__card-actions">
                    <button
                      type="button"
                      className="proposal-configurable-packages__detail-btn"
                      onClick={() => setDetailTypeId(pt.id)}
                    >
                      Show detail
                    </button>
                    <button
                      type="button"
                      className="proposal-configurable-packages__build-btn"
                      disabled={!canBuild}
                      onClick={() => startBuild(pt.id)}
                    >
                      {buildLabel}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
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
