import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, SetStateAction } from "react";
import { Link } from "react-router-dom";
import { browserKeyConfigurationError, getSupabase } from "../lib/supabase";
import {
  budgetVsScenarioStatus,
  cardHoursForScenarioRollup,
  cardPriceUsdForRollup,
  effectiveHoursStr,
  effectivePriceStr,
  type CatalogCtxLike,
  type RoadmapCard,
  type RoadmapCardKind,
  type RoadmapLineScope,
  type RoadmapPhase,
  type RoadmapScenario,
  reorderPhaseCardsByKeys,
  sortedPhasesForScenario,
  scratchEffectiveHoursBreakdown,
  tryParseRoadmapHours,
  tryParseUsdRough,
} from "../lib/roadmapModel";
import type { CatalogTierTableRow } from "../components/CatalogTierTable";
import { ProposalBuilderModeTabs, type ProposalBuilderMode } from "../components/proposal-builder/ProposalBuilderModeTabs";
import { ProposalSavedProposalsPanel } from "../components/proposal-builder/ProposalSavedProposalsPanel";
import { ProposalBuilderSteps, type ProposalBuilderStep } from "../components/proposal-builder/ProposalBuilderSteps";
import { ProposalStepNav } from "../components/proposal-builder/ProposalStepNav";
import { ProposalOrganizePanel } from "../components/proposal-builder/ProposalOrganizePanel";
import { ProposalScenariosPanel } from "../components/proposal-builder/ProposalScenariosPanel";
import { ProposalCatalogPanel } from "../components/proposal-builder/ProposalCatalogPanel";
import { TierResourceExamplesDisplay } from "../components/TierResourceExamplesDisplay";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { useProposalDraftGuard } from "../context/ProposalDraftGuardContext";
import {
  effectiveResourceExamples,
  effectiveResourceTools,
  stripRedundantResourceMarkdownHeading,
  tierTemplatesForProposalDisplay,
} from "../lib/tierResourceFields";
import { computePackageWorkspaceCatalogNumbers } from "../lib/packageWorkspaceMetrics";
import { catalogDisplayTierHours, formatTierHoursDisplay } from "../lib/vaultTierMetrics";
import { displayTierCategoryLabel } from "../lib/tierCategories";
import {
  loadTierPricingMathConfigFromStorage,
  normalizeTierPricingMathConfig,
  type TierPricingMathConfig,
} from "../lib/tierPricingMath";
import { downloadProposalPdf } from "../lib/proposalPdfExport";
import {
  normalizeIsoDateInput,
  proposalDateRangeLabel,
  type ProposalOfferingDates,
} from "../lib/proposalDates";
import {
  cloneProposalStructure,
  parseProposalSnapshot,
  type RoadmapHorizon,
  type RoadmapProposalSnapshot,
} from "../lib/roadmapProposalSnapshot";
import { ProposalCopyFromPanel } from "../components/proposal-builder/ProposalCopyFromPanel";
import { ProposalSaveReminderBanner } from "../components/proposal-builder/ProposalSaveReminderBanner";
import { copyScenarioOfferings } from "../lib/copyScenarioOfferings";
import { proposalSnapshotFingerprint } from "../lib/proposalDraftFingerprint";
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
import type {
  ImplementerHourGroupRow,
  Package,
  PackageSolutionTier,
  RoadmapProposalRow,
  Solution,
  SolutionTier,
  SolutionTierPricing,
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

function exportOneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function appendCardNotesExport(out: string[], c: RoadmapCard): void {
  if (!c.description.trim()) return;
  out.push(`  - **Notes (on card):**`);
  for (const para of c.description.trim().split(/\n\n+/)) {
    out.push(`    - ${exportOneLine(para)}`);
  }
}

/** Rich markdown lines for Copy summary / export preview (catalog + board context). */
function roadmapCardExportLines(c: RoadmapCard, ctx: CatalogCtx | null): string[] {
  const out: string[] = [];
  const displayTitle = c.headline.trim() || "(untitled)";
  out.push(`- **${kindLabel(c.kind)}** · ${displayTitle}${exportScopeSuffix(c.scope)} (\`${c.refId}\`)`);
  const scheduleLabel = proposalDateRangeLabel(c.startDate, c.endDate);
  if (scheduleLabel !== "—") {
    out.push(`  - **Schedule:** ${scheduleLabel}`);
  }
  const boardHours = effectiveHoursStr(c);
  const boardPrice = effectivePriceStr(c, ctx, computeScratchSellPrice);
  if (c.hoursOverride?.trim()) {
    out.push(`  - **Proposal hours (override):** \`${c.hoursOverride.trim()}\` _(vs catalog field \`${c.hours}\`)_`);
  }
  if (c.priceOverride?.trim()) {
    out.push(`  - **Proposal price (override):** **${c.priceOverride.trim()}**`);
  }

  if (!ctx) {
    out.push(`  - **On board:** Hours \`${boardHours}\` · Price **${boardPrice}**`);
    appendCardNotesExport(out, c);
    return out;
  }

  switch (c.kind) {
    case "custom_tier": {
      const rate = c.scratchBlendRateUsd ?? DEFAULT_SCRATCH_BLEND;
      const r = c.scratchRiskMult ?? DEFAULT_SCRATCH_MULT;
      const s = c.scratchStrategicMult ?? DEFAULT_SCRATCH_MULT;
      out.push(
        `  - **Pricing model:** (\`hours on card\` + \`catalog task times & template line hours\`) × **$${rate.toLocaleString()}/h** × **${r}** (risk) × **${s}** (strategic) → **${boardPrice}**`
      );
      const br = scratchEffectiveHoursBreakdown(c, ctx);
      if (br) {
        out.push(
          `  - **Hours in the model:** **${formatHoursShort(br.total)} h** total — ${formatHoursShort(br.manual)} h from the card + ${formatHoursShort(br.catalog)} h rolled in from catalog`
        );
      } else {
        out.push(`  - **Hours in the model:** _none yet — add hours on the card and/or attachments that have times in Admin_`);
      }
      const tids = c.scratchAttachedTaskIds ?? [];
      for (const tid of tids) {
        const k = ctx.tasks.find((t) => t.task_id === tid);
        const tier = k ? ctx.tiers.find((t) => t.solution_tier_id === k.solution_tier_id) : undefined;
        const th = k?.task_time != null && Number.isFinite(Number(k.task_time)) ? Number(k.task_time) : null;
        out.push(
          `  - **Attached task:** ${k ? `**${k.task_name}**` : `\`${tid}\` _(missing in catalog)_`}${
            tier ? ` · tier _${tier.solution_tier_name}_` : ""
          }${th != null ? ` · **${formatHoursShort(th)} h**` : " · _(no \`task_time\` in catalog)_"}`
        );
      }
      const gids = c.scratchAttachedTaskGroupIds ?? [];
      for (const gid of gids) {
        const g = ctx.taskGroups.find((x) => x.id === gid);
        const lines = ctx.groupLinesMap.get(gid) ?? [];
        const sorted = lines.slice().sort((a, b) => a.sort_order - b.sort_order);
        let gh = 0;
        for (const L of sorted) {
          if (L.hours != null && Number.isFinite(Number(L.hours))) gh += Number(L.hours);
        }
        out.push(
          `  - **Attached template:** ${g ? `**${g.name}**` : `\`${gid}\` _(missing in catalog)_`} — **${formatHoursShort(gh)} h** from ${sorted.length} line(s)`
        );
        const maxLines = 14;
        for (const L of sorted.slice(0, maxLines)) {
          out.push(`    - ${L.task_name}${L.hours != null ? ` · **${L.hours} h**` : ""}`);
        }
        if (sorted.length > maxLines) {
          out.push(`    - _…and ${sorted.length - maxLines} more line(s)_`);
        }
      }
      out.push(`  - **On board (editable):** hours \`${boardHours}\` · sell **${boardPrice}** _(computed or override)_`);
      appendCardNotesExport(out, c);
      break;
    }
    case "tier": {
      const t = ctx.tiers.find((x) => x.solution_tier_id === c.refId);
      if (!t) {
        out.push(`  - _No tier in catalog for \`${c.refId}\` — board values may be stale._`);
        out.push(`  - **On board:** ${boardHours} · **${boardPrice}**`);
        appendCardNotesExport(out, c);
        break;
      }
      const sol = ctx.solutions.find((s) => s.solution_id === t.solution_id);
      const pr = ctx.pricingMap.get(t.solution_tier_id) ?? null;
      const pkgNames = ctx.packageTiers
        .filter((pt) => pt.solution_tier_id === t.solution_tier_id)
        .map((pt) => ctx.packages.find((pk) => pk.package_id === pt.package_id)?.package_name ?? pt.package_id);
      out.push(`  - **Catalog:** **${sol?.solution_name ?? t.solution_id}** → tier **${t.solution_tier_name}** (\`${t.solution_tier_id}\`)`);
      if (pr) {
        out.push(`  - **Admin pricing row:** sell **${sellPriceLine(pr)}** · checklist task time **${tierHoursLine(c.refId, pr, ctx.tasks)}**`);
      } else {
        out.push(`  - **Admin pricing row:** _none linked — add \`solution_tier_pricing\` in Admin_`);
      }
      if (pkgNames.length) {
        out.push(`  - **Packages that include this tier:** ${pkgNames.join(", ")}`);
      }
      const pitch = tierPitchText(t);
      if (pitch) {
        const flat = exportOneLine(pitch);
        out.push(`  - **Tier narrative (Admin):** ${flat.length > 720 ? `${flat.slice(0, 720)}…` : flat}`);
      }
      out.push(`  - **On board (your edits):** ${boardHours} · **${boardPrice}** _(what you are showing in this scenario)_`);
      appendCardNotesExport(out, c);
      break;
    }
    case "task": {
      const k = ctx.tasks.find((x) => x.task_id === c.refId);
      if (!k) {
        out.push(`  - _Task \`${c.refId}\` not in catalog._`);
        out.push(`  - **On board:** ${boardHours} · **${boardPrice}**`);
        appendCardNotesExport(out, c);
        break;
      }
      const tier = ctx.tiers.find((tt) => tt.solution_tier_id === k.solution_tier_id);
      const pr = tier ? ctx.pricingMap.get(tier.solution_tier_id) ?? null : null;
      out.push(
        `  - **Catalog:** **${k.task_name}** · tier _${tier?.solution_tier_name ?? "—"}_ · **${
          k.task_time != null && Number.isFinite(Number(k.task_time)) ? `${formatHoursShort(Number(k.task_time))} h` : "_(no hours)_"
        }**${k.task_implementer ? ` · ${k.task_implementer}` : ""}`
      );
      if (pr) {
        out.push(`  - **Tier reference sell (catalog):** ${sellPriceLine(pr)}`);
      }
      out.push(`  - **On board:** ${boardHours} · **${boardPrice}**`);
      appendCardNotesExport(out, c);
      break;
    }
    case "task_group": {
      const g = ctx.taskGroups.find((x) => x.id === c.refId);
      const lines = (g ? ctx.groupLinesMap.get(g.id) : undefined) ?? [];
      const sorted = lines.slice().sort((a, b) => a.sort_order - b.sort_order);
      if (!g) {
        out.push(`  - _Template \`${c.refId}\` not in catalog._`);
      } else {
        out.push(`  - **Catalog template:** **${g.name}** (\`${g.id}\`)${g.description?.trim() ? ` — _${exportOneLine(g.description)}_` : ""}`);
        if (sorted.length === 0) {
          out.push(`  - **Lines:** _none in Admin_`);
        } else {
          out.push(`  - **Lines (${sorted.length}):**`);
          const cap = 18;
          for (const L of sorted.slice(0, cap)) {
            out.push(`    - ${L.task_name}${L.hours != null ? ` · **${L.hours} h**` : ""}`);
          }
          if (sorted.length > cap) out.push(`    - _…${sorted.length - cap} more_`);
        }
      }
      out.push(`  - **On board:** ${boardHours} · **${boardPrice}**`);
      appendCardNotesExport(out, c);
      break;
    }
    case "package": {
      const p = ctx.packages.find((x) => x.package_id === c.refId);
      if (!p) {
        out.push(`  - _Package \`${c.refId}\` not in catalog._`);
        out.push(`  - **On board:** ${boardHours} · **${boardPrice}**`);
        appendCardNotesExport(out, c);
        break;
      }
      const tids = tierIdsForPackage(ctx.packageTiers, p.package_id);
      const tierNames = tids
        .map((id) => ctx.tiers.find((tt) => tt.solution_tier_id === id)?.solution_tier_name)
        .filter(Boolean) as string[];
      const catalog = packageHoursPriceForCatalog(p, ctx);
      const vaultRoll = rollupHoursPrice(tids, ctx.pricingMap);
      out.push(`  - **Catalog:** **${p.package_name}** · ${tierNames.length} linked tier(s): ${tierNames.length ? tierNames.join(", ") : "—"}`);
      out.push(`  - **Package workspace (net sell):** ${catalog.hours} · ${catalog.price}`);
      out.push(`  - **Σ vault tiers (reference):** ${vaultRoll.hours} · ${vaultRoll.price}`);
      out.push(`  - **On board:** ${boardHours} · **${boardPrice}**`);
      appendCardNotesExport(out, c);
      break;
    }
    case "solution": {
      const s = ctx.solutions.find((x) => x.solution_id === c.refId);
      if (!s) {
        out.push(`  - _Solution \`${c.refId}\` not in catalog._`);
        out.push(`  - **On board:** ${boardHours} · **${boardPrice}**`);
        appendCardNotesExport(out, c);
        break;
      }
      const tids = tierIdsForSolution(ctx.tiers, s.solution_id);
      const tierNames = tids
        .map((id) => ctx.tiers.find((tt) => tt.solution_tier_id === id)?.solution_tier_name)
        .filter(Boolean) as string[];
      const roll = rollupHoursPrice(tids, ctx.pricingMap);
      out.push(`  - **Catalog:** **${s.solution_name}** · ${tierNames.length} tier(s): ${tierNames.length ? tierNames.join(", ") : "—"}`);
      out.push(`  - **Rollup from tiers (catalog):** ${roll.hours} · ${roll.price}`);
      out.push(`  - **On board:** ${boardHours} · **${boardPrice}**`);
      appendCardNotesExport(out, c);
      break;
    }
    default:
      out.push(`  - **On board:** Hours \`${boardHours}\` · Price **${boardPrice}**`);
      appendCardNotesExport(out, c);
  }

  return out;
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
  const card = cardForTier(t, ctx, scenarioId, phaseId, dates);
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
  const tierNames = tids
    .map((id) => ctx.tiers.find((t) => t.solution_tier_id === id)?.solution_tier_name)
    .filter(Boolean) as string[];
  const desc =
    tierNames.length > 0
      ? `Package includes ${tierNames.length} solution tier(s): ${tierNames.join(", ")}.`
      : "No tiers linked to this package yet.";
  return makeCard("package", p.package_id, scenarioId, phaseId, p.package_name, desc, hours, price, undefined, dates);
}

function cardForTier(
  t: SolutionTier,
  ctx: CatalogCtx,
  scenarioId: string,
  phaseId: string,
  dates?: ProposalOfferingDates
): RoadmapCard {
  const pr = ctx.pricingMap.get(t.solution_tier_id) ?? null;
  const pkgNames = ctx.packageTiers
    .filter((pt) => pt.solution_tier_id === t.solution_tier_id)
    .map((pt) => ctx.packages.find((pk) => pk.package_id === pt.package_id)?.package_name ?? pt.package_id);
  const pkgLine = pkgNames.length ? `Packages: ${pkgNames.join(", ")}.` : "";
  const desc = [tierPitchText(t), pkgLine].filter(Boolean).join("\n\n").trim();
  return makeCard(
    "tier",
    t.solution_tier_id,
    scenarioId,
    phaseId,
    t.solution_tier_name,
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

function descPreview(text: string, max = 200): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

const DEFAULT_SCENARIOS = ["Scenario 1"];

function createInitialScenariosAndPhases(): { scenarios: RoadmapScenario[]; phases: RoadmapPhase[] } {
  const scenarios: RoadmapScenario[] = DEFAULT_SCENARIOS.map((title) => ({
    id: newRoadmapCardKey(),
    title,
    narrative: "",
  }));
  const phases: RoadmapPhase[] = scenarios.map((s) => ({
    id: newRoadmapCardKey(),
    scenarioId: s.id,
    title: "Phase 1",
    sortOrder: 0,
  }));
  return { scenarios, phases };
}

const INITIAL_SCENARIOS_AND_PHASES = createInitialScenariosAndPhases();

function exportScopeSuffix(scope: RoadmapLineScope): string {
  if (scope === "optional") return " · _optional add-on_";
  if (scope === "deferred") return " · _deferred (not in core proposal)_";
  return "";
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
        return <p className="roadmap-muted">This tier is no longer in the catalog (check Admin).</p>;
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
      const tierNames = tids
        .map((id) => ctx.tiers.find((tt) => tt.solution_tier_id === id)?.solution_tier_name)
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
  const [savedProposals, setSavedProposals] = useState<RoadmapProposalRow[]>([]);
  const [savedProposalsLoading, setSavedProposalsLoading] = useState(false);
  const [savingProposal, setSavingProposal] = useState(false);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [deletingProposalId, setDeletingProposalId] = useState<string | null>(null);
  const [activeProposalId, setActiveProposalId] = useState<string | null>(null);
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
  const [cards, setCards] = useState<RoadmapCard[]>([]);
  const [targetScenarioId, setTargetScenarioId] = useState<string>(
    () => INITIAL_SCENARIOS_AND_PHASES.scenarios[0]!.id
  );
  const [detailsModalKey, setDetailsModalKey] = useState<string | null>(null);
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
  const [targetPhaseId, setTargetPhaseId] = useState("");

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
    const [pRes, sRes, tRes, kRes, ptRes, tgRes, prRes, tglRes, implRes] = await Promise.all([
      client.from("packages").select("*").order("package_id"),
      client.from("solutions").select("*").order("solution_id"),
      client.from("solution_tiers").select("*").order("solution_tier_id"),
      client.from("tasks").select("*").order("task_id"),
      client.from("package_solution_tiers").select("*").order("package_id"),
      client.from("task_groups").select("*").order("name"),
      client.from("solution_tier_pricing").select("*").order("solution_tier_id"),
      client.from("task_group_lines").select("*").order("sort_order"),
      client.from("implementer_pricing_hour_groups").select("*").order("implementer_name"),
    ]);
    const err =
      pRes.error ||
      sRes.error ||
      tRes.error ||
      kRes.error ||
      ptRes.error ||
      tgRes.error ||
      prRes.error ||
      tglRes.error
        ? [pRes.error, sRes.error, tRes.error, kRes.error, ptRes.error, tgRes.error, prRes.error, tglRes.error].find(
            Boolean
          )
        : null;
    if (err) {
      if (preserveCurrentProposal) {
        setCatalogReloading(false);
        toastError(`Could not reload catalog data: ${err.message}`);
      } else {
        setState({ status: "error", message: err.message });
      }
      return;
    }
    const packages = (pRes.data ?? []) as Package[];
    const solutions = (sRes.data ?? []) as Solution[];
    const tiers = (tRes.data ?? []) as SolutionTier[];
    const tasks = (kRes.data ?? []) as TaskRow[];
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
    });
    if (preserveCurrentProposal) {
      setCatalogReloading(false);
      toastSuccess("Catalog data reloaded. Your proposal stayed unchanged.");
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
      scenarios,
      phases,
      cards,
    }),
    [cards, clientBudget, clientLabel, horizon, phases, proposalEndDate, proposalStartDate, roadmapTitle, scenarios]
  );

  const saveCurrentProposal = useCallback(async () => {
    const client = getSupabase();
    if (!client) return;
    const clientName = clientLabel.trim();
    const title = roadmapTitle.trim();
    if (!clientName || !title) {
      toastError("Add both Client / opportunity and Roadmap name before saving.");
      return;
    }
    setSavingProposal(true);
    const userId = user?.id ?? null;
    const email = user?.email ?? null;
    const snapshot = currentProposalSnapshot();
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
      return;
    }
    const saved = result.data as RoadmapProposalRow | null;
    if (saved?.id) setActiveProposalId(saved.id);
    setLastSavedFingerprint(proposalSnapshotFingerprint(snapshot));
    toastSuccess(`Saved "${title}" under ${clientName}.`);
    await loadSavedProposals();
  }, [
    activeProposalId,
    clientBudget,
    clientLabel,
    currentProposalSnapshot,
    horizon,
    loadSavedProposals,
    roadmapTitle,
    toastError,
    toastSuccess,
    user?.email,
    user?.id,
  ]);

  const proposalStepSaveProps = useMemo(
    () => ({
      onSave: () => void saveCurrentProposal(),
      saving: savingProposal,
      saveLabel: activeProposalId ? "Update saved" : "Save proposal",
    }),
    [saveCurrentProposal, savingProposal, activeProposalId]
  );

  const showSaveBanner =
    builderMode === "create" ||
    activeProposalId != null ||
    cards.length > 0 ||
    clientLabel.trim() !== "" ||
    roadmapTitle.trim() !== "" ||
    clientBudget.trim() !== "";

  const proposalIsDirty = useMemo(() => {
    if (lastSavedFingerprint === null) return false;
    return (
      proposalSnapshotFingerprint({
        version: 1,
        clientLabel,
        roadmapTitle,
        horizon,
        clientBudget,
        proposalStartDate,
        proposalEndDate,
        scenarios,
        phases,
        cards,
      }) !== lastSavedFingerprint
    );
  }, [
    lastSavedFingerprint,
    clientLabel,
    roadmapTitle,
    horizon,
    clientBudget,
    proposalStartDate,
    proposalEndDate,
    scenarios,
    phases,
    cards,
  ]);

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
    const init = createInitialScenariosAndPhases();
    const emptySnapshot: RoadmapProposalSnapshot = {
      version: 1,
      clientLabel: "",
      roadmapTitle: "",
      horizon: "6",
      clientBudget: "",
      proposalStartDate: "",
      proposalEndDate: "",
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
    setScenarios(init.scenarios);
    setPhases(init.phases);
    setCards([]);
    setTargetScenarioId(init.scenarios[0]!.id);
    setActiveProposalId(null);
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
      setBuilderMode("saved");
    },
    [activeProposalId, cards.length, clientBudget, clientLabel, roadmapTitle, startNewProposal]
  );

  const loadSavedProposalIntoBoard = useCallback(
    (row: RoadmapProposalRow) => {
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
          scenarios: nextScenarios,
          phases: nextPhases,
          cards: snapshot.cards,
        })
      );
      setDetailsModalKey(null);
      setScratchDraft(null);
      setScratchModalFocusCompose(false);
      setBuilderMode("saved");
      setBuilderStep("review");
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
    setCards((prev) => applyVariablePricing(prev));
  }, [catalogCtx, applyVariablePricing]);

  const addCard = useCallback(
    (c: RoadmapCard) => {
      setCardsSynced((prev) => [...prev, c]);
    },
    [setCardsSynced]
  );

  const removeCard = useCallback(
    (key: string) => {
      setCardsSynced((prev) => prev.filter((x) => x.key !== key));
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

  const setupComplete = roadmapTitle.trim().length > 0;
  const canAddToTarget = !!targetPhaseId;

  const catalogAddedLines = useMemo(() => {
    if (!catalogCtx) return [];
    const phaseTitleById = new Map(phases.map((p) => [p.id, p.title.trim() || "Phase"]));
    return cards
      .filter((c) => c.scenarioId === targetScenarioId)
      .map((c) => ({
        key: c.key,
        headline: c.headline,
        phaseTitle: phaseTitleById.get(c.phaseId) ?? "Phase",
        priceDisplay: effectivePriceStr(c, catalogCtx, computeScratchSellPrice) || "—",
        scope: c.scope,
        isTargetPhase: c.phaseId === targetPhaseId,
        kind: c.kind,
        appliedToLabel: variableTierAppliedToLabel(c, cards),
      }))
      .sort((a, b) => {
        if (a.isTargetPhase !== b.isTargetPhase) return a.isTargetPhase ? -1 : 1;
        return a.headline.localeCompare(b.headline, undefined, { sensitivity: "base" });
      });
  }, [cards, catalogCtx, phases, targetScenarioId, targetPhaseId]);

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
            ? "Those offerings are already on this scenario."
            : "That scenario has nothing to copy."
        );
        return;
      }

      const dupNote =
        skippedDuplicates > 0
          ? ` ${skippedDuplicates} duplicate tier/package${skippedDuplicates === 1 ? "" : "s"} will be skipped.`
          : "";

      const ok = window.confirm(
        `Copy ${cloned.length} offering${cloned.length === 1 ? "" : "s"} from "${sourceTitle}" into "${targetTitle}"?${dupNote}`
      );
      if (!ok) return;

      setCardsSynced((prev) => [...prev, ...cloned]);
      toastSuccess(
        `Copied ${cloned.length} offering${cloned.length === 1 ? "" : "s"} from "${sourceTitle}".`
      );
    },
    [cards, phases, scenarios, targetScenarioId, targetPhaseId, toastNote, toastSuccess, setCardsSynced]
  );

  const addScenario = useCallback(() => {
    const id = newRoadmapCardKey();
    setScenarios((prev) => [...prev, { id, title: `Scenario ${prev.length + 1}`, narrative: "" }]);
    setPhases((prev) => [...prev, { id: newRoadmapCardKey(), scenarioId: id, title: "Phase 1", sortOrder: 0 }]);
  }, []);

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

  const addPhaseForScenario = useCallback((scenarioId: string) => {
    setPhases((prev) => {
      const existing = prev.filter((p) => p.scenarioId === scenarioId);
      const nextOrder = existing.length === 0 ? 0 : Math.max(...existing.map((x) => x.sortOrder)) + 1;
      return [
        ...prev,
        {
          id: newRoadmapCardKey(),
          scenarioId,
          title: `Phase ${existing.length + 1}`,
          sortOrder: nextOrder,
        },
      ];
    });
  }, []);

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

  const summaryMarkdown = useMemo(() => {
    const lines: string[] = [];
    const title = roadmapTitle.trim() || "Roadmap draft";
    lines.push(`# ${title}`);
    if (clientLabel.trim()) lines.push(`**Client / opportunity:** ${clientLabel.trim()}`);
    lines.push(`**Horizon:** ${horizon === "custom" ? "Custom" : `${horizon} months`}`);
    const proposalSchedule = proposalDateRangeLabel(proposalStartDate, proposalEndDate);
    if (proposalSchedule !== "—") {
      lines.push(`**Proposal dates:** ${proposalSchedule}`);
    }
    if (budgetNumber != null) {
      lines.push(`**Client budget (USD):** ${formatUsd(budgetNumber)}`);
    } else if (clientBudget.trim()) {
      lines.push(`**Client budget (USD):** ${clientBudget.trim()} _(unparsed)_`);
    }
    lines.push("");

    for (const scenario of scenarios) {
      lines.push(`## ${scenario.title.trim() || "Scenario"}`);
      if (scenario.narrative.trim()) {
        lines.push("");
        lines.push(scenario.narrative.trim());
      }
      const scenCards = cards.filter((c) => c.scenarioId === scenario.id);
      if (scenCards.length === 0) {
        lines.push("");
        lines.push("_Nothing added yet._");
        lines.push("");
        continue;
      }

      let includedSub = 0;
      for (const c of scenCards) {
        if (c.scope !== "included") continue;
        const p = cardPriceUsdForRollup(c, catalogCtx, computeScratchSellPrice);
        if (p != null) includedSub += p;
      }
      lines.push("");
      lines.push(`_**Included scope** subtotal (parsed prices): **${formatUsd(includedSub)}**_`);
      if (budgetNumber != null) {
        const st = budgetVsScenarioStatus(includedSub, budgetNumber);
        const rem = budgetNumber - includedSub;
        const label =
          st === "over"
            ? `${formatUsd(Math.abs(rem))} over budget`
            : st === "in_range"
              ? "Within range of budget (~92–100%)"
              : `${formatUsd(Math.max(0, rem))} under budget`;
        lines.push(`_${label}._`);
      }

      const phaseOrder = sortedPhasesForScenario(phases, scenario.id);
      lines.push("");
      lines.push("### Roadmap by phase _(included)_");
      for (const ph of phaseOrder) {
        const phaseCards = scenCards.filter((c) => c.phaseId === ph.id && c.scope === "included");
        if (phaseCards.length === 0) continue;
        let phHours = 0;
        let phHn = 0;
        let phPrice = 0;
        let phPn = 0;
        for (const c of phaseCards) {
          const hh = cardHoursForScenarioRollup(c, catalogCtx);
          if (hh != null) {
            phHours += hh;
            phHn += 1;
          }
          const pp = cardPriceUsdForRollup(c, catalogCtx, computeScratchSellPrice);
          if (pp != null) {
            phPrice += pp;
            phPn += 1;
          }
        }
        lines.push("");
        lines.push(`#### ${ph.title.trim() || "Phase"}`);
        lines.push(
          `_Phase rollup: ${phPn > 0 ? `**${formatUsd(phPrice)}**` : "price TBD"}${
            phHn > 0 ? ` · ~${formatHoursShort(phHours)} h` : ""
          }_`
        );
        for (const c of phaseCards) {
          lines.push("");
          for (const line of roadmapCardExportLines(c, catalogCtx)) lines.push(line);
        }
      }

      const optionalCards = scenCards.filter((c) => c.scope === "optional");
      if (optionalCards.length > 0) {
        let optSub = 0;
        let optHours = 0;
        let optHn = 0;
        for (const c of optionalCards) {
          const pu = tryParseUsdRough(effectivePriceStr(c, catalogCtx, computeScratchSellPrice));
          if (pu != null) optSub += pu;
          if (c.kind === "custom_tier") {
            const b = scratchEffectiveHoursBreakdown(c, catalogCtx);
            if (b) {
              optHours += b.total;
              optHn += 1;
            }
          } else {
            const hr = tryParseRoadmapHours(effectiveHoursStr(c));
            if (hr != null) {
              optHours += hr;
              optHn += 1;
            }
          }
        }
        lines.push("");
        lines.push("### Optional add-ons _(not in core subtotal)_");
        lines.push(
          `_Tracked subtotal (optional): **${formatUsd(optSub)}**${
            optHn > 0 ? ` · ~${formatHoursShort(optHours)} h` : ""
          }_`
        );
        for (const c of optionalCards) {
          lines.push("");
          for (const line of roadmapCardExportLines(c, catalogCtx)) lines.push(line);
        }
      }

      const deferredCards = scenCards.filter((c) => c.scope === "deferred");
      if (deferredCards.length > 0) {
        lines.push("");
        lines.push("### Deferred _(hidden from core proposal totals)_");
        for (const c of deferredCards) {
          lines.push("");
          for (const line of roadmapCardExportLines(c, catalogCtx)) lines.push(line);
        }
      }

      lines.push("");
    }
    return lines.join("\n");
  }, [cards, clientBudget, clientLabel, budgetNumber, horizon, proposalEndDate, proposalStartDate, scenarios, phases, roadmapTitle, catalogCtx]);

  const downloadPdf = useCallback(() => {
    if (!catalogCtx) return;
    setPdfGenerating(true);
    try {
      downloadProposalPdf({
        roadmapTitle,
        clientLabel,
        horizonMonths: horizon === "custom" ? "custom" : Number(horizon),
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
      });
      toastSuccess("Proposal PDF downloaded.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not generate PDF.";
      toastError(msg);
    } finally {
      setPdfGenerating(false);
    }
  }, [
    cards,
    catalogCtx,
    clientBudget,
    clientLabel,
    budgetNumber,
    horizon,
    proposalEndDate,
    proposalStartDate,
    phases,
    roadmapTitle,
    scenarios,
    toastError,
    toastSuccess,
  ]);

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

  const catalogPackages = useMemo(() => {
    if (!catalogCtx) return [];
    return [...catalogCtx.packages].sort((a, b) => sortId(a.package_id, b.package_id));
  }, [catalogCtx]);

  if (state.status === "error") {
    return (
      <div className="roadmap-page">
        <div className="roadmap-page__inner">
          <p className="roadmap-muted">
            Unable to load the catalog. Details are shown in the notification stack (bottom corner).
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
          <p className="roadmap-muted">Loading catalog from Supabase…</p>
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
  const targetScenarioTitle =
    scenarios.find((s) => s.id === targetScenarioId)?.title.trim() || "Scenario";
  const targetPhaseTitle =
    sortedPhasesForScenario(phases, targetScenarioId).find((p) => p.id === targetPhaseId)?.title.trim() || "Phase";
  const totalOptionalCount = cards.filter((c) => c.scope === "optional").length;
  const totalDeferredCount = cards.filter((c) => c.scope === "deferred").length;
  return (
    <div className="roadmap-page">
      <div className="roadmap-page__inner roadmap-page__inner--wide">
        <header className="roadmap-hero roadmap-hero--builder">
          <div className="roadmap-hero__main roadmap-hero__main--builder">
            <div className="roadmap-hero__copy">
              <p className="roadmap-hero__eyebrow">Sales &amp; Strategy Workspace</p>
              <h1 className="roadmap-hero__title">Proposal Builder</h1>
              <p className="roadmap-hero__lead">
                Build client proposals step by step — set context, compare scenarios, add catalog offerings by playbook,
                organize phases, then save and export. Catalog data lives in <Link to="/admin">Admin</Link>.
              </p>
            </div>
            <div className="roadmap-hero__mode-tabs">
              <ProposalBuilderModeTabs
                active={activeProposalId ? "saved" : builderMode}
                onChange={handleBuilderModeChange}
                savedCount={savedProposals.length}
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

        {builderMode === "saved" && !activeProposalId ? (
          <div className="proposal-builder-saved-wrap">
            <ProposalSavedProposalsPanel
              proposals={savedProposals}
              loading={savedProposalsLoading}
              activeProposalId={activeProposalId}
              deletingProposalId={deletingProposalId}
              onRefresh={() => void loadSavedProposals()}
              onOpen={loadSavedProposalIntoBoard}
              onDelete={(row) => void deleteSavedProposal(row)}
            />
          </div>
        ) : (
        <div className="proposal-builder">
          <ProposalBuilderSteps
            active={builderStep}
            onChange={setBuilderStep}
            setupComplete={setupComplete}
            scenarioCount={scenarios.length}
            lineItemCount={cards.length}
          />
          <div className="proposal-builder__main">
            {builderStep === "setup" ? (
              <>
                <section className="roadmap-panel roadmap-panel--meta proposal-step-panel">
                  <header className="proposal-step-panel__head">
                    <p className="proposal-step-panel__eyebrow">Step 1</p>
                    <h2 className="proposal-step-panel__title">Proposal Context</h2>
                    <p className="proposal-step-panel__lead">
                      Name the roadmap, set the proposal date range, and optional client budget so each scenario can be compared against plan.
                    </p>
                  </header>
                  <div className="roadmap-meta-grid">
                    <label className="roadmap-field">
                      <span className="roadmap-field__cap">Roadmap name</span>
                      <input
                        className="roadmap-input"
                        value={roadmapTitle}
                        onChange={(e) => setRoadmapTitle(e.target.value)}
                        placeholder="e.g. Acme — H2 growth roadmap"
                      />
                    </label>
                    <label className="roadmap-field">
                      <span className="roadmap-field__cap">Client / opportunity</span>
                      <input
                        className="roadmap-input"
                        value={clientLabel}
                        onChange={(e) => setClientLabel(e.target.value)}
                        placeholder="Optional label for your notes"
                      />
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
                      {budgetNumber != null ? (
                        <span className="roadmap-budget-confirm">Using {formatUsd(budgetNumber)} for comparisons.</span>
                      ) : clientBudget.trim() ? (
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
                      <span className="roadmap-field__cap">Pitch horizon</span>
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
                <ProposalStepNav
                  step="setup"
                  onStepChange={setBuilderStep}
                  nextDisabled={!setupComplete}
                  nextLabel={setupComplete ? "Continue to scenarios & phases" : "Add a roadmap name to continue"}
                  {...proposalStepSaveProps}
                />
              </>
            ) : null}

            {builderStep === "scenarios" ? (
              <>
                <ProposalCopyFromPanel
                  proposals={savedProposals}
                  loading={savedProposalsLoading}
                  activeProposalId={activeProposalId}
                  onCopy={copyStructureFromSavedProposal}
                />
                <ProposalScenariosPanel
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
                  step="scenarios"
                  onStepChange={setBuilderStep}
                  nextLabel="Continue to add offerings"
                  {...proposalStepSaveProps}
                />
              </>
            ) : null}

            {builderStep === "catalog" ? (
              <>
                <ProposalCatalogPanel
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
                  filteredPackages={catalogPackages}
                  packagePreview={(p) => cardForPackage(p, ctx, targetScenarioId, targetPhaseId)}
                  proposalStartDate={proposalStartDate}
                  proposalEndDate={proposalEndDate}
                  onAddPackage={(p, dates) => {
                    if (!canAddToTarget) return;
                    addCard(cardForPackage(p, ctx, targetScenarioId, targetPhaseId, dates));
                  }}
                  onAddTier={(t, dates) => {
                    if (!canAddToTarget) return;
                    addCard(cardForTier(t, ctx, targetScenarioId, targetPhaseId, dates));
                  }}
                  onAddVariableTier={(t, dates, opts) => {
                    if (!canAddToTarget) return;
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
                  addedTierRefIds={addedTierRefIds}
                  addedPackageRefIds={addedPackageRefIds}
                  copyFromScenarios={copyFromScenarios}
                  onCopyFromScenario={copyOfferingsFromScenario}
                />
                <ProposalStepNav
                  step="catalog"
                  onStepChange={setBuilderStep}
                  nextLabel="Organize proposal"
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
                  onEditStructure={() => setBuilderStep("scenarios")}
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
                nextLabel="Review & Export"
                {...proposalStepSaveProps}
              />
            ) : null}

            {builderStep === "review" ? (
              <>
                <section className="roadmap-panel proposal-review-header">
                  <header className="proposal-step-panel__head">
                    <p className="proposal-step-panel__eyebrow">Step 5</p>
                    <h2 className="proposal-step-panel__title">Review &amp; Export</h2>
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
            <div>
              <p className="roadmap-export__eyebrow">Client-Ready Output</p>
              <h2 className="roadmap-export__title">Export Preview</h2>
            </div>
            <div className="roadmap-export__head-actions">
              <button
                type="button"
                className="roadmap-btn roadmap-btn--primary"
                disabled={pdfGenerating}
                onClick={downloadPdf}
              >
                {pdfGenerating ? "Generating PDF…" : "Download PDF"}
              </button>
            </div>
          </div>
          <div className="roadmap-export__stats">
            <span>{summaryMarkdown.split("\n").filter(Boolean).length} summary lines</span>
            <span>{cards.length} board items</span>
            <span>{totalOptionalCount} optional</span>
            <span>{totalDeferredCount} deferred</span>
          </div>
          <p className="roadmap-export__explain">
            Phased tables mirror the board: <strong>included</strong> items by phase, then <strong>optional</strong> add-ons.{" "}
            <strong>Deferred</strong> appears last. Download a PDF to share with clients — proposal hours and pricing use your
            overrides from Organize.
          </p>
          <div className="roadmap-export-table-wrap" aria-label="Roadmap export tables">
            {scenarios.map((scenario) => {
              const scenCards = cards.filter((c) => c.scenarioId === scenario.id);
              const phaseOrder = sortedPhasesForScenario(phases, scenario.id);
              let includedGrand = 0;
              for (const c of scenCards) {
                if (c.scope !== "included") continue;
                const p = cardPriceUsdForRollup(c, ctx, computeScratchSellPrice);
                if (p != null) includedGrand += p;
              }
              const renderRow = (c: RoadmapCard) => {
                const appliedToLabel = variableTierAppliedToLabel(c, scenCards);
                return (
                <tr key={c.key}>
                  <td className="roadmap-export-table__col roadmap-export-table__col--deliverable">
                    <div className="roadmap-export-table__deliverable">
                      <div className="roadmap-export-table__deliverable-head">
                        <strong className="roadmap-export-table__name">
                          {c.headline.trim() || "(untitled)"}
                        </strong>
                        <span
                          className={`roadmap-export-table__scope roadmap-export-table__scope--${c.scope}`}
                        >
                          {c.scope}
                        </span>
                      </div>
                      {appliedToLabel && !isTravelVariableTierRefId(c.refId) ? (
                        <span className="roadmap-export-table__applied">
                          Applied to{" "}
                          <strong>{appliedToLabel}</strong>
                        </span>
                      ) : null}
                      {c.description.trim() && c.kind !== "tier" && c.kind !== "custom_tier" ? (
                        <p className="roadmap-export-table__desc">{descPreview(c.description, 140)}</p>
                      ) : null}
                    </div>
                  </td>
                  <td className="roadmap-export-table__col roadmap-export-table__col--type">
                    {kindLabel(c.kind)}
                  </td>
                  <td className="roadmap-export-table__col roadmap-export-table__col--dates">
                    {proposalDateRangeLabel(c.startDate, c.endDate)}
                  </td>
                  <td className="roadmap-export-table__col roadmap-export-table__col--num">
                    {effectiveHoursStr(c) || "—"}
                  </td>
                  <td className="roadmap-export-table__col roadmap-export-table__col--num">
                    {effectivePriceStr(c, ctx, computeScratchSellPrice) || "—"}
                  </td>
                </tr>
              );
              };
              return (
                <section key={scenario.id} className="roadmap-export-table">
                  <header className="roadmap-export-table__head">
                    <h3 className="roadmap-export-table__title">{scenario.title}</h3>
                    <span className="roadmap-export-table__sum">{formatUsd(includedGrand)} included</span>
                  </header>
                  {scenCards.length === 0 ? (
                    <p className="roadmap-export-table__empty">Nothing added yet.</p>
                  ) : (
                    <>
                      {phaseOrder.map((phase) => {
                        const rows = scenCards.filter((c) => c.phaseId === phase.id && c.scope === "included");
                        if (rows.length === 0) return null;
                        let ps = 0;
                        let ph = 0;
                        let phn = 0;
                        for (const c of rows) {
                          const pu = cardPriceUsdForRollup(c, ctx, computeScratchSellPrice);
                          if (pu != null) ps += pu;
                          const hh = cardHoursForScenarioRollup(c, ctx);
                          if (hh != null) {
                            ph += hh;
                            phn += 1;
                          }
                        }
                        return (
                          <div key={phase.id} className="roadmap-export-phase">
                            <h4 className="roadmap-export-phase__title">
                              {phase.title.trim() || "Phase"}{" "}
                              <span className="roadmap-export-phase__sub">
                                {formatUsd(ps)}
                                {phn > 0 ? ` · ~${formatHoursShort(ph)} h` : ""}
                              </span>
                            </h4>
                            <table>
                              <thead>
                                <tr>
                                  <th>Deliverable</th>
                                  <th>Type</th>
                                  <th>Dates</th>
                                  <th>Hours</th>
                                  <th>Price</th>
                                </tr>
                              </thead>
                              <tbody>{rows.map(renderRow)}</tbody>
                            </table>
                          </div>
                        );
                      })}
                      {(() => {
                        const opt = scenCards.filter((c) => c.scope === "optional");
                        if (!opt.length) return null;
                        return (
                          <div className="roadmap-export-phase roadmap-export-phase--optional">
                            <h4 className="roadmap-export-phase__title">Optional Add-Ons</h4>
                            <table>
                              <thead>
                                <tr>
                                  <th>Deliverable</th>
                                  <th>Type</th>
                                  <th>Dates</th>
                                  <th>Hours</th>
                                  <th>Price</th>
                                </tr>
                              </thead>
                              <tbody>{opt.map(renderRow)}</tbody>
                            </table>
                          </div>
                        );
                      })()}
                      {(() => {
                        const def = scenCards.filter((c) => c.scope === "deferred");
                        if (!def.length) return null;
                        return (
                          <div className="roadmap-export-phase roadmap-export-phase--deferred">
                            <h4 className="roadmap-export-phase__title">Deferred (Not In Core)</h4>
                            <table>
                              <thead>
                                <tr>
                                  <th>Deliverable</th>
                                  <th>Type</th>
                                  <th>Dates</th>
                                  <th>Hours</th>
                                  <th>Price</th>
                                </tr>
                              </thead>
                              <tbody>{def.map(renderRow)}</tbody>
                            </table>
                          </div>
                        );
                      })()}
                    </>
                  )}
                </section>
              );
            })}
          </div>
        </section>
                <ProposalStepNav step="review" onStepChange={setBuilderStep} {...proposalStepSaveProps} />
              </>
            ) : null}
          </div>
        </div>
        )}
      </div>

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
                    <code>(manual hours + catalog task &amp; group template hours) × blended $/hr × risk × strategic</code>{" "}
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
                    <h3 className="roadmap-details-h3">Catalog composition</h3>
                    <p className="roadmap-muted roadmap-scratch-compose__hint">
                      Attach catalog tasks (their time) and task group templates (sum of line hours). These add to
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
                                  {h != null ? ` · ${h} h` : " · (no time in catalog)"}
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
                        <span className="roadmap-field__cap">Add catalog task</span>
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
                                  {ghOk ? ` · ${gh} h (lines Σ)` : " · (no line hours in catalog)"}
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
                            Effective hours: <strong>—</strong> (add manual hours and/or catalog attachments) · Sell:{" "}
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
                            ({br.manual} h manual + {br.catalog} h from catalog)
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
