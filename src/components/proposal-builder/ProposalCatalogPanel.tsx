import { useId, useMemo, useState } from "react";
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
import { compareTierPhaseLabels } from "../../lib/tierTaxonomy";
import { compareTierCategoryLabels } from "../../lib/tierCategories";
import { proposalStepDef, type ProposalBuilderStep } from "./ProposalBuilderSteps";

const UNSET = "Not classified";
/** Sentinel: skip this drill-down level and show all tiers at the current scope. */
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

function normLabel(raw: string): string {
  const t = raw.trim();
  return t || UNSET;
}

function compareLabels(a: string, b: string): number {
  if (a === UNSET && b !== UNSET) return 1;
  if (b === UNSET && a !== UNSET) return -1;
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function comparePhaseGroupLabels(a: string, b: string): number {
  if (a === UNSET && b !== UNSET) return 1;
  if (b === UNSET && a !== UNSET) return -1;
  return compareTierPhaseLabels(a, b);
}

function compareCategoryGroupLabels(a: string, b: string): number {
  if (a === UNSET && b !== UNSET) return 1;
  if (b === UNSET && a !== UNSET) return -1;
  return compareTierCategoryLabels(a, b);
}

function countGroups(
  rows: CatalogTierTableRow[],
  field: (r: CatalogTierTableRow) => string,
  compareFn: (a: string, b: string) => number = compareLabels
): { label: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = normLabel(field(r));
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => compareFn(a.label, b.label));
}

function BrowseCard({
  label,
  count,
  sub,
  onClick,
  variant = "default",
}: {
  label: string;
  count: number;
  sub?: string;
  onClick: () => void;
  variant?: "default" | "show-all";
}) {
  return (
    <button
      type="button"
      className={`proposal-browse-card${variant === "show-all" ? " proposal-browse-card--show-all" : ""}`}
      onClick={onClick}
    >
      <span className="proposal-browse-card__label">{label}</span>
      {sub ? <span className="proposal-browse-card__sub">{sub}</span> : null}
      <span className="proposal-browse-card__count">
        {count} tier{count === 1 ? "" : "s"}
      </span>
    </button>
  );
}

function crumbLabel(value: string | null): string {
  if (value === BROWSE_SHOW_ALL) return "Show All";
  return value ?? "";
}

function phaseContextLabel(phase: string | null): string {
  if (!phase || phase === BROWSE_SHOW_ALL) return "Solutions";
  return `${phase} phase`;
}

function SolutionTierBrowsePath({
  browsePhase,
  browseCategory,
  browseTactic,
  browseLevel,
  onReset,
  onBackToPhases,
  onBackToCategories,
  onBackToTactics,
}: {
  browsePhase: string | null;
  browseCategory: string | null;
  browseTactic: string | null;
  browseLevel: "phase" | "category" | "tactic" | "tiers";
  onReset: () => void;
  onBackToPhases: () => void;
  onBackToCategories: () => void;
  onBackToTactics: () => void;
}) {
  if (browsePhase === null) {
    return (
      <nav className="proposal-catalog-crumb" aria-label="Solution tier browse path">
        <span className="proposal-catalog-crumb__current">Phase</span>
      </nav>
    );
  }

  const phaseName = crumbLabel(browsePhase);
  const categoryName = browseCategory !== null ? crumbLabel(browseCategory) : null;
  const tacticName = browseTactic !== null ? crumbLabel(browseTactic) : null;

  return (
    <nav className="proposal-catalog-crumb" aria-label="Solution tier browse path">
      <button type="button" className="proposal-catalog-crumb__link" onClick={onReset}>
        Phase
      </button>
      <span className="proposal-catalog-crumb__sep" aria-hidden>
        :
      </span>
      <button
        type="button"
        className="proposal-catalog-crumb__link"
        onClick={() => {
          if (browseLevel === "category") onBackToPhases();
          else onBackToCategories();
        }}
      >
        {phaseName}
      </button>

      {browseLevel === "category" ? (
        <span className="proposal-catalog-crumb__current"> / Category</span>
      ) : null}

      {categoryName !== null && browseLevel !== "category" ? (
        <>
          <button type="button" className="proposal-catalog-crumb__link" onClick={onBackToCategories}>
            {" "}
            / Category
          </button>
          <span className="proposal-catalog-crumb__sep" aria-hidden>
            :
          </span>
          <button type="button" className="proposal-catalog-crumb__link" onClick={onBackToCategories}>
            {categoryName}
          </button>
        </>
      ) : null}

      {browseLevel === "tiers" && browseCategory === null ? (
        <span className="proposal-catalog-crumb__current"> / All tiers</span>
      ) : null}

      {browseLevel === "tactic" ? (
        <span className="proposal-catalog-crumb__current"> / Tactic</span>
      ) : null}

      {tacticName !== null && browseLevel === "tiers" ? (
        <>
          <button type="button" className="proposal-catalog-crumb__link" onClick={onBackToTactics}>
            {" "}
            / Tactic
          </button>
          <span className="proposal-catalog-crumb__sep" aria-hidden>
            :
          </span>
          <button type="button" className="proposal-catalog-crumb__link" onClick={onBackToTactics}>
            {tacticName}
          </button>
        </>
      ) : null}
    </nav>
  );
}

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
  const [browsePhase, setBrowsePhase] = useState<string | null>(null);
  const [browseCategory, setBrowseCategory] = useState<string | null>(null);
  const [browseTactic, setBrowseTactic] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const [travelModalTierId, setTravelModalTierId] = useState<string | null>(null);
  const [travelHoursStr, setTravelHoursStr] = useState("");
  const [paidAdsModalTierId, setPaidAdsModalTierId] = useState<string | null>(null);
  const [paidAdsSpendStr, setPaidAdsSpendStr] = useState("");
  const [linkModalTierId, setLinkModalTierId] = useState<string | null>(null);
  const [selectedLinkedTierRefId, setSelectedLinkedTierRefId] = useState<string | null>(null);

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

  const rowsForPhase = useMemo(() => {
    if (browsePhase === null || browsePhase === BROWSE_SHOW_ALL) return catalogTierTableRows;
    return catalogTierTableRows.filter((r) => normLabel(r.phaseRaw) === browsePhase);
  }, [catalogTierTableRows, browsePhase]);

  const rowsForCategory = useMemo(() => {
    if (browseCategory === null || browseCategory === BROWSE_SHOW_ALL) return rowsForPhase;
    return rowsForPhase.filter((r) => normLabel(r.categoryRaw) === browseCategory);
  }, [rowsForPhase, browseCategory]);

  const rowsForTactic = useMemo(() => {
    if (browseTactic === null || browseTactic === BROWSE_SHOW_ALL) return rowsForCategory;
    return rowsForCategory.filter((r) => normLabel(r.tacticRaw) === browseTactic);
  }, [rowsForCategory, browseTactic]);

  const browseLevel = useMemo(() => {
    if (browsePhase === BROWSE_SHOW_ALL || browseCategory === BROWSE_SHOW_ALL || browseTactic === BROWSE_SHOW_ALL) {
      return "tiers" as const;
    }
    if (browseTactic !== null) return "tiers" as const;
    if (browseCategory !== null) return "tactic" as const;
    if (browsePhase !== null) return "category" as const;
    return "phase" as const;
  }, [browsePhase, browseCategory, browseTactic]);

  const stepPrompt = useMemo(() => {
    if (browseLevel === "phase") return "Pick A Phase";
    if (browseLevel === "category") return "Pick A Category";
    if (browseLevel === "tactic") return "Pick A Tactic";
    if (browsePhase === BROWSE_SHOW_ALL) return "All Tiers";
    if (browseCategory === BROWSE_SHOW_ALL) return `All Tiers In ${phaseContextLabel(browsePhase)}`;
    if (browseTactic === BROWSE_SHOW_ALL) {
      return `All Tiers In ${crumbLabel(browseCategory)}, ${phaseContextLabel(browsePhase)}`;
    }
    return `Add tiers — ${crumbLabel(browseTactic)}`;
  }, [browseLevel, browsePhase, browseCategory, browseTactic]);

  const searchLower = search.trim().toLowerCase();
  const tierRows = useMemo(() => {
    let rows = rowsForTactic;
    if (!searchLower) return rows;
    return rows.filter((r) => {
      const blob = `${r.tierName} ${r.solutionName} ${r.tierId} ${r.phaseRaw} ${r.categoryRaw} ${r.tacticRaw}`.toLowerCase();
      return blob.includes(searchLower);
    });
  }, [rowsForTactic, searchLower]);

  const phaseGroups = useMemo(
    () => countGroups(catalogTierTableRows, (r) => r.phaseRaw, comparePhaseGroupLabels),
    [catalogTierTableRows]
  );
  const categoryGroups = useMemo(
    () => countGroups(rowsForPhase, (r) => r.categoryRaw, compareCategoryGroupLabels),
    [rowsForPhase]
  );
  const tacticGroups = useMemo(() => countGroups(rowsForCategory, (r) => r.tacticRaw), [rowsForCategory]);

  const resetBrowse = () => {
    setBrowsePhase(null);
    setBrowseCategory(null);
    setBrowseTactic(null);
    setSearch("");
  };

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
      panelVariant === "preset_packages"
        ? "preset_packages"
        : panelVariant === "configurable_packages"
          ? "configurable_packages"
          : panelVariant === "variable_tiers"
            ? "variable_tiers"
            : "catalog";
    const def = proposalStepDef(stepId);
    if (panelVariant === "preset_packages") {
      return {
        ...def,
        lead:
          "Add custom packages you already built from configurable templates in Step 3. Pick one to add it to the active scenario and phase. This step is optional—you can skip it and continue.",
      };
    }
    if (panelVariant === "configurable_packages") {
      return {
        ...def,
        lead:
          "Build custom packages from configurable templates in Package Builder. This step is optional—you can skip it and continue.",
      };
    }
    if (panelVariant === "variable_tiers") {
      return {
        ...def,
        lead:
          "Variable solutions are add-ons like Paid Campaign Management, Rush Charge, and Travel Time — priced dynamically from the solutions already in this scenario. This step is optional—you can skip it and continue.",
      };
    }
    return {
      ...def,
      lead:
        "Choose where items land, then add Solution Tiers from the playbook. Use Show All to skip a drill-down level.",
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
        <p className="proposal-step-panel__eyebrow">Step {stepMeta.number}</p>
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
                    ? "Build a package in Step 3, then refresh solutions."
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
          <p className="proposal-catalog-step-prompt">Pick A Variable Solution</p>
          <p className="proposal-catalog-offerings__hint">
            Add-ons like Paid Campaign Management, Rush Charge, and Travel Time — priced dynamically
            from scenario solutions · adding to <strong>{targetScenarioTitle}</strong> ·{" "}
            <strong>{targetPhaseTitle}</strong>
          </p>
          <ProposalCatalogListSearch
            id={searchId}
            value={search}
            onChange={setSearch}
            placeholder="Search variable solutions…"
            label="Search variable solutions"
          />
          <ProposalCatalogLinesPanel
            count={variableTierRows.length}
            isEmpty={variableTierRows.length === 0}
            emptyTitle="No variable solutions"
            emptyText="Variable solutions are configured in the Solutions Directory."
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
          <div className="proposal-catalog-browse__head">
            <SolutionTierBrowsePath
              browsePhase={browsePhase}
              browseCategory={browseCategory}
              browseTactic={browseTactic}
              browseLevel={browseLevel}
              onReset={resetBrowse}
              onBackToPhases={() => {
                setBrowsePhase(null);
                setBrowseCategory(null);
                setBrowseTactic(null);
                setSearch("");
              }}
              onBackToCategories={() => {
                setBrowseCategory(null);
                setBrowseTactic(null);
                setSearch("");
              }}
              onBackToTactics={() => {
                setBrowseTactic(null);
                setSearch("");
              }}
            />
          </div>
          <p className="proposal-catalog-step-prompt">{stepPrompt}</p>

          {browseLevel === "phase" ? (
            <div className="proposal-catalog-browse-grid" role="list" aria-label="Phases">
              <BrowseCard
                label="Show All"
                count={catalogTierTableRows.length}
                sub="All Tiers"
                variant="show-all"
                onClick={() => {
                  setBrowsePhase(BROWSE_SHOW_ALL);
                  setBrowseCategory(null);
                  setBrowseTactic(null);
                  setSearch("");
                }}
              />
              {phaseGroups.map(({ label, count }) => (
                <BrowseCard
                  key={label}
                  label={label}
                  count={count}
                  sub="Then pick a category"
                  onClick={() => {
                    setBrowsePhase(label);
                    setBrowseCategory(null);
                    setBrowseTactic(null);
                  }}
                />
              ))}
            </div>
          ) : null}

          {browseLevel === "category" ? (
            <div className="proposal-catalog-browse-grid" role="list" aria-label="Categories">
              <BrowseCard
                label="Show All"
                count={rowsForPhase.length}
                sub={`All Tiers In ${phaseContextLabel(browsePhase)}`}
                variant="show-all"
                onClick={() => {
                  setBrowseCategory(BROWSE_SHOW_ALL);
                  setBrowseTactic(null);
                  setSearch("");
                }}
              />
              {categoryGroups.map(({ label, count }) => (
                <BrowseCard
                  key={label}
                  label={label}
                  count={count}
                  sub="Then pick a tactic"
                  onClick={() => {
                    setBrowseCategory(label);
                    setBrowseTactic(null);
                  }}
                />
              ))}
            </div>
          ) : null}

          {browseLevel === "tactic" ? (
            <div className="proposal-catalog-browse-grid" role="list" aria-label="Tactics">
              <BrowseCard
                label="Show All"
                count={rowsForCategory.length}
                sub={`All Tiers In ${crumbLabel(browseCategory)}, ${phaseContextLabel(browsePhase)}`}
                variant="show-all"
                onClick={() => {
                  setBrowseTactic(BROWSE_SHOW_ALL);
                  setSearch("");
                }}
              />
              {tacticGroups.map(({ label, count }) => (
                <BrowseCard
                  key={label}
                  label={label}
                  count={count}
                  sub="View tiers to add"
                  onClick={() => {
                    setBrowseTactic(label);
                    setSearch("");
                  }}
                />
              ))}
            </div>
          ) : null}

          {browseLevel === "tiers" ? (
            <div className="proposal-catalog-offerings">
              <ProposalCatalogListSearch
                id={searchId}
                value={search}
                onChange={setSearch}
                placeholder="Search tiers or solutions…"
                label="Search solution tiers"
              />
              <ProposalCatalogLinesPanel
                count={tierRows.length}
                isEmpty={tierRows.length === 0}
                emptyTitle="No tiers match"
                emptyText="Try search or go back and pick another tactic."
              >
                {tierRows.map((r) => {
                  const onProposal = addedTierRefIds.has(r.tierId);
                  const justAdded = justAddedId === `tier:${r.tierId}`;
                  const taxonomy =
                    [r.phaseRaw, r.categoryRaw, r.tacticRaw].filter((x) => x.trim()).join(" · ") ||
                    r.solutionName;
                  return (
                    <ProposalCatalogLineRow
                      key={r.tierId}
                      kind="tier"
                      title={r.tierName}
                      detail={taxonomy}
                      hours={r.hoursDisplay}
                      price={r.priceDisplay}
                      onProposal={onProposal}
                      justAdded={justAdded}
                      canAdd={canAdd}
                      onAdd={() => handleAddTier(r.tierId)}
                    />
                  );
                })}
              </ProposalCatalogLinesPanel>
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
          ) : null}
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
