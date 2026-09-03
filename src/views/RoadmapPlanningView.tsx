import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, SetStateAction } from "react";
import { browserKeyConfigurationError, getSupabase } from "../lib/supabase";
import {
  cardHoursForScenarioRollup,
  cardPriceUsdForRollup,
  effectivePriceStr,
  type CatalogCtxLike,
  type RoadmapCard,
  type RoadmapCardKind,
  type RoadmapPhase,
  type RoadmapScenario,
  reorderPhaseCardsByKeys,
  sortedPhasesForScenario,
  scratchEffectiveHoursBreakdown,
  tryParseUsdRough,
} from "../lib/roadmapModel";
import type { CatalogTierTableRow } from "../components/CatalogTierTable";
import { ProposalBuilderModeTabs, type ProposalBuilderMode } from "../components/proposal-builder/ProposalBuilderModeTabs";
import { PROPOSAL_DURATION_LABEL } from "../branding";
import { ProposalSavedProposalsPanel } from "../components/proposal-builder/ProposalSavedProposalsPanel";
import { ProposalBuilderSteps, type ProposalBuilderStep } from "../components/proposal-builder/ProposalBuilderSteps";
import { ProposalStepNav } from "../components/proposal-builder/ProposalStepNav";
import { ProposalOrganizePanel } from "../components/proposal-builder/ProposalOrganizePanel";
import { ProposalScenariosPanel } from "../components/proposal-builder/ProposalScenariosPanel";
import { ProposalCatalogPanel } from "../components/proposal-builder/ProposalCatalogPanel";
import type { ProposalAddedLine } from "../components/proposal-builder/ProposalAddedItemsPanel";
import {
  ProposalAddedEditModal,
  type ProposalAddedEditPatch,
} from "../components/proposal-builder/ProposalAddedEditModal";
import { PackageBuildWizard } from "../components/PackageBuildWizard";
import { ProposalClientServiceReviewPanel } from "../components/proposal-builder/ProposalClientServiceReviewPanel";
import { ProposalClientReadyPanel } from "../components/proposal-builder/ProposalClientReadyPanel";
import { TierResourceExamplesDisplay } from "../components/TierResourceExamplesDisplay";
import { useToast, useToastBusy } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { useProposalDraftGuard } from "../context/ProposalDraftGuardContext";
import {
  effectiveResourceExamples,
  effectiveResourceTools,
  stripRedundantResourceMarkdownHeading,
  tierTemplatesForProposalDisplay,
} from "../lib/tierResourceFields";
import { computePackageWorkspaceCatalogNumbers } from "../lib/packageWorkspaceMetrics";
import { mergeTierWithPackageOverrides, parseTierOverrides } from "../lib/packageTierOverrides";
import { catalogDisplayTierHours, formatTierHoursDisplay } from "../lib/vaultTierMetrics";
import { displayTierCategoryLabel } from "../lib/tierCategories";
import {
  loadTierPricingMathConfigFromStorage,
  normalizeTierPricingMathConfig,
  type TierPricingMathConfig,
} from "../lib/tierPricingMath";
import { downloadProposalOpsPdf, downloadProposalPdf } from "../lib/proposalPdfExport";
import { ProposalExportPreviewTables } from "../components/proposal-builder/ProposalExportPreviewTables";
import {
  normalizeIsoDateInput,
  proposalDateRangeLabel,
  type ProposalOfferingDates,
} from "../lib/proposalDates";
import {
  applyRoadmapNameDateSuffix,
  isValidRoadmapNameFormat,
  ROADMAP_NAME_CLIENT_CODE_TOOLTIP,
  ROADMAP_NAME_FORMAT_EXAMPLE,
  ROADMAP_NAME_FORMAT_HINT,
} from "../lib/roadmapNameFormat";
import {
  createScenariosAndPhasesForKind,
  defaultPhaseTitleForKind,
  defaultScenarioTitleForKind,
  type ProposalKind,
} from "../lib/proposalKindPresets";
import {
  cloneProposalStructure,
  isAwaitingOpsReview,
  isClientReadyProposal,
  parseProposalSnapshot,
  type ProposalReviewStatus,
  type RoadmapHorizon,
  type RoadmapProposalSnapshot,
} from "../lib/roadmapProposalSnapshot";
import { ProposalCopyFromPanel } from "../components/proposal-builder/ProposalCopyFromPanel";
import { ProposalSaveReminderBanner } from "../components/proposal-builder/ProposalSaveReminderBanner";
import { catalogSolutionKind, buildModuleAddOnGroups } from "../lib/buildCatalogDirectoryRows";
import { copyScenarioOfferings } from "../lib/copyScenarioOfferings";
import { proposalSnapshotFingerprint } from "../lib/proposalDraftFingerprint";
import { notifyOpsReviewSubmitted } from "../lib/notifyOpsReviewEmail";
import { fetchPackageBuilderCatalog } from "../lib/packageBuilderSlots";
import { fetchAllTaskRows } from "../lib/taskIds";
import { filterConfigurablePackages } from "../lib/presetPackages";
import { ProposalConfigurablePackagesPanel } from "../components/proposal-builder/ProposalConfigurablePackagesPanel";
import {
  ProposalPackagesChoice,
  ProposalPackagesPathBar,
  ProposalPackagesSwitchPrompt,
  type PackageAddPath,
} from "../components/proposal-builder/ProposalPackagesChoice";
import {
  applyVariableTierPricingToCards,
  computeVariableTierSellUsd,
  isPaidAdsVariableTierRefId,
  isPercentVariableTierRefId,
  isTravelVariableTierRefId,
  isVariableTierRefId,
  variableTierLinkTargetsForScenario,
  variableTierAppliedToLabel,
  type AddVariableTierOpts,
} from "../lib/proposalVariableTiers";
import { formatProposalUsdValue } from "../lib/proposalCardTasks";
import type {
  ImplementerHourGroupRow,
  Package,
  PackageSolutionTier,
  RoadmapProposalRow,
  Solution,
  SolutionTier,
  SolutionTierPricing,
  PackageBuilderPackageType,
  PackageBuilderSlotTemplate,
  TaskGroupLineRow,
  TaskGroupRow,
  TaskRow,
} from "../types";

type LoadState =
  | { status: "idle" | "loading" }
  | { status: "error"; message: string }
  | {
      status: "ok";
      packages: Package[];
      solutions: Solution[];
      tiers: SolutionTier[];
      packageTiers: PackageSolutionTier[];
      tasks: TaskRow[];
      taskGroups: TaskGroupRow[];
      tierPricing: SolutionTierPricing[];
      taskGroupLines: TaskGroupLineRow[];
      implementerHourGroups: ImplementerHourGroupRow[];
      packageTypes: PackageBuilderPackageType[];
      packageBuilderSlots: PackageBuilderSlotTemplate[];
    };

type CatalogCtx = {
  packages: Package[];
  solutions: Solution[];
  tiers: SolutionTier[];
  packageTiers: PackageSolutionTier[];
  tasks: TaskRow[];
  taskGroups: TaskGroupRow[];
  pricingMap: Map<string, SolutionTierPricing>;
  groupLinesMap: Map<string, TaskGroupLineRow[]>;
  implementerHourGroups: ImplementerHourGroupRow[];
  tierPricingMathConfig: TierPricingMathConfig;
};

function formatUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(n));
}

function sellPriceNumber(pricing: SolutionTierPricing | null): number | null {
  if (!pricing) return null;
  const primary = pricing.sell_price;
  if (primary != null && Number.isFinite(Number(primary))) return Number(primary);
  const fallback = pricing.standalone_sell_price;
  if (fallback != null && Number.isFinite(Number(fallback))) return Number(fallback);
  return null;
}

function sellPriceLine(pricing: SolutionTierPricing | null): string {
  const n = sellPriceNumber(pricing);
  return n != null ? formatUsd(n) : "—";
}

function tierHoursLine(
  tierId: string,
  pricing: SolutionTierPricing | null,
  tasks: TaskRow[]
): string {
  const h = catalogDisplayTierHours(pricing, tasks, tierId);
  return h != null ? `${formatTierHoursDisplay(h)} h` : "—";
}

function tierPitchText(t: SolutionTier): string {
  const pick =
    t.solution_tier_overview?.trim() ||
    t.solution_tier_why_is_it_valuable?.trim() ||
    "";
  return pick;
}

function newRoadmapCardKey(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

function applyOfferingDates(card: RoadmapCard, dates?: ProposalOfferingDates): RoadmapCard {
  if (!dates) return card;
  return {
    ...card,
    startDate: normalizeIsoDateInput(dates.startDate) || null,
    endDate: normalizeIsoDateInput(dates.endDate) || null,
  };
}

function makeCard(
  kind: RoadmapCardKind,
  refId: string,
  scenarioId: string,
  phaseId: string,
  headline: string,
  description: string,
  hours: string,
  price: string,
  scratch?: Pick<RoadmapCard, "scratchBlendRateUsd" | "scratchRiskMult" | "scratchStrategicMult">,
  dates?: ProposalOfferingDates
): RoadmapCard {
  return applyOfferingDates(
    {
      key: newRoadmapCardKey(),
      kind,
      refId,
      scenarioId,
      phaseId,
      headline,
      description,
      hours,
      price,
      scope: "included",
      hoursOverride: null,
      priceOverride: null,
      ...scratch,
    },
    dates
  );
}

const DEFAULT_SCRATCH_BLEND = 175;
const DEFAULT_SCRATCH_MULT = 1;

type ScratchPricingInput = Pick<
  RoadmapCard,
  | "kind"
  | "hours"
  | "hoursOverride"
  | "scratchBlendRateUsd"
  | "scratchRiskMult"
  | "scratchStrategicMult"
  | "scratchAttachedTaskIds"
  | "scratchAttachedTaskGroupIds"
>;

function computeScratchSellPrice(card: ScratchPricingInput, ctx: CatalogCtxLike | null): string {
  const b = scratchEffectiveHoursBreakdown(card, ctx);
  if (!b) return "—";
  const rate = card.scratchBlendRateUsd ?? DEFAULT_SCRATCH_BLEND;
  const r = card.scratchRiskMult ?? DEFAULT_SCRATCH_MULT;
  const s = card.scratchStrategicMult ?? DEFAULT_SCRATCH_MULT;
  if (!Number.isFinite(rate) || rate < 0 || !Number.isFinite(r) || r < 0 || !Number.isFinite(s) || s < 0) {
    return "—";
  }
  return formatUsd(Math.round(b.total * rate * r * s));
}

function withScratchRecalculatedPrice(next: RoadmapCard, ctx: CatalogCtxLike | null): RoadmapCard {
  if (next.kind !== "custom_tier") return next;
  if (next.priceOverride?.trim()) return { ...next };
  return { ...next, price: computeScratchSellPrice(next, ctx) };
}

function cardForScratchTier(
  scenarioId: string,
  phaseId: string,
  ctx: CatalogCtx | null,
  dates?: ProposalOfferingDates
): RoadmapCard {
  const hours = "20 h";
  const scratch = {
    scratchBlendRateUsd: DEFAULT_SCRATCH_BLEND,
    scratchRiskMult: DEFAULT_SCRATCH_MULT,
    scratchStrategicMult: DEFAULT_SCRATCH_MULT,
  };
  const id = newRoadmapCardKey();
  const base: RoadmapCard = {
    key: id,
    kind: "custom_tier",
    refId: `scratch-${id}`,
    scenarioId,
    phaseId,
    headline: "Scratch tier",
    description: "",
    hours,
    price: "—",
    scope: "included",
    hoursOverride: null,
    priceOverride: null,
    scratchAttachedTaskIds: [],
    scratchAttachedTaskGroupIds: [],
    ...scratch,
  };
  return applyOfferingDates({ ...base, price: computeScratchSellPrice(base, ctx) }, dates);
}

function tierIdsForPackage(packageTiers: PackageSolutionTier[], packageId: string): string[] {
  return packageTiers.filter((r) => r.package_id === packageId).map((r) => r.solution_tier_id);
}

function tierIdsForSolution(tiers: SolutionTier[], solutionId: string): string[] {
  return tiers.filter((t) => t.solution_id === solutionId).map((t) => t.solution_tier_id);
}

function packageHoursPriceForCatalog(p: Package, ctx: CatalogCtx): { hours: string; price: string } {
  const tids = tierIdsForPackage(ctx.packageTiers, p.package_id);
  const links = ctx.packageTiers.filter((row) => row.package_id === p.package_id);
  const workspace = computePackageWorkspaceCatalogNumbers({
    pkg: p,
    tierIdsSorted: tids,
    packageTierLinksForPackage: links,
    vaultTasks: ctx.tasks,
    implementerHourGroups: ctx.implementerHourGroups,
    mathConfig: ctx.tierPricingMathConfig,
  });
  if (workspace) {
    return {
      hours: `${formatHoursShort(workspace.resourceHours)} h`,
      price: formatUsd(workspace.netSellUsd),
    };
  }
  return rollupHoursPrice(tids, ctx.pricingMap);
}

function rollupHoursPrice(tierIds: string[], pricingMap: Map<string, SolutionTierPricing>): { hours: string; price: string } {
  let th = 0;
  let hOk = false;
  let tp = 0;
  let pOk = false;
  for (const id of tierIds) {
    const pr = pricingMap.get(id);
    if (pr?.total_hours != null && Number.isFinite(Number(pr.total_hours))) {
      th += Number(pr.total_hours);
      hOk = true;
    }
    const sp = pr?.sell_price ?? pr?.standalone_sell_price;
    if (sp != null && Number.isFinite(Number(sp))) {
      tp += Number(sp);
      pOk = true;
    }
  }
  return {
    hours: hOk ? `${th} h (tiers Σ)` : "—",
    price: pOk ? `${formatUsd(tp)} (tiers Σ)` : "—",
  };
}

function cardForVariableTier(
  t: SolutionTier,
  ctx: CatalogCtx,
  scenarioId: string,
  phaseId: string,
  opts?: AddVariableTierOpts,
  dates?: ProposalOfferingDates
): RoadmapCard {
  const monthLabel = opts?.paidAdsMonthLabel?.trim();
  const headline =
    monthLabel && isPaidAdsVariableTierRefId(t.solution_tier_id)
      ? `${t.solution_tier_name.trim() || t.solution_tier_id} · ${monthLabel}`
      : undefined;
  const card = cardForTier(t, ctx, scenarioId, phaseId, dates, headline);
  if (opts?.travelHours != null && isTravelVariableTierRefId(t.solution_tier_id)) {
    return { ...card, variableTravelHours: opts.travelHours };
  }
  if (opts?.paidAdsSpendUsd != null && isPaidAdsVariableTierRefId(t.solution_tier_id)) {
    return { ...card, variablePaidAdsSpendUsd: opts.paidAdsSpendUsd };
  }
  if (opts?.linkedTierRefId && isPercentVariableTierRefId(t.solution_tier_id)) {
    return { ...card, variableLinkedTierRefId: opts.linkedTierRefId };
  }
  return card;
}

function cardForPackage(
  p: Package,
  ctx: CatalogCtx,
  scenarioId: string,
  phaseId: string,
  dates?: ProposalOfferingDates
): RoadmapCard {
  const tids = tierIdsForPackage(ctx.packageTiers, p.package_id);
  const { hours, price } = packageHoursPriceForCatalog(p, ctx);
  const linksByTier = new Map(
    ctx.packageTiers.filter((l) => l.package_id === p.package_id).map((l) => [l.solution_tier_id, l])
  );
  const tierNames = tids
    .map((id) => {
      const tier = ctx.tiers.find((t) => t.solution_tier_id === id);
      if (!tier) return null;
      const link = linksByTier.get(id);
      const merged = mergeTierWithPackageOverrides(tier, parseTierOverrides(link?.tier_overrides));
      return merged.solution_tier_name?.trim() || tier.solution_tier_name?.trim() || null;
    })
    .filter(Boolean) as string[];
  const desc =
    tierNames.length > 0
      ? `Package includes ${tierNames.length} solution(s): ${tierNames.join(", ")}.`
      : "No solutions linked to this package yet.";
  return makeCard("package", p.package_id, scenarioId, phaseId, p.package_name, desc, hours, price, undefined, dates);
}

function packageComponentRows(
  packageId: string,
  ctx: CatalogCtx
): Array<{ id: string; name: string }> {
  const tids = tierIdsForPackage(ctx.packageTiers, packageId);
  const linksByTier = new Map(
    ctx.packageTiers.filter((l) => l.package_id === packageId).map((l) => [l.solution_tier_id, l])
  );
  const rows: Array<{ id: string; name: string }> = [];
  for (const id of tids) {
    const tier = ctx.tiers.find((t) => t.solution_tier_id === id);
    const link = linksByTier.get(id);
    const ov = parseTierOverrides(link?.tier_overrides);
    const qty =
      link?.quantity != null && link.quantity > 0 ? Math.floor(link.quantity) : 1;
    const fallback = tier?.solution_tier_name?.trim() || id;
    const labels =
      Array.isArray(ov.client_facing_labels) && ov.client_facing_labels.length > 0
        ? ov.client_facing_labels
        : ov.solution_tier_name?.trim()
          ? [ov.solution_tier_name.trim()]
          : [fallback];
    for (let i = 0; i < qty; i++) {
      rows.push({
        id: qty > 1 ? `${id}#${i + 1}` : id,
        name: labels[i]?.trim() || labels[0]?.trim() || fallback,
      });
    }
  }
  return rows;
}

function refreshPackageCardsFromCatalog(cards: RoadmapCard[], ctx: CatalogCtx): RoadmapCard[] {
  return cards.map((c) => {
    if (c.kind !== "package") return c;
    const p = ctx.packages.find((x) => x.package_id === c.refId);
    if (!p) return c;
    const dates = {
      startDate: c.startDate ?? "",
      endDate: c.endDate ?? "",
    };
    const fresh = cardForPackage(p, ctx, c.scenarioId, c.phaseId, dates);
    return {
      ...c,
      hours: fresh.hours,
      price: fresh.price,
      description: fresh.description,
    };
  });
}

function cardAllowsAddOns(card: RoadmapCard, ctx: CatalogCtx): boolean {
  if (card.kind !== "tier" || card.addonOfCardKey) return false;
  if (isVariableTierRefId(card.refId)) return false;
  const tier = ctx.tiers.find((t) => t.solution_tier_id === card.refId);
  if (!tier) return false;
  const sol = ctx.solutions.find((s) => s.solution_id === tier.solution_id);
  if (!sol?.add_ons_allowed) return false;
  return catalogSolutionKind(sol.solution_name, sol.solution_type).type === "configured_solution";
}

/** Link module tiers added before parent/child keys existed to the preceding add-ons-enabled solution. */
function attachOrphanModuleAddOns(cards: RoadmapCard[], ctx: CatalogCtx): RoadmapCard[] {
  const lastParentByBucket = new Map<string, string>();
  let changed = false;
  const next = cards.map((c) => {
    const bucket = `${c.scenarioId}:${c.phaseId}`;
    if (c.kind === "tier" && !c.addonOfCardKey && cardAllowsAddOns(c, ctx)) {
      lastParentByBucket.set(bucket, c.key);
      return c;
    }
    if (c.kind !== "tier" || c.addonOfCardKey) return c;
    const tier = ctx.tiers.find((t) => t.solution_tier_id === c.refId);
    const sol = tier ? ctx.solutions.find((s) => s.solution_id === tier.solution_id) : undefined;
    if (!sol || catalogSolutionKind(sol.solution_name, sol.solution_type).type !== "solution_module") {
      return c;
    }
    const parentKey = lastParentByBucket.get(bucket);
    if (!parentKey) return c;
    changed = true;
    return { ...c, addonOfCardKey: parentKey };
  });
  return changed ? next : cards;
}

function cardForTier(
  t: SolutionTier,
  ctx: CatalogCtx,
  scenarioId: string,
  phaseId: string,
  dates?: ProposalOfferingDates,
  clientFacingLabel?: string
): RoadmapCard {
  const pr = ctx.pricingMap.get(t.solution_tier_id) ?? null;
  const pkgNames = ctx.packageTiers
    .filter((pt) => pt.solution_tier_id === t.solution_tier_id)
    .map((pt) => ctx.packages.find((pk) => pk.package_id === pt.package_id)?.package_name ?? pt.package_id);
  const pkgLine = pkgNames.length ? `Packages: ${pkgNames.join(", ")}.` : "";
  const desc = [tierPitchText(t), pkgLine].filter(Boolean).join("\n\n").trim();
  const headline =
    clientFacingLabel?.trim() ||
    t.solution_tier_name.trim() ||
    t.solution_tier_id;
  return makeCard(
    "tier",
    t.solution_tier_id,
    scenarioId,
    phaseId,
    headline,
    desc || "No client-facing description yet — add in Admin or type here.",
    tierHoursLine(t.solution_tier_id, pr, ctx.tasks),
    sellPriceLine(pr),
    undefined,
    dates
  );
}

/** Parses user-entered budget: $, commas, optional `150k` style. */
function parseMoneyInput(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const k = t.match(/^(\d+(?:\.\d+)?)\s*k$/i);
  if (k) {
    const n = Number(k[1]) * 1000;
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  const s = t.replace(/[$,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const INITIAL_SCENARIOS_AND_PHASES = createScenariosAndPhasesForKind("program", newRoadmapCardKey);

function createInitialScenariosAndPhases(): { scenarios: RoadmapScenario[]; phases: RoadmapPhase[] } {
  return createScenariosAndPhasesForKind("program", newRoadmapCardKey);
}

function sortId(a: string, b: string): number {
  const pa = a.split("-").map(Number);
  const pb = b.split("-").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return a.localeCompare(b);
}

function kindLabel(k: RoadmapCardKind): string {
  switch (k) {
    case "package":
      return "Package";
    case "solution":
      return "Solution";
    case "tier":
      return "Tier";
    case "task":
      return "Task";
    case "task_group":
      return "Task group";
    case "custom_tier":
      return "Scratch tier";
    default:
      return k;
  }
}

function numOrDash(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return Number(n).toLocaleString();
}

/** Trim trailing zeros for hour amounts shown on compact UI (e.g. 10.75, 20). */
function formatHoursShort(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return String(Number(n.toFixed(2)));
}

function tierCatalogDetailBlocks(t: SolutionTier, pr: SolutionTierPricing | null, solutionName: string, pkgLine: string): ReactNode {
  const prose = (label: string, text: string | null | undefined) => {
    const v = text?.trim();
    if (!v) return null;
    return (
      <Fragment key={label}>
        <dt className="roadmap-details-dt">{label}</dt>
        <dd className="roadmap-details-dd roadmap-details-dd--prose">{v}</dd>
      </Fragment>
    );
  };
  return (
    <div className="roadmap-details-scroll">
      <h3 className="roadmap-details-h3">Solution tier</h3>
      <dl className="roadmap-details-dl">
        <dt className="roadmap-details-dt">Solution</dt>
        <dd className="roadmap-details-dd">{solutionName}</dd>
        <dt className="roadmap-details-dt">Tier ID</dt>
        <dd className="roadmap-details-dd">
          <code>{t.solution_tier_id}</code>
        </dd>
        <dt className="roadmap-details-dt">Tier name</dt>
        <dd className="roadmap-details-dd">{t.solution_tier_name}</dd>
        {pkgLine ? (
          <>
            <dt className="roadmap-details-dt">Packages</dt>
            <dd className="roadmap-details-dd">{pkgLine}</dd>
          </>
        ) : null}
        {prose("Overview", t.solution_tier_overview)}
        {prose("Why valuable", t.solution_tier_why_is_it_valuable)}
        {prose("When to use", t.solution_tier_when_should_it_be_used)}
        {prose("What is it", t.solution_tier_what_is_it)}
        {prose("In scope", t.solution_tier_in_scope)}
        {prose("Out of scope", t.solution_tier_out_of_scope)}
        {prose("Final deliverable", t.solution_tier_final_deliverable)}
        {prose("How work gets done", t.solution_tier_how_do_we_get_this_work_done)}
        {prose("Assumptions / prerequisites", t.solution_tier_assumption_prerequisites)}
        {prose("Owner", t.solution_tier_owner)}
        {prose("Direction", t.solution_tier_direction)}
        {prose("SOP", t.solution_tier_sop)}
        {prose(
          "Templates",
          stripRedundantResourceMarkdownHeading(tierTemplatesForProposalDisplay(t), "templates")
        )}
        {(() => {
          const rows = effectiveResourceExamples(t).filter((r) => r.example.trim() || r.date.trim());
          if (rows.length === 0) return null;
          return (
            <Fragment key="tier-res-examples">
              <dt className="roadmap-details-dt">Examples with dates</dt>
              <dd className="roadmap-details-dd roadmap-details-dd--prose">
                <TierResourceExamplesDisplay rows={rows} />
              </dd>
            </Fragment>
          );
        })()}
        {prose("Tools", stripRedundantResourceMarkdownHeading(effectiveResourceTools(t), "tools"))}
        {t.solution_tier_overview_link?.trim() ? (
          <>
            <dt className="roadmap-details-dt">Overview link</dt>
            <dd className="roadmap-details-dd">
              <a href={t.solution_tier_overview_link.trim()} target="_blank" rel="noopener noreferrer">
                {t.solution_tier_overview_link.trim()}
              </a>
            </dd>
          </>
        ) : null}
      </dl>
      <h3 className="roadmap-details-h3">Pricing (solution_tier_pricing)</h3>
      {pr ? (
        <dl className="roadmap-details-dl">
          <dt className="roadmap-details-dt">Total hours</dt>
          <dd className="roadmap-details-dd">{numOrDash(pr.total_hours)}</dd>
          <dt className="roadmap-details-dt">Sell price</dt>
          <dd className="roadmap-details-dd">{sellPriceLine(pr)}</dd>
          <dt className="roadmap-details-dt">Expected effort base</dt>
          <dd className="roadmap-details-dd">{formatUsd(pr.expected_effort_base_price)}</dd>
          <dt className="roadmap-details-dt">Risk‑mitigated base</dt>
          <dd className="roadmap-details-dd">{formatUsd(pr.risk_mitigated_base_price)}</dd>
          <dt className="roadmap-details-dt">Risk multiplier</dt>
          <dd className="roadmap-details-dd">{numOrDash(pr.risk_multiplier)}</dd>
          <dt className="roadmap-details-dt">Strategic value mult.</dt>
          <dd className="roadmap-details-dd">{numOrDash(pr.strategic_value_multiplier)}</dd>
          <dt className="roadmap-details-dt">Scope risk</dt>
          <dd className="roadmap-details-dd">{numOrDash(pr.scope_risk)}</dd>
          <dt className="roadmap-details-dt">Internal coordination</dt>
          <dd className="roadmap-details-dd">{numOrDash(pr.internal_coordination)}</dd>
          <dt className="roadmap-details-dt">Client revision risk</dt>
          <dd className="roadmap-details-dd">{numOrDash(pr.client_revision_risk)}</dd>
          <dt className="roadmap-details-dt">Taxable</dt>
          <dd className="roadmap-details-dd">{pr.taxable ? "Yes" : "No"}</dd>
          {pr.notes?.trim() ? prose("Pricing notes", pr.notes) : null}
        </dl>
      ) : (
        <p className="roadmap-muted">No pricing row linked to this tier.</p>
      )}
    </div>
  );
}

function catalogItemDetails(card: RoadmapCard, ctx: CatalogCtx): ReactNode {
  switch (card.kind) {
    case "tier": {
      const t = ctx.tiers.find((x) => x.solution_tier_id === card.refId);
      if (!t) {
        return <p className="roadmap-muted">This tier is no longer in solutions (check Admin).</p>;
      }
      const pr = ctx.pricingMap.get(t.solution_tier_id) ?? null;
      const sol = ctx.solutions.find((s) => s.solution_id === t.solution_id);
      const pkgNames = ctx.packageTiers
        .filter((pt) => pt.solution_tier_id === t.solution_tier_id)
        .map((pt) => ctx.packages.find((pk) => pk.package_id === pt.package_id)?.package_name ?? pt.package_id);
      const pkgLine = pkgNames.length ? pkgNames.join(", ") : "";
      return tierCatalogDetailBlocks(t, pr, sol?.solution_name ?? t.solution_id, pkgLine);
    }
    case "package": {
      const p = ctx.packages.find((x) => x.package_id === card.refId);
      if (!p) return <p className="roadmap-muted">Package not found.</p>;
      const tids = tierIdsForPackage(ctx.packageTiers, p.package_id);
      const linksByTier = new Map(
        ctx.packageTiers.filter((l) => l.package_id === p.package_id).map((l) => [l.solution_tier_id, l])
      );
      const tierNames = tids
        .map((id) => {
          const tier = ctx.tiers.find((tt) => tt.solution_tier_id === id);
          if (!tier) return null;
          const link = linksByTier.get(id);
          const merged = mergeTierWithPackageOverrides(tier, parseTierOverrides(link?.tier_overrides));
          return merged.solution_tier_name?.trim() || tier.solution_tier_name?.trim() || null;
        })
        .filter(Boolean) as string[];
      return (
        <div className="roadmap-details-scroll">
          <h3 className="roadmap-details-h3">Package</h3>
          <dl className="roadmap-details-dl">
            <dt className="roadmap-details-dt">Name</dt>
            <dd className="roadmap-details-dd">{p.package_name}</dd>
            <dt className="roadmap-details-dt">ID</dt>
            <dd className="roadmap-details-dd">
              <code>{p.package_id}</code>
            </dd>
            <dt className="roadmap-details-dt">Linked tiers</dt>
            <dd className="roadmap-details-dd">{tierNames.length ? tierNames.join(", ") : "—"}</dd>
          </dl>
          {card.description.trim() ? (
            <>
              <h3 className="roadmap-details-h3">Notes on card</h3>
              <p className="roadmap-details-dd--prose">{card.description}</p>
            </>
          ) : null}
        </div>
      );
    }
    case "solution": {
      const s = ctx.solutions.find((x) => x.solution_id === card.refId);
      if (!s) return <p className="roadmap-muted">Solution not found.</p>;
      const tids = tierIdsForSolution(ctx.tiers, s.solution_id);
      const tierNames = tids
        .map((id) => ctx.tiers.find((tt) => tt.solution_tier_id === id)?.solution_tier_name)
        .filter(Boolean) as string[];
      return (
        <div className="roadmap-details-scroll">
          <h3 className="roadmap-details-h3">Solution</h3>
          <dl className="roadmap-details-dl">
            <dt className="roadmap-details-dt">Name</dt>
            <dd className="roadmap-details-dd">{s.solution_name}</dd>
            <dt className="roadmap-details-dt">ID</dt>
            <dd className="roadmap-details-dd">
              <code>{s.solution_id}</code>
            </dd>
            <dt className="roadmap-details-dt">Tiers</dt>
            <dd className="roadmap-details-dd">{tierNames.length ? tierNames.join(", ") : "—"}</dd>
          </dl>
          {card.description.trim() ? (
            <>
              <h3 className="roadmap-details-h3">Notes on card</h3>
              <p className="roadmap-details-dd--prose">{card.description}</p>
            </>
          ) : null}
        </div>
      );
    }
    case "task": {
      const k = ctx.tasks.find((x) => x.task_id === card.refId);
      if (!k) return <p className="roadmap-muted">Task not found.</p>;
      const tier = ctx.tiers.find((tt) => tt.solution_tier_id === k.solution_tier_id);
      return (
        <div className="roadmap-details-scroll">
          <h3 className="roadmap-details-h3">Task</h3>
          <dl className="roadmap-details-dl">
            <dt className="roadmap-details-dt">Name</dt>
            <dd className="roadmap-details-dd">{k.task_name}</dd>
            <dt className="roadmap-details-dt">ID</dt>
            <dd className="roadmap-details-dd">
              <code>{k.task_id}</code>
            </dd>
            <dt className="roadmap-details-dt">Tier</dt>
            <dd className="roadmap-details-dd">{tier?.solution_tier_name ?? "—"}</dd>
            <dt className="roadmap-details-dt">Implementer</dt>
            <dd className="roadmap-details-dd">{k.task_implementer ?? "—"}</dd>
            <dt className="roadmap-details-dt">Time (h)</dt>
            <dd className="roadmap-details-dd">{k.task_time != null ? String(k.task_time) : "—"}</dd>
            <dt className="roadmap-details-dt">Duration</dt>
            <dd className="roadmap-details-dd">{k.task_duration != null ? String(k.task_duration) : "—"}</dd>
            <dt className="roadmap-details-dt">Dependencies</dt>
            <dd className="roadmap-details-dd">{k.task_dependencies ?? "—"}</dd>
            <dt className="roadmap-details-dt">Notes</dt>
            <dd className="roadmap-details-dd roadmap-details-dd--prose">{k.task_notes?.trim() || "—"}</dd>
          </dl>
        </div>
      );
    }
    case "task_group": {
      const g = ctx.taskGroups.find((x) => x.id === card.refId);
      if (!g) return <p className="roadmap-muted">Task group not found.</p>;
      const lines = ctx.groupLinesMap.get(g.id) ?? [];
      return (
        <div className="roadmap-details-scroll">
          <h3 className="roadmap-details-h3">Task group template</h3>
          <dl className="roadmap-details-dl">
            <dt className="roadmap-details-dt">Name</dt>
            <dd className="roadmap-details-dd">{g.name}</dd>
            <dt className="roadmap-details-dt">ID</dt>
            <dd className="roadmap-details-dd">
              <code>{g.id}</code>
            </dd>
            <dt className="roadmap-details-dt">Description</dt>
            <dd className="roadmap-details-dd roadmap-details-dd--prose">{g.description?.trim() || "—"}</dd>
          </dl>
          <h3 className="roadmap-details-h3">Lines</h3>
          {lines.length ? (
            <ul className="roadmap-details-ul">
              {lines
                .slice()
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((L) => (
                  <li key={L.id}>
                    {L.task_name}
                    {L.hours != null ? ` — ${L.hours} h` : ""}
                    {L.task_implementer ? ` · ${L.task_implementer}` : ""}
                  </li>
                ))}
            </ul>
          ) : (
            <p className="roadmap-muted">No lines in this template.</p>
          )}
        </div>
      );
    }
    case "custom_tier":
      return null;
    default:
      return <p className="roadmap-muted">No details.</p>;
  }
}

export function RoadmapPlanningView() {
  const { user } = useAuth();
  const { toastError, toastNote, toastSuccess } = useToast();
  const { setGuard } = useProposalDraftGuard();
  const [state, setState] = useState<LoadState>({ status: "idle" });
  const [catalogReloading, setCatalogReloading] = useState(false);
  useToastBusy(catalogReloading, "Refreshing solutions…");
  const [savedProposals, setSavedProposals] = useState<RoadmapProposalRow[]>([]);
  const [savedProposalsLoading, setSavedProposalsLoading] = useState(false);
  const [savingProposal, setSavingProposal] = useState(false);
  useToastBusy(savingProposal, "Saving proposal…");
  const [pdfGenerating, setPdfGenerating] = useState<"client" | "ops" | null>(null);
  useToastBusy(pdfGenerating != null, "Generating PDF…");
  const [deletingProposalId, setDeletingProposalId] = useState<string | null>(null);
  useToastBusy(deletingProposalId != null, "Deleting proposal…");
  const [reviewingProposalId, setReviewingProposalId] = useState<string | null>(null);
  useToastBusy(reviewingProposalId != null, "Updating review status…");
  const [activeProposalId, setActiveProposalId] = useState<string | null>(null);
  const [proposalReviewStatus, setProposalReviewStatus] = useState<ProposalReviewStatus>("draft");
  const [lastSavedFingerprint, setLastSavedFingerprint] = useState<string | null>(null);
  const roadmapLoadErrSeen = useRef<string | null>(null);
  const savedProposalErrSeen = useRef<string | null>(null);
  const [clientLabel, setClientLabel] = useState("");
  const [roadmapTitle, setRoadmapTitle] = useState("");
  const [horizon, setHorizon] = useState<RoadmapHorizon>("6");
  const [clientBudget, setClientBudget] = useState("");
  const [proposalStartDate, setProposalStartDate] = useState("");
  const [proposalEndDate, setProposalEndDate] = useState("");
  const [scenarios, setScenarios] = useState<RoadmapScenario[]>(() => INITIAL_SCENARIOS_AND_PHASES.scenarios);
  const [phases, setPhases] = useState<RoadmapPhase[]>(() => INITIAL_SCENARIOS_AND_PHASES.phases);
  const [proposalKind, setProposalKind] = useState<ProposalKind>("program");
  const [cards, setCards] = useState<RoadmapCard[]>([]);
  const [targetScenarioId, setTargetScenarioId] = useState<string>(
    () => INITIAL_SCENARIOS_AND_PHASES.scenarios[0]!.id
  );
  const [detailsModalKey, setDetailsModalKey] = useState<string | null>(null);
  const [addedEditKey, setAddedEditKey] = useState<string | null>(null);
  const [vaultPackageEditId, setVaultPackageEditId] = useState<string | null>(null);
  const pendingPackageCardRefreshRef = useRef(false);
  /** Live edit buffer for scratch tier in the details modal */
  const [scratchDraft, setScratchDraft] = useState<RoadmapCard | null>(null);
  /** After opening Details from Customize, scroll the composition section into view once */
  const [scratchModalFocusCompose, setScratchModalFocusCompose] = useState(false);
  const scratchComposeSectionRef = useRef<HTMLDivElement>(null);
  /** Remount catalog pickers so the dropdown resets after each pick (including duplicate picks). */
  const [scratchTaskPickTick, setScratchTaskPickTick] = useState(0);
  const [scratchGroupPickTick, setScratchGroupPickTick] = useState(0);
  const [builderStep, setBuilderStep] = useState<ProposalBuilderStep>("setup");
  const [builderMode, setBuilderMode] = useState<ProposalBuilderMode>("saved");
  const [packageAddPath, setPackageAddPath] = useState<PackageAddPath | null>(null);
  const [packageSwitchPromptPath, setPackageSwitchPromptPath] = useState<PackageAddPath | null>(null);
  const [targetPhaseId, setTargetPhaseId] = useState("");

  useEffect(() => {
    if (builderStep !== "packages") {
      setPackageAddPath(null);
      setPackageSwitchPromptPath(null);
    }
  }, [builderStep]);

  useEffect(() => {
    if (!normalizeIsoDateInput(proposalStartDate) || !normalizeIsoDateInput(proposalEndDate)) return;
    setRoadmapTitle((prev) => {
      const next = applyRoadmapNameDateSuffix(prev, proposalStartDate, proposalEndDate);
      return next === prev ? prev : next;
    });
  }, [proposalStartDate, proposalEndDate]);

  const roadmapNameValid = useMemo(
    () => isValidRoadmapNameFormat(roadmapTitle),
    [roadmapTitle]
  );

  const load = useCallback(async (preserveCurrentProposal = false) => {
    const keyErr = browserKeyConfigurationError();
    if (keyErr) {
      if (preserveCurrentProposal) toastError(keyErr);
      else setState({ status: "error", message: keyErr });
      return;
    }
    const client = getSupabase();
    if (!client) {
      const message =
        "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env and restart the dev server.";
      if (preserveCurrentProposal) toastError(message);
      else {
        setState({
          status: "error",
          message,
        });
      }
      return;
    }
    if (preserveCurrentProposal) setCatalogReloading(true);
    else setState({ status: "loading" });
    const [pRes, sRes, tRes, tasksPack, ptRes, tgRes, prRes, tglRes, implRes, builderPack] = await Promise.all([
      client.from("packages").select("*").order("package_id"),
      client.from("solutions").select("*").order("solution_id"),
      client.from("solution_tiers").select("*").order("solution_tier_id"),
      fetchAllTaskRows(client),
      client.from("package_solution_tiers").select("*").order("package_id"),
      client.from("task_groups").select("*").order("name"),
      client.from("solution_tier_pricing").select("*").order("solution_tier_id"),
      client.from("task_group_lines").select("*").order("sort_order"),
      client.from("implementer_pricing_hour_groups").select("*").order("implementer_name"),
      fetchPackageBuilderCatalog(client),
    ]);
    const err =
      pRes.error ||
      sRes.error ||
      tRes.error ||
      tasksPack.error ||
      ptRes.error ||
      tgRes.error ||
      prRes.error ||
      tglRes.error
        ? [
            pRes.error,
            sRes.error,
            tRes.error,
            tasksPack.error ? { message: tasksPack.error } : null,
            ptRes.error,
            tgRes.error,
            prRes.error,
            tglRes.error,
          ].find(Boolean)
        : null;
    if (err) {
      if (preserveCurrentProposal) {
        setCatalogReloading(false);
        toastError(`Could not reload solution data: ${err.message}`);
      } else {
        setState({ status: "error", message: err.message });
      }
      return;
    }
    const packages = (pRes.data ?? []) as Package[];
    const solutions = (sRes.data ?? []) as Solution[];
    const tiers = (tRes.data ?? []) as SolutionTier[];
    const tasks = tasksPack.rows;
    const packageTiers = (ptRes.data ?? []) as PackageSolutionTier[];
    const taskGroups = (tgRes.data ?? []) as TaskGroupRow[];
    const tierPricing = (prRes.data ?? []) as SolutionTierPricing[];
    const taskGroupLines = (tglRes.data ?? []) as TaskGroupLineRow[];
    const implementerHourGroups = implRes.error ? [] : ((implRes.data ?? []) as ImplementerHourGroupRow[]);
    packages.sort((a, b) => sortId(a.package_id, b.package_id));
    solutions.sort((a, b) => sortId(a.solution_id, b.solution_id));
    tiers.sort((a, b) => sortId(a.solution_tier_id, b.solution_tier_id));
    setState({
      status: "ok",
      packages,
      solutions,
      tiers,
      packageTiers,
      tasks,
      taskGroups,
      tierPricing,
      taskGroupLines,
      implementerHourGroups,
      packageTypes: builderPack.catalog.types,
      packageBuilderSlots: builderPack.catalog.slots,
    });
    if (preserveCurrentProposal) {
      setCatalogReloading(false);
      toastSuccess("Solution data reloaded. Your proposal stayed unchanged.");
    }
  }, [toastError, toastSuccess]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadSavedProposals = useCallback(async () => {
    const client = getSupabase();
    if (!client) return;
    setSavedProposalsLoading(true);
    const { data: rows, error } = await client
      .from("roadmap_proposals")
      .select("*")
      .order("updated_at", { ascending: false });
    setSavedProposalsLoading(false);
    if (error) {
      if (savedProposalErrSeen.current !== error.message) {
        savedProposalErrSeen.current = error.message;
        toastError(`Saved proposals are not available yet: ${error.message}`);
      }
      return;
    }
    savedProposalErrSeen.current = null;
    setSavedProposals((rows ?? []) as RoadmapProposalRow[]);
  }, [toastError]);

  useEffect(() => {
    void loadSavedProposals();
  }, [loadSavedProposals]);

  const currentProposalSnapshot = useCallback(
    (): RoadmapProposalSnapshot => ({
      version: 1,
      clientLabel,
      roadmapTitle,
      horizon,
      clientBudget,
      proposalStartDate,
      proposalEndDate,
      proposalKind,
      reviewStatus: proposalReviewStatus,
      scenarios,
      phases,
      cards,
    }),
    [
      cards,
      clientBudget,
      clientLabel,
      horizon,
      phases,
      proposalEndDate,
      proposalKind,
      proposalReviewStatus,
      proposalStartDate,
      roadmapTitle,
      scenarios,
    ]
  );

  const saveCurrentProposal = useCallback(async (opts?: {
    reviewStatus?: ProposalReviewStatus;
    successMessage?: string;
  }): Promise<RoadmapProposalRow | null> => {
    const client = getSupabase();
    if (!client) return null;
    const clientName = clientLabel.trim();
    const title = roadmapTitle.trim();
    if (!clientName || !title) {
      toastError("Add both Client name and Roadmap name before saving.");
      return null;
    }
    if (!isValidRoadmapNameFormat(title)) {
      toastError(`Roadmap name must follow ${ROADMAP_NAME_FORMAT_HINT.replace("Format: ", "")}.`);
      return null;
    }
    setSavingProposal(true);
    const userId = user?.id ?? null;
    const email = user?.email ?? null;
    const nextReviewStatus = opts?.reviewStatus ?? proposalReviewStatus;
    const snapshot: RoadmapProposalSnapshot = {
      ...currentProposalSnapshot(),
      reviewStatus: nextReviewStatus,
    };
    const payload = {
      client_label: clientName,
      roadmap_title: title,
      horizon,
      client_budget: clientBudget.trim() || null,
      proposal_state: snapshot,
      updated_by_user_id: userId,
      updated_by_email: email,
    };
    const result = activeProposalId
      ? await client
          .from("roadmap_proposals")
          .update(payload)
          .eq("id", activeProposalId)
          .select("*")
          .maybeSingle()
      : await client
          .from("roadmap_proposals")
          .insert({
            ...payload,
            created_by_user_id: userId,
            created_by_email: email,
          })
          .select("*")
          .single();
    setSavingProposal(false);
    if (result.error) {
      toastError(`Could not save proposal: ${result.error.message}`);
      return null;
    }
    const saved = result.data as RoadmapProposalRow | null;
    if (saved?.id) setActiveProposalId(saved.id);
    setProposalReviewStatus(nextReviewStatus);
    setLastSavedFingerprint(proposalSnapshotFingerprint(snapshot));
    toastSuccess(opts?.successMessage ?? `Saved "${title}" under ${clientName}.`);
    await loadSavedProposals();
    return saved;
  }, [
    activeProposalId,
    clientBudget,
    clientLabel,
    currentProposalSnapshot,
    horizon,
    loadSavedProposals,
    proposalReviewStatus,
    roadmapTitle,
    toastError,
    toastSuccess,
    user?.email,
    user?.id,
  ]);

  const submitForOpsReview = useCallback(async () => {
    const clientName = clientLabel.trim();
    const title = roadmapTitle.trim();
    const saved = await saveCurrentProposal({
      reviewStatus: "awaiting_ops_review",
      successMessage: `Submitted "${title}" for Ops Review.`,
    });
    if (!saved) return;
    void notifyOpsReviewSubmitted({
      proposalId: saved.id,
      clientLabel: saved.client_label || clientName,
      roadmapTitle: saved.roadmap_title || title,
      submittedByEmail: user?.email ?? saved.updated_by_email ?? saved.created_by_email,
    });
    setActiveProposalId(null);
    setBuilderMode("awaiting_ops");
    setBuilderStep("setup");
  }, [clientLabel, roadmapTitle, saveCurrentProposal, user?.email]);

  const markReviewedByOps = useCallback(async () => {
    const saved = await saveCurrentProposal({
      reviewStatus: "client_ready",
      successMessage: `"${roadmapTitle.trim()}" marked Reviewed by Ops.`,
    });
    if (!saved) return;
    setActiveProposalId(null);
    setBuilderMode("client_ready");
    setBuilderStep("setup");
  }, [roadmapTitle, saveCurrentProposal]);

  const includeOpsPath = builderMode === "awaiting_ops" || builderMode === "client_ready";

  const proposalStepSaveProps = useMemo(
    () => ({
      onSave: () => void saveCurrentProposal(),
      saving: savingProposal,
      saveLabel: activeProposalId ? "Update saved" : "Save proposal",
    }),
    [saveCurrentProposal, savingProposal, activeProposalId]
  );

  const awaitingOpsProposals = useMemo(
    () => savedProposals.filter(isAwaitingOpsReview),
    [savedProposals]
  );

  const clientReadyProposals = useMemo(
    () => savedProposals.filter(isClientReadyProposal),
    [savedProposals]
  );

  /** Hide while browsing library tabs; only when drafting or an open proposal is loaded. */
  const showSaveBanner = builderMode === "create" || activeProposalId != null;

  const proposalIsDirty = useMemo(() => {
    if (lastSavedFingerprint === null) return false;
    return proposalSnapshotFingerprint(currentProposalSnapshot()) !== lastSavedFingerprint;
  }, [lastSavedFingerprint, currentProposalSnapshot]);

  useEffect(() => {
    setGuard({
      isActive: showSaveBanner,
      isDirty: proposalIsDirty,
      message:
        "You have unsaved changes to your proposal. Save your work before leaving, or your changes will be lost.",
    });
    return () => setGuard(null);
  }, [proposalIsDirty, setGuard, showSaveBanner]);

  useEffect(() => {
    if (!proposalIsDirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [proposalIsDirty]);

  const startNewProposal = useCallback(() => {
    const init = createScenariosAndPhasesForKind("program", newRoadmapCardKey);
    const emptySnapshot: RoadmapProposalSnapshot = {
      version: 1,
      clientLabel: "",
      roadmapTitle: "",
      horizon: "6",
      clientBudget: "",
      proposalStartDate: "",
      proposalEndDate: "",
      proposalKind: "program",
      scenarios: init.scenarios,
      phases: init.phases,
      cards: [],
    };
    setClientLabel("");
    setRoadmapTitle("");
    setClientBudget("");
    setProposalStartDate("");
    setProposalEndDate("");
    setHorizon("6");
    setProposalKind("program");
    setScenarios(init.scenarios);
    setPhases(init.phases);
    setCards([]);
    setTargetScenarioId(init.scenarios[0]!.id);
    setActiveProposalId(null);
    setProposalReviewStatus("draft");
    setLastSavedFingerprint(proposalSnapshotFingerprint(emptySnapshot));
    setDetailsModalKey(null);
    setScratchDraft(null);
    setScratchModalFocusCompose(false);
    setBuilderMode("create");
    setBuilderStep("setup");
    toastNote("Started a new proposal draft.");
  }, [toastNote]);

  const handleBuilderModeChange = useCallback(
    (mode: ProposalBuilderMode) => {
      if (mode === "create") {
        const hasWork =
          activeProposalId != null ||
          cards.length > 0 ||
          clientLabel.trim() !== "" ||
          roadmapTitle.trim() !== "" ||
          clientBudget.trim() !== "";
        if (hasWork) {
          const ok = window.confirm(
            "Start a new proposal? Your current draft will be cleared unless you saved it."
          );
          if (!ok) return;
        }
        startNewProposal();
        return;
      }
      setActiveProposalId(null);
      setBuilderMode(mode);
    },
    [activeProposalId, cards.length, clientBudget, clientLabel, roadmapTitle, startNewProposal]
  );

  const loadSavedProposalIntoBoard = useCallback(
    (row: RoadmapProposalRow, opts?: { entryStep?: ProposalBuilderStep; libraryMode?: ProposalBuilderMode }) => {
      const snapshot = parseProposalSnapshot(row);
      if (!snapshot) {
        toastError("This saved proposal could not be read.");
        return;
      }
      const hasCurrentWork =
        cards.length > 0 || clientLabel.trim() || roadmapTitle.trim() || clientBudget.trim();
      if (hasCurrentWork && activeProposalId !== row.id) {
        const ok = window.confirm(
          "Open this saved proposal? Your current on-screen proposal will be replaced."
        );
        if (!ok) return;
      }
      const fallback = createInitialScenariosAndPhases();
      const nextScenarios = snapshot.scenarios.length > 0 ? snapshot.scenarios : fallback.scenarios;
      const nextPhases = snapshot.phases.length > 0 ? snapshot.phases : fallback.phases;
      setClientLabel(snapshot.clientLabel);
      setRoadmapTitle(snapshot.roadmapTitle);
      setHorizon(snapshot.horizon);
      setClientBudget(snapshot.clientBudget);
      setProposalStartDate(snapshot.proposalStartDate);
      setProposalEndDate(snapshot.proposalEndDate);
      setProposalKind(snapshot.proposalKind ?? "program");
      setProposalReviewStatus(snapshot.reviewStatus ?? "draft");
      setScenarios(nextScenarios);
      setPhases(nextPhases);
      setCards(snapshot.cards);
      setTargetScenarioId(nextScenarios[0]?.id ?? "");
      setActiveProposalId(row.id);
      setLastSavedFingerprint(
        proposalSnapshotFingerprint({
          version: 1,
          clientLabel: snapshot.clientLabel,
          roadmapTitle: snapshot.roadmapTitle,
          horizon: snapshot.horizon,
          clientBudget: snapshot.clientBudget,
          proposalStartDate: snapshot.proposalStartDate,
          proposalEndDate: snapshot.proposalEndDate,
          proposalKind: snapshot.proposalKind ?? "program",
          reviewStatus: snapshot.reviewStatus ?? "draft",
          scenarios: nextScenarios,
          phases: nextPhases,
          cards: snapshot.cards,
        })
      );
      setDetailsModalKey(null);
      setScratchDraft(null);
      setScratchModalFocusCompose(false);
      setBuilderMode(opts?.libraryMode ?? "saved");
      setBuilderStep(opts?.entryStep ?? "review");
      toastSuccess(`Opened "${row.roadmap_title}".`);
    },
    [activeProposalId, cards.length, clientBudget, clientLabel, roadmapTitle, toastError, toastSuccess]
  );

  const copyStructureFromSavedProposal = useCallback(
    (row: RoadmapProposalRow) => {
      const snapshot = parseProposalSnapshot(row);
      if (!snapshot || snapshot.scenarios.length === 0) {
        toastError("This saved proposal has no scenarios to copy.");
        return;
      }
      if (cards.length > 0) {
        const ok = window.confirm(
          `Replace your current scenarios, phases, and line items with "${row.roadmap_title}"? Client and budget on step 1 stay as they are.`
        );
        if (!ok) return;
      }
      const fallback = createInitialScenariosAndPhases();
      const cloned = cloneProposalStructure(snapshot);
      const nextScenarios = cloned.scenarios.length > 0 ? cloned.scenarios : fallback.scenarios;
      const nextPhases = cloned.phases.length > 0 ? cloned.phases : fallback.phases;
      setScenarios(nextScenarios);
      setPhases(nextPhases);
      setProposalKind(snapshot.proposalKind ?? "program");
      setCards(cloned.cards);
      const firstScenarioId = nextScenarios[0]?.id ?? "";
      setTargetScenarioId(firstScenarioId);
      const firstPhase = sortedPhasesForScenario(nextPhases, firstScenarioId)[0];
      setTargetPhaseId(firstPhase?.id ?? "");
      toastSuccess(`Copied structure from "${row.roadmap_title}".`);
    },
    [cards.length, toastError, toastSuccess]
  );

  const deleteSavedProposal = useCallback(
    async (row: RoadmapProposalRow) => {
      const client = getSupabase();
      if (!client) return;
      const ok = window.confirm(
        `Delete "${row.roadmap_title}" for ${row.client_label}? This cannot be undone.`
      );
      if (!ok) return;
      setDeletingProposalId(row.id);
      const { error } = await client.from("roadmap_proposals").delete().eq("id", row.id);
      setDeletingProposalId(null);
      if (error) {
        toastError(`Could not delete proposal: ${error.message}`);
        return;
      }
      if (activeProposalId === row.id) {
        setActiveProposalId(null);
      }
      toastSuccess(`Deleted "${row.roadmap_title}".`);
      await loadSavedProposals();
    },
    [activeProposalId, loadSavedProposals, toastError, toastSuccess]
  );

  const setReviewedByOps = useCallback(
    async (row: RoadmapProposalRow, reviewed: boolean) => {
      const client = getSupabase();
      if (!client) return;
      const snapshot = parseProposalSnapshot(row);
      if (!snapshot) {
        toastError("This saved proposal could not be read.");
        return;
      }
      const nextStatus: ProposalReviewStatus = reviewed ? "client_ready" : "awaiting_ops_review";
      const nextSnapshot: RoadmapProposalSnapshot = {
        ...snapshot,
        reviewStatus: nextStatus,
      };
      setReviewingProposalId(row.id);
      const { error } = await client
        .from("roadmap_proposals")
        .update({
          proposal_state: nextSnapshot,
          updated_by_user_id: user?.id ?? null,
          updated_by_email: user?.email ?? null,
        })
        .eq("id", row.id);
      setReviewingProposalId(null);
      if (error) {
        toastError(`Could not update review status: ${error.message}`);
        return;
      }
      if (activeProposalId === row.id) {
        setProposalReviewStatus(nextStatus);
      }
      toastSuccess(
        reviewed
          ? `"${row.roadmap_title}" moved to Client Ready Proposals.`
          : `"${row.roadmap_title}" returned to Ops Review queue.`
      );
      await loadSavedProposals();
    },
    [activeProposalId, loadSavedProposals, toastError, toastSuccess, user?.email, user?.id]
  );

  const moveProposalToSaved = useCallback(
    async (row: RoadmapProposalRow) => {
      const client = getSupabase();
      if (!client) return;
      const snapshot = parseProposalSnapshot(row);
      if (!snapshot) {
        toastError("This saved proposal could not be read.");
        return;
      }
      const nextSnapshot: RoadmapProposalSnapshot = {
        ...snapshot,
        reviewStatus: "draft",
      };
      setReviewingProposalId(row.id);
      const { error } = await client
        .from("roadmap_proposals")
        .update({
          proposal_state: nextSnapshot,
          updated_by_user_id: user?.id ?? null,
          updated_by_email: user?.email ?? null,
        })
        .eq("id", row.id);
      setReviewingProposalId(null);
      if (error) {
        toastError(`Could not move proposal: ${error.message}`);
        return;
      }
      if (activeProposalId === row.id) {
        setProposalReviewStatus("draft");
      }
      toastSuccess(`"${row.roadmap_title}" moved to Saved Proposals.`);
      await loadSavedProposals();
    },
    [activeProposalId, loadSavedProposals, toastError, toastSuccess, user?.email, user?.id]
  );

  const errMsg = state.status === "error" ? state.message : null;
  useEffect(() => {
    if (errMsg === null) {
      roadmapLoadErrSeen.current = null;
      return;
    }
    if (roadmapLoadErrSeen.current === errMsg) return;
    roadmapLoadErrSeen.current = errMsg;
    toastError(errMsg);
  }, [errMsg, toastError]);

  const data = state.status === "ok" ? state : null;
  const tierPricingMathConfig = useMemo(
    () => normalizeTierPricingMathConfig(loadTierPricingMathConfigFromStorage()),
    []
  );

  const catalogCtx = useMemo((): CatalogCtx | null => {
    if (!data) return null;
    const pricingMap = new Map<string, SolutionTierPricing>();
    for (const r of data.tierPricing) pricingMap.set(r.solution_tier_id, r);
    const groupLinesMap = new Map<string, TaskGroupLineRow[]>();
    for (const L of data.taskGroupLines) {
      const arr = groupLinesMap.get(L.task_group_id) ?? [];
      arr.push(L);
      groupLinesMap.set(L.task_group_id, arr);
    }
    for (const arr of groupLinesMap.values()) arr.sort((a, b) => a.sort_order - b.sort_order);
    return {
      packages: data.packages,
      solutions: data.solutions,
      tiers: data.tiers,
      packageTiers: data.packageTiers,
      tasks: data.tasks,
      taskGroups: data.taskGroups,
      pricingMap,
      groupLinesMap,
      implementerHourGroups: data.implementerHourGroups,
      tierPricingMathConfig,
    };
  }, [data, tierPricingMathConfig]);

  const applyVariablePricing = useCallback(
    (next: RoadmapCard[]): RoadmapCard[] => {
      if (!catalogCtx) return next;
      return applyVariableTierPricingToCards(next, catalogCtx, computeScratchSellPrice);
    },
    [catalogCtx]
  );

  const setCardsSynced = useCallback(
    (action: SetStateAction<RoadmapCard[]>) => {
      setCards((prev) => applyVariablePricing(typeof action === "function" ? action(prev) : action));
    },
    [applyVariablePricing]
  );

  useEffect(() => {
    if (!catalogCtx) return;
    setCards((prev) => applyVariablePricing(attachOrphanModuleAddOns(prev, catalogCtx)));
  }, [catalogCtx, applyVariablePricing]);

  const addCard = useCallback(
    (c: RoadmapCard) => {
      setCardsSynced((prev) => [...prev, c]);
    },
    [setCardsSynced]
  );

  const removeCard = useCallback(
    (key: string) => {
      setCardsSynced((prev) => prev.filter((x) => x.key !== key && x.addonOfCardKey !== key));
    },
    [setCardsSynced]
  );

  const reorderPhaseCards = useCallback(
    (scenarioId: string, phaseId: string, orderedKeys: string[]) => {
      setCardsSynced((prev) => reorderPhaseCardsByKeys(prev, scenarioId, phaseId, orderedKeys));
    },
    [setCardsSynced]
  );

  type RoadmapCardPatch = Partial<
    Pick<
      RoadmapCard,
      | "headline"
      | "description"
      | "hours"
      | "price"
      | "phaseId"
      | "scope"
      | "hoursOverride"
      | "priceOverride"
      | "scratchBlendRateUsd"
      | "scratchRiskMult"
      | "scratchStrategicMult"
      | "scratchAttachedTaskIds"
      | "scratchAttachedTaskGroupIds"
      | "variableTravelHours"
      | "variablePaidAdsSpendUsd"
      | "variableLinkedTierRefId"
      | "startDate"
      | "endDate"
    >
  >;

  const patchCard = useCallback(
    (key: string, patch: RoadmapCardPatch) => {
      setCardsSynced((prev) =>
        prev.map((c) => {
          if (c.key !== key) return c;
          const next: RoadmapCard = { ...c, ...patch };
          if (next.kind === "custom_tier" && !next.priceOverride?.trim()) {
            next.price = computeScratchSellPrice(next, catalogCtx);
          }
          return next;
        })
      );
    },
    [catalogCtx, setCardsSynced]
  );

  const duplicateAddedCard = useCallback(
    (key: string) => {
      setCardsSynced((prev) => {
        const source = prev.find((c) => c.key === key);
        if (!source) return prev;
        const newKey = newRoadmapCardKey();
        const baseHeadline = source.headline.trim() || "Untitled";
        const copyHeadline = /\(copy\)\s*$/i.test(baseHeadline)
          ? baseHeadline
          : `${baseHeadline} (copy)`;
        const clone: RoadmapCard = {
          ...source,
          key: newKey,
          headline: copyHeadline,
          taskLayout: source.taskLayout
            ? {
                ...source.taskLayout,
                extras: source.taskLayout.extras?.map((ex) => ({
                  ...ex,
                  id: newRoadmapCardKey(),
                })),
              }
            : source.taskLayout,
        };
        const extras = prev
          .filter((c) => c.addonOfCardKey === key)
          .map((child) => ({
            ...child,
            key: newRoadmapCardKey(),
            addonOfCardKey: newKey,
            taskLayout: child.taskLayout
              ? {
                  ...child.taskLayout,
                  extras: child.taskLayout.extras?.map((ex) => ({
                    ...ex,
                    id: newRoadmapCardKey(),
                  })),
                }
              : child.taskLayout,
          }));
        return [...prev, clone, ...extras];
      });
    },
    [setCardsSynced]
  );

  const openDetailsModal = useCallback((c: RoadmapCard, opts?: { focusCompose?: boolean }) => {
    setDetailsModalKey(c.key);
    if (c.kind === "custom_tier") {
      setScratchDraft({ ...c });
      setScratchModalFocusCompose(!!opts?.focusCompose);
      setScratchTaskPickTick(0);
      setScratchGroupPickTick(0);
    } else {
      setScratchDraft(null);
      setScratchModalFocusCompose(false);
    }
  }, []);

  const openAddedEdit = useCallback(
    (key: string) => {
      const card = cards.find((c) => c.key === key);
      if (!card) return;
      if (card.kind === "custom_tier") {
        openDetailsModal(card);
        return;
      }
      setAddedEditKey(key);
    },
    [cards, openDetailsModal]
  );

  const closeAddedEdit = useCallback(() => setAddedEditKey(null), []);

  const saveAddedEdit = useCallback(
    (key: string, patch: ProposalAddedEditPatch) => {
      patchCard(key, patch);
      setAddedEditKey(null);
    },
    [patchCard]
  );

  const openVaultPackageComponentsEditor = useCallback(() => {
    const card = addedEditKey ? cards.find((c) => c.key === addedEditKey) : null;
    if (!card || card.kind !== "package") return;
    setVaultPackageEditId(card.refId);
  }, [addedEditKey, cards]);

  const closeVaultPackageComponentsEditor = useCallback(() => {
    setVaultPackageEditId(null);
  }, []);

  const onVaultPackageComponentsSaved = useCallback(async () => {
    pendingPackageCardRefreshRef.current = true;
    await load(true);
  }, [load]);

  useEffect(() => {
    if (!pendingPackageCardRefreshRef.current || !catalogCtx) return;
    pendingPackageCardRefreshRef.current = false;
    setCardsSynced((prev) => refreshPackageCardsFromCatalog(prev, catalogCtx));
  }, [catalogCtx, setCardsSynced]);

  const closeDetailsModal = useCallback(() => {
    setDetailsModalKey(null);
    setScratchDraft(null);
    setScratchModalFocusCompose(false);
  }, []);

  const saveScratchFromModal = useCallback(() => {
    if (!detailsModalKey || !scratchDraft || scratchDraft.kind !== "custom_tier") return;
    const merged: RoadmapCard = { ...scratchDraft };
    if (!merged.priceOverride?.trim()) {
      merged.price = computeScratchSellPrice(merged, catalogCtx);
    }
    setCardsSynced((prev) => prev.map((c) => (c.key === detailsModalKey ? merged : c)));
    closeDetailsModal();
  }, [detailsModalKey, scratchDraft, catalogCtx, closeDetailsModal, setCardsSynced]);

  useLayoutEffect(() => {
    if (!scratchModalFocusCompose) return;
    const el = scratchComposeSectionRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    setScratchModalFocusCompose(false);
  }, [scratchModalFocusCompose, detailsModalKey]);

  useEffect(() => {
    if (detailsModalKey && !cards.some((c) => c.key === detailsModalKey)) {
      closeDetailsModal();
    }
  }, [cards, detailsModalKey, closeDetailsModal]);

  useEffect(() => {
    if (addedEditKey && !cards.some((c) => c.key === addedEditKey)) {
      setAddedEditKey(null);
    }
  }, [cards, addedEditKey]);

  useEffect(() => {
    if (!detailsModalKey) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeDetailsModal();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailsModalKey, closeDetailsModal]);

  const clearScenarioItems = useCallback(
    (scenarioId: string) => {
      setCardsSynced((prev) => prev.filter((c) => c.scenarioId !== scenarioId));
      setDetailsModalKey(null);
      setScratchDraft(null);
      setScratchModalFocusCompose(false);
    },
    [setCardsSynced]
  );

  useEffect(() => {
    const list = sortedPhasesForScenario(phases, targetScenarioId);
    setTargetPhaseId((prev) => (prev && list.some((p) => p.id === prev) ? prev : list[0]?.id ?? ""));
  }, [phases, targetScenarioId]);

  const catalogTierTableRows = useMemo((): CatalogTierTableRow[] => {
    if (!catalogCtx) return [];
    const { tiers, packages, packageTiers, solutions, pricingMap, tasks } = catalogCtx;
    return [...tiers]
      .sort((a, b) => sortId(a.solution_tier_id, b.solution_tier_id))
      .map((tier) => {
        const pr = pricingMap.get(tier.solution_tier_id) ?? null;
        const link = packageTiers.find((r) => r.solution_tier_id === tier.solution_tier_id);
        const pname = link
          ? packages.find((p) => p.package_id === link.package_id)?.package_name?.trim() ||
            link.package_id ||
            "Standalone"
          : "Standalone";
        const solution = solutions.find((s) => s.solution_id === tier.solution_id);
        const hoursNum = catalogDisplayTierHours(pr, tasks, tier.solution_tier_id);
        const priceNum = sellPriceNumber(pr);
        return {
          tierId: tier.solution_tier_id,
          solutionId: tier.solution_id,
          pname,
          tierName: tier.solution_tier_name,
          solutionName: solution?.solution_name ?? tier.solution_id,
          solutionType: solution?.solution_type ?? null,
          phaseRaw: tier.solution_tier_phase?.trim() ?? "",
          categoryRaw: displayTierCategoryLabel(tier.solution_tier_category ?? ""),
          tacticRaw: tier.solution_tier_tactic?.trim() ?? "",
          priceNum,
          priceDisplay: sellPriceLine(pr),
          hoursNum,
          hoursDisplay: formatTierHoursDisplay(hoursNum),
          taxable: pr?.taxable ?? false,
          taxableSort: pr?.taxable ? 1 : 0,
          taxableLabel: pr?.taxable ? "Taxable" : "Non-taxable",
          tagsRaw: pr?.tags?.trim() ?? "",
        };
      });
  }, [catalogCtx]);

  const playbookCatalogTierTableRows = useMemo(
    () => catalogTierTableRows.filter((r) => !isVariableTierRefId(r.tierId)),
    [catalogTierTableRows]
  );

  const variableCatalogTierTableRows = useMemo(
    () => catalogTierTableRows.filter((r) => isVariableTierRefId(r.tierId)),
    [catalogTierTableRows]
  );

  const variableTierLinkTargets = useMemo(() => {
    if (!catalogCtx) return [];
    const phaseTitleById = new Map(phases.map((p) => [p.id, p.title.trim() || "Phase"]));
    return variableTierLinkTargetsForScenario(
      cards,
      targetScenarioId,
      catalogCtx,
      computeScratchSellPrice,
      phaseTitleById
    );
  }, [cards, targetScenarioId, catalogCtx, phases]);

  const previewVariableTierPriceUsd = useCallback(
    (refId: string, opts?: AddVariableTierOpts): number | null => {
      if (!catalogCtx) return null;
      if (isTravelVariableTierRefId(refId)) {
        return computeVariableTierSellUsd(refId, 0, { travelHours: opts?.travelHours });
      }
      if (isPaidAdsVariableTierRefId(refId)) {
        return computeVariableTierSellUsd(refId, 0, { paidAdsSpendUsd: opts?.paidAdsSpendUsd });
      }
      const linkedRefId = opts?.linkedTierRefId;
      if (!linkedRefId) return null;
      const linked = cards.find(
        (c) =>
          c.scenarioId === targetScenarioId &&
          c.refId === linkedRefId &&
          c.scope === "included" &&
          !isVariableTierRefId(c.refId)
      );
      if (!linked) return null;
      const base = cardPriceUsdForRollup(linked, catalogCtx, computeScratchSellPrice);
      if (base == null || !Number.isFinite(base)) return null;
      return computeVariableTierSellUsd(refId, base);
    },
    [cards, targetScenarioId, catalogCtx]
  );

  const setupComplete = roadmapNameValid;
  const canAddToTarget = !!targetPhaseId;

  const catalogAddedLines = useMemo(() => {
    if (!catalogCtx) return [];
    const phaseTitleById = new Map(phases.map((p) => [p.id, p.title.trim() || "Phase"]));
    const scenarioCards = cards.filter((c) => c.scenarioId === targetScenarioId);
    const keySet = new Set(scenarioCards.map((c) => c.key));
    const childrenByParent = new Map<string, typeof scenarioCards>();
    for (const c of scenarioCards) {
      if (!c.addonOfCardKey || !keySet.has(c.addonOfCardKey)) continue;
      const list = childrenByParent.get(c.addonOfCardKey) ?? [];
      list.push(c);
      childrenByParent.set(c.addonOfCardKey, list);
    }

    const toLine = (c: RoadmapCard, addons?: ProposalAddedLine[]): ProposalAddedLine => ({
      key: c.key,
      refId: c.refId,
      headline: c.headline,
      phaseTitle: phaseTitleById.get(c.phaseId) ?? "Phase",
      priceDisplay: effectivePriceStr(c, catalogCtx, computeScratchSellPrice) || "—",
      scope: c.scope,
      isTargetPhase: c.phaseId === targetPhaseId,
      kind: c.kind,
      appliedToLabel: variableTierAppliedToLabel(c, cards),
      isAddon: Boolean(c.addonOfCardKey && keySet.has(c.addonOfCardKey)),
      canAddAddOns: cardAllowsAddOns(c, catalogCtx),
      addons,
    });

    const sortLines = (a: ProposalAddedLine, b: ProposalAddedLine) => {
      if (a.isTargetPhase !== b.isTargetPhase) return a.isTargetPhase ? -1 : 1;
      return a.headline.localeCompare(b.headline, undefined, { sensitivity: "base" });
    };

    return scenarioCards
      .filter((c) => !c.addonOfCardKey || !keySet.has(c.addonOfCardKey))
      .map((c) => {
        const kids = (childrenByParent.get(c.key) ?? [])
          .map((child) => toLine(child))
          .sort((a, b) => a.headline.localeCompare(b.headline, undefined, { sensitivity: "base" }));
        return toLine(c, kids.length > 0 ? kids : undefined);
      })
      .sort(sortLines);
  }, [cards, catalogCtx, phases, targetScenarioId, targetPhaseId]);

  const moduleAddOnGroups = useMemo(
    () => buildModuleAddOnGroups(playbookCatalogTierTableRows),
    [playbookCatalogTierTableRows]
  );

  const addAddOnsToParent = useCallback(
    (parentKey: string, tierIds: string[]) => {
      if (!catalogCtx || tierIds.length === 0) return;
      const parent = cards.find((c) => c.key === parentKey);
      if (!parent) return;
      const dates: ProposalOfferingDates = {
        startDate: parent.startDate ?? "",
        endDate: parent.endDate ?? "",
      };
      const extras: RoadmapCard[] = [];
      for (const id of tierIds) {
        const t = catalogCtx.tiers.find((x) => x.solution_tier_id === id);
        if (!t) continue;
        extras.push({
          ...cardForTier(
            t,
            catalogCtx,
            parent.scenarioId,
            parent.phaseId,
            dates,
            t.solution_tier_name.trim() || t.solution_tier_id
          ),
          addonOfCardKey: parent.key,
        });
      }
      if (extras.length === 0) return;
      setCardsSynced((prev) => [...prev, ...extras]);
    },
    [catalogCtx, cards, setCardsSynced]
  );

  const addedTierRefIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of cards) {
      if (c.scenarioId === targetScenarioId && c.kind === "tier") ids.add(c.refId);
    }
    return ids;
  }, [cards, targetScenarioId]);

  const addedPackageRefIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of cards) {
      if (c.scenarioId === targetScenarioId && c.kind === "package") ids.add(c.refId);
    }
    return ids;
  }, [cards, targetScenarioId]);

  const copyFromScenarios = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of cards) {
      counts.set(c.scenarioId, (counts.get(c.scenarioId) ?? 0) + 1);
    }
    return scenarios
      .filter((s) => s.id !== targetScenarioId)
      .map((s) => ({
        id: s.id,
        title: s.title,
        offeringCount: counts.get(s.id) ?? 0,
      }));
  }, [cards, scenarios, targetScenarioId]);

  const copyOfferingsFromScenario = useCallback(
    (sourceScenarioId: string) => {
      if (sourceScenarioId === targetScenarioId) return;

      const sourceTitle =
        scenarios.find((s) => s.id === sourceScenarioId)?.title.trim() || "Source scenario";
      const targetTitle =
        scenarios.find((s) => s.id === targetScenarioId)?.title.trim() || "This scenario";

      const { cards: cloned, skippedDuplicates } = copyScenarioOfferings({
        allCards: cards,
        phases,
        sourceScenarioId,
        targetScenarioId,
        targetPhaseId,
        newKey: newRoadmapCardKey,
      });

      if (cloned.length === 0) {
        toastNote(
          skippedDuplicates > 0
            ? "Those solutions are already on this scenario."
            : "That scenario has nothing to copy."
        );
        return;
      }

      const dupNote =
        skippedDuplicates > 0
          ? ` ${skippedDuplicates} duplicate tier/package${skippedDuplicates === 1 ? "" : "s"} will be skipped.`
          : "";

      const ok = window.confirm(
        `Copy ${cloned.length} solution${cloned.length === 1 ? "" : "s"} from "${sourceTitle}" into "${targetTitle}"?${dupNote}`
      );
      if (!ok) return;

      setCardsSynced((prev) => [...prev, ...cloned]);
      toastSuccess(
        `Copied ${cloned.length} solution${cloned.length === 1 ? "" : "s"} from "${sourceTitle}".`
      );
    },
    [cards, phases, scenarios, targetScenarioId, targetPhaseId, toastNote, toastSuccess, setCardsSynced]
  );

  const applyProposalKind = useCallback(
    (kind: ProposalKind) => {
      if (kind === proposalKind) return;
      const hasItems = cards.length > 0;
      const hasCustomStructure =
        scenarios.length > 1 ||
        phases.length !== (kind === "program" ? 5 : 3) ||
        scenarios.some((s) => s.title.trim() && s.title.trim() !== "Proposal Scenario 1");
      if (hasItems || hasCustomStructure) {
        const ok = window.confirm(
          `Switch to ${kind === "program" ? "Program" : "Project"} proposal? This replaces scenarios and sections with the preset structure${
            hasItems ? " and removes current line items" : ""
          }.`
        );
        if (!ok) return;
      }
      const init = createScenariosAndPhasesForKind(kind, newRoadmapCardKey);
      setProposalKind(kind);
      setScenarios(init.scenarios);
      setPhases(init.phases);
      setCards([]);
      setTargetScenarioId(init.scenarios[0]!.id);
      setTargetPhaseId(init.phases[0]?.id ?? "");
    },
    [cards.length, phases.length, proposalKind, scenarios]
  );

  const addScenario = useCallback(() => {
    const id = newRoadmapCardKey();
    setScenarios((prev) => [
      ...prev,
      { id, title: defaultScenarioTitleForKind(proposalKind, prev.length), narrative: "" },
    ]);
    setPhases((prev) => [
      ...prev,
      {
        id: newRoadmapCardKey(),
        scenarioId: id,
        title: defaultPhaseTitleForKind(proposalKind, 0),
        sortOrder: 0,
      },
    ]);
  }, [proposalKind]);

  const duplicateScenarioById = useCallback((scenarioId: string) => {
    const newSid = newRoadmapCardKey();
    setScenarios((prev) => {
      const src = prev.find((s) => s.id === scenarioId);
      if (!src) return prev;
      return [...prev, { id: newSid, title: `${src.title.trim() || "Scenario"} (copy)`, narrative: src.narrative }];
    });
    setPhases((phPrev) => {
      const phaseList = sortedPhasesForScenario(phPrev, scenarioId);
      const pmap = new Map<string, string>();
      const extra = phaseList.map((ph) => {
        const nid = newRoadmapCardKey();
        pmap.set(ph.id, nid);
        return { ...ph, id: nid, scenarioId: newSid, sortOrder: ph.sortOrder };
      });
      setCardsSynced((cPrev) => [
        ...cPrev,
        ...cPrev
          .filter((c) => c.scenarioId === scenarioId)
          .map((c) => ({
            ...c,
            key: newRoadmapCardKey(),
            scenarioId: newSid,
            phaseId: pmap.get(c.phaseId) ?? c.phaseId,
          })),
      ]);
      return [...phPrev, ...extra];
    });
  }, [setCardsSynced]);

  const deleteScenarioById = useCallback((scenarioId: string) => {
    setScenarios((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((s) => s.id !== scenarioId);
      setTargetScenarioId((tid) => (tid === scenarioId ? next[0]!.id : tid));
      return next;
    });
    setPhases((phPrev) => phPrev.filter((p) => p.scenarioId !== scenarioId));
    setCardsSynced((cPrev) => cPrev.filter((c) => c.scenarioId !== scenarioId));
  }, [setCardsSynced]);

  const addPhaseForScenario = useCallback(
    (scenarioId: string) => {
      setPhases((prev) => {
        const existing = prev.filter((p) => p.scenarioId === scenarioId);
        const nextOrder = existing.length === 0 ? 0 : Math.max(...existing.map((x) => x.sortOrder)) + 1;
        return [
          ...prev,
          {
            id: newRoadmapCardKey(),
            scenarioId,
            title: defaultPhaseTitleForKind(proposalKind, existing.length),
            sortOrder: nextOrder,
          },
        ];
      });
    },
    [proposalKind]
  );

  const deletePhaseById = useCallback(
    (phaseId: string) => {
      const phase = phases.find((p) => p.id === phaseId);
      if (!phase) return;
      const forScenario = phases.filter((p) => p.scenarioId === phase.scenarioId);
      if (forScenario.length <= 1) return;
      const inPhase = cards.filter((c) => c.phaseId === phaseId);
      if (inPhase.length > 0) {
        const ok = window.confirm(
          `Remove "${phase.title.trim() || "Phase"}" and ${inPhase.length} line item${inPhase.length === 1 ? "" : "s"} in it?`
        );
        if (!ok) return;
      }
      setPhases((prev) => prev.filter((p) => p.id !== phaseId));
      setCardsSynced((prev) => prev.filter((c) => c.phaseId !== phaseId));
      if (targetPhaseId === phaseId) {
        const remaining = forScenario.filter((p) => p.id !== phaseId).sort((a, b) => a.sortOrder - b.sortOrder);
        setTargetPhaseId(remaining[0]?.id ?? "");
      }
    },
    [phases, cards, targetPhaseId, setCardsSynced]
  );

  const budgetNumber = useMemo(() => parseMoneyInput(clientBudget), [clientBudget]);

  const pdfExportBase = useCallback(() => {
    if (!catalogCtx) return null;
    return {
      roadmapTitle,
      clientLabel,
      horizonMonths: (horizon === "custom" ? "custom" : Number(horizon)) as number | "custom",
      proposalStartDate,
      proposalEndDate,
      clientBudgetRaw: clientBudget,
      budgetNumber,
      scenarios,
      phases,
      cards,
      ctx: catalogCtx,
      computeScratchSellPrice,
      formatHoursShort,
    };
  }, [
    budgetNumber,
    cards,
    catalogCtx,
    clientBudget,
    clientLabel,
    horizon,
    phases,
    proposalEndDate,
    proposalStartDate,
    roadmapTitle,
    scenarios,
  ]);

  const downloadPdf = useCallback(() => {
    const input = pdfExportBase();
    if (!input) return;
    setPdfGenerating("client");
    try {
      downloadProposalPdf(input);
      toastSuccess("Client PDF downloaded.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not generate PDF.";
      toastError(msg);
    } finally {
      setPdfGenerating(null);
    }
  }, [pdfExportBase, toastError, toastSuccess]);

  const downloadOpsPdf = useCallback(() => {
    const input = pdfExportBase();
    if (!input || !catalogCtx) return;
    setPdfGenerating("ops");
    try {
      downloadProposalOpsPdf({
        ...input,
        tasksCtx: {
          tasks: catalogCtx.tasks,
          packageTiers: catalogCtx.packageTiers,
          tiers: catalogCtx.tiers,
          solutions: catalogCtx.solutions,
        },
      });
      toastSuccess("Ops PDF downloaded.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not generate ops PDF.";
      toastError(msg);
    } finally {
      setPdfGenerating(null);
    }
  }, [catalogCtx, pdfExportBase, toastError, toastSuccess]);

  const scenarioRollups = useMemo(() => {
    return scenarios.map((scenario) => {
      const inScenario = cards.filter((c) => c.scenarioId === scenario.id);
      let h = 0;
      let hN = 0;
      let priceSub = 0;
      let pN = 0;
      let missP = 0;
      let optPrice = 0;
      let optN = 0;
      for (const c of inScenario) {
        if (c.scope === "included") {
          const hh = cardHoursForScenarioRollup(c, catalogCtx);
          if (hh != null) {
            h += hh;
            hN += 1;
          }
          const pp = cardPriceUsdForRollup(c, catalogCtx, computeScratchSellPrice);
          if (pp != null) {
            priceSub += pp;
            pN += 1;
          } else {
            missP += 1;
          }
        } else if (c.scope === "optional") {
          const pu = tryParseUsdRough(effectivePriceStr(c, catalogCtx, computeScratchSellPrice));
          if (pu != null) {
            optPrice += pu;
            optN += 1;
          }
        }
      }
      return {
        count: inScenario.length,
        includedCount: inScenario.filter((c) => c.scope === "included").length,
        hoursSum: hN > 0 ? h : null,
        hoursCount: hN,
        priceSubtotal: priceSub,
        priceParsedCount: pN,
        missingPriceCount: missP,
        optionalPriceSubtotal: optPrice,
        optionalParsedCount: optN,
      };
    });
  }, [cards, scenarios, catalogCtx]);

  const preBuiltCustomPackages = useMemo(() => {
    if (!data?.packageTypes || !catalogCtx) return [];
    return filterConfigurablePackages(catalogCtx.packages, data.packageTypes).sort((a, b) =>
      sortId(a.package_id, b.package_id)
    );
  }, [catalogCtx, data?.packageTypes]);

  if (state.status === "error") {
    return (
      <div className="roadmap-page">
        <div className="roadmap-page__inner">
          <p className="roadmap-muted">
            Unable to load solutions. Details are shown in the notification stack (bottom corner).
          </p>
          <button type="button" className="roadmap-btn roadmap-btn--ghost" onClick={() => void load()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (state.status === "loading" || state.status === "idle") {
    return (
      <div className="roadmap-page">
        <div className="roadmap-page__inner roadmap-page__inner--narrow">
          <p className="roadmap-muted">Loading solutions from Supabase…</p>
        </div>
      </div>
    );
  }

  if (state.status !== "ok") {
    return null;
  }

  if (!catalogCtx) {
    return null;
  }

  const ctx = catalogCtx;
  const detailsCard = detailsModalKey ? cards.find((c) => c.key === detailsModalKey) ?? null : null;
  const addedEditCard = addedEditKey ? cards.find((c) => c.key === addedEditKey) ?? null : null;
  const addedEditPackageComponents =
    addedEditCard?.kind === "package" && ctx
      ? packageComponentRows(addedEditCard.refId, ctx)
      : undefined;
  const targetScenarioTitle =
    scenarios.find((s) => s.id === targetScenarioId)?.title.trim() || "Scenario";
  const targetPhaseTitle =
    sortedPhasesForScenario(phases, targetScenarioId).find((p) => p.id === targetPhaseId)?.title.trim() || "Phase";

  const renderConfigurablePackagesPanel = () => {
    if (!data) return null;
    return (
    <ProposalConfigurablePackagesPanel
      packageTypes={data.packageTypes}
      slots={data.packageBuilderSlots}
      packages={ctx.packages}
      solutions={ctx.solutions}
      tiers={ctx.tiers}
      tasks={ctx.tasks}
      pricing={[...ctx.pricingMap.values()]}
      scenarios={scenarios}
      phases={phases}
      targetScenarioId={targetScenarioId}
      targetPhaseId={targetPhaseId}
      onTargetScenarioChange={setTargetScenarioId}
      onTargetPhaseChange={setTargetPhaseId}
      targetScenarioTitle={targetScenarioTitle}
      targetPhaseTitle={targetPhaseTitle}
      proposalStartDate={proposalStartDate}
      proposalEndDate={proposalEndDate}
      onAddPackage={(p, dates) => {
        if (!canAddToTarget) return;
        addCard(cardForPackage(p, ctx, targetScenarioId, targetPhaseId, dates));
        if (builderStep === "packages" && packageAddPath) {
          setPackageSwitchPromptPath(packageAddPath);
        }
      }}
      canAdd={canAddToTarget}
      catalogReloading={catalogReloading}
      onReloadCatalog={async () => {
        await load(true);
      }}
      budget={budgetNumber}
      scenarioBudgetBars={scenarios.map((s, i) => ({
        scenarioId: s.id,
        title: s.title,
        includedSubtotal: scenarioRollups[i]?.priceSubtotal ?? 0,
        isActive: s.id === targetScenarioId,
      }))}
      formatUsd={formatUsd}
      addedLines={catalogAddedLines}
      onRemoveAdded={removeCard}
      onEditAdded={openAddedEdit}
      onDuplicateAdded={duplicateAddedCard}
      onAddAddOns={addAddOnsToParent}
      addonGroups={moduleAddOnGroups}
      copyFromScenarios={copyFromScenarios}
      onCopyFromScenario={copyOfferingsFromScenario}
    />
    );
  };

  const renderCatalogPanel = (
    panelVariant: "offerings" | "preset_packages" | "configurable_packages" | "variable_tiers",
    filteredPackages: Package[]
  ) => (
    <ProposalCatalogPanel
      panelVariant={panelVariant}
      ctx={ctx}
      catalogTierTableRows={playbookCatalogTierTableRows}
      variableTierTableRows={variableCatalogTierTableRows}
      scenarios={scenarios}
      phases={phases}
      targetScenarioId={targetScenarioId}
      targetPhaseId={targetPhaseId}
      onTargetScenarioChange={setTargetScenarioId}
      onTargetPhaseChange={setTargetPhaseId}
      targetScenarioTitle={targetScenarioTitle}
      targetPhaseTitle={targetPhaseTitle}
      filteredPackages={filteredPackages}
      packagePreview={(p) => cardForPackage(p, ctx, targetScenarioId, targetPhaseId)}
      proposalStartDate={proposalStartDate}
      proposalEndDate={proposalEndDate}
      onAddPackage={(p, dates) => {
        if (!canAddToTarget) return;
        addCard(cardForPackage(p, ctx, targetScenarioId, targetPhaseId, dates));
        if (builderStep === "packages" && packageAddPath) {
          setPackageSwitchPromptPath(packageAddPath);
        }
      }}
      onAddTier={(t, dates, clientFacingLabel, addonTiers, opts) => {
        if (!canAddToTarget) return;
        const parent = cardForTier(t, ctx, targetScenarioId, targetPhaseId, dates, clientFacingLabel);
        const flexUsd = opts?.flexBudgetPriceUsd;
        const pricedParent =
          flexUsd != null && Number.isFinite(flexUsd) && flexUsd >= 0
            ? {
                ...parent,
                price: formatProposalUsdValue(flexUsd),
                priceOverride: formatProposalUsdValue(flexUsd),
                isFlexBudget: true,
              }
            : parent;
        const extras = (addonTiers ?? []).map((a) => ({
          ...cardForTier(
            a,
            ctx,
            targetScenarioId,
            targetPhaseId,
            dates,
            a.solution_tier_name.trim() || a.solution_tier_id
          ),
          addonOfCardKey: pricedParent.key,
        }));
        setCardsSynced((prev) => [...prev, pricedParent, ...extras]);
      }}
      onAddVariableTier={(t, dates, opts) => {
        if (!canAddToTarget) return;
        if (opts?.paidAdsMonths?.length) {
          const monthCards = opts.paidAdsMonths.map((m) =>
            cardForVariableTier(
              t,
              ctx,
              targetScenarioId,
              targetPhaseId,
              {
                paidAdsSpendUsd: m.spendUsd,
                paidAdsMonthLabel: m.monthLabel,
              },
              { startDate: m.startDate, endDate: m.endDate }
            )
          );
          setCardsSynced((prev) => [...prev, ...monthCards]);
          return;
        }
        addCard(cardForVariableTier(t, ctx, targetScenarioId, targetPhaseId, opts, dates));
      }}
      previewVariableTierPriceUsd={previewVariableTierPriceUsd}
      variableTierLinkTargets={variableTierLinkTargets}
      onAddScratchTier={(dates) => {
        if (!canAddToTarget) return;
        addCard(cardForScratchTier(targetScenarioId, targetPhaseId, ctx, dates));
      }}
      canAdd={canAddToTarget}
      catalogReloading={catalogReloading}
      onReloadCatalog={() => void load(true)}
      budget={budgetNumber}
      formatUsd={formatUsd}
      scenarioBudgetBars={scenarios.map((s, i) => ({
        scenarioId: s.id,
        title: s.title,
        includedSubtotal: scenarioRollups[i]?.priceSubtotal ?? 0,
        isActive: s.id === targetScenarioId,
      }))}
      addedLines={catalogAddedLines}
      onRemoveAdded={removeCard}
      onEditAdded={openAddedEdit}
      onDuplicateAdded={duplicateAddedCard}
      onAddAddOns={addAddOnsToParent}
      addedTierRefIds={addedTierRefIds}
      addedPackageRefIds={addedPackageRefIds}
      copyFromScenarios={copyFromScenarios}
      onCopyFromScenario={copyOfferingsFromScenario}
    />
  );

  return (
    <div className="roadmap-page">
      <div className="roadmap-page__inner roadmap-page__inner--wide">
        <header className="roadmap-hero roadmap-hero--builder">
          <div className="roadmap-hero__main roadmap-hero__main--builder">
            <div className="roadmap-hero__copy">
              <div className="roadmap-hero__title-lockup">
                <span className="roadmap-hero__title-icon" aria-hidden>
                  <svg viewBox="0 0 24 24" fill="none">
                    <path
                      d="M8 4h8l4 4v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinejoin="round"
                    />
                    <path d="M16 4v4h4" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
                    <path d="M9 12h6M9 16h4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                  </svg>
                </span>
                <h1 className="roadmap-hero__title roadmap-hero__title--builder">Proposal Builder</h1>
              </div>
            </div>
            <div className="roadmap-hero__mode-tabs">
              <ProposalBuilderModeTabs
                active={
                  activeProposalId
                    ? builderMode === "awaiting_ops" || builderMode === "client_ready"
                      ? builderMode
                      : "saved"
                    : builderMode
                }
                onChange={handleBuilderModeChange}
                savedCount={savedProposals.length}
                awaitingOpsCount={awaitingOpsProposals.length}
                clientReadyCount={clientReadyProposals.length}
              />
            </div>
          </div>
        </header>

        {showSaveBanner ? (
          <ProposalSaveReminderBanner
            isDirty={proposalIsDirty}
            saving={savingProposal}
            onSave={() => void saveCurrentProposal()}
          />
        ) : null}

        {(builderMode === "saved" ||
          builderMode === "awaiting_ops" ||
          builderMode === "client_ready") &&
        !activeProposalId ? (
          <div className="proposal-builder-saved-wrap">
            <ProposalSavedProposalsPanel
              key={builderMode}
              proposals={
                builderMode === "awaiting_ops"
                  ? awaitingOpsProposals
                  : builderMode === "client_ready"
                    ? clientReadyProposals
                    : savedProposals
              }
              loading={savedProposalsLoading}
              activeProposalId={activeProposalId}
              deletingProposalId={deletingProposalId}
              reviewingProposalId={reviewingProposalId}
              onRefresh={() => void loadSavedProposals()}
              onOpen={(row) =>
                loadSavedProposalIntoBoard(row, {
                  libraryMode: builderMode,
                  entryStep:
                    builderMode === "awaiting_ops"
                      ? "client_service"
                      : builderMode === "client_ready"
                        ? "client_ready"
                        : "review",
                })
              }
              onDelete={(row) => void deleteSavedProposal(row)}
              onReviewedByOpsChange={
                builderMode === "awaiting_ops" || builderMode === "client_ready"
                  ? (row, reviewed) => void setReviewedByOps(row, reviewed)
                  : undefined
              }
              onMoveToSaved={
                builderMode === "awaiting_ops" || builderMode === "client_ready"
                  ? (row) => void moveProposalToSaved(row)
                  : undefined
              }
              variant={
                builderMode === "awaiting_ops"
                  ? "awaiting_ops"
                  : builderMode === "client_ready"
                    ? "client_ready"
                    : "saved"
              }
            />
          </div>
        ) : (
        <div className="proposal-builder">
          <ProposalBuilderSteps
            active={builderStep}
            onChange={setBuilderStep}
            setupComplete={setupComplete}
            lineItemCount={cards.length}
            includeOpsPath={includeOpsPath}
          />
          <div className="proposal-builder__main">
            {builderStep === "setup" ? (
              <>
                <section className="roadmap-panel roadmap-panel--meta proposal-step-panel">
                  <header className="proposal-step-panel__head">
                    <p className="proposal-step-panel__eyebrow">Step 1</p>
                    <h2 className="proposal-step-panel__title">Setup</h2>
                  </header>
                  <div className="roadmap-meta-grid">
                    <div className="roadmap-field">
                      <div className="roadmap-field__cap-row">
                        <label className="roadmap-field__cap" htmlFor="proposal-roadmap-name">
                          Roadmap name
                        </label>
                        <span className="roadmap-field__tip-wrap">
                          <button
                            type="button"
                            className="roadmap-field__tip"
                            aria-describedby="proposal-roadmap-name-client-tip"
                            aria-label="Client code guidance"
                          >
                            i
                          </button>
                          <span
                            id="proposal-roadmap-name-client-tip"
                            role="tooltip"
                            className="roadmap-field__tip-popover"
                          >
                            {ROADMAP_NAME_CLIENT_CODE_TOOLTIP}
                          </span>
                        </span>
                      </div>
                      <input
                        id="proposal-roadmap-name"
                        className="roadmap-input"
                        value={roadmapTitle}
                        onChange={(e) => setRoadmapTitle(e.target.value)}
                        placeholder={ROADMAP_NAME_FORMAT_EXAMPLE}
                        aria-describedby="proposal-roadmap-name-hint"
                      />
                      <p id="proposal-roadmap-name-hint" className="roadmap-muted roadmap-field__note">
                        {ROADMAP_NAME_FORMAT_HINT}
                      </p>
                      {roadmapTitle.trim() && !roadmapNameValid ? (
                        <span className="roadmap-budget-warn" role="status">
                          Use the standard format, e.g. {ROADMAP_NAME_FORMAT_EXAMPLE}.
                        </span>
                      ) : null}
                    </div>
                    <label className="roadmap-field">
                      <span className="roadmap-field__cap">Client name</span>
                      <input
                        className="roadmap-input"
                        value={clientLabel}
                        onChange={(e) => setClientLabel(e.target.value)}
                        placeholder="Optional label for your notes"
                      />
                      <p className="roadmap-muted roadmap-field__note">
                        Reference the company by its exact full name as it appears in Productive.
                      </p>
                    </label>
                    <label className="roadmap-field">
                      <span className="roadmap-field__cap">Client budget (USD)</span>
                      <input
                        className="roadmap-input"
                        value={clientBudget}
                        onChange={(e) => setClientBudget(e.target.value)}
                        placeholder="e.g. 150000 or 150k"
                        inputMode="decimal"
                        autoComplete="off"
                      />
                      {budgetNumber == null && clientBudget.trim() ? (
                        <span className="roadmap-budget-warn" role="status">
                          Could not read that as a number — try digits only, commas, or 150k.
                        </span>
                      ) : null}
                    </label>
                    <label className="roadmap-field">
                      <span className="roadmap-field__cap">Proposal start date</span>
                      <input
                        type="date"
                        className="roadmap-input"
                        value={proposalStartDate}
                        onChange={(e) => setProposalStartDate(normalizeIsoDateInput(e.target.value))}
                      />
                    </label>
                    <label className="roadmap-field">
                      <span className="roadmap-field__cap">Proposal end date</span>
                      <input
                        type="date"
                        className="roadmap-input"
                        value={proposalEndDate}
                        onChange={(e) => setProposalEndDate(normalizeIsoDateInput(e.target.value))}
                      />
                      {proposalDateRangeLabel(proposalStartDate, proposalEndDate) !== "—" ? (
                        <span className="roadmap-budget-confirm">
                          Proposal schedule: {proposalDateRangeLabel(proposalStartDate, proposalEndDate)}
                        </span>
                      ) : null}
                    </label>
                    <label className="roadmap-field">
                      <span className="roadmap-field__cap">{PROPOSAL_DURATION_LABEL}</span>
                      <select
                        className="roadmap-input"
                        value={horizon}
                        onChange={(e) => setHorizon(e.target.value as RoadmapHorizon)}
                      >
                        <option value="3">3 months</option>
                        <option value="4">4 months</option>
                        <option value="6">6 months</option>
                        <option value="12">12 months</option>
                        <option value="custom">Custom (describe in export)</option>
                      </select>
                    </label>
                  </div>
                </section>
                <ProposalCopyFromPanel
                  proposals={savedProposals}
                  loading={savedProposalsLoading}
                  activeProposalId={activeProposalId}
                  onCopy={copyStructureFromSavedProposal}
                />
                <ProposalScenariosPanel
                  proposalKind={proposalKind}
                  onProposalKindChange={applyProposalKind}
                  scenarios={scenarios}
                  phases={phases}
                  cards={cards}
                  onUpdateScenarioTitle={(id, title) =>
                    setScenarios((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)))
                  }
                  onUpdatePhaseTitle={(id, title) =>
                    setPhases((prev) => prev.map((p) => (p.id === id ? { ...p, title } : p)))
                  }
                  onAddScenario={addScenario}
                  onDuplicateScenario={duplicateScenarioById}
                  onDeleteScenario={deleteScenarioById}
                  onAddPhase={addPhaseForScenario}
                  onDeletePhase={deletePhaseById}
                />
                <ProposalStepNav
                  step="setup"
                  onStepChange={setBuilderStep}
                  includeOpsPath={includeOpsPath}
                  nextDisabled={!setupComplete}
                  nextLabel={
                    setupComplete ? "Continue to add packages" : "Add a roadmap name to continue"
                  }
                  {...proposalStepSaveProps}
                />
              </>
            ) : null}

            {builderStep === "packages" ? (
              <>
                {packageAddPath == null ? (
                  <ProposalPackagesChoice onChoose={setPackageAddPath} />
                ) : (
                  <>
                    <ProposalPackagesPathBar
                      path={packageAddPath}
                      onSelectPath={(next) => {
                        setPackageAddPath(next);
                        setPackageSwitchPromptPath(null);
                      }}
                      onBackToOptions={() => {
                        setPackageAddPath(null);
                        setPackageSwitchPromptPath(null);
                      }}
                    />
                    {packageSwitchPromptPath === packageAddPath ? (
                      <ProposalPackagesSwitchPrompt
                        fromPath={packageAddPath}
                        onSwitch={() => {
                          const next = packageAddPath === "build" ? "prebuilt" : "build";
                          setPackageAddPath(next);
                          setPackageSwitchPromptPath(null);
                        }}
                        onDismiss={() => setPackageSwitchPromptPath(null)}
                      />
                    ) : null}
                    {packageAddPath === "build"
                      ? renderConfigurablePackagesPanel()
                      : renderCatalogPanel("preset_packages", preBuiltCustomPackages)}
                  </>
                )}
                <ProposalStepNav
                  step="packages"
                  onStepChange={setBuilderStep}
                  includeOpsPath={includeOpsPath}
                  nextLabel="Continue to add solutions"
                  {...proposalStepSaveProps}
                />
              </>
            ) : null}

            {builderStep === "catalog" ? (
              <>
                {renderCatalogPanel("offerings", [])}
                <ProposalStepNav
                  step="catalog"
                  onStepChange={setBuilderStep}
                  includeOpsPath={includeOpsPath}
                  nextLabel="Organize Proposal"
                  {...proposalStepSaveProps}
                />
              </>
            ) : null}

            {builderStep === "board" ? (
              <>
                <ProposalOrganizePanel
                  scenarios={scenarios}
                  phases={phases}
                  cards={cards}
                  ctx={ctx}
                  scenarioRollups={scenarioRollups}
                  budget={budgetNumber}
                  formatUsd={formatUsd}
                  formatHoursShort={formatHoursShort}
                  computeScratchSellPrice={computeScratchSellPrice}
                  initialScenarioId={targetScenarioId}
                  onPatchCard={patchCard}
                  onRemoveCard={removeCard}
                  onReorderPhaseCards={reorderPhaseCards}
                  onOpenDetails={openDetailsModal}
                  onEditStructure={() => setBuilderStep("setup")}
                  onClearScenarioItems={clearScenarioItems}
                  onUpdateScenarioNarrative={(id, narrative) =>
                    setScenarios((prev) => prev.map((s) => (s.id === id ? { ...s, narrative } : s)))
                  }
                />
              </>
            ) : null}

            {builderStep === "board" ? (
              <ProposalStepNav
                step="board"
                onStepChange={setBuilderStep}
                includeOpsPath={includeOpsPath}
                nextLabel="Preview Proposal"
                {...proposalStepSaveProps}
              />
            ) : null}

            {builderStep === "review" ? (
              <>
                <section className="roadmap-panel proposal-review-header">
                  <header className="proposal-step-panel__head">
                    <p className="proposal-step-panel__eyebrow">Step 5</p>
                    <h2 className="proposal-step-panel__title">Preview Proposal</h2>
                    <p className="proposal-step-panel__lead">
                      {roadmapTitle.trim() || "Untitled roadmap"}
                      {clientLabel.trim() ? ` · ${clientLabel.trim()}` : ""}
                      {proposalDateRangeLabel(proposalStartDate, proposalEndDate) !== "—"
                        ? ` · ${proposalDateRangeLabel(proposalStartDate, proposalEndDate)}`
                        : ""}{" "}
                      — {cards.length} line item
                      {cards.length === 1 ? "" : "s"} across {scenarios.length} scenario
                      {scenarios.length === 1 ? "" : "s"}.
                    </p>
                  </header>
                </section>

        <section className="roadmap-panel roadmap-panel--export">
          <div className="roadmap-export__head">
            <h2 className="roadmap-export__title">Export Preview</h2>
            <div className="roadmap-export__head-actions">
              <button
                type="button"
                className="roadmap-btn roadmap-btn--primary"
                disabled={pdfGenerating != null}
                onClick={downloadPdf}
              >
                {pdfGenerating === "client" ? "Generating PDF…" : "Download PDF"}
              </button>
            </div>
          </div>
          <ProposalExportPreviewTables
            scenarios={scenarios}
            phases={phases}
            cards={cards}
            ctx={ctx}
            computeScratchSellPrice={computeScratchSellPrice}
            formatUsd={formatUsd}
            formatHoursShort={formatHoursShort}
          />
        </section>
                <ProposalStepNav
                  step="review"
                  onStepChange={setBuilderStep}
                  includeOpsPath={includeOpsPath}
                  nextLabel={includeOpsPath ? "Ops Review" : "Submit for Ops Review"}
                  onNext={includeOpsPath ? undefined : () => void submitForOpsReview()}
                  {...proposalStepSaveProps}
                />
              </>
            ) : null}

            {includeOpsPath && builderStep === "client_service" ? (
              <>
                {catalogCtx ? (
                  <ProposalClientServiceReviewPanel
                    scenarios={scenarios}
                    phases={phases}
                    cards={cards}
                    tasks={catalogCtx.tasks}
                    packageTiers={catalogCtx.packageTiers}
                    tiers={catalogCtx.tiers}
                    solutions={catalogCtx.solutions}
                    effectivePriceForCard={(c) =>
                      effectivePriceStr(c, catalogCtx, computeScratchSellPrice)
                    }
                    onPatchCard={(key, next) => {
                      setCardsSynced((prev) => prev.map((c) => (c.key === key ? next : c)));
                    }}
                  />
                ) : (
                  <p className="roadmap-muted">Loading catalog tasks…</p>
                )}
                <ProposalStepNav
                  step="client_service"
                  onStepChange={setBuilderStep}
                  includeOpsPath={includeOpsPath}
                  nextLabel="Client Ready Proposal"
                  {...proposalStepSaveProps}
                />
              </>
            ) : null}

            {includeOpsPath && builderStep === "client_ready" ? (
              <>
                <ProposalClientReadyPanel
                  roadmapTitle={roadmapTitle}
                  clientLabel={clientLabel}
                  dateRangeLabel={proposalDateRangeLabel(proposalStartDate, proposalEndDate)}
                  scenarios={scenarios}
                  phases={phases}
                  cards={cards}
                  ctx={catalogCtx}
                  tasksCtx={
                    catalogCtx
                      ? {
                          tasks: catalogCtx.tasks,
                          packageTiers: catalogCtx.packageTiers,
                          tiers: catalogCtx.tiers,
                          solutions: catalogCtx.solutions,
                        }
                      : null
                  }
                  computeScratchSellPrice={computeScratchSellPrice}
                  formatUsd={formatUsd}
                  formatHoursShort={formatHoursShort}
                  pdfGenerating={pdfGenerating}
                  onClientDownload={downloadPdf}
                  onOpsDownload={downloadOpsPdf}
                  onReviewedByOps={() => void markReviewedByOps()}
                  reviewedByOpsBusy={savingProposal}
                />
                <ProposalStepNav
                  step="client_ready"
                  onStepChange={setBuilderStep}
                  includeOpsPath={includeOpsPath}
                  nextLabel="Reviewed by Ops"
                  onNext={() => void markReviewedByOps()}
                  {...proposalStepSaveProps}
                />
              </>
            ) : null}
          </div>
        </div>
        )}
      </div>

      {addedEditCard ? (
        <ProposalAddedEditModal
          card={addedEditCard}
          phaseChoices={sortedPhasesForScenario(phases, addedEditCard.scenarioId)}
          formatUsd={formatUsd}
          packageComponents={addedEditPackageComponents}
          onEditPackageComponents={
            addedEditCard.kind === "package" ? openVaultPackageComponentsEditor : undefined
          }
          onClose={closeAddedEdit}
          onSave={saveAddedEdit}
        />
      ) : null}

      {vaultPackageEditId && data && ctx ? (
        <PackageBuildWizard
          variant="proposal"
          editPackageId={vaultPackageEditId}
          onEditPackageConsumed={closeVaultPackageComponentsEditor}
          packageTypes={data.packageTypes}
          slots={data.packageBuilderSlots}
          packages={ctx.packages}
          packageTiers={ctx.packageTiers}
          solutions={ctx.solutions}
          tiers={ctx.tiers}
          tasks={ctx.tasks}
          pricing={[...ctx.pricingMap.values()]}
          wizardTitle="Edit package components"
          onReload={async () => {
            await load(true);
          }}
          onCreated={async () => {
            await onVaultPackageComponentsSaved();
          }}
        />
      ) : null}

      {detailsModalKey && detailsCard ? (
        <div className="roadmap-modal-backdrop" onClick={closeDetailsModal} role="presentation">
          <div
            className="roadmap-modal roadmap-modal--wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="roadmap-details-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="roadmap-details-modal-title" className="roadmap-modal__title">
              Details
            </h2>
            <p className="roadmap-modal__subtitle">
              <span className={`roadmap-card__kind roadmap-card__kind--${detailsCard.kind}`}>
                {kindLabel(detailsCard.kind)}
              </span>
              <span className="roadmap-modal__subtitle-name">{detailsCard.headline}</span>
            </p>
            {detailsCard.kind === "custom_tier" && scratchDraft && scratchDraft.kind === "custom_tier" ? (
              <>
                <div className="roadmap-details-scroll">
                  <p className="roadmap-muted roadmap-details-lead">
                    Sell price updates from:{" "}
                    <code>(manual hours + solution task &amp; group template hours) × blended $/hr × risk × strategic</code>{" "}
                    (rounded to whole dollars).
                  </p>
                  <label className="roadmap-field">
                    <span className="roadmap-field__cap">Title</span>
                    <input
                      className="roadmap-input"
                      value={scratchDraft.headline}
                      onChange={(e) => setScratchDraft((d) => (d ? { ...d, headline: e.target.value } : d))}
                    />
                  </label>
                  <label className="roadmap-field">
                    <span className="roadmap-field__cap">Manual hours (e.g. 20 or 11.75 h)</span>
                    <input
                      className="roadmap-input"
                      value={scratchDraft.hours}
                      onChange={(e) =>
                        setScratchDraft((d) =>
                          d ? withScratchRecalculatedPrice({ ...d, hours: e.target.value }, ctx) : d
                        )
                      }
                    />
                  </label>
                  <div ref={scratchComposeSectionRef} className="roadmap-scratch-compose">
                    <h3 className="roadmap-details-h3">Solution composition</h3>
                    <p className="roadmap-muted roadmap-scratch-compose__hint">
                      Attach solution tasks (their time) and task group templates (sum of line hours). These add to
                      manual hours above for pricing.
                    </p>
                    <div className="roadmap-scratch-compose__block">
                      <span className="roadmap-field__cap">Attached tasks</span>
                      {(scratchDraft.scratchAttachedTaskIds ?? []).length === 0 ? (
                        <p className="roadmap-muted roadmap-scratch-compose__empty">None yet.</p>
                      ) : (
                        <ul className="roadmap-scratch-compose__list">
                          {(scratchDraft.scratchAttachedTaskIds ?? []).map((tid) => {
                            const k = ctx.tasks.find((t) => t.task_id === tid);
                            const h = k?.task_time != null && Number.isFinite(Number(k.task_time)) ? Number(k.task_time) : null;
                            return (
                              <li key={tid} className="roadmap-scratch-compose__row">
                                <span>
                                  <strong>{k?.task_name ?? tid}</strong>
                                  {h != null ? ` · ${h} h` : " · (no time in solutions)"}
                                </span>
                                <button
                                  type="button"
                                  className="roadmap-btn roadmap-btn--danger-sm"
                                  onClick={() =>
                                    setScratchDraft((d) => {
                                      if (!d) return d;
                                      const next = {
                                        ...d,
                                        scratchAttachedTaskIds: (d.scratchAttachedTaskIds ?? []).filter((x) => x !== tid),
                                      };
                                      return withScratchRecalculatedPrice(next, ctx);
                                    })
                                  }
                                >
                                  Remove
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      <label className="roadmap-field roadmap-scratch-compose__add">
                        <span className="roadmap-field__cap">Add solution task</span>
                        <select
                          key={`scratch-task-pick-${detailsModalKey}-${scratchTaskPickTick}`}
                          className="roadmap-input"
                          defaultValue=""
                          onChange={(e) => {
                            const id = e.target.value;
                            setScratchTaskPickTick((n) => n + 1);
                            if (!id) return;
                            setScratchDraft((d) => {
                              if (!d) return d;
                              const cur = d.scratchAttachedTaskIds ?? [];
                              if (cur.includes(id)) return withScratchRecalculatedPrice(d, ctx);
                              const next = { ...d, scratchAttachedTaskIds: [...cur, id] };
                              return withScratchRecalculatedPrice(next, ctx);
                            });
                          }}
                        >
                          <option value="">Choose a task…</option>
                          {ctx.tasks
                            .slice()
                            .sort((a, b) => a.task_name.localeCompare(b.task_name))
                            .map((k) => (
                              <option key={k.task_id} value={k.task_id}>
                                {k.task_name}
                              </option>
                            ))}
                        </select>
                      </label>
                    </div>
                    <div className="roadmap-scratch-compose__block">
                      <span className="roadmap-field__cap">Attached task group templates</span>
                      {(scratchDraft.scratchAttachedTaskGroupIds ?? []).length === 0 ? (
                        <p className="roadmap-muted roadmap-scratch-compose__empty">None yet.</p>
                      ) : (
                        <ul className="roadmap-scratch-compose__list">
                          {(scratchDraft.scratchAttachedTaskGroupIds ?? []).map((gid) => {
                            const g = ctx.taskGroups.find((x) => x.id === gid);
                            const lines = ctx.groupLinesMap.get(gid) ?? [];
                            let gh = 0;
                            let ghOk = false;
                            for (const L of lines) {
                              if (L.hours != null && Number.isFinite(Number(L.hours))) {
                                gh += Number(L.hours);
                                ghOk = true;
                              }
                            }
                            return (
                              <li key={gid} className="roadmap-scratch-compose__row">
                                <span>
                                  <strong>{g?.name ?? gid}</strong>
                                  {ghOk ? ` · ${gh} h (lines Σ)` : " · (no line hours in solutions)"}
                                </span>
                                <button
                                  type="button"
                                  className="roadmap-btn roadmap-btn--danger-sm"
                                  onClick={() =>
                                    setScratchDraft((d) => {
                                      if (!d) return d;
                                      const next = {
                                        ...d,
                                        scratchAttachedTaskGroupIds: (d.scratchAttachedTaskGroupIds ?? []).filter((x) => x !== gid),
                                      };
                                      return withScratchRecalculatedPrice(next, ctx);
                                    })
                                  }
                                >
                                  Remove
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      <label className="roadmap-field roadmap-scratch-compose__add">
                        <span className="roadmap-field__cap">Add task group template</span>
                        <select
                          key={`scratch-group-pick-${detailsModalKey}-${scratchGroupPickTick}`}
                          className="roadmap-input"
                          defaultValue=""
                          onChange={(e) => {
                            const id = e.target.value;
                            setScratchGroupPickTick((n) => n + 1);
                            if (!id) return;
                            setScratchDraft((d) => {
                              if (!d) return d;
                              const cur = d.scratchAttachedTaskGroupIds ?? [];
                              if (cur.includes(id)) return withScratchRecalculatedPrice(d, ctx);
                              const next = { ...d, scratchAttachedTaskGroupIds: [...cur, id] };
                              return withScratchRecalculatedPrice(next, ctx);
                            });
                          }}
                        >
                          <option value="">Choose a template…</option>
                          {ctx.taskGroups
                            .slice()
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map((g) => (
                              <option key={g.id} value={g.id}>
                                {g.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    </div>
                  </div>
                  <div className="roadmap-scratch-mult-grid">
                    <label className="roadmap-field">
                      <span className="roadmap-field__cap">Blended $/hr</span>
                      <input
                        className="roadmap-input"
                        type="number"
                        min={0}
                        step={1}
                        value={scratchDraft.scratchBlendRateUsd ?? DEFAULT_SCRATCH_BLEND}
                        onChange={(e) =>
                          setScratchDraft((d) => {
                            if (!d) return d;
                            const v = Number(e.target.value);
                            const next = { ...d, scratchBlendRateUsd: Number.isFinite(v) ? v : DEFAULT_SCRATCH_BLEND };
                            return withScratchRecalculatedPrice(next, ctx);
                          })
                        }
                      />
                    </label>
                    <label className="roadmap-field">
                      <span className="roadmap-field__cap">Risk multiplier</span>
                      <input
                        className="roadmap-input"
                        type="number"
                        min={0}
                        step={0.05}
                        value={scratchDraft.scratchRiskMult ?? DEFAULT_SCRATCH_MULT}
                        onChange={(e) =>
                          setScratchDraft((d) => {
                            if (!d) return d;
                            const v = Number(e.target.value);
                            const next = { ...d, scratchRiskMult: Number.isFinite(v) ? v : DEFAULT_SCRATCH_MULT };
                            return withScratchRecalculatedPrice(next, ctx);
                          })
                        }
                      />
                    </label>
                    <label className="roadmap-field">
                      <span className="roadmap-field__cap">Strategic multiplier</span>
                      <input
                        className="roadmap-input"
                        type="number"
                        min={0}
                        step={0.05}
                        value={scratchDraft.scratchStrategicMult ?? DEFAULT_SCRATCH_MULT}
                        onChange={(e) =>
                          setScratchDraft((d) => {
                            if (!d) return d;
                            const v = Number(e.target.value);
                            const next = { ...d, scratchStrategicMult: Number.isFinite(v) ? v : DEFAULT_SCRATCH_MULT };
                            return withScratchRecalculatedPrice(next, ctx);
                          })
                        }
                      />
                    </label>
                  </div>
                  <label className="roadmap-field">
                    <span className="roadmap-field__cap">Price override (optional)</span>
                    <input
                      className="roadmap-input"
                      placeholder="Leave empty to use calculated sell"
                      value={scratchDraft.priceOverride ?? ""}
                      onChange={(e) =>
                        setScratchDraft((d) => {
                          if (!d) return d;
                          const raw = e.target.value;
                          const next = { ...d, priceOverride: raw.trim() ? raw : null };
                          return withScratchRecalculatedPrice(next, ctx);
                        })
                      }
                    />
                  </label>
                  <p className="roadmap-scratch-computed">
                    {(() => {
                      const br = scratchEffectiveHoursBreakdown(scratchDraft, ctx);
                      const sell = effectivePriceStr(scratchDraft, ctx, computeScratchSellPrice);
                      if (!br) {
                        return (
                          <>
                            Effective hours: <strong>—</strong> (add manual hours and/or solution attachments) · Sell:{" "}
                            <strong>{sell}</strong>
                            {scratchDraft.priceOverride?.trim() ? (
                              <span className="roadmap-muted"> (using override)</span>
                            ) : null}
                          </>
                        );
                      }
                      return (
                        <>
                          Effective hours: <strong>{br.total} h</strong>{" "}
                          <span className="roadmap-muted">
                            ({br.manual} h manual + {br.catalog} h from solutions)
                          </span>
                          {" · "}Sell: <strong>{sell}</strong>
                          {scratchDraft.priceOverride?.trim() ? (
                            <span className="roadmap-muted"> (override)</span>
                          ) : null}
                        </>
                      );
                    })()}
                  </p>
                  <label className="roadmap-field">
                    <span className="roadmap-field__cap">Notes (included in export)</span>
                    <textarea
                      className="roadmap-input roadmap-modal__textarea roadmap-modal__textarea--short"
                      rows={4}
                      value={scratchDraft.description}
                      onChange={(e) => setScratchDraft((d) => (d ? { ...d, description: e.target.value } : d))}
                    />
                  </label>
                </div>
                <div className="roadmap-modal__actions">
                  <button type="button" className="roadmap-btn roadmap-btn--ghost" onClick={closeDetailsModal}>
                    Cancel
                  </button>
                  <button type="button" className="roadmap-btn roadmap-btn--primary" onClick={saveScratchFromModal}>
                    Save
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="roadmap-modal__body">{catalogItemDetails(detailsCard, ctx)}</div>
                <div className="roadmap-modal__actions">
                  <button type="button" className="roadmap-btn roadmap-btn--primary" onClick={closeDetailsModal}>
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
