import { useCallback, useId, useMemo, useState } from "react";
import type { Package, SolutionTier } from "../../types";
import type { CatalogTierTableRow } from "../CatalogTierTable";
import type { RoadmapPhase, RoadmapScenario } from "../../lib/roadmapModel";
import { sortedPhasesForScenario } from "../../lib/roadmapModel";
import type { ProposalOfferingDates } from "../../lib/proposalDates";
import {
  isPaidAdsVariableTierRefId,
  isPercentVariableTierRefId,
  isTravelVariableTierRefId,
  paidAdsOptimizationFormulaLabel,
  variableTierRuleSummary,
  type AddVariableTierOpts,
  type VariableTierLinkTarget,
} from "../../lib/proposalVariableTiers";
import { buildSolutionDirectoryRowsFromTier } from "../../lib/buildCatalogDirectoryRows";
import { ProposalOfferingDatesModal } from "./ProposalOfferingDatesModal";
import { ProposalAddedItemsPanel, type ProposalAddedLine } from "./ProposalAddedItemsPanel";
import type { ScenarioCopySource } from "./ProposalCopyScenarioOfferings";
import {
  ProposalScenarioBudgetBars,
  type ScenarioBudgetBarRow,
} from "./ProposalScenarioBudgetBars";
import {
  ProposalCatalogLineRow,
  ProposalCatalogLinesPanel,
  ProposalCatalogListSearch,
} from "./ProposalCatalogLineRow";
import {
  CatalogDirectoryBrowser,
  type CatalogDirectoryTypeFilter,
} from "../CatalogDirectoryBrowser";
import type { CatalogDirectorySortCol } from "../CatalogDirectoryTable";
import type { PlaybookFilterValue } from "../CatalogPlaybookBrowser";
import { proposalStepDef, type ProposalBuilderStep } from "./ProposalBuilderSteps";

/** Sentinel kept for any external imports; browse drill-down removed from Add Solutions. */
export const BROWSE_SHOW_ALL = "__show_all__";

type CatalogCtxLike = {
  packages: Package[];
  tiers: SolutionTier[];
};

type CatalogPanelVariant =
  | "offerings"
  | "preset_packages"
  | "configurable_packages"
  | "variable_tiers";

type Props = {
  panelVariant?: CatalogPanelVariant;
  catalogTierTableRows: CatalogTierTableRow[];
  variableTierTableRows: CatalogTierTableRow[];
  ctx: CatalogCtxLike;
  scenarios: RoadmapScenario[];
  phases: RoadmapPhase[];
  targetScenarioId: string;
  targetPhaseId: string;
  onTargetScenarioChange: (id: string) => void;
  onTargetPhaseChange: (id: string) => void;
  targetScenarioTitle: string;
  targetPhaseTitle: string;
  filteredPackages: Package[];
  packagePreview: (p: Package) => { hours: string; price: string };
  proposalStartDate: string;
  proposalEndDate: string;
  onAddPackage: (p: Package, dates: ProposalOfferingDates) => void;
  onAddTier: (t: SolutionTier, dates: ProposalOfferingDates) => void;
  onAddVariableTier: (t: SolutionTier, dates: ProposalOfferingDates, opts?: AddVariableTierOpts) => void;
  previewVariableTierPriceUsd: (refId: string, opts?: AddVariableTierOpts) => number | null;
  variableTierLinkTargets: VariableTierLinkTarget[];
  onAddScratchTier: (dates: ProposalOfferingDates) => void;
  canAdd: boolean;
  catalogReloading?: boolean;
  onReloadCatalog?: () => void;
  budget: number | null;
  scenarioBudgetBars: ScenarioBudgetBarRow[];
  formatUsd: (n: number | null | undefined) => string;
  addedLines: ProposalAddedLine[];
  onRemoveAdded: (key: string) => void;
  addedTierRefIds: Set<string>;
  addedPackageRefIds: Set<string>;
  copyFromScenarios?: ScenarioCopySource[];
  onCopyFromScenario?: (sourceScenarioId: string) => void;
};

export function ProposalCatalogPanel({
  panelVariant = "offerings",
  catalogTierTableRows,
  variableTierTableRows,
  ctx,
  scenarios,
  phases,
  targetScenarioId,
  targetPhaseId,
  onTargetScenarioChange,
  onTargetPhaseChange,
  targetScenarioTitle,
  targetPhaseTitle,
  filteredPackages,
  packagePreview,
  onAddPackage,
  onAddTier,
  onAddVariableTier,
  previewVariableTierPriceUsd,
  variableTierLinkTargets,
  onAddScratchTier,
  proposalStartDate,
  proposalEndDate,
  canAdd,
  catalogReloading,
  onReloadCatalog,
  budget,
  scenarioBudgetBars,
  formatUsd,
  addedLines,
  onRemoveAdded,
  addedTierRefIds,
  addedPackageRefIds,
  copyFromScenarios,
  onCopyFromScenario,
}: Props) {
  const searchId = useId();
  const travelHoursFieldId = useId();
  const paidAdsSpendFieldId = useId();
  const isPackageOnlyStep =
    panelVariant === "preset_packages" || panelVariant === "configurable_packages";
  const isVariableOnlyStep = panelVariant === "variable_tiers";
  const catalogMode: "playbook" | "packages" | "variable" = isPackageOnlyStep
    ? "packages"
    : isVariableOnlyStep
      ? "variable"
      : "playbook";
  const [search, setSearch] = useState("");
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const [travelModalTierId, setTravelModalTierId] = useState<string | null>(null);
  const [travelHoursStr, setTravelHoursStr] = useState("");
  const [paidAdsModalTierId, setPaidAdsModalTierId] = useState<string | null>(null);
  const [paidAdsSpendStr, setPaidAdsSpendStr] = useState("");
  const [linkModalTierId, setLinkModalTierId] = useState<string | null>(null);
  const [selectedLinkedTierRefId, setSelectedLinkedTierRefId] = useState<string | null>(null);

  const [dirItemType, setDirItemType] = useState<CatalogDirectoryTypeFilter>("solution");
  const [dirPhase, setDirPhase] = useState<PlaybookFilterValue>(null);
  const [dirCategory, setDirCategory] = useState<PlaybookFilterValue>(null);
  const [dirTactic, setDirTactic] = useState<PlaybookFilterValue>(null);
  const [dirSearch, setDirSearch] = useState("");
  const [dirSort, setDirSort] = useState<{ col: CatalogDirectorySortCol; dir: "asc" | "desc" }>({
    col: "name",
    dir: "asc",
  });
  const [expandedSolutionIds, setExpandedSolutionIds] = useState<Set<string>>(() => new Set());

  type PendingOfferingAdd =
    | { kind: "tier"; tier: SolutionTier }
    | { kind: "package"; pkg: Package }
    | { kind: "scratch" }
    | { kind: "variable"; tier: SolutionTier; opts: AddVariableTierOpts };

  const [datesModalPending, setDatesModalPending] = useState<PendingOfferingAdd | null>(null);

  const targetPhases = useMemo(
    () => sortedPhasesForScenario(phases, targetScenarioId),
    [phases, targetScenarioId]
  );

  const tierById = useMemo(() => {
    const m = new Map<string, SolutionTier>();
    for (const t of ctx.tiers) m.set(t.solution_tier_id, t);
    return m;
  }, [ctx.tiers]);

  const solutionDirectoryRows = useMemo(
    () => buildSolutionDirectoryRowsFromTier(catalogTierTableRows),
    [catalogTierTableRows]
  );

  const toggleExpandedSolution = useCallback((solutionId: string) => {
    setExpandedSolutionIds((prev) => {
      const next = new Set(prev);
      if (next.has(solutionId)) next.delete(solutionId);
      else next.add(solutionId);
      return next;
    });
  }, []);

  const toggleDirSort = useCallback((col: CatalogDirectorySortCol) => {
    setDirSort((prev) =>
      prev.col === col ? { col, dir: prev.dir === "asc" ? "desc" : "asc" } : { col, dir: "asc" }
    );
  }, []);

  const searchLower = search.trim().toLowerCase();
  const variableTierRows = useMemo(() => {
    if (!searchLower) return variableTierTableRows;
    return variableTierTableRows.filter((r) => {
      const blob = `${r.tierName} ${r.solutionName} ${r.tierId}`.toLowerCase();
      return blob.includes(searchLower);
    });
  }, [variableTierTableRows, searchLower]);

  const travelModalTier = travelModalTierId ? tierById.get(travelModalTierId) ?? null : null;
  const paidAdsModalTier = paidAdsModalTierId ? tierById.get(paidAdsModalTierId) ?? null : null;
  const linkModalTier = linkModalTierId ? tierById.get(linkModalTierId) ?? null : null;

  const closeTravelModal = () => {
    setTravelModalTierId(null);
    setTravelHoursStr("");
  };

  const closePaidAdsModal = () => {
    setPaidAdsModalTierId(null);
    setPaidAdsSpendStr("");
  };

  const closeLinkModal = () => {
    setLinkModalTierId(null);
    setSelectedLinkedTierRefId(null);
  };

  const submitTravelModal = () => {
    if (!travelModalTier) return;
    const h = Number(travelHoursStr.trim());
    if (!Number.isFinite(h) || h <= 0) return;
    setDatesModalPending({ kind: "variable", tier: travelModalTier, opts: { travelHours: h } });
    closeTravelModal();
  };

  const submitPaidAdsModal = () => {
    if (!paidAdsModalTier) return;
    const spend = Number(paidAdsSpendStr.trim().replace(/[$,\s]/g, ""));
    if (!Number.isFinite(spend) || spend <= 0) return;
    setDatesModalPending({ kind: "variable", tier: paidAdsModalTier, opts: { paidAdsSpendUsd: spend } });
    closePaidAdsModal();
  };

  const submitLinkModal = () => {
    if (!linkModalTier || !selectedLinkedTierRefId) return;
    setDatesModalPending({
      kind: "variable",
      tier: linkModalTier,
      opts: { linkedTierRefId: selectedLinkedTierRefId },
    });
    closeLinkModal();
  };

  const handleAddVariableTierRow = (tierId: string) => {
    const tier = tierById.get(tierId);
    if (!tier || !canAdd) return;
    if (isTravelVariableTierRefId(tierId)) {
      setTravelModalTierId(tierId);
      setTravelHoursStr("");
      return;
    }
    if (isPaidAdsVariableTierRefId(tierId)) {
      setPaidAdsModalTierId(tierId);
      setPaidAdsSpendStr("");
      return;
    }
    if (isPercentVariableTierRefId(tierId)) {
      if (variableTierLinkTargets.length === 0) {
        window.alert("Add at least one solution tier to this scenario before adding this variable tier.");
        return;
      }
      setLinkModalTierId(tierId);
      setSelectedLinkedTierRefId(variableTierLinkTargets[0]?.refId ?? null);
    }
  };

  const stepMeta = useMemo(() => {
    const stepId: ProposalBuilderStep =
      panelVariant === "preset_packages" || panelVariant === "configurable_packages"
        ? "packages"
        : "catalog";
    const def = proposalStepDef(stepId);
    if (panelVariant === "preset_packages") {
      return {
        ...def,
        numberLabel: `Step ${def.number} · Pre-built`,
        label: "Add a Pre-Built Package",
        lead: "Pick a package you already built and add it to the active scenario and phase.",
      };
    }
    if (panelVariant === "configurable_packages") {
      return {
        ...def,
        numberLabel: `Step ${def.number} · Build new`,
        label: "Build a New Package",
        lead: "Build custom packages from configurable templates in Package Builder.",
      };
    }
    if (panelVariant === "variable_tiers") {
      return {
        ...def,
        numberLabel: `Step ${def.number}`,
        label: "Extras",
        lead:
          "Extras like Paid Campaign Management, Rush Charge, and Travel Time — priced dynamically from the solutions already in this scenario.",
      };
    }
    return {
      ...def,
      numberLabel: `Step ${def.number}`,
      lead:
        "Browse solutions in the table, expand one to see tiers, then add a tier. Extras (dynamic add-ons) are below the table.",
    };
  }, [panelVariant]);

  const packagePrompt =
    panelVariant === "configurable_packages"
      ? "Pick A Template"
      : panelVariant === "preset_packages"
        ? "Pick A Pre-Built Custom Package"
        : "Pick A Custom Package";
  const packageHint =
    panelVariant === "configurable_packages"
      ? "Configurable packages from Package Builder templates"
      : panelVariant === "preset_packages"
        ? "Pre-built packages from the configurable package builder"
        : "Admin-defined custom bundles";

  const linkModalPreviewUsd =
    linkModalTier && selectedLinkedTierRefId
      ? previewVariableTierPriceUsd(linkModalTier.solution_tier_id, {
          linkedTierRefId: selectedLinkedTierRefId,
        })
      : null;

  const selectedLinkTarget = selectedLinkedTierRefId
    ? variableTierLinkTargets.find((t) => t.refId === selectedLinkedTierRefId) ?? null
    : null;

  const confirmOfferingDates = (dates: ProposalOfferingDates) => {
    const pending = datesModalPending;
    if (!pending || !canAdd) return;

    let justAdded: string | null = null;
    switch (pending.kind) {
      case "tier":
        onAddTier(pending.tier, dates);
        justAdded = `tier:${pending.tier.solution_tier_id}`;
        break;
      case "package":
        onAddPackage(pending.pkg, dates);
        justAdded = `pkg:${pending.pkg.package_id}`;
        break;
      case "scratch":
        onAddScratchTier(dates);
        justAdded = "scratch";
        break;
      case "variable":
        onAddVariableTier(pending.tier, dates, pending.opts);
        justAdded = `tier:${pending.tier.solution_tier_id}`;
        break;
    }

    setDatesModalPending(null);
    if (justAdded) {
      setJustAddedId(justAdded);
      window.setTimeout(() => setJustAddedId((id) => (id === justAdded ? null : id)), 1600);
    }
  };

  const datesModalItemLabel = useMemo(() => {
    const pending = datesModalPending;
    if (!pending) return undefined;
    if (pending.kind === "tier" || pending.kind === "variable") return pending.tier.solution_tier_name;
    if (pending.kind === "package") return pending.pkg.package_name;
    return "Scratch tier";
  }, [datesModalPending]);

  const handleAddTier = (tierId: string) => {
    const tier = tierById.get(tierId);
    if (!tier || !canAdd) return;
    setDatesModalPending({ kind: "tier", tier });
  };

  const handleAddPackage = (packageId: string) => {
    const pkg = ctx.packages.find((p) => p.package_id === packageId);
    if (!pkg || !canAdd) return;
    setDatesModalPending({ kind: "package", pkg });
  };

  return (
    <div className="proposal-step-panel proposal-catalog">
      <header className="proposal-step-panel__head">
        <p className="proposal-step-panel__eyebrow">{stepMeta.numberLabel ?? `Step ${stepMeta.number}`}</p>
        <h2 className="proposal-step-panel__title">{stepMeta.label}</h2>
        <p className="proposal-step-panel__lead">{stepMeta.lead}</p>
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

      {onReloadCatalog ? (
        <div className="proposal-catalog-source">
          <nav className="proposal-catalog-source-tabs proposal-catalog-source-tabs--reload" aria-label="Solution source">
            <button
              type="button"
              className="proposal-catalog-mode-link"
              onClick={onReloadCatalog}
              disabled={catalogReloading}
            >
              {catalogReloading ? "Refreshing…" : "Refresh solutions"}
            </button>
          </nav>
        </div>
      ) : null}

      {isPackageOnlyStep ? (
        <div className="proposal-catalog-offerings">
          <p className="proposal-catalog-step-prompt">{packagePrompt}</p>
          <p className="proposal-catalog-offerings__hint">
            {packageHint} · adding to <strong>{targetScenarioTitle}</strong> ·{" "}
            <strong>{targetPhaseTitle}</strong>
          </p>
          <ProposalCatalogListSearch
            id={searchId}
            value={search}
            onChange={setSearch}
            placeholder="Search packages…"
            label="Search packages"
          />
          <ProposalCatalogLinesPanel
            count={
              filteredPackages.filter(
                (p) => !searchLower || p.package_name.toLowerCase().includes(searchLower)
              ).length
            }
            isEmpty={
              ctx.packages.length === 0 ||
              filteredPackages.filter((p) => !searchLower || p.package_name.toLowerCase().includes(searchLower))
                .length === 0
            }
            emptyTitle={ctx.packages.length === 0 ? "No packages yet" : "No matches"}
            emptyText={
              ctx.packages.length === 0
                ? panelVariant === "configurable_packages"
                  ? "Build a package in Package Builder, then refresh solutions."
                  : panelVariant === "preset_packages"
                    ? "Build a package under Add Packages, then refresh solutions."
                    : "Create custom packages in Admin, then refresh solutions."
                : "Try a different search term."
            }
          >
            {filteredPackages
              .filter((p) => !searchLower || p.package_name.toLowerCase().includes(searchLower))
              .map((p) => {
                const row = packagePreview(p);
                const onProposal = addedPackageRefIds.has(p.package_id);
                const justAdded = justAddedId === `pkg:${p.package_id}`;
                return (
                  <ProposalCatalogLineRow
                    key={p.package_id}
                    kind="package"
                    title={p.package_name}
                    detail="Linked solution tiers bundle"
                    hours={row.hours}
                    price={row.price}
                    onProposal={onProposal}
                    justAdded={justAdded}
                    canAdd={canAdd}
                    onAdd={() => handleAddPackage(p.package_id)}
                  />
                );
              })}
          </ProposalCatalogLinesPanel>
        </div>
      ) : catalogMode === "variable" ? (
        <div className="proposal-catalog-offerings">
          <p className="proposal-catalog-step-prompt">Pick An Extra</p>
          <p className="proposal-catalog-offerings__hint">
            Extras like Paid Campaign Management, Rush Charge, and Travel Time — priced dynamically from
            scenario solutions · adding to <strong>{targetScenarioTitle}</strong> ·{" "}
            <strong>{targetPhaseTitle}</strong>
          </p>
          <ProposalCatalogListSearch
            id={searchId}
            value={search}
            onChange={setSearch}
            placeholder="Search extras…"
            label="Search extras"
          />
          <ProposalCatalogLinesPanel
            count={variableTierRows.length}
            isEmpty={variableTierRows.length === 0}
            emptyTitle="No extras"
            emptyText="Extras are configured in the Solutions Directory."
          >
            {variableTierRows.map((r) => {
              const onProposal = addedTierRefIds.has(r.tierId);
              const justAdded = justAddedId === `tier:${r.tierId}`;
              const priceDisplay = isTravelVariableTierRefId(r.tierId)
                ? "Enter hours"
                : isPercentVariableTierRefId(r.tierId)
                  ? "Select tier"
                  : "—";
              return (
                <ProposalCatalogLineRow
                  key={r.tierId}
                  kind="tier"
                  title={r.tierName}
                  detail={variableTierRuleSummary(r.tierId)}
                  hours={isTravelVariableTierRefId(r.tierId) ? "—" : r.hoursDisplay}
                  price={priceDisplay}
                  onProposal={onProposal}
                  justAdded={justAdded}
                  canAdd={canAdd}
                  onAdd={() => handleAddVariableTierRow(r.tierId)}
                />
              );
            })}
          </ProposalCatalogLinesPanel>
        </div>
      ) : (
        <>
          <div className="proposal-catalog-directory">
            <p className="proposal-catalog-step-prompt">All Solutions</p>
            <p className="proposal-catalog-offerings__hint">
              Expand a solution to see tiers, then add one to <strong>{targetScenarioTitle}</strong> ·{" "}
              <strong>{targetPhaseTitle}</strong>
            </p>
            <CatalogDirectoryBrowser
              allRows={solutionDirectoryRows}
              itemType={dirItemType}
              phase={dirPhase}
              category={dirCategory}
              tactic={dirTactic}
              onItemTypeChange={setDirItemType}
              onPhaseChange={setDirPhase}
              onCategoryChange={setDirCategory}
              onTacticChange={setDirTactic}
              tableSearch={dirSearch}
              onTableSearchChange={setDirSearch}
              sort={dirSort}
              onToggleSort={toggleDirSort}
              expandedSolutionIds={expandedSolutionIds}
              onToggleSolution={toggleExpandedSolution}
              onOpenTier={() => {}}
              onOpenPresetPackage={() => {}}
              onOpenConfigurablePackage={() => {}}
              hideTypeFilter
              hidePackageStats
              searchPlaceholder="Solution, tier, tags…"
              footerHint="Expand a solution for tiers · Click Add on a tier to place it on the proposal"
              tierInteraction="add"
              onAddTier={(_solutionId, tierId) => handleAddTier(tierId)}
              addedTierRefIds={addedTierRefIds}
              justAddedTierId={
                justAddedId?.startsWith("tier:") ? justAddedId.slice("tier:".length) : null
              }
              canAdd={canAdd}
            />
            <footer className="proposal-catalog-tiers__footer">
              <button
                type="button"
                className="roadmap-btn roadmap-btn--ghost roadmap-btn--sm"
                disabled={!canAdd}
                onClick={() => {
                  if (!canAdd) return;
                  setDatesModalPending({ kind: "scratch" });
                }}
              >
                + Custom one-off tier
              </button>
            </footer>
          </div>

          <div className="proposal-catalog-extras">
            <header className="proposal-catalog-extras__head">
              <p className="proposal-catalog-step-prompt">Extras</p>
              <p className="proposal-catalog-offerings__hint">
                Dynamic add-ons like Paid Campaign Management, Rush Charge, and Travel Time — priced from
                solutions already in this scenario.
              </p>
            </header>
            <ProposalCatalogListSearch
              id={`${searchId}-extras`}
              value={search}
              onChange={setSearch}
              placeholder="Search extras…"
              label="Search extras"
            />
            <ProposalCatalogLinesPanel
              count={variableTierRows.length}
              isEmpty={variableTierRows.length === 0}
              emptyTitle="No extras"
              emptyText="Extras are configured in the Solutions Directory."
            >
              {variableTierRows.map((r) => {
                const onProposal = addedTierRefIds.has(r.tierId);
                const justAdded = justAddedId === `tier:${r.tierId}`;
                const priceDisplay = isTravelVariableTierRefId(r.tierId)
                  ? "Enter hours"
                  : isPercentVariableTierRefId(r.tierId)
                    ? "Select tier"
                    : "—";
                return (
                  <ProposalCatalogLineRow
                    key={r.tierId}
                    kind="tier"
                    title={r.tierName}
                    detail={variableTierRuleSummary(r.tierId)}
                    hours={isTravelVariableTierRefId(r.tierId) ? "—" : r.hoursDisplay}
                    price={priceDisplay}
                    onProposal={onProposal}
                    justAdded={justAdded}
                    canAdd={canAdd}
                    onAdd={() => handleAddVariableTierRow(r.tierId)}
                  />
                );
              })}
            </ProposalCatalogLinesPanel>
          </div>
        </>
      )}

      {travelModalTier ? (
        <div
          className="roadmap-modal-backdrop proposal-travel-modal-backdrop"
          role="presentation"
          onClick={closeTravelModal}
        >
          <div
            className="roadmap-modal proposal-travel-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="proposal-travel-hours-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="proposal-travel-modal__close"
              aria-label="Close"
              onClick={closeTravelModal}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M18 6L6 18M6 6l12 12"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>

            <header className="proposal-travel-modal__head">
              <div className="proposal-travel-modal__icon" aria-hidden>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" />
                  <path d="M12 7v5l3.5 2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                </svg>
              </div>
              <div className="proposal-travel-modal__head-copy">
                <p className="proposal-travel-modal__eyebrow">Variable Tier</p>
                <h2 id="proposal-travel-hours-title" className="proposal-travel-modal__title">
                  {travelModalTier.solution_tier_name}
                </h2>
                <p className="proposal-travel-modal__subtitle">
                  Billable travel time for this scenario. Sell price is calculated automatically.
                </p>
              </div>
            </header>

            <div className="proposal-travel-modal__body">
              <div className="proposal-travel-modal__rate" aria-label="Hourly rate">
                <span className="proposal-travel-modal__rate-label">Hourly rate</span>
                <strong className="proposal-travel-modal__rate-value">$150</strong>
                <span className="proposal-travel-modal__rate-unit">/ hr</span>
              </div>

              <label className="proposal-travel-modal__field" htmlFor={travelHoursFieldId}>
                <span className="proposal-travel-modal__field-label">Total travel hours</span>
                <div className="proposal-travel-modal__input-wrap">
                  <input
                    id={travelHoursFieldId}
                    type="number"
                    min={0.25}
                    step={0.25}
                    inputMode="decimal"
                    className="proposal-travel-modal__input"
                    placeholder="0"
                    value={travelHoursStr}
                    onChange={(e) => setTravelHoursStr(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitTravelModal();
                      if (e.key === "Escape") closeTravelModal();
                    }}
                  />
                  <span className="proposal-travel-modal__input-suffix">hrs</span>
                </div>
              </label>

              {(() => {
                const h = Number(travelHoursStr.trim());
                const preview =
                  Number.isFinite(h) && h > 0
                    ? previewVariableTierPriceUsd(travelModalTier.solution_tier_id, { travelHours: h })
                    : null;
                const hoursLabel =
                  Number.isFinite(h) && h > 0
                    ? Number.isInteger(h)
                      ? String(h)
                      : String(Math.round(h * 10) / 10)
                    : null;
                return (
                  <div
                    className={`proposal-travel-modal__preview${preview != null ? " proposal-travel-modal__preview--live" : ""}`}
                    role="status"
                  >
                    <span className="proposal-travel-modal__preview-label">Estimated sell price</span>
                    <strong className="proposal-travel-modal__preview-value">
                      {preview != null ? formatUsd(preview) : "—"}
                    </strong>
                    {preview != null && hoursLabel ? (
                      <span className="proposal-travel-modal__preview-formula">
                        {hoursLabel} hrs × $150
                      </span>
                    ) : (
                      <span className="proposal-travel-modal__preview-hint">Enter hours to see the sell price</span>
                    )}
                  </div>
                );
              })()}
            </div>

            <footer className="roadmap-modal__actions proposal-travel-modal__actions">
              <button type="button" className="roadmap-btn roadmap-btn--ghost" onClick={closeTravelModal}>
                Cancel
              </button>
              <button
                type="button"
                className="roadmap-btn roadmap-btn--primary proposal-travel-modal__submit"
                disabled={!Number.isFinite(Number(travelHoursStr.trim())) || Number(travelHoursStr.trim()) <= 0}
                onClick={submitTravelModal}
              >
                Add to scenario
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {paidAdsModalTier ? (
        <div
          className="roadmap-modal-backdrop proposal-travel-modal-backdrop"
          role="presentation"
          onClick={closePaidAdsModal}
        >
          <div
            className="roadmap-modal proposal-travel-modal proposal-travel-modal--paid-ads"
            role="dialog"
            aria-modal="true"
            aria-labelledby="proposal-paid-ads-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="proposal-travel-modal__close"
              aria-label="Close"
              onClick={closePaidAdsModal}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M18 6L6 18M6 6l12 12"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>

            <header className="proposal-travel-modal__head">
              <div className="proposal-travel-modal__icon proposal-travel-modal__icon--paid-ads" aria-hidden>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 2v20M17 5H9.5a3.5 3.5 0 100 7h5a3.5 3.5 0 110 7H6"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <div className="proposal-travel-modal__head-copy">
                <p className="proposal-travel-modal__eyebrow">Variable Tier</p>
                <h2 id="proposal-paid-ads-title" className="proposal-travel-modal__title">
                  {paidAdsModalTier.solution_tier_name}
                </h2>
                <p className="proposal-travel-modal__subtitle">
                  Enter total paid ads spend for this scenario. Sell price is calculated automatically from tiered rates.
                </p>
              </div>
            </header>

            <div className="proposal-travel-modal__body">
              <div className="proposal-travel-modal__rate" aria-label="Pricing tiers">
                <span className="proposal-travel-modal__rate-label">Rate per $1k spend</span>
                <div className="proposal-travel-modal__rate-tiers">
                  <span>≤ $2k → $400</span>
                  <span>≤ $10k → $270</span>
                  <span>&gt; $10k → $200</span>
                </div>
              </div>

              <label className="proposal-travel-modal__field" htmlFor={paidAdsSpendFieldId}>
                <span className="proposal-travel-modal__field-label">Total paid ads spend</span>
                <div className="proposal-travel-modal__input-wrap">
                  <span className="proposal-travel-modal__input-prefix">$</span>
                  <input
                    id={paidAdsSpendFieldId}
                    type="number"
                    min={1}
                    step={100}
                    inputMode="decimal"
                    className="proposal-travel-modal__input proposal-travel-modal__input--currency"
                    placeholder="0"
                    value={paidAdsSpendStr}
                    onChange={(e) => setPaidAdsSpendStr(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitPaidAdsModal();
                      if (e.key === "Escape") closePaidAdsModal();
                    }}
                  />
                </div>
              </label>

              {(() => {
                const spend = Number(paidAdsSpendStr.trim().replace(/[$,\s]/g, ""));
                const preview =
                  Number.isFinite(spend) && spend > 0
                    ? previewVariableTierPriceUsd(paidAdsModalTier.solution_tier_id, {
                        paidAdsSpendUsd: spend,
                      })
                    : null;
                const formula =
                  Number.isFinite(spend) && spend > 0 ? paidAdsOptimizationFormulaLabel(spend) : null;
                return (
                  <div
                    className={`proposal-travel-modal__preview${preview != null ? " proposal-travel-modal__preview--live" : ""}`}
                    role="status"
                  >
                    <span className="proposal-travel-modal__preview-label">Estimated sell price</span>
                    <strong className="proposal-travel-modal__preview-value">
                      {preview != null ? formatUsd(preview) : "—"}
                    </strong>
                    {preview != null && formula ? (
                      <span className="proposal-travel-modal__preview-formula">{formula}</span>
                    ) : (
                      <span className="proposal-travel-modal__preview-hint">
                        Enter total paid ads spend to see the sell price
                      </span>
                    )}
                  </div>
                );
              })()}
            </div>

            <footer className="roadmap-modal__actions proposal-travel-modal__actions">
              <button type="button" className="roadmap-btn roadmap-btn--ghost" onClick={closePaidAdsModal}>
                Cancel
              </button>
              <button
                type="button"
                className="roadmap-btn roadmap-btn--primary proposal-travel-modal__submit"
                disabled={
                  !Number.isFinite(Number(paidAdsSpendStr.trim().replace(/[$,\s]/g, ""))) ||
                  Number(paidAdsSpendStr.trim().replace(/[$,\s]/g, "")) <= 0
                }
                onClick={submitPaidAdsModal}
              >
                Add to scenario
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {linkModalTier ? (
        <div
          className="roadmap-modal-backdrop proposal-travel-modal-backdrop"
          role="presentation"
          onClick={closeLinkModal}
        >
          <div
            className="roadmap-modal proposal-travel-modal proposal-travel-modal--link"
            role="dialog"
            aria-modal="true"
            aria-labelledby="proposal-link-tier-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="proposal-travel-modal__close"
              aria-label="Close"
              onClick={closeLinkModal}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M18 6L6 18M6 6l12 12"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>

            <header className="proposal-travel-modal__head">
              <div className="proposal-travel-modal__icon proposal-travel-modal__icon--link" aria-hidden>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                  />
                  <path
                    d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <div className="proposal-travel-modal__head-copy">
                <p className="proposal-travel-modal__eyebrow">Variable Tier</p>
                <h2 id="proposal-link-tier-title" className="proposal-travel-modal__title">
                  {linkModalTier.solution_tier_name}
                </h2>
                <p className="proposal-travel-modal__subtitle">
                  Choose which scenario tier this charge is based on. The formula stays the same — only the base sell
                  price changes.
                </p>
              </div>
            </header>

            <div className="proposal-travel-modal__body">
              <p className="proposal-travel-modal__field-label">Linked tier</p>
              {variableTierLinkTargets.length === 0 ? (
                <p className="proposal-travel-modal__empty">Add solution tiers to this scenario first.</p>
              ) : (
                <ul className="proposal-travel-modal__link-list" role="listbox" aria-label="Linked tier">
                  {variableTierLinkTargets.map((target) => {
                    const selected = selectedLinkedTierRefId === target.refId;
                    return (
                      <li key={target.refId} role="presentation">
                        <button
                          type="button"
                          role="option"
                          aria-selected={selected}
                          className={`proposal-travel-modal__link-option${selected ? " is-selected" : ""}`}
                          onClick={() => setSelectedLinkedTierRefId(target.refId)}
                        >
                          <span className="proposal-travel-modal__link-option-main">
                            <span className="proposal-travel-modal__link-option-title">{target.headline}</span>
                            <span className="proposal-travel-modal__link-option-meta">
                              {target.phaseTitle} · {target.priceDisplay}
                            </span>
                          </span>
                          <span className="proposal-travel-modal__link-option-check" aria-hidden>
                            {selected ? "✓" : ""}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              <div
                className={`proposal-travel-modal__preview${linkModalPreviewUsd != null ? " proposal-travel-modal__preview--live" : ""}`}
                role="status"
              >
                <span className="proposal-travel-modal__preview-label">Estimated sell price</span>
                <strong className="proposal-travel-modal__preview-value">
                  {linkModalPreviewUsd != null ? formatUsd(linkModalPreviewUsd) : "—"}
                </strong>
                {linkModalPreviewUsd != null && selectedLinkTarget ? (
                  <span className="proposal-travel-modal__preview-formula">
                    {variableTierRuleSummary(linkModalTier.solution_tier_id).replace(
                      "linked tier sell",
                      selectedLinkTarget.priceDisplay
                    )}
                  </span>
                ) : (
                  <span className="proposal-travel-modal__preview-hint">Select a tier to preview the charge</span>
                )}
              </div>
            </div>

            <footer className="roadmap-modal__actions proposal-travel-modal__actions">
              <button type="button" className="roadmap-btn roadmap-btn--ghost" onClick={closeLinkModal}>
                Cancel
              </button>
              <button
                type="button"
                className="roadmap-btn roadmap-btn--primary proposal-travel-modal__submit"
                disabled={!selectedLinkedTierRefId || linkModalPreviewUsd == null}
                onClick={submitLinkModal}
              >
                Add to scenario
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      <ProposalOfferingDatesModal
        open={datesModalPending != null}
        title="Set solution dates"
        subtitle="Defaults come from your proposal schedule in Step 1. Adjust per line item if needed."
        itemLabel={datesModalItemLabel}
        proposalStartDate={proposalStartDate}
        proposalEndDate={proposalEndDate}
        onCancel={() => setDatesModalPending(null)}
        onConfirm={confirmOfferingDates}
      />
    </div>
  );
}
