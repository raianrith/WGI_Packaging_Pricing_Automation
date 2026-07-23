import type { PackageSolutionTier, SolutionTier, TaskRow } from "../types";
import { buildMergedTaskRowsForPackageTier } from "./packageTaskLayout";
import { parseTierOverrides } from "./packageTierOverrides";
import {
  tryParseRoadmapHours,
  tryParseUsdRough,
  type RoadmapCard,
  type RoadmapCardExtraTask,
  type RoadmapCardTaskLayout,
} from "./roadmapModel";
import { tasksOnTierSorted } from "./tierTaskCopy";

export type ProposalEditableTask = {
  id: string;
  name: string;
  /** Catalog / vault task name before proposal client-facing rename */
  catalogName: string;
  hours: number | null;
  /** Hours from catalog / package before proposal override */
  catalogHours: number | null;
  implementer: string | null;
  source: "catalog" | "package" | "proposal";
  /** Tier id when this row comes from a package multi-tier bundle */
  groupLabel?: string | null;
  /** Vault solution name for the component this task belongs to */
  solutionName?: string | null;
  /** Vault solution tier name for the component this task belongs to */
  solutionTierName?: string | null;
  /** Client-facing label for the package/solution component (from tier_overrides or card). */
  componentLabel?: string | null;
  isExtra: boolean;
};

export type ProposalCardTasksCtx = {
  tasks: TaskRow[];
  packageTiers: PackageSolutionTier[];
  tiers?: SolutionTier[];
  solutions?: Array<{ solution_id: string; solution_name: string }>;
};

export function newProposalExtraTaskId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return `prop-extra-${c.randomUUID()}`;
  return `prop-extra-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function emptyLayout(): RoadmapCardTaskLayout {
  return { hiddenIds: [], hourOverrides: {}, nameOverrides: {}, taskOrder: [], extras: [] };
}

export function normalizeTaskLayout(layout: RoadmapCardTaskLayout | null | undefined): RoadmapCardTaskLayout {
  if (!layout) return emptyLayout();
  return {
    hiddenIds: [...(layout.hiddenIds ?? [])],
    hourOverrides: { ...(layout.hourOverrides ?? {}) },
    nameOverrides: { ...(layout.nameOverrides ?? {}) },
    taskOrder: [...(layout.taskOrder ?? [])],
    extras: [...(layout.extras ?? [])],
  };
}

/** Names for a package component: vault solution/tier + client-facing override. */
function packageComponentMeta(
  link: PackageSolutionTier,
  ctx: ProposalCardTasksCtx
): {
  solutionName: string | null;
  solutionTierName: string | null;
  componentLabel: string | null;
} {
  const tier = ctx.tiers?.find((t) => t.solution_tier_id === link.solution_tier_id);
  const solutionName =
    (tier
      ? ctx.solutions?.find((s) => s.solution_id === tier.solution_id)?.solution_name?.trim()
      : null) || null;
  const solutionTierName = tier?.solution_tier_name?.trim() || null;
  const ov = parseTierOverrides(link.tier_overrides);
  const componentLabel =
    ov.solution_tier_name?.trim() || solutionName || solutionTierName || null;
  return { solutionName, solutionTierName, componentLabel };
}

function baseTasksForCard(card: RoadmapCard, ctx: ProposalCardTasksCtx): ProposalEditableTask[] {
  if (card.kind === "tier") {
    const tier = ctx.tiers?.find((t) => t.solution_tier_id === card.refId);
    const solutionName =
      (tier
        ? ctx.solutions?.find((s) => s.solution_id === tier.solution_id)?.solution_name?.trim()
        : null) || null;
    const solutionTierName = tier?.solution_tier_name?.trim() || card.headline.trim() || null;
    const componentLabel = card.headline.trim() || solutionName || solutionTierName;
    return tasksOnTierSorted(ctx.tasks, card.refId).map((t) => {
      const name = t.task_name?.trim() || t.task_id;
      return {
        id: t.task_id,
        name,
        catalogName: name,
        hours: t.task_time != null && Number.isFinite(Number(t.task_time)) ? Number(t.task_time) : null,
        catalogHours: t.task_time != null && Number.isFinite(Number(t.task_time)) ? Number(t.task_time) : null,
        implementer: t.task_implementer,
        source: "catalog" as const,
        groupLabel: null,
        solutionName,
        solutionTierName,
        componentLabel,
        isExtra: false,
      };
    });
  }

  if (card.kind === "package") {
    const links = ctx.packageTiers.filter((l) => l.package_id === card.refId);
    const out: ProposalEditableTask[] = [];
    const seen = new Set<string>();
    for (const link of links) {
      const meta = packageComponentMeta(link, ctx);
      const rows = buildMergedTaskRowsForPackageTier({
        tierId: link.solution_tier_id,
        vaultTasks: ctx.tasks,
        taskOverrides: link.task_overrides,
        taskExtensions: link.task_extensions,
        packageExtrasAnchorTierId: links[0]?.solution_tier_id ?? null,
      });
      for (const t of rows) {
        if (seen.has(t.task_id)) continue;
        seen.add(t.task_id);
        const name = t.task_name?.trim() || t.task_id;
        out.push({
          id: t.task_id,
          name,
          catalogName: name,
          hours: t.task_time != null && Number.isFinite(Number(t.task_time)) ? Number(t.task_time) : null,
          catalogHours: t.task_time != null && Number.isFinite(Number(t.task_time)) ? Number(t.task_time) : null,
          implementer: t.task_implementer,
          source: t.task_id.startsWith("pkg-extra-") ? "package" : "catalog",
          groupLabel: link.solution_tier_id,
          solutionName: meta.solutionName,
          solutionTierName: meta.solutionTierName,
          componentLabel: meta.componentLabel,
          isExtra: false,
        });
      }
    }
    return out;
  }

  if (card.kind === "custom_tier") {
    const ids = card.scratchAttachedTaskIds ?? [];
    const componentLabel = card.headline.trim() || "Custom tier";
    return ids
      .map((id) => ctx.tasks.find((t) => t.task_id === id))
      .filter((t): t is TaskRow => t != null)
      .map((t) => {
        const name = t.task_name?.trim() || t.task_id;
        return {
          id: t.task_id,
          name,
          catalogName: name,
          hours: t.task_time != null && Number.isFinite(Number(t.task_time)) ? Number(t.task_time) : null,
          catalogHours: t.task_time != null && Number.isFinite(Number(t.task_time)) ? Number(t.task_time) : null,
          implementer: t.task_implementer,
          source: "catalog" as const,
          groupLabel: null,
          solutionName: null,
          solutionTierName: null,
          componentLabel,
          isExtra: false,
        };
      });
  }

  return [];
}

function applyTaskOrder(tasks: ProposalEditableTask[], order: string[] | undefined): ProposalEditableTask[] {
  if (!order?.length) return tasks;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const ordered: ProposalEditableTask[] = [];
  const seen = new Set<string>();
  for (const id of order) {
    const row = byId.get(id);
    if (!row || seen.has(id)) continue;
    ordered.push(row);
    seen.add(id);
  }
  for (const row of tasks) {
    if (seen.has(row.id)) continue;
    ordered.push(row);
  }
  return ordered;
}

/** Resolve editable tasks for a proposal line (catalog base + proposal-only layout). */
export function resolveProposalCardTasks(
  card: RoadmapCard,
  ctx: ProposalCardTasksCtx
): ProposalEditableTask[] {
  const layout = normalizeTaskLayout(card.taskLayout);
  const hidden = new Set(layout.hiddenIds ?? []);
  const hourOverrides = layout.hourOverrides ?? {};
  const nameOverrides = layout.nameOverrides ?? {};

  const base = baseTasksForCard(card, ctx)
    .filter((t) => !hidden.has(t.id))
    .map((t) => {
      const next = { ...t };
      if (Object.prototype.hasOwnProperty.call(hourOverrides, t.id)) {
        const ov = hourOverrides[t.id];
        next.hours = ov != null && Number.isFinite(Number(ov)) ? Number(ov) : null;
      }
      if (Object.prototype.hasOwnProperty.call(nameOverrides, t.id)) {
        const label = nameOverrides[t.id]?.trim();
        if (label) next.name = label;
      }
      return next;
    });

  const extras: ProposalEditableTask[] = (layout.extras ?? []).map((e) => {
    const catalogName = e.name.trim() || "Proposal task";
    return {
      id: e.id,
      name: catalogName,
      catalogName,
      hours: e.hours != null && Number.isFinite(e.hours) ? e.hours : null,
      catalogHours: null,
      implementer: e.implementer ?? null,
      source: "proposal" as const,
      groupLabel: null,
      solutionName: null,
      solutionTierName: null,
      componentLabel: null,
      isExtra: true,
    };
  });

  return applyTaskOrder([...base, ...extras], layout.taskOrder);
}

export function sumProposalTaskHours(tasks: ProposalEditableTask[]): number {
  let sum = 0;
  for (const t of tasks) {
    if (t.hours != null && Number.isFinite(t.hours)) sum += t.hours;
  }
  return sum;
}

export function formatProposalTaskHoursTotal(tasks: ProposalEditableTask[]): string {
  const sum = sumProposalTaskHours(tasks);
  if (sum <= 0 && tasks.every((t) => t.hours == null)) return "—";
  const rounded = Math.round(sum * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded} h` : `${rounded} h`;
}

export function formatProposalHoursValue(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded} h` : `${rounded} h`;
}

export function formatProposalUsdValue(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.round(n));
}

/** Catalog hours stored on the card when it was added to the proposal. */
export function cardOriginalHours(card: Pick<RoadmapCard, "hours">): number | null {
  return tryParseRoadmapHours(card.hours);
}

/** Catalog sell stored on the card when it was added to the proposal. */
export function cardOriginalPriceUsd(card: Pick<RoadmapCard, "price">): number | null {
  return tryParseUsdRough(card.price);
}

export type ProposalLineCompareMetrics = {
  originalHours: number | null;
  currentHours: number | null;
  originalPriceUsd: number | null;
  currentPriceUsd: number | null;
  hoursChanged: boolean;
  priceChanged: boolean;
};

/** Sum of catalog task hours for a line (ignores proposal hour overrides / extras). */
export function sumBaseCatalogTaskHours(card: RoadmapCard, ctx: ProposalCardTasksCtx): number {
  let sum = 0;
  for (const t of baseTasksForCard(card, ctx)) {
    if (t.catalogHours != null && Number.isFinite(t.catalogHours)) sum += t.catalogHours;
  }
  return sum;
}

/**
 * Side-by-side original vs current hours/price for Client Service Review.
 *
 * Without CSR task edits (`taskLayout`), original and current are the same
 * resting proposal values — so Organize overrides / variable-tier fields do not
 * falsely look like hour changes on this step.
 *
 * With `taskLayout`, original is catalog-as-added (`card.hours` / `card.price`)
 * and current is the proposal override / effective price after task edits.
 */
export function proposalLineCompareMetrics(
  card: RoadmapCard,
  _ctx: ProposalCardTasksCtx,
  effectivePriceLabel: string
): ProposalLineCompareMetrics {
  const catalogHours = cardOriginalHours(card);
  const catalogPriceUsd = cardOriginalPriceUsd(card);
  const overrideHours = card.hoursOverride?.trim()
    ? tryParseRoadmapHours(card.hoursOverride)
    : null;
  const overridePriceUsd = card.priceOverride?.trim()
    ? tryParseUsdRough(card.priceOverride)
    : null;
  const effectivePriceUsd = tryParseUsdRough(effectivePriceLabel);
  const hasTaskEdits = Boolean(card.taskLayout);

  if (!hasTaskEdits) {
    const hours = overrideHours ?? catalogHours;
    const price = overridePriceUsd ?? effectivePriceUsd ?? catalogPriceUsd;
    return {
      originalHours: hours,
      currentHours: hours,
      originalPriceUsd: price,
      currentPriceUsd: price,
      hoursChanged: false,
      priceChanged: false,
    };
  }

  const originalHours = catalogHours;
  const originalPriceUsd = catalogPriceUsd;
  const currentHours = overrideHours ?? catalogHours;
  const currentPriceUsd = overridePriceUsd ?? effectivePriceUsd ?? catalogPriceUsd;

  const hoursChanged =
    originalHours != null &&
    currentHours != null &&
    Math.abs(currentHours - originalHours) >= 0.005;

  const priceChanged =
    originalPriceUsd != null &&
    currentPriceUsd != null &&
    Math.round(originalPriceUsd) !== Math.round(currentPriceUsd);

  return {
    originalHours,
    currentHours,
    originalPriceUsd,
    currentPriceUsd,
    hoursChanged,
    priceChanged,
  };
}

function layoutIsEmpty(layout: RoadmapCardTaskLayout): boolean {
  return (
    (layout.hiddenIds?.length ?? 0) === 0 &&
    Object.keys(layout.hourOverrides ?? {}).length === 0 &&
    Object.keys(layout.nameOverrides ?? {}).length === 0 &&
    (layout.taskOrder?.length ?? 0) === 0 &&
    (layout.extras?.length ?? 0) === 0
  );
}

function formatHoursOverrideValue(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

/** Apply a task layout mutation and sync `hoursOverride` (+ proportional `priceOverride`) from task hours. */
export function patchCardTaskLayout(
  card: RoadmapCard,
  ctx: ProposalCardTasksCtx,
  mutate: (layout: RoadmapCardTaskLayout) => RoadmapCardTaskLayout
): RoadmapCard {
  const nextLayout = mutate(normalizeTaskLayout(card.taskLayout));
  const cleaned = layoutIsEmpty(nextLayout) ? null : nextLayout;
  const withLayout: RoadmapCard = { ...card, taskLayout: cleaned };
  const tasks = resolveProposalCardTasks(withLayout, ctx);
  const editedTaskHours = sumProposalTaskHours(tasks);

  if (!cleaned) {
    return {
      ...withLayout,
      hoursOverride: null,
      // CSR cleared task edits — restore catalog price for non-scratch lines.
      priceOverride: card.kind === "custom_tier" ? card.priceOverride ?? null : null,
    };
  }

  // Scale the card's catalog hours/price by edited vs baseline catalog task hours.
  // Package cards store discounted resource hours — never replace them with raw task sums.
  const baselineTaskHours = sumBaseCatalogTaskHours(card, ctx);
  const origCardHours = cardOriginalHours(card);
  const origPrice = cardOriginalPriceUsd(card);
  const ratio =
    baselineTaskHours > 0 && Number.isFinite(editedTaskHours)
      ? editedTaskHours / baselineTaskHours
      : 1;

  let hoursOverride: string | null;
  if (origCardHours != null && Number.isFinite(origCardHours)) {
    hoursOverride = formatHoursOverrideValue(origCardHours * ratio);
  } else if (Number.isInteger(editedTaskHours)) {
    hoursOverride = String(editedTaskHours);
  } else {
    hoursOverride = String(Math.round(editedTaskHours * 100) / 100);
  }

  const next: RoadmapCard = {
    ...withLayout,
    hoursOverride,
  };

  // Scratch tiers derive sell from hours; tier/package lines scale catalog sell with the same ratio.
  if (card.kind === "custom_tier") return next;
  if (origPrice == null) return next;

  const scaled = Math.round(origPrice * ratio);
  if (Math.abs(ratio - 1) < 0.0001 && Math.round(scaled) === Math.round(origPrice)) {
    return { ...next, priceOverride: null };
  }
  return { ...next, priceOverride: formatProposalUsdValue(scaled) };
}

export function hideProposalTask(card: RoadmapCard, ctx: ProposalCardTasksCtx, taskId: string): RoadmapCard {
  return patchCardTaskLayout(card, ctx, (layout) => {
    if (layout.extras?.some((e) => e.id === taskId)) {
      return {
        ...layout,
        extras: (layout.extras ?? []).filter((e) => e.id !== taskId),
        taskOrder: (layout.taskOrder ?? []).filter((id) => id !== taskId),
      };
    }
    const hiddenIds = [...new Set([...(layout.hiddenIds ?? []), taskId])];
    const hourOverrides = { ...(layout.hourOverrides ?? {}) };
    delete hourOverrides[taskId];
    const nameOverrides = { ...(layout.nameOverrides ?? {}) };
    delete nameOverrides[taskId];
    return {
      ...layout,
      hiddenIds,
      hourOverrides,
      nameOverrides,
      taskOrder: (layout.taskOrder ?? []).filter((id) => id !== taskId),
    };
  });
}

export function setProposalTaskHours(
  card: RoadmapCard,
  ctx: ProposalCardTasksCtx,
  taskId: string,
  hours: number | null
): RoadmapCard {
  return patchCardTaskLayout(card, ctx, (layout) => {
    const extraIdx = (layout.extras ?? []).findIndex((e) => e.id === taskId);
    if (extraIdx >= 0) {
      const extras = [...(layout.extras ?? [])];
      extras[extraIdx] = { ...extras[extraIdx]!, hours };
      return { ...layout, extras };
    }
    const hourOverrides = { ...(layout.hourOverrides ?? {}), [taskId]: hours };
    return { ...layout, hourOverrides };
  });
}

export function setProposalTaskClientLabel(
  card: RoadmapCard,
  ctx: ProposalCardTasksCtx,
  taskId: string,
  label: string
): RoadmapCard {
  return patchCardTaskLayout(card, ctx, (layout) => {
    const trimmed = label.trim();
    const extraIdx = (layout.extras ?? []).findIndex((e) => e.id === taskId);
    if (extraIdx >= 0) {
      const extras = [...(layout.extras ?? [])];
      extras[extraIdx] = { ...extras[extraIdx]!, name: trimmed || extras[extraIdx]!.name };
      return { ...layout, extras };
    }
    const base = baseTasksForCard(card, ctx).find((t) => t.id === taskId);
    const catalogName = base?.catalogName?.trim() || "";
    const nameOverrides = { ...(layout.nameOverrides ?? {}) };
    if (!trimmed || trimmed === catalogName) {
      delete nameOverrides[taskId];
    } else {
      nameOverrides[taskId] = trimmed;
    }
    return { ...layout, nameOverrides };
  });
}

export function moveProposalTask(
  card: RoadmapCard,
  ctx: ProposalCardTasksCtx,
  taskId: string,
  direction: "up" | "down"
): RoadmapCard {
  return patchCardTaskLayout(card, ctx, (layout) => {
    const current = resolveProposalCardTasks({ ...card, taskLayout: layout }, ctx);
    const ids = current.map((t) => t.id);
    const idx = ids.indexOf(taskId);
    if (idx < 0) return layout;
    const swapWith = direction === "up" ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= ids.length) return layout;
    const next = [...ids];
    const tmp = next[idx]!;
    next[idx] = next[swapWith]!;
    next[swapWith] = tmp;
    return { ...layout, taskOrder: next };
  });
}

/** Set explicit task order from drag-and-drop (ids must match current visible tasks). */
export function reorderProposalTasks(
  card: RoadmapCard,
  ctx: ProposalCardTasksCtx,
  orderedIds: string[]
): RoadmapCard {
  return patchCardTaskLayout(card, ctx, (layout) => {
    const current = resolveProposalCardTasks({ ...card, taskLayout: layout }, ctx);
    const currentIds = current.map((t) => t.id);
    if (orderedIds.length !== currentIds.length) return layout;
    const currentSet = new Set(currentIds);
    if (orderedIds.some((id) => !currentSet.has(id))) return layout;
    const seen = new Set<string>();
    for (const id of orderedIds) {
      if (seen.has(id)) return layout;
      seen.add(id);
    }
    return { ...layout, taskOrder: [...orderedIds] };
  });
}

export function addProposalExtraTask(
  card: RoadmapCard,
  ctx: ProposalCardTasksCtx,
  partial?: Partial<Pick<RoadmapCardExtraTask, "name" | "hours" | "implementer">>
): RoadmapCard {
  const extra: RoadmapCardExtraTask = {
    id: newProposalExtraTaskId(),
    name: partial?.name?.trim() || "New task",
    hours: partial?.hours ?? 1,
    implementer: partial?.implementer ?? null,
  };
  return patchCardTaskLayout(card, ctx, (layout) => {
    const current = resolveProposalCardTasks({ ...card, taskLayout: layout }, ctx);
    const taskOrder = [...current.map((t) => t.id), extra.id];
    return {
      ...layout,
      extras: [...(layout.extras ?? []), extra],
      taskOrder,
    };
  });
}

export function renameProposalExtraTask(
  card: RoadmapCard,
  ctx: ProposalCardTasksCtx,
  taskId: string,
  name: string
): RoadmapCard {
  return setProposalTaskClientLabel(card, ctx, taskId, name);
}

export function cardSupportsTaskReview(card: RoadmapCard): boolean {
  return card.kind === "tier" || card.kind === "package" || card.kind === "custom_tier";
}
