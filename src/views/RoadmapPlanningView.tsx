import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
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
  scratchEffectiveHoursBreakdown,
  tryParseRoadmapHours,
  tryParseUsdRough,
} from "../lib/roadmapModel";
import { TierResourceExamplesDisplay } from "../components/TierResourceExamplesDisplay";
import { useToast } from "../context/ToastContext";
import {
  effectiveResourceExamples,
  effectiveResourceTools,
  stripRedundantResourceMarkdownHeading,
  tierTemplatesForProposalDisplay,
} from "../lib/tierResourceFields";
import type {
  Package,
  PackageSolutionTier,
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
};

function formatUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(n));
}

function sellPriceLine(pricing: SolutionTierPricing | null): string {
  if (!pricing) return "—";
  const primary = pricing.sell_price;
  const fallback = pricing.standalone_sell_price;
  if (primary != null && Number.isFinite(Number(primary))) return formatUsd(primary);
  if (fallback != null && Number.isFinite(Number(fallback))) return formatUsd(fallback);
  return "—";
}

function tierHoursLine(pricing: SolutionTierPricing | null): string {
  if (!pricing || pricing.total_hours == null || !Number.isFinite(Number(pricing.total_hours))) return "—";
  return `${Number(pricing.total_hours)} h`;
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

function makeCard(
  kind: RoadmapCardKind,
  refId: string,
  scenarioId: string,
  phaseId: string,
  headline: string,
  description: string,
  hours: string,
  price: string,
  scratch?: Pick<RoadmapCard, "scratchBlendRateUsd" | "scratchRiskMult" | "scratchStrategicMult">
): RoadmapCard {
  return {
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
  };
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

function cardForScratchTier(scenarioId: string, phaseId: string, ctx: CatalogCtx | null): RoadmapCard {
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
  return { ...base, price: computeScratchSellPrice(base, ctx) };
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
        out.push(`  - **Admin pricing row:** sell **${sellPriceLine(pr)}** · recorded effort **${tierHoursLine(pr)}**`);
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
      const roll = rollupHoursPrice(tids, ctx.pricingMap);
      out.push(`  - **Catalog:** **${p.package_name}** · ${tierNames.length} linked tier(s): ${tierNames.length ? tierNames.join(", ") : "—"}`);
      out.push(`  - **Rollup from linked tiers (catalog):** ${roll.hours} · ${roll.price}`);
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

function cardForPackage(p: Package, ctx: CatalogCtx, scenarioId: string, phaseId: string): RoadmapCard {
  const tids = tierIdsForPackage(ctx.packageTiers, p.package_id);
  const { hours, price } = rollupHoursPrice(tids, ctx.pricingMap);
  const tierNames = tids
    .map((id) => ctx.tiers.find((t) => t.solution_tier_id === id)?.solution_tier_name)
    .filter(Boolean) as string[];
  const desc =
    tierNames.length > 0
      ? `Package includes ${tierNames.length} solution tier(s): ${tierNames.join(", ")}.`
      : "No tiers linked to this package yet.";
  return makeCard("package", p.package_id, scenarioId, phaseId, p.package_name, desc, hours, price);
}

function cardForTier(t: SolutionTier, ctx: CatalogCtx, scenarioId: string, phaseId: string): RoadmapCard {
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
    tierHoursLine(pr),
    sellPriceLine(pr)
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

const DEFAULT_SCENARIOS = ["What-if A — lean", "What-if B — balanced", "What-if C — full scope"];

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

function sortedPhasesForScenario(phases: RoadmapPhase[], scenarioId: string): RoadmapPhase[] {
  return phases.filter((p) => p.scenarioId === scenarioId).sort((a, b) => a.sortOrder - b.sortOrder);
}

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

function matches(hay: string, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return hay.toLowerCase().includes(t);
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

type RoadmapCardBlockProps = {
  c: RoadmapCard;
  ctx: CatalogCtx;
  phaseChoices: RoadmapPhase[];
  onPatch: (key: string, patch: Partial<RoadmapCard>) => void;
  onRemove: (key: string) => void;
  onDetails: (c: RoadmapCard) => void;
  onScratchCustomize: (c: RoadmapCard) => void;
};

function RoadmapCardBlock({
  c,
  ctx,
  phaseChoices,
  onPatch,
  onRemove,
  onDetails,
  onScratchCustomize,
}: RoadmapCardBlockProps) {
  const effPrice = effectivePriceStr(c, ctx, computeScratchSellPrice);
  const effHours = effectiveHoursStr(c);
  return (
    <li
      className={`roadmap-card${c.scope !== "included" ? " roadmap-card--scope-secondary" : ""}`}
    >
      <div className="roadmap-card__toolbar">
        <div className="roadmap-card__toolbar-meta">
          <span className={`roadmap-card__kind roadmap-card__kind--${c.kind}`}>{kindLabel(c.kind)}</span>
          <p className="roadmap-card__ref">
            <code>{c.refId}</code>
          </p>
        </div>
        <div className="roadmap-card__toolbar-controls">
          <label className="roadmap-card__inline-field">
            <span className="roadmap-card__cap">Scope</span>
            <select
              className="roadmap-input roadmap-select roadmap-select--sm"
              value={c.scope}
              onChange={(e) => onPatch(c.key, { scope: e.target.value as RoadmapLineScope })}
              aria-label="Line scope"
            >
              <option value="included">Included</option>
              <option value="optional">Optional</option>
              <option value="deferred">Deferred</option>
            </select>
          </label>
          <label className="roadmap-card__inline-field">
            <span className="roadmap-card__cap">Phase</span>
            <select
              className="roadmap-input roadmap-select roadmap-select--sm"
              value={c.phaseId}
              onChange={(e) => onPatch(c.key, { phaseId: e.target.value })}
              aria-label="Move to phase"
            >
              {phaseChoices.map((ph) => (
                <option key={ph.id} value={ph.id}>
                  {ph.title.trim() || "Phase"}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <label className="roadmap-card__field-label">
        <span className="roadmap-card__cap">Title</span>
        <input
          className="roadmap-input roadmap-card__headline"
          value={c.headline}
          onChange={(e) => onPatch(c.key, { headline: e.target.value })}
        />
      </label>
      <div className="roadmap-card__snapshot">
        <div className="roadmap-card__snapshot-item">
          <span className="roadmap-card__snapshot-label">Effective hours</span>
          <strong>{effHours ? `${effHours} h` : "—"}</strong>
        </div>
        <div className="roadmap-card__snapshot-item">
          <span className="roadmap-card__snapshot-label">Effective price</span>
          <strong>{effPrice || "—"}</strong>
        </div>
      </div>
      <div className="roadmap-card__statgrid">
        <label className="roadmap-card__field-label">
          <span className="roadmap-card__cap">Catalog hours</span>
          <input
            className="roadmap-input"
            value={c.hours}
            onChange={(e) => onPatch(c.key, { hours: e.target.value })}
            placeholder={c.kind === "custom_tier" ? "e.g. 66 or 66 h" : "e.g. 120 h"}
          />
        </label>
        <label className="roadmap-card__field-label">
          <span className="roadmap-card__cap">Proposal hours</span>
          <input
            className="roadmap-input"
            value={c.hoursOverride ?? ""}
            placeholder="optional"
            onChange={(e) => onPatch(c.key, { hoursOverride: e.target.value.trim() ? e.target.value : null })}
          />
        </label>
      </div>
      <div className="roadmap-card__statgrid">
        <label className="roadmap-card__field-label">
          <span className="roadmap-card__cap">{c.kind === "custom_tier" ? "Computed price" : "Catalog price"}</span>
          {c.kind === "custom_tier" ? (
            <div
              className="roadmap-card__price-readonly"
              title="Override below, or edit multipliers in Details / Customize"
            >
              {effPrice}
            </div>
          ) : (
            <input
              className="roadmap-input"
              value={c.price}
              onChange={(e) => onPatch(c.key, { price: e.target.value })}
              placeholder="e.g. $45,000"
            />
          )}
        </label>
        <label className="roadmap-card__field-label">
          <span className="roadmap-card__cap">Proposal price</span>
          <input
            className="roadmap-input"
            value={c.priceOverride ?? ""}
            placeholder="optional $"
            onChange={(e) => onPatch(c.key, { priceOverride: e.target.value.trim() ? e.target.value : null })}
          />
        </label>
      </div>
      {c.kind === "custom_tier" ? (() => {
        const br = scratchEffectiveHoursBreakdown(c, ctx);
        const nt = c.scratchAttachedTaskIds?.length ?? 0;
        const ng = c.scratchAttachedTaskGroupIds?.length ?? 0;
        if (!br && nt === 0 && ng === 0) return null;
        return (
          <div className="roadmap-scratch-hours" role="status" aria-label="Scratch tier hours used for pricing">
            {br ? (
              <>
                <div className="roadmap-scratch-hours__head">
                  <span className="roadmap-scratch-hours__head-label">Pricing hours</span>
                  <span className="roadmap-scratch-hours__head-value">{formatHoursShort(br.total)} h</span>
                </div>
                {br.catalog > 0 ? (
                  <div className="roadmap-scratch-hours__breakdown">
                    <div className="roadmap-scratch-hours__row">
                      <span className="roadmap-scratch-hours__k">From card</span>
                      <span className="roadmap-scratch-hours__v">{formatHoursShort(br.manual)} h</span>
                    </div>
                    <div className="roadmap-scratch-hours__row">
                      <span className="roadmap-scratch-hours__k">From catalog</span>
                      <span className="roadmap-scratch-hours__v">{formatHoursShort(br.catalog)} h</span>
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="roadmap-scratch-hours__note">
                Items attached — add hours on the card or use catalog lines with hours so pricing can total them.
              </p>
            )}
            {(nt > 0 || ng > 0) && (
              <div className="roadmap-scratch-hours__attachments">
                {nt > 0 ? (
                  <span className="roadmap-scratch-hours__pill">
                    {nt} task{nt === 1 ? "" : "s"}
                  </span>
                ) : null}
                {ng > 0 ? (
                  <span className="roadmap-scratch-hours__pill">
                    {ng} group{ng === 1 ? "" : "s"}
                  </span>
                ) : null}
              </div>
            )}
          </div>
        );
      })() : null}
      <div className="roadmap-card__foot">
        <button type="button" className="roadmap-btn roadmap-btn--sm" onClick={() => onDetails(c)}>
          Details
        </button>
        {c.kind === "custom_tier" ? (
          <button type="button" className="roadmap-btn roadmap-btn--sm" onClick={() => onScratchCustomize(c)}>
            Customize
          </button>
        ) : null}
        <button type="button" className="roadmap-btn roadmap-btn--danger-sm" onClick={() => onRemove(c.key)}>
          Remove
        </button>
      </div>
    </li>
  );
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
  const { toastError } = useToast();
  const searchId = useId();
  const [state, setState] = useState<LoadState>({ status: "idle" });
  const roadmapLoadErrSeen = useRef<string | null>(null);
  const [clientLabel, setClientLabel] = useState("");
  const [roadmapTitle, setRoadmapTitle] = useState("");
  const [horizon, setHorizon] = useState<"3" | "4" | "6" | "12" | "custom">("6");
  const [clientBudget, setClientBudget] = useState("");
  const [scenarios, setScenarios] = useState<RoadmapScenario[]>(() => INITIAL_SCENARIOS_AND_PHASES.scenarios);
  const [phases, setPhases] = useState<RoadmapPhase[]>(() => INITIAL_SCENARIOS_AND_PHASES.phases);
  const [cards, setCards] = useState<RoadmapCard[]>([]);
  const [paletteSearch, setPaletteSearch] = useState("");
  const [targetScenarioId, setTargetScenarioId] = useState<string>(
    () => INITIAL_SCENARIOS_AND_PHASES.scenarios[0]!.id
  );
  const [paletteTab, setPaletteTab] = useState<"packages" | "tiers">("tiers");
  const [detailsModalKey, setDetailsModalKey] = useState<string | null>(null);
  /** Live edit buffer for scratch tier in the details modal */
  const [scratchDraft, setScratchDraft] = useState<RoadmapCard | null>(null);
  /** After opening Details from Customize, scroll the composition section into view once */
  const [scratchModalFocusCompose, setScratchModalFocusCompose] = useState(false);
  const scratchComposeSectionRef = useRef<HTMLDivElement>(null);
  /** Remount catalog pickers so the dropdown resets after each pick (including duplicate picks). */
  const [scratchTaskPickTick, setScratchTaskPickTick] = useState(0);
  const [scratchGroupPickTick, setScratchGroupPickTick] = useState(0);

  const load = useCallback(async () => {
    const keyErr = browserKeyConfigurationError();
    if (keyErr) {
      setState({ status: "error", message: keyErr });
      return;
    }
    const client = getSupabase();
    if (!client) {
      setState({
        status: "error",
        message:
          "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env and restart the dev server.",
      });
      return;
    }
    setState({ status: "loading" });
    const [pRes, sRes, tRes, kRes, ptRes, tgRes, prRes, tglRes] = await Promise.all([
      client.from("packages").select("*").order("package_id"),
      client.from("solutions").select("*").order("solution_id"),
      client.from("solution_tiers").select("*").order("solution_tier_id"),
      client.from("tasks").select("*").order("task_id"),
      client.from("package_solution_tiers").select("*").order("package_id"),
      client.from("task_groups").select("*").order("name"),
      client.from("solution_tier_pricing").select("*").order("solution_tier_id"),
      client.from("task_group_lines").select("*").order("sort_order"),
    ]);
    const err =
      pRes.error || sRes.error || tRes.error || kRes.error || ptRes.error || tgRes.error || prRes.error || tglRes.error
        ? [pRes.error, sRes.error, tRes.error, kRes.error, ptRes.error, tgRes.error, prRes.error, tglRes.error].find(
            Boolean
          )
        : null;
    if (err) {
      setState({ status: "error", message: err.message });
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
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
    };
  }, [data]);

  const addCard = useCallback((c: RoadmapCard) => {
    setCards((prev) => [...prev, c]);
  }, []);

  const removeCard = useCallback((key: string) => {
    setCards((prev) => prev.filter((x) => x.key !== key));
  }, []);

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
    >
  >;

  const patchCard = useCallback(
    (key: string, patch: RoadmapCardPatch) => {
      setCards((prev) =>
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
    [catalogCtx]
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

  const openScratchCustomize = useCallback(
    (c: RoadmapCard) => {
      openDetailsModal(c, { focusCompose: true });
    },
    [openDetailsModal]
  );

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
    setCards((prev) => prev.map((c) => (c.key === detailsModalKey ? merged : c)));
    closeDetailsModal();
  }, [detailsModalKey, scratchDraft, catalogCtx, closeDetailsModal]);

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

  const clearBoard = useCallback(() => {
    setCards([]);
    setDetailsModalKey(null);
    setScratchDraft(null);
    setScratchModalFocusCompose(false);
  }, []);

  const targetDefaultPhaseId = useMemo(() => {
    const list = sortedPhasesForScenario(phases, targetScenarioId);
    return list[0]?.id ?? "";
  }, [phases, targetScenarioId]);

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
      setCards((cPrev) => [
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
  }, []);

  const deleteScenarioById = useCallback((scenarioId: string) => {
    setScenarios((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((s) => s.id !== scenarioId);
      setTargetScenarioId((tid) => (tid === scenarioId ? next[0]!.id : tid));
      return next;
    });
    setPhases((phPrev) => phPrev.filter((p) => p.scenarioId !== scenarioId));
    setCards((cPrev) => cPrev.filter((c) => c.scenarioId !== scenarioId));
  }, []);

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

  const budgetNumber = useMemo(() => parseMoneyInput(clientBudget), [clientBudget]);

  const summaryMarkdown = useMemo(() => {
    const lines: string[] = [];
    const title = roadmapTitle.trim() || "Roadmap draft";
    lines.push(`# ${title}`);
    if (clientLabel.trim()) lines.push(`**Client / opportunity:** ${clientLabel.trim()}`);
    lines.push(`**Horizon:** ${horizon === "custom" ? "Custom" : `${horizon} months`}`);
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
  }, [cards, clientBudget, clientLabel, budgetNumber, horizon, scenarios, phases, roadmapTitle, catalogCtx]);

  const copySummary = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(summaryMarkdown);
    } catch {
      window.prompt("Copy this summary:", summaryMarkdown);
    }
  }, [summaryMarkdown]);

  const q = paletteSearch;

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

  const filteredPackages = useMemo(() => {
    if (!catalogCtx) return [];
    return catalogCtx.packages.filter((p) => {
      const { hours, price } = rollupHoursPrice(
        tierIdsForPackage(catalogCtx.packageTiers, p.package_id),
        catalogCtx.pricingMap
      );
      return matches(`${p.package_id} ${p.package_name} ${hours} ${price}`, q);
    });
  }, [catalogCtx, q]);

  const filteredTiers = useMemo(() => {
    if (!catalogCtx) return [];
    return catalogCtx.tiers.filter((t) => {
      const sol = catalogCtx.solutions.find((s) => s.solution_id === t.solution_id);
      const solPart = sol ? `${sol.solution_name} ` : "";
      const pr = catalogCtx.pricingMap.get(t.solution_tier_id) ?? null;
      const pitch = tierPitchText(t);
      return matches(
        `${t.solution_tier_id} ${t.solution_tier_name} ${solPart}${pitch} ${tierHoursLine(pr)} ${sellPriceLine(pr)}`,
        q
      );
    });
  }, [catalogCtx, q]);

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
  const palettePreviewScenarioId = scenarios[0]?.id ?? "";
  const palettePreviewPhaseId = sortedPhasesForScenario(phases, palettePreviewScenarioId)[0]?.id ?? "";
  const targetScenario = scenarios.find((s) => s.id === targetScenarioId) ?? null;
  const targetScenarioIndex = scenarios.findIndex((s) => s.id === targetScenarioId);
  const targetScenarioRollup = targetScenarioIndex >= 0 ? (scenarioRollups[targetScenarioIndex] ?? null) : null;
  const totalOptionalCount = cards.filter((c) => c.scope === "optional").length;
  const totalDeferredCount = cards.filter((c) => c.scope === "deferred").length;
  let budgetClosestLabel = "Add a budget to compare scenarios.";
  if (budgetNumber != null) {
    let bestRank = Number.POSITIVE_INFINITY;
    let bestDelta = Number.POSITIVE_INFINITY;
    scenarios.forEach((scenario, idx) => {
      const subtotal = scenarioRollups[idx]?.priceSubtotal ?? 0;
      const status = budgetVsScenarioStatus(subtotal, budgetNumber);
      const delta = Math.abs(budgetNumber - subtotal);
      const rank = status === "in_range" ? 0 : status === "under" ? 1 : 2;
      if (rank < bestRank || (rank === bestRank && delta < bestDelta)) {
        bestRank = rank;
        bestDelta = delta;
        budgetClosestLabel = `${scenario.title.trim() || "Scenario"}: ${
          status === "over" ? `Over by ${formatUsd(delta)}` : status === "in_range" ? "Within range" : `${formatUsd(delta)} under`
        }`;
      }
    });
  }

  return (
    <div className="roadmap-page">
      <div className="roadmap-page__inner roadmap-page__inner--wide">
        <header className="roadmap-hero roadmap-hero--builder">
          <div className="roadmap-hero__main">
            <p className="roadmap-hero__eyebrow">Sales &amp; strategy workspace</p>
            <h1 className="roadmap-hero__title">Proposal Builder</h1>
            <p className="roadmap-hero__lead">
              Compare scenarios in columns, organize each into <strong>phases</strong>, and mark line items as{" "}
              <strong>included</strong>, <strong>optional</strong>, or <strong>deferred</strong>. Set a <strong>client budget</strong>{" "}
              to see each scenario against plan (under / in range / over). Use optional <strong>hours and price overrides</strong>{" "}
              for proposal-only tweaks without changing the catalog. Export groups by phase with optional add-ons separated. Nothing
              here writes to the database — use <Link to="/admin">Admin</Link> for catalog data.
            </p>
          </div>
          <div className="roadmap-hero__aside">
            <div className="roadmap-hero__statgrid">
              <div className="roadmap-hero-stat">
                <span className="roadmap-hero-stat__label">Target scenario</span>
                <strong>{targetScenario?.title?.trim() || "Select a scenario"}</strong>
                <p>{targetDefaultPhaseId ? "New items land in its first phase." : "Create a phase to start adding items."}</p>
              </div>
              <div className="roadmap-hero-stat">
                <span className="roadmap-hero-stat__label">Scenarios</span>
                <strong>{scenarios.length}</strong>
                <p>{cards.length} total line items on board</p>
              </div>
              <div className="roadmap-hero-stat">
                <span className="roadmap-hero-stat__label">Target subtotal</span>
                <strong>{targetScenarioRollup ? formatUsd(targetScenarioRollup.priceSubtotal) : "—"}</strong>
                <p>{targetScenarioRollup?.includedCount ?? 0} included lines</p>
              </div>
              <div className="roadmap-hero-stat">
                <span className="roadmap-hero-stat__label">Budget read</span>
                <strong>{budgetNumber != null ? formatUsd(budgetNumber) : "Not set"}</strong>
                <p>{budgetClosestLabel}</p>
              </div>
            </div>
            <div className="roadmap-hero__actions">
              <button type="button" className="roadmap-btn roadmap-btn--ghost" onClick={addScenario}>
                + Scenario
              </button>
              <button type="button" className="roadmap-btn roadmap-btn--ghost" onClick={clearBoard}>
                Clear board
              </button>
              <button type="button" className="roadmap-btn roadmap-btn--primary" onClick={() => void copySummary()}>
                Copy summary
              </button>
            </div>
          </div>
        </header>

        <section className="roadmap-panel roadmap-panel--meta">
          <div className="roadmap-section-head">
            <div>
              <p className="roadmap-section-head__eyebrow">Proposal setup</p>
              <h2 className="roadmap-section-head__title">Context and guardrails</h2>
            </div>
            <p className="roadmap-section-head__note">
              These inputs shape the proposal narrative, budget comparison, and exported summary.
            </p>
          </div>
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
              ) : (
                <span className="roadmap-muted roadmap-budget-hint">
                  Budget bars use <strong>included</strong> lines only (plus effective price: overrides or catalog).
                </span>
              )}
            </label>
            <label className="roadmap-field">
              <span className="roadmap-field__cap">Pitch horizon</span>
              <select
                className="roadmap-input"
                value={horizon}
                onChange={(e) => setHorizon(e.target.value as "3" | "4" | "6" | "12" | "custom")}
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

        <div className="roadmap-workspace">
          <aside className="roadmap-library" aria-label="Catalog library">
            <div className="roadmap-library__head">
              <p className="roadmap-library__eyebrow">Add from catalog</p>
              <div className="roadmap-library__title-row">
                <h2 className="roadmap-library__title">Library</h2>
                <span className="roadmap-library__count">
                  {paletteTab === "packages" ? filteredPackages.length : filteredTiers.length}
                </span>
              </div>
              <p className="roadmap-muted roadmap-library__hint">
                Choose which <strong>what-if</strong> column to add to, then tap <strong>+ Add</strong> on any row.
              </p>
              <div className="roadmap-library__target-card">
                <div className="roadmap-library__target-head">
                  <span className="roadmap-field__cap">Add next item to</span>
                  {targetScenarioRollup ? (
                    <span className="roadmap-library__target-kpi">{formatUsd(targetScenarioRollup.priceSubtotal)} included</span>
                  ) : null}
                </div>
                <div className="roadmap-scenario-pick">
                  {scenarios.map((s, i) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`roadmap-scenario-pill${targetScenarioId === s.id ? " is-active" : ""}`}
                      onClick={() => setTargetScenarioId(s.id)}
                      title={s.title}
                    >
                      {i + 1}. {s.title}
                    </button>
                  ))}
                </div>
                <p className="roadmap-library__target-note">
                  New items default into the first phase of the selected scenario, then can be moved on-card.
                </p>
              </div>
              <label className="roadmap-field roadmap-field--search">
                <span className="roadmap-field__cap" id={searchId}>
                  Search
                </span>
                <input
                  className="roadmap-input"
                  aria-labelledby={searchId}
                  value={paletteSearch}
                  onChange={(e) => setPaletteSearch(e.target.value)}
                  placeholder="Filter by name or id…"
                />
              </label>
              <div className="roadmap-palette-tabs" role="tablist" aria-label="Library category">
                {(
                  [
                    ["packages", "Packages"],
                    ["tiers", "Tiers"],
                  ] as const
                ).map(([id, lab]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={paletteTab === id}
                    className={`roadmap-palette-tab${paletteTab === id ? " is-active" : ""}`}
                    onClick={() => setPaletteTab(id)}
                  >
                    {lab}
                  </button>
                ))}
              </div>
              <div className="roadmap-library__summary">
                <span>{ctx.packages.length} packages</span>
                <span>{ctx.tiers.length} tiers</span>
                <span>Scratch tiers available</span>
              </div>
            </div>
            <div className="roadmap-palette-scroll">
              {paletteTab === "tiers" ? (
                <div className="roadmap-scratch-row">
                  <button
                    type="button"
                    className="roadmap-btn roadmap-btn--sm"
                    disabled={!targetDefaultPhaseId}
                    onClick={() => {
                      if (!targetDefaultPhaseId) return;
                      addCard(cardForScratchTier(targetScenarioId, targetDefaultPhaseId, ctx));
                    }}
                  >
                    + Scratch tier
                  </button>
                  <span className="roadmap-muted roadmap-scratch-row__hint">
                    Adds a temporary tier to the selected scenario. Use Details or Customize for title, manual hours,
                    catalog tasks / group templates, blended $/hr, and risk / strategic multipliers — sell price is
                    calculated for you.
                  </span>
                </div>
              ) : null}
              {paletteTab === "packages" &&
                filteredPackages.map((p) => {
                  const row = cardForPackage(p, ctx, palettePreviewScenarioId, palettePreviewPhaseId);
                  return (
                    <div key={p.package_id} className="roadmap-palette-row">
                      <div className="roadmap-palette-row__body">
                        <div className="roadmap-palette-row__head">
                          <strong>{p.package_name}</strong>
                          <code className="roadmap-palette-row__id">{p.package_id}</code>
                        </div>
                        <div className="roadmap-palette-row__kpis">
                          <span title="Rollup from linked tiers">{row.hours}</span>
                          <span title="Rollup from linked tiers">{row.price}</span>
                        </div>
                        {row.description ? (
                          <p className="roadmap-palette-row__desc">{descPreview(row.description, 240)}</p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="roadmap-btn roadmap-btn--sm"
                        disabled={!targetDefaultPhaseId}
                        onClick={() => {
                          if (!targetDefaultPhaseId) return;
                          addCard(cardForPackage(p, ctx, targetScenarioId, targetDefaultPhaseId));
                        }}
                      >
                        + Add
                      </button>
                    </div>
                  );
                })}
              {paletteTab === "tiers" &&
                filteredTiers.map((t) => {
                  const row = cardForTier(t, ctx, palettePreviewScenarioId, palettePreviewPhaseId);
                  const sol = ctx.solutions.find((s) => s.solution_id === t.solution_id);
                  return (
                    <div key={t.solution_tier_id} className="roadmap-palette-row">
                      <div className="roadmap-palette-row__body">
                        <div className="roadmap-palette-row__head">
                          <strong>{t.solution_tier_name}</strong>
                          <code className="roadmap-palette-row__id">{t.solution_tier_id}</code>
                        </div>
                        <p className="roadmap-palette-row__context">
                          {sol ? sol.solution_name : "—"}
                        </p>
                        <div className="roadmap-palette-row__kpis">
                          <span>{row.hours}</span>
                          <span>{row.price}</span>
                        </div>
                        {row.description ? (
                          <p className="roadmap-palette-row__desc">{descPreview(row.description, 280)}</p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="roadmap-btn roadmap-btn--sm"
                        disabled={!targetDefaultPhaseId}
                        onClick={() => {
                          if (!targetDefaultPhaseId) return;
                          addCard(cardForTier(t, ctx, targetScenarioId, targetDefaultPhaseId));
                        }}
                      >
                        + Add
                      </button>
                    </div>
                  );
                })}
              {paletteTab === "packages" && filteredPackages.length === 0 ? (
                <p className="roadmap-muted roadmap-palette-empty">No packages match.</p>
              ) : null}
              {paletteTab === "tiers" && filteredTiers.length === 0 ? (
                <p className="roadmap-muted roadmap-palette-empty">No tiers match.</p>
              ) : null}
            </div>
          </aside>

          <main className="roadmap-board" aria-label="Roadmap board">
            <div className="roadmap-board__toolbar">
              <div className="roadmap-board__heading">
                <p className="roadmap-board__eyebrow">Scenario board</p>
                <h2 className="roadmap-board__title">What-if scenarios</h2>
                <p className="roadmap-board__lead">
                  Compare included scope, optional upsell, deferred work, and phased sequencing side by side.
                </p>
              </div>
            </div>
            <div className="roadmap-columns">
              {scenarios.map((scenario, scenarioIdx) => {
                const scenarioPhases = sortedPhasesForScenario(phases, scenario.id);
                const rollup = scenarioRollups[scenarioIdx] ?? {
                  count: 0,
                  includedCount: 0,
                  hoursSum: null,
                  hoursCount: 0,
                  priceSubtotal: 0,
                  priceParsedCount: 0,
                  missingPriceCount: 0,
                  optionalPriceSubtotal: 0,
                  optionalParsedCount: 0,
                };
                const sub = rollup.priceSubtotal;
                const b = budgetNumber;
                const remaining = b != null ? b - sub : null;
                const barPct = b != null && b > 0 ? Math.min(100, (sub / b) * 100) : 0;
                const budgetStat = b != null ? budgetVsScenarioStatus(sub, b) : null;
                return (
                  <section
                    key={scenario.id}
                    className={`roadmap-column${targetScenarioId === scenario.id ? " roadmap-column--active" : ""}`}
                  >
                    <header className="roadmap-column__head">
                      <div className="roadmap-column__heading">
                        <label className="roadmap-scenario-edit">
                          <span className="visually-hidden">Scenario name</span>
                          <input
                            className="roadmap-scenario-input"
                            value={scenario.title}
                            onChange={(e) =>
                              setScenarios((prev) =>
                                prev.map((s) => (s.id === scenario.id ? { ...s, title: e.target.value } : s))
                              )
                            }
                          />
                        </label>
                        <div className="roadmap-column__badges">
                          {targetScenarioId === scenario.id ? (
                            <span className="roadmap-column__target-badge">Library target</span>
                          ) : null}
                          <span className="roadmap-column__count" title="All line items in this scenario">
                            {cards.filter((c) => c.scenarioId === scenario.id).length} items
                          </span>
                        </div>
                      </div>
                      <div className="roadmap-column__scenario-actions">
                        <button
                          type="button"
                          className="roadmap-btn roadmap-btn--sm roadmap-btn--ghost"
                          onClick={() => duplicateScenarioById(scenario.id)}
                        >
                          Duplicate
                        </button>
                        <button
                          type="button"
                          className="roadmap-btn roadmap-btn--sm roadmap-btn--ghost"
                          disabled={scenarios.length <= 1}
                          onClick={() => deleteScenarioById(scenario.id)}
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          className="roadmap-btn roadmap-btn--sm"
                          onClick={() => addPhaseForScenario(scenario.id)}
                        >
                          + Phase
                        </button>
                      </div>
                    </header>
                    <div className="roadmap-column__stats">
                      <div className="roadmap-column__stat">
                        <span>Included</span>
                        <strong>{formatUsd(sub)}</strong>
                      </div>
                      <div className="roadmap-column__stat">
                        <span>Optional</span>
                        <strong>{rollup.optionalParsedCount > 0 ? formatUsd(rollup.optionalPriceSubtotal) : "—"}</strong>
                      </div>
                      <div className="roadmap-column__stat">
                        <span>Hours</span>
                        <strong>{rollup.hoursSum != null && rollup.hoursCount > 0 ? `~${formatHoursShort(rollup.hoursSum)} h` : "—"}</strong>
                      </div>
                    </div>
                    {b != null ? (
                      <div className="roadmap-column__budget-strip">
                        <div
                          className={`roadmap-budget-meter${budgetStat === "over" ? " roadmap-budget-meter--over" : ""}`}
                          role="progressbar"
                          aria-valuenow={Math.round(barPct)}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          title="Included subtotal vs client budget"
                        >
                          <div className="roadmap-budget-meter__fill" style={{ width: `${barPct}%` }} />
                        </div>
                        <div className="roadmap-rollup__line">
                          <span>
                            <strong>{formatUsd(sub)}</strong> included · budget {formatUsd(b)}
                          </span>
                          {budgetStat === "over" ? (
                            <span className="roadmap-budget-pill roadmap-budget-pill--over">
                              Over by {formatUsd(-(remaining ?? 0))}
                            </span>
                          ) : budgetStat === "in_range" ? (
                            <span className="roadmap-budget-pill roadmap-budget-pill--range">Within range</span>
                          ) : (
                            <span className="roadmap-budget-pill roadmap-budget-pill--under">
                              {remaining != null ? `${formatUsd(Math.max(0, remaining))} under` : "—"}
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="roadmap-muted roadmap-column__budget-hint">
                        Set a client budget above to compare <strong>included</strong> totals.
                      </p>
                    )}
                    <details className="roadmap-scenario-narrative">
                      <summary className="roadmap-scenario-narrative__summary">Approach / narrative (export)</summary>
                      <textarea
                        className="roadmap-input roadmap-scenario-narrative__textarea"
                        rows={3}
                        value={scenario.narrative}
                        placeholder="Why this scenario is structured this way…"
                        onChange={(e) =>
                          setScenarios((prev) =>
                            prev.map((s) => (s.id === scenario.id ? { ...s, narrative: e.target.value } : s))
                          )
                        }
                      />
                    </details>
                    <div className="roadmap-column__phases">
                      {scenarioPhases.map((phase) => {
                        const phaseCardsIncluded = cards.filter(
                          (c) => c.scenarioId === scenario.id && c.phaseId === phase.id && c.scope === "included"
                        );
                        const phaseCardsOther = cards.filter(
                          (c) => c.scenarioId === scenario.id && c.phaseId === phase.id && c.scope !== "included"
                        );
                        let phH = 0;
                        let phHC = 0;
                        let phP = 0;
                        let phPC = 0;
                        for (const c of phaseCardsIncluded) {
                          const hh = cardHoursForScenarioRollup(c, ctx);
                          if (hh != null) {
                            phH += hh;
                            phHC += 1;
                          }
                          const pu = cardPriceUsdForRollup(c, ctx, computeScratchSellPrice);
                          if (pu != null) {
                            phP += pu;
                            phPC += 1;
                          }
                        }
                        return (
                          <div key={phase.id} className="roadmap-phase">
                            <div className="roadmap-phase__head">
                              <input
                                className="roadmap-input roadmap-phase__title-input"
                                value={phase.title}
                                onChange={(e) =>
                                  setPhases((prev) =>
                                    prev.map((p) => (p.id === phase.id ? { ...p, title: e.target.value } : p))
                                  )
                                }
                                aria-label="Phase title"
                              />
                              <span className="roadmap-phase__rollup roadmap-muted">
                                {phPC > 0 ? formatUsd(phP) : "—"} · {phHC > 0 ? `~${formatHoursShort(phH)} h` : "—"}
                              </span>
                            </div>
                            <ul className="roadmap-column__list roadmap-column__list--phase">
                              {phaseCardsIncluded.map((c) => (
                                <RoadmapCardBlock
                                  key={c.key}
                                  c={c}
                                  ctx={ctx}
                                  phaseChoices={scenarioPhases}
                                  onPatch={patchCard}
                                  onRemove={removeCard}
                                  onDetails={openDetailsModal}
                                  onScratchCustomize={openScratchCustomize}
                                />
                              ))}
                              {phaseCardsOther.map((c) => (
                                <RoadmapCardBlock
                                  key={c.key}
                                  c={c}
                                  ctx={ctx}
                                  phaseChoices={scenarioPhases}
                                  onPatch={patchCard}
                                  onRemove={removeCard}
                                  onDetails={openDetailsModal}
                                  onScratchCustomize={openScratchCustomize}
                                />
                              ))}
                            </ul>
                          </div>
                        );
                      })}
                    </div>
                    <footer className="roadmap-column__rollup">
                      {rollup.count === 0 ? (
                        <span className="roadmap-muted">Add line items from the library.</span>
                      ) : (
                        <>
                          <div className="roadmap-rollup__line">
                            <strong>{rollup.includedCount}</strong> included · <strong>{formatUsd(sub)}</strong>
                            {rollup.optionalParsedCount > 0 ? (
                              <span className="roadmap-muted">
                                {" "}
                                · optional tracked: <strong>{formatUsd(rollup.optionalPriceSubtotal)}</strong>
                              </span>
                            ) : null}
                            {rollup.missingPriceCount > 0 ? (
                              <span className="roadmap-muted" title="Included lines missing a parsed price">
                                {" "}
                                ({rollup.missingPriceCount} included without price)
                              </span>
                            ) : null}
                          </div>
                          {rollup.hoursSum != null && rollup.hoursCount > 0 ? (
                            <div className="roadmap-rollup__line roadmap-muted" title="Included hours only">
                              ~{rollup.hoursSum.toLocaleString()} h included
                            </div>
                          ) : null}
                        </>
                      )}
                    </footer>
                  </section>
                );
              })}
            </div>
          </main>
        </div>

        <section className="roadmap-panel roadmap-panel--export">
          <div className="roadmap-export__head">
            <div>
              <p className="roadmap-export__eyebrow">Client-ready output</p>
              <h2 className="roadmap-export__title">Export preview</h2>
            </div>
            <div className="roadmap-export__stats">
              <span>{summaryMarkdown.split("\n").filter(Boolean).length} summary lines</span>
              <span>{cards.length} board items</span>
              <span>{totalOptionalCount} optional</span>
              <span>{totalDeferredCount} deferred</span>
            </div>
          </div>
          <p className="roadmap-export__explain">
            Phased tables mirror the board: <strong>included</strong> items by phase, then <strong>optional</strong> add-ons.{" "}
            <strong>Deferred</strong> appears last. Use <strong>Copy summary</strong> for Markdown.
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
              const renderRow = (c: RoadmapCard) => (
                <tr key={c.key}>
                  <td>
                    <div className="roadmap-export-table__deliverable">
                      <strong>{c.headline.trim() || "(untitled)"}</strong>
                      <span className="roadmap-export-table__scope">{c.scope}</span>
                      {c.description.trim() ? <span>{descPreview(c.description, 180)}</span> : null}
                    </div>
                  </td>
                  <td>{kindLabel(c.kind)}</td>
                  <td>{effectiveHoursStr(c) || "—"}</td>
                  <td>{effectivePriceStr(c, ctx, computeScratchSellPrice) || "—"}</td>
                </tr>
              );
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
                            <h4 className="roadmap-export-phase__title">Optional add-ons</h4>
                            <table>
                              <thead>
                                <tr>
                                  <th>Deliverable</th>
                                  <th>Type</th>
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
                            <h4 className="roadmap-export-phase__title">Deferred (not in core)</h4>
                            <table>
                              <thead>
                                <tr>
                                  <th>Deliverable</th>
                                  <th>Type</th>
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
