import type { PackageSolutionTier, TaskRow } from "../types";
import { buildMergedTaskRowsForPackageTier } from "./packageTaskLayout";
import {
  type RoadmapCard,
  type RoadmapCardExtraTask,
  type RoadmapCardTaskLayout,
} from "./roadmapModel";
import { tasksOnTierSorted } from "./tierTaskCopy";

export type ProposalEditableTask = {
  id: string;
  name: string;
  hours: number | null;
  /** Hours from catalog / package before proposal override */
  catalogHours: number | null;
  implementer: string | null;
  source: "catalog" | "package" | "proposal";
  /** Tier label when this row comes from a package multi-tier bundle */
  groupLabel?: string | null;
  isExtra: boolean;
};

export type ProposalCardTasksCtx = {
  tasks: TaskRow[];
  packageTiers: PackageSolutionTier[];
};

export function newProposalExtraTaskId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return `prop-extra-${c.randomUUID()}`;
  return `prop-extra-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function emptyLayout(): RoadmapCardTaskLayout {
  return { hiddenIds: [], hourOverrides: {}, extras: [] };
}

export function normalizeTaskLayout(layout: RoadmapCardTaskLayout | null | undefined): RoadmapCardTaskLayout {
  if (!layout) return emptyLayout();
  return {
    hiddenIds: [...(layout.hiddenIds ?? [])],
    hourOverrides: { ...(layout.hourOverrides ?? {}) },
    extras: [...(layout.extras ?? [])],
  };
}

function baseTasksForCard(card: RoadmapCard, ctx: ProposalCardTasksCtx): ProposalEditableTask[] {
  if (card.kind === "tier") {
    return tasksOnTierSorted(ctx.tasks, card.refId).map((t) => ({
      id: t.task_id,
      name: t.task_name?.trim() || t.task_id,
      hours: t.task_time != null && Number.isFinite(Number(t.task_time)) ? Number(t.task_time) : null,
      catalogHours: t.task_time != null && Number.isFinite(Number(t.task_time)) ? Number(t.task_time) : null,
      implementer: t.task_implementer,
      source: "catalog" as const,
      groupLabel: null,
      isExtra: false,
    }));
  }

  if (card.kind === "package") {
    const links = ctx.packageTiers.filter((l) => l.package_id === card.refId);
    const out: ProposalEditableTask[] = [];
    const seen = new Set<string>();
    for (const link of links) {
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
        out.push({
          id: t.task_id,
          name: t.task_name?.trim() || t.task_id,
          hours: t.task_time != null && Number.isFinite(Number(t.task_time)) ? Number(t.task_time) : null,
          catalogHours: t.task_time != null && Number.isFinite(Number(t.task_time)) ? Number(t.task_time) : null,
          implementer: t.task_implementer,
          source: t.task_id.startsWith("pkg-extra-") ? "package" : "catalog",
          groupLabel: link.solution_tier_id,
          isExtra: false,
        });
      }
    }
    return out;
  }

  if (card.kind === "custom_tier") {
    const ids = card.scratchAttachedTaskIds ?? [];
    return ids
      .map((id) => ctx.tasks.find((t) => t.task_id === id))
      .filter((t): t is TaskRow => t != null)
      .map((t) => ({
        id: t.task_id,
        name: t.task_name?.trim() || t.task_id,
        hours: t.task_time != null && Number.isFinite(Number(t.task_time)) ? Number(t.task_time) : null,
        catalogHours: t.task_time != null && Number.isFinite(Number(t.task_time)) ? Number(t.task_time) : null,
        implementer: t.task_implementer,
        source: "catalog" as const,
        groupLabel: null,
        isExtra: false,
      }));
  }

  return [];
}

/** Resolve editable tasks for a proposal line (catalog base + proposal-only layout). */
export function resolveProposalCardTasks(
  card: RoadmapCard,
  ctx: ProposalCardTasksCtx
): ProposalEditableTask[] {
  const layout = normalizeTaskLayout(card.taskLayout);
  const hidden = new Set(layout.hiddenIds ?? []);
  const hourOverrides = layout.hourOverrides ?? {};

  const base = baseTasksForCard(card, ctx)
    .filter((t) => !hidden.has(t.id))
    .map((t) => {
      if (!Object.prototype.hasOwnProperty.call(hourOverrides, t.id)) return t;
      const ov = hourOverrides[t.id];
      return {
        ...t,
        hours: ov != null && Number.isFinite(Number(ov)) ? Number(ov) : null,
      };
    });

  const extras: ProposalEditableTask[] = (layout.extras ?? []).map((e) => ({
    id: e.id,
    name: e.name.trim() || "Proposal task",
    hours: e.hours != null && Number.isFinite(e.hours) ? e.hours : null,
    catalogHours: null,
    implementer: e.implementer ?? null,
    source: "proposal" as const,
    groupLabel: null,
    isExtra: true,
  }));

  return [...base, ...extras];
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

function layoutIsEmpty(layout: RoadmapCardTaskLayout): boolean {
  return (
    (layout.hiddenIds?.length ?? 0) === 0 &&
    Object.keys(layout.hourOverrides ?? {}).length === 0 &&
    (layout.extras?.length ?? 0) === 0
  );
}

/** Apply a task layout mutation and sync `hoursOverride` from the resulting task hours sum. */
export function patchCardTaskLayout(
  card: RoadmapCard,
  ctx: ProposalCardTasksCtx,
  mutate: (layout: RoadmapCardTaskLayout) => RoadmapCardTaskLayout
): RoadmapCard {
  const nextLayout = mutate(normalizeTaskLayout(card.taskLayout));
  const cleaned = layoutIsEmpty(nextLayout) ? null : nextLayout;
  const withLayout: RoadmapCard = { ...card, taskLayout: cleaned };
  const tasks = resolveProposalCardTasks(withLayout, ctx);
  const total = sumProposalTaskHours(tasks);
  const hoursOverride =
    tasks.length === 0 && !cleaned
      ? null
      : Number.isInteger(total)
        ? String(total)
        : String(Math.round(total * 100) / 100);
  return {
    ...withLayout,
    // Keep proposal hours in sync with edited task totals; clear when layout is gone.
    hoursOverride: cleaned ? hoursOverride : null,
  };
}

export function hideProposalTask(card: RoadmapCard, ctx: ProposalCardTasksCtx, taskId: string): RoadmapCard {
  return patchCardTaskLayout(card, ctx, (layout) => {
    if (layout.extras?.some((e) => e.id === taskId)) {
      return {
        ...layout,
        extras: (layout.extras ?? []).filter((e) => e.id !== taskId),
      };
    }
    const hiddenIds = [...new Set([...(layout.hiddenIds ?? []), taskId])];
    const hourOverrides = { ...(layout.hourOverrides ?? {}) };
    delete hourOverrides[taskId];
    return { ...layout, hiddenIds, hourOverrides };
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
  return patchCardTaskLayout(card, ctx, (layout) => ({
    ...layout,
    extras: [...(layout.extras ?? []), extra],
  }));
}

export function renameProposalExtraTask(
  card: RoadmapCard,
  ctx: ProposalCardTasksCtx,
  taskId: string,
  name: string
): RoadmapCard {
  return patchCardTaskLayout(card, ctx, (layout) => {
    const extras = (layout.extras ?? []).map((e) =>
      e.id === taskId ? { ...e, name: name.trim() || e.name } : e
    );
    return { ...layout, extras };
  });
}

export function cardSupportsTaskReview(card: RoadmapCard): boolean {
  return card.kind === "tier" || card.kind === "package" || card.kind === "custom_tier";
}
