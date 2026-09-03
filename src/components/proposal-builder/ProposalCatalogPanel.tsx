import { useCallback, useId, useMemo, useState } from "react";
import type { Package, Solution, SolutionTier } from "../../types";
import type { CatalogTierTableRow } from "../CatalogTierTable";
import type { RoadmapPhase, RoadmapScenario } from "../../lib/roadmapModel";
import { sortedPhasesForScenario } from "../../lib/roadmapModel";
import {
  emptyOfferingDates,
  enumerateProposalMonths,
  type ProposalOfferingDates,
} from "../../lib/proposalDates";
import {
  computePaidAdsOptimizationUsd,
  isPaidAdsVariableTierRefId,
  isPercentVariableTierRefId,
  isTravelVariableTierRefId,
  paidAdsOptimizationFormulaLabel,
  variableTierRuleSummary,
  type AddVariableTierOpts,
  type VariableTierLinkTarget,
} from "../../lib/proposalVariableTiers";
import { buildSolutionDirectoryRowsFromTier, buildModuleAddOnGroups, isSolutionModuleName } from "../../lib/buildCatalogDirectoryRows";
import {
  isFlexBudgetName,
  isFlexBudgetTier,
  parseFlexBudgetPriceInput,
} from "../../lib/proposalFlexBudget";
import { formatProposalUsdValue } from "../../lib/proposalCardTasks";
import { ProposalAddOnsModal } from "./ProposalAddOnsModal";
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
  solutions?: Solution[];
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
  onAddTier: (
    t: SolutionTier,
    dates: ProposalOfferingDates,
    clientFacingLabel?: string,
    addonTiers?: SolutionTier[],
    opts?: { flexBudgetPriceUsd?: number }
  ) => void;
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
  onEditAdded?: (key: string) => void;
  onDuplicateAdded?: (key: string) => void;
  onAddAddOns?: (parentKey: string, tierIds: string[]) => void;
  addedTierRefIds: Set<string>;
  addedPackageRefIds: Set<string>;
  copyFromScenarios?: ScenarioCopySource[];
  onCopyFromScenario?: (sourceScenarioId: string) => void;
};

function parsePaidAdsSpendInput(raw: string): number {
  return Number(String(raw).trim().replace(/[$,\s]/g, ""));
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
  onEditAdded,
  onDuplicateAdded,
  onAddAddOns,
  addedTierRefIds,
  addedPackageRefIds,
  copyFromScenarios,
  onCopyFromScenario,
}: Props) {
  const searchId = useId();
  const travelHoursFieldId = useId();
  const paidAdsSpendFieldIdPrefix = useId();
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
  const [paidAdsSpendByMonth, setPaidAdsSpendByMonth] = useState<Record<string, string>>({});
  const [linkModalTierId, setLinkModalTierId] = useState<string | null>(null);
  const [selectedLinkedTierRefId, setSelectedLinkedTierRefId] = useState<string | null>(null);

  const [dirItemType, setDirItemType] = useState<CatalogDirectoryTypeFilter>(null);
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
    | {
        kind: "tier";
        tier: SolutionTier;
        clientFacingLabel: string;
        addonTiers?: SolutionTier[];
        flexBudgetPriceUsd?: number;
      }
    | { kind: "package"; pkg: Package }
    | { kind: "scratch" }
    | { kind: "variable"; tier: SolutionTier; opts: AddVariableTierOpts };

  const [datesModalPending, setDatesModalPending] = useState<PendingOfferingAdd | null>(null);
  const [labelPrompt, setLabelPrompt] = useState<{
    tier: SolutionTier;
    solutionName: string;
    draft: string;
    addOnsAllowed: boolean;
  } | null>(null);
  const [flexPricePrompt, setFlexPricePrompt] = useState<{
    tier: SolutionTier;
    solutionName: string;
    clientFacingLabel: string;
    addOnsAllowed: boolean;
    draft: string;
  } | null>(null);
  const [addOnsPrompt, setAddOnsPrompt] = useState<{
    tier: SolutionTier;
    solutionName: string;
    clientFacingLabel: string;
    selectedIds: Set<string>;
    flexBudgetPriceUsd?: number;
  } | null>(null);

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
    () =>
      buildSolutionDirectoryRowsFromTier(catalogTierTableRows).filter(
        (r) => r.type === "configured_solution"
      ),
    [catalogTierTableRows]
  );

  const moduleAddOnGroups = useMemo(
    () => buildModuleAddOnGroups(catalogTierTableRows),
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

  const paidAdsMonths = useMemo(
    () => enumerateProposalMonths(proposalStartDate, proposalEndDate),
    [proposalStartDate, proposalEndDate]
  );

  const closeTravelModal = () => {
    setTravelModalTierId(null);
    setTravelHoursStr("");
  };

  const closePaidAdsModal = () => {
    setPaidAdsModalTierId(null);
    setPaidAdsSpendByMonth({});
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
    if (!paidAdsModalTier || paidAdsMonths.length === 0) return;
    const months: NonNullable<AddVariableTierOpts["paidAdsMonths"]> = [];
    for (const m of paidAdsMonths) {
      const spend = parsePaidAdsSpendInput(paidAdsSpendByMonth[m.key] ?? "");
      if (!Number.isFinite(spend) || spend <= 0) return;
      months.push({
        spendUsd: spend,
        startDate: m.startDate,
        endDate: m.endDate,
        monthLabel: m.label,
      });
    }
    onAddVariableTier(paidAdsModalTier, emptyOfferingDates(), { paidAdsMonths: months });
    const justAdded = `tier:${paidAdsModalTier.solution_tier_id}`;
    setJustAddedId(justAdded);
    window.setTimeout(() => setJustAddedId((id) => (id === justAdded ? null : id)), 1600);
    closePaidAdsModal();
  };

  const paidAdsAllMonthsValid =
    paidAdsMonths.length > 0 &&
    paidAdsMonths.every((m) => {
      const spend = parsePaidAdsSpendInput(paidAdsSpendByMonth[m.key] ?? "");
      return Number.isFinite(spend) && spend > 0;
    });

  const paidAdsPreviewRows = useMemo(() => {
    return paidAdsMonths.map((m) => {
      const spend = parsePaidAdsSpendInput(paidAdsSpendByMonth[m.key] ?? "");
      const sell =
        Number.isFinite(spend) && spend > 0 ? computePaidAdsOptimizationUsd(spend) : null;
      const formula =
        Number.isFinite(spend) && spend > 0 ? paidAdsOptimizationFormulaLabel(spend) : null;
      return { ...m, spend, sell, formula };
    });
  }, [paidAdsMonths, paidAdsSpendByMonth]);

  const paidAdsTotalSell = useMemo(() => {
    let sum = 0;
    let any = false;
    for (const row of paidAdsPreviewRows) {
      if (row.sell != null) {
        sum += row.sell;
        any = true;
      }
    }
    return any ? sum : null;
  }, [paidAdsPreviewRows]);

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
      setPaidAdsSpendByMonth({});
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
        label: "Copy a Previously Created Package",
        lead: "Copy a packages that has been used before.",
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
        ? "Copy a Previously Created Package"
        : "Pick A Custom Package";
  const packageHint =
    panelVariant === "configurable_packages"
      ? "Configurable packages from Package Builder templates"
      : panelVariant === "preset_packages"
        ? "Copy a packages that has been used before"
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
        onAddTier(pending.tier, dates, pending.clientFacingLabel, pending.addonTiers, {
          flexBudgetPriceUsd: pending.flexBudgetPriceUsd,
        });
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
    if (pending.kind === "tier") {
      const extra = pending.addonTiers?.length ?? 0;
      const base = pending.clientFacingLabel || pending.tier.solution_tier_name;
      return extra > 0 ? `${base} + ${extra} add-on${extra === 1 ? "" : "s"}` : base;
    }
    if (pending.kind === "variable") return pending.tier.solution_tier_name;
    if (pending.kind === "package") return pending.pkg.package_name;
    return "Scratch tier";
  }, [datesModalPending]);

  const handleAddTier = (tierId: string) => {
    const tier = tierById.get(tierId);
    if (!tier || !canAdd) return;
    const parent = solutionDirectoryRows.find((r) => r.tierRows.some((t) => t.tierId === tierId));
    if (!parent || parent.type === "solution_module" || isSolutionModuleName(parent.name)) return;
    const row = catalogTierTableRows.find((r) => r.tierId === tierId);
    const solutionName =
      parent.name.trim() ||
      row?.solutionName?.trim() ||
      tier.solution_tier_name.trim() ||
      tier.solution_tier_id;
    const parentSol = (ctx.solutions ?? []).find((s) => s.solution_id === parent.solutionId);
    const addOnsAllowed = Boolean(parentSol?.add_ons_allowed) && moduleAddOnGroups.length > 0;
    setLabelPrompt({
      tier,
      solutionName,
      draft: solutionName,
      addOnsAllowed,
    });
  };

  const openDatesForTier = (
    tier: SolutionTier,
    clientFacingLabel: string,
    addonTiers?: SolutionTier[],
    flexBudgetPriceUsd?: number
  ) => {
    setDatesModalPending({
      kind: "tier",
      tier,
      clientFacingLabel,
      addonTiers: addonTiers && addonTiers.length > 0 ? addonTiers : undefined,
      flexBudgetPriceUsd,
    });
  };

  const continueAfterLabel = (
    tier: SolutionTier,
    solutionName: string,
    label: string,
    addOnsAllowed: boolean
  ) => {
    const isFlex =
      isFlexBudgetTier(tier) ||
      isFlexBudgetName(solutionName) ||
      isFlexBudgetName(label);
    if (isFlex) {
      setFlexPricePrompt({
        tier,
        solutionName,
        clientFacingLabel: label,
        addOnsAllowed,
        draft: "",
      });
      return;
    }
    if (addOnsAllowed) {
      setAddOnsPrompt({
        tier,
        solutionName,
        clientFacingLabel: label,
        selectedIds: new Set(),
      });
      return;
    }
    openDatesForTier(tier, label);
  };

  const confirmLabelPrompt = () => {
    if (!labelPrompt || !canAdd) return;
    const label =
      labelPrompt.draft.trim() ||
      labelPrompt.solutionName.trim() ||
      labelPrompt.tier.solution_tier_name.trim() ||
      labelPrompt.tier.solution_tier_id;
    const { tier, solutionName, addOnsAllowed } = labelPrompt;
    setLabelPrompt(null);
    continueAfterLabel(tier, solutionName, label, addOnsAllowed);
  };

  const cancelLabelPrompt = () => setLabelPrompt(null);

  const cancelFlexPricePrompt = () => setFlexPricePrompt(null);

  const confirmFlexPricePrompt = () => {
    if (!flexPricePrompt || !canAdd) return;
    const usd = parseFlexBudgetPriceInput(flexPricePrompt.draft);
    if (usd == null) {
      window.alert("Enter a Flex Budget sell price (for example 15000 or $15,000).");
      return;
    }
    const { tier, solutionName, clientFacingLabel, addOnsAllowed } = flexPricePrompt;
    setFlexPricePrompt(null);
    if (addOnsAllowed) {
      setAddOnsPrompt({
        tier,
        solutionName,
        clientFacingLabel,
        selectedIds: new Set(),
        flexBudgetPriceUsd: usd,
      });
      return;
    }
    openDatesForTier(tier, clientFacingLabel, undefined, usd);
  };

  const cancelAddOnsPrompt = () => setAddOnsPrompt(null);

  const toggleAddOnTier = (tierId: string) => {
    setAddOnsPrompt((prev) => {
      if (!prev) return prev;
      const next = new Set(prev.selectedIds);
      if (next.has(tierId)) next.delete(tierId);
      else next.add(tierId);
      return { ...prev, selectedIds: next };
    });
  };

  const confirmAddOnsPrompt = () => {
    if (!addOnsPrompt || !canAdd) return;
    const addonTiers = [...addOnsPrompt.selectedIds]
      .map((id) => tierById.get(id))
      .filter((t): t is SolutionTier => t != null);
    openDatesForTier(
      addOnsPrompt.tier,
      addOnsPrompt.clientFacingLabel,
      addonTiers,
      addOnsPrompt.flexBudgetPriceUsd
    );
    setAddOnsPrompt(null);
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
          onEdit={onEditAdded}
          onDuplicate={onDuplicateAdded}
          copyFromScenarios={copyFromScenarios}
          onCopyFromScenario={onCopyFromScenario}
          addonGroups={moduleAddOnGroups}
          onAddAddOns={onAddAddOns}
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
                  Enter ad spend for each month. Sell price is calculated from the rates below; each
                  month is added as its own line.
                </p>
              </div>
            </header>

            <div className="proposal-travel-modal__body">
              <div className="proposal-travel-modal__rate" aria-label="Pricing tiers">
                <span className="proposal-travel-modal__rate-label">Rate per $1k spend</span>
                <div className="proposal-travel-modal__rate-tiers">
                  <span>≤ $2k → $400</span>
                  <span>≤ $10k → $270</span>
                  <span>&lt; $40k → $200</span>
                  <span>≥ $40k → $175</span>
                </div>
              </div>

              {paidAdsMonths.length === 0 ? (
                <div className="proposal-travel-modal__dates-missing" role="status">
                  <strong>Set proposal dates in Setup</strong>
                  <span>
                    Paid Campaign Management needs a Proposal Start Date and End Date so months can be
                    listed here.
                  </span>
                </div>
              ) : (
                <>
                  <div className="proposal-paid-ads-months" role="group" aria-label="Monthly paid ads spend">
                    <div className="proposal-paid-ads-months__head">
                      <span>Month</span>
                      <span>Monthly ad spend</span>
                      <span>Est. sell</span>
                    </div>
                    <ul className="proposal-paid-ads-months__list">
                      {paidAdsPreviewRows.map((row, idx) => {
                        const fieldId = `${paidAdsSpendFieldIdPrefix}-${row.key}`;
                        return (
                          <li key={row.key} className="proposal-paid-ads-months__row">
                            <div className="proposal-paid-ads-months__month">
                              <label htmlFor={fieldId} className="proposal-paid-ads-months__month-label">
                                {row.label}
                              </label>
                            </div>
                            <div className="proposal-travel-modal__input-wrap proposal-paid-ads-months__input-wrap">
                              <span className="proposal-travel-modal__input-prefix">$</span>
                              <input
                                id={fieldId}
                                type="number"
                                min={1}
                                step={100}
                                inputMode="decimal"
                                className="proposal-travel-modal__input proposal-travel-modal__input--currency proposal-paid-ads-months__input"
                                placeholder="0"
                                value={paidAdsSpendByMonth[row.key] ?? ""}
                                autoFocus={idx === 0}
                                onChange={(e) =>
                                  setPaidAdsSpendByMonth((prev) => ({
                                    ...prev,
                                    [row.key]: e.target.value,
                                  }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Escape") closePaidAdsModal();
                                }}
                              />
                            </div>
                            <div
                              className={`proposal-paid-ads-months__sell${row.sell != null ? " proposal-paid-ads-months__sell--live" : ""}`}
                              title={row.formula ?? undefined}
                            >
                              {row.sell != null ? formatUsd(row.sell) : "—"}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  <div
                    className={`proposal-travel-modal__preview${paidAdsTotalSell != null ? " proposal-travel-modal__preview--live" : ""}`}
                    role="status"
                  >
                    <span className="proposal-travel-modal__preview-label">Total estimated sell</span>
                    <strong className="proposal-travel-modal__preview-value">
                      {paidAdsTotalSell != null ? formatUsd(paidAdsTotalSell) : "—"}
                    </strong>
                    <span className="proposal-travel-modal__preview-hint">
                      {paidAdsAllMonthsValid
                        ? `${paidAdsMonths.length} month${paidAdsMonths.length === 1 ? "" : "s"} will be added as separate lines`
                        : "Enter spend for every month to continue"}
                    </span>
                  </div>
                </>
              )}
            </div>

            <footer className="roadmap-modal__actions proposal-travel-modal__actions">
              <button type="button" className="roadmap-btn roadmap-btn--ghost" onClick={closePaidAdsModal}>
                Cancel
              </button>
              <button
                type="button"
                className="roadmap-btn roadmap-btn--primary proposal-travel-modal__submit"
                disabled={!paidAdsAllMonthsValid}
                onClick={submitPaidAdsModal}
              >
                {paidAdsMonths.length > 1
                  ? `Add ${paidAdsMonths.length} months`
                  : "Add to scenario"}
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

      {labelPrompt ? (
        <div
          className="agency-pkg-label-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) cancelLabelPrompt();
          }}
        >
          <div
            className="agency-pkg-label-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="proposal-sol-label-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="agency-pkg-label-modal__header">
              <div className="agency-pkg-label-modal__head-copy">
                <p className="agency-pkg-label-modal__eyebrow">Add solution</p>
                <h3 id="proposal-sol-label-title" className="agency-pkg-label-modal__title">
                  Client Facing Label
                </h3>
                <p className="agency-pkg-label-modal__sub">
                  {labelPrompt.solutionName}
                  {labelPrompt.tier.solution_tier_name.trim() &&
                  labelPrompt.tier.solution_tier_name.trim() !== labelPrompt.solutionName
                    ? ` · ${labelPrompt.tier.solution_tier_name}`
                    : ""}
                </p>
              </div>
              <button
                type="button"
                className="agency-pkg-label-modal__close"
                aria-label="Close"
                onClick={cancelLabelPrompt}
              >
                ×
              </button>
            </header>
            <div className="agency-pkg-label-modal__body">
              <label className="agency-pkg-label-modal__field">
                <span className="agency-pkg-label-modal__field-label">
                  How this should appear to the client
                </span>
                <input
                  className="agency-pkg-label-modal__input"
                  value={labelPrompt.draft}
                  onChange={(e) =>
                    setLabelPrompt((prev) => (prev ? { ...prev, draft: e.target.value } : prev))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      confirmLabelPrompt();
                    }
                  }}
                  autoFocus
                  placeholder={labelPrompt.solutionName || "Client facing label"}
                />
              </label>
              <p className="agency-pkg-label-modal__hint">
                Defaults to the solution name. Change it if you want a different title on the proposal.
              </p>
            </div>
            <footer className="agency-pkg-label-modal__footer">
              <button type="button" className="roadmap-btn roadmap-btn--ghost" onClick={cancelLabelPrompt}>
                Cancel
              </button>
              <button type="button" className="roadmap-btn roadmap-btn--primary" onClick={confirmLabelPrompt}>
                Continue
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {flexPricePrompt ? (
        <div
          className="agency-pkg-label-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) cancelFlexPricePrompt();
          }}
        >
          <div
            className="agency-pkg-label-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="proposal-flex-price-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="agency-pkg-label-modal__header">
              <div className="agency-pkg-label-modal__head-copy">
                <p className="agency-pkg-label-modal__eyebrow">Flex Budget</p>
                <h3 id="proposal-flex-price-title" className="agency-pkg-label-modal__title">
                  Flex Budget price
                </h3>
                <p className="agency-pkg-label-modal__sub">
                  {flexPricePrompt.clientFacingLabel}
                  {flexPricePrompt.solutionName.trim() &&
                  flexPricePrompt.solutionName.trim() !== flexPricePrompt.clientFacingLabel
                    ? ` · ${flexPricePrompt.solutionName}`
                    : ""}
                </p>
              </div>
              <button
                type="button"
                className="agency-pkg-label-modal__close"
                aria-label="Close"
                onClick={cancelFlexPricePrompt}
              >
                ×
              </button>
            </header>
            <div className="agency-pkg-label-modal__body">
              <label className="agency-pkg-label-modal__field">
                <span className="agency-pkg-label-modal__field-label">Sell price for this proposal</span>
                <input
                  className="agency-pkg-label-modal__input"
                  inputMode="decimal"
                  value={flexPricePrompt.draft}
                  onChange={(e) =>
                    setFlexPricePrompt((prev) => (prev ? { ...prev, draft: e.target.value } : prev))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      confirmFlexPricePrompt();
                    }
                  }}
                  autoFocus
                  placeholder="e.g. 15000 or $15,000"
                />
              </label>
              <p className="agency-pkg-label-modal__hint">
                This amount is the proposal sell for Flex Budget only. Of that price, 18% counts toward account
                management and 1% toward continuous improvement (shown as derived hours in Organize / Preview).
                {(() => {
                  const preview = parseFlexBudgetPriceInput(flexPricePrompt.draft);
                  if (preview == null) return null;
                  return (
                    <>
                      {" "}
                      Preview: {formatProposalUsdValue(preview)} sell ·{" "}
                      {formatProposalUsdValue(preview * 0.18)} AM · {formatProposalUsdValue(preview * 0.01)} CI.
                    </>
                  );
                })()}
              </p>
            </div>
            <footer className="agency-pkg-label-modal__footer">
              <button
                type="button"
                className="roadmap-btn roadmap-btn--ghost"
                onClick={cancelFlexPricePrompt}
              >
                Cancel
              </button>
              <button
                type="button"
                className="roadmap-btn roadmap-btn--primary"
                onClick={confirmFlexPricePrompt}
              >
                Continue
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      <ProposalAddOnsModal
        open={addOnsPrompt != null}
        solutionName={addOnsPrompt?.solutionName ?? ""}
        tierName={addOnsPrompt?.tier.solution_tier_name ?? ""}
        groups={moduleAddOnGroups}
        selectedTierIds={addOnsPrompt?.selectedIds ?? new Set()}
        onToggleTier={toggleAddOnTier}
        onCancel={cancelAddOnsPrompt}
        onContinue={confirmAddOnsPrompt}
      />
    </div>
  );
}
