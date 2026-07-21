import { useCallback, useId, useMemo, useState } from "react";
import type {
  Package,
  PackageBuilderPackageType,
  PackageBuilderSlotTemplate,
  Solution,
  SolutionTier,
  SolutionTierPricing,
  TaskRow,
} from "../../types";
import type { RoadmapPhase, RoadmapScenario } from "../../lib/roadmapModel";
import { sortedPhasesForScenario } from "../../lib/roadmapModel";
import type { ProposalOfferingDates } from "../../lib/proposalDates";
import { slotsForPackageType } from "../../lib/packageBuilderSlots";
import { PackageBuilderFamilyDetail } from "../PackageBuilderFamilyDetail";
import { PackageBuildWizard } from "../PackageBuildWizard";
import { ProposalOfferingDatesModal } from "./ProposalOfferingDatesModal";
import { ProposalAddedItemsPanel, type ProposalAddedLine } from "./ProposalAddedItemsPanel";
import type { ScenarioCopySource } from "./ProposalCopyScenarioOfferings";
import {
  ProposalScenarioBudgetBars,
  type ScenarioBudgetBarRow,
} from "./ProposalScenarioBudgetBars";
import { ProposalCatalogListSearch } from "./ProposalCatalogLineRow";
import { proposalStepDef } from "./ProposalBuilderSteps";

type Props = {
  packageTypes: PackageBuilderPackageType[];
  slots: PackageBuilderSlotTemplate[];
  packages: Package[];
  solutions: Solution[];
  tiers: SolutionTier[];
  tasks: TaskRow[];
  pricing: SolutionTierPricing[];
  scenarios: RoadmapScenario[];
  phases: RoadmapPhase[];
  targetScenarioId: string;
  targetPhaseId: string;
  onTargetScenarioChange: (id: string) => void;
  onTargetPhaseChange: (id: string) => void;
  targetScenarioTitle: string;
  targetPhaseTitle: string;
  proposalStartDate: string;
  proposalEndDate: string;
  onAddPackage: (p: Package, dates: ProposalOfferingDates) => void;
  canAdd: boolean;
  catalogReloading?: boolean;
  onReloadCatalog?: () => Promise<void>;
  budget: number | null;
  scenarioBudgetBars: ScenarioBudgetBarRow[];
  formatUsd: (n: number | null | undefined) => string;
  addedLines: ProposalAddedLine[];
  onRemoveAdded: (key: string) => void;
  copyFromScenarios?: ScenarioCopySource[];
  onCopyFromScenario?: (sourceScenarioId: string) => void;
};

export function ProposalConfigurablePackagesPanel({
  packageTypes,
  slots,
  packages,
  solutions,
  tiers,
  tasks,
  pricing,
  scenarios,
  phases,
  targetScenarioId,
  targetPhaseId,
  onTargetScenarioChange,
  onTargetPhaseChange,
  targetScenarioTitle,
  targetPhaseTitle,
  proposalStartDate,
  proposalEndDate,
  onAddPackage,
  canAdd,
  catalogReloading,
  onReloadCatalog,
  budget,
  scenarioBudgetBars,
  formatUsd,
  addedLines,
  onRemoveAdded,
  copyFromScenarios,
  onCopyFromScenario,
}: Props) {
  const stepMeta = proposalStepDef("packages");
  const searchId = useId();
  const [search, setSearch] = useState("");
  const [launchPackageTypeId, setLaunchPackageTypeId] = useState<string | null>(null);
  const [detailTypeId, setDetailTypeId] = useState<string | null>(null);
  const [datesModalPkg, setDatesModalPkg] = useState<Package | null>(null);

  const targetPhases = useMemo(
    () => sortedPhasesForScenario(phases, targetScenarioId),
    [phases, targetScenarioId]
  );

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
    if (!canAdd) return;
    setLaunchPackageTypeId(typeId);
  };

  const handlePackageCreated = useCallback(
    (_packageId: string, createdPackage?: Package) => {
      if (!createdPackage || !canAdd) return;
      setDatesModalPkg(createdPackage);
    },
    [canAdd]
  );

  const confirmOfferingDates = (dates: ProposalOfferingDates) => {
    if (!datesModalPkg || !canAdd) return;
    onAddPackage(datesModalPkg, dates);
    setDatesModalPkg(null);
  };

  return (
    <div className="proposal-step-panel proposal-catalog proposal-configurable-packages">
      <header className="proposal-step-panel__head">
        <p className="proposal-step-panel__eyebrow">Step {stepMeta.number} · Build new</p>
        <h2 className="proposal-step-panel__title">Build a New Package</h2>
        <p className="proposal-step-panel__lead">
          Choose a configurable template, build it in the wizard, then add it to the active scenario and
          phase.
        </p>
      </header>

      <section
        className={`proposal-catalog-target${canAdd ? " proposal-catalog-target--ready" : " proposal-catalog-target--blocked"}`}
        aria-label="Choose where new items are added"
      >
        <div className="proposal-catalog-target__row">
          <div className="proposal-catalog-target__summary">
            <div className="proposal-catalog-target__hero-badge" aria-hidden>
              +
            </div>
            <div className="proposal-catalog-target__hero-copy">
              <p className="proposal-catalog-target__eyebrow">Adding To</p>
              {canAdd ? (
                <p className="proposal-catalog-target__live" aria-live="polite">
                  <span className="proposal-catalog-target__live-scenario">{targetScenarioTitle}</span>
                  <span className="proposal-catalog-target__live-arrow" aria-hidden>
                    →
                  </span>
                  <span className="proposal-catalog-target__live-phase">{targetPhaseTitle}</span>
                </p>
              ) : (
                <p className="proposal-catalog-target__blocked-msg">
                  Add a phase in <strong>Scenarios &amp; Phases</strong> first.
                </p>
              )}
            </div>
          </div>

          <div className="proposal-catalog-target__pickers">
            <div className="proposal-catalog-target__picker">
              <span className="proposal-catalog-target__picker-label">Scenario</span>
              <div className="proposal-catalog-target__pills" role="list">
                {scenarios.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="listitem"
                    className={`proposal-catalog-target__pill${targetScenarioId === s.id ? " is-active" : ""}`}
                    onClick={() => onTargetScenarioChange(s.id)}
                  >
                    {s.title.trim() || "Untitled"}
                  </button>
                ))}
              </div>
            </div>
            <div className="proposal-catalog-target__picker">
              <span className="proposal-catalog-target__picker-label">Phase</span>
              <div className="proposal-catalog-target__pills" role="list">
                {targetPhases.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="listitem"
                    className={`proposal-catalog-target__pill${targetPhaseId === p.id ? " is-active" : ""}`}
                    onClick={() => onTargetPhaseChange(p.id)}
                    disabled={!canAdd && targetPhases.length === 0}
                  >
                    {p.title.trim() || "Phase"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="proposal-catalog-dashboard">
        <ProposalScenarioBudgetBars budget={budget} scenarios={scenarioBudgetBars} formatUsd={formatUsd} />
        <ProposalAddedItemsPanel
          scenarioTitle={targetScenarioTitle}
          targetPhaseTitle={targetPhaseTitle}
          lines={addedLines}
          onRemove={onRemoveAdded}
          copyFromScenarios={copyFromScenarios}
          onCopyFromScenario={onCopyFromScenario}
        />
      </div>

      <div className="proposal-catalog-offerings">
        <div className="proposal-configurable-packages__head">
          <div>
            <p className="proposal-catalog-step-prompt">Pick A Template</p>
            <p className="proposal-catalog-offerings__hint">
              Build a custom package from a template · adding to{" "}
              <strong>{targetScenarioTitle}</strong> · <strong>{targetPhaseTitle}</strong>
            </p>
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
              const typeSlots = slotsForPackageType(slots, pt.id);
              const tierCount = typeSlots.length;
              return (
                <article
                  key={pt.id}
                  className="proposal-configurable-packages__card"
                  data-accent-index={String(index % 7)}
                >
                  <span className="proposal-configurable-packages__card-num">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3 className="proposal-configurable-packages__card-title">{pt.name}</h3>
                  <p className="proposal-configurable-packages__card-meta">
                    {tierCount} package tier{tierCount === 1 ? "" : "s"}
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
                      disabled={!canAdd}
                      onClick={() => startBuild(pt.id)}
                    >
                      Build &amp; add
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {detailType ? (
        <div
          className="pkg-family-detail-overlay"
          role="presentation"
          onClick={closeFamilyDetail}
        >
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
                disabled={!canAdd}
                onClick={() => {
                  closeFamilyDetail();
                  startBuild(detailType.id);
                }}
              >
                Build &amp; add
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
        wizardTitle="Build & add package"
      />

      <ProposalOfferingDatesModal
        open={datesModalPkg != null}
        title="Solution dates"
        subtitle="Set when this package runs in the proposal timeline."
        itemLabel={datesModalPkg?.package_name}
        proposalStartDate={proposalStartDate}
        proposalEndDate={proposalEndDate}
        onCancel={() => setDatesModalPkg(null)}
        onConfirm={confirmOfferingDates}
      />
    </div>
  );
}
