import type {
  PackageExtraTaskRow,
  PackageTaskExtensions,
  PackageTaskOverridesMap,
  SolutionTier,
  TaskGroupLineRow,
  TaskRow,
} from "../types";
import { mergeTaskWithPackageOverride } from "./packagePricingTaskOverrides";
import { compareTasksByOrder } from "./taskOrder";
import { mergeTaskNotesWithTierAttribution, sourceTierMeta, tasksOnTierSorted } from "./tierTaskCopy";

export function newPackageTaskId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return `pkg-extra-${c.randomUUID()}`;
  return `pkg-extra-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyTaskExtensions(): PackageTaskExtensions {
  return { hidden_task_ids: [], extra_tasks: [] };
}

export function parseTaskExtensions(raw: unknown): PackageTaskExtensions {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return emptyTaskExtensions();
  const o = raw as Record<string, unknown>;
  const hidden = o.hidden_task_ids;
  const extra = o.extra_tasks;
  const out: PackageTaskExtensions = { hidden_task_ids: [], extra_tasks: [] };
  if (Array.isArray(hidden)) {
    out.hidden_task_ids = hidden.filter((x): x is string => typeof x === "string" && x.length > 0);
  }
  if (Array.isArray(extra)) {
    const rows: PackageExtraTaskRow[] = [];
    for (const item of extra) {
      if (typeof item !== "object" || item == null) continue;
      const r = item as Record<string, unknown>;
      const id = r.package_task_id;
      if (typeof id !== "string" || !id.trim()) continue;
      rows.push({
        package_task_id: id.trim(),
        task_name: typeof r.task_name === "string" ? r.task_name : "",
        task_implementer: typeof r.task_implementer === "string" ? r.task_implementer : null,
        task_time:
          typeof r.task_time === "number" && Number.isFinite(r.task_time)
            ? r.task_time
            : r.task_time === null
              ? null
              : null,
        task_duration:
          typeof r.task_duration === "number" && Number.isFinite(r.task_duration)
            ? r.task_duration
            : r.task_duration === null
              ? null
              : null,
        task_dependencies: typeof r.task_dependencies === "string" ? r.task_dependencies : null,
        task_notes: typeof r.task_notes === "string" ? r.task_notes : null,
      });
    }
    out.extra_tasks = rows;
  }
  return out;
}

export function sanitizeTaskExtensionsForDb(ext: PackageTaskExtensions | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const hidden = ext?.hidden_task_ids?.filter(Boolean) ?? [];
  const extra = ext?.extra_tasks?.filter((e) => e.package_task_id && e.task_name.trim()) ?? [];
  if (hidden.length) out.hidden_task_ids = hidden;
  if (extra.length) {
    out.extra_tasks = extra.map((e) => ({
      package_task_id: e.package_task_id,
      task_name: e.task_name.trim(),
      task_implementer: e.task_implementer?.trim() ? e.task_implementer.trim() : null,
      task_time: e.task_time != null && Number.isFinite(e.task_time) ? e.task_time : null,
      task_duration: e.task_duration != null && Number.isFinite(e.task_duration) ? e.task_duration : null,
      task_dependencies: e.task_dependencies?.trim() ? e.task_dependencies.trim() : null,
      task_notes: e.task_notes?.trim() ? e.task_notes.trim() : null,
    }));
  }
  return out;
}

/** Synthetic `TaskRow` for Agency / rollups (not persisted on `tasks`). */
export function extraTaskToTaskRow(tierId: string, e: PackageExtraTaskRow): TaskRow {
  const placeholder = "1970-01-01";
  return {
    task_id: e.package_task_id,
    solution_tier_id: tierId,
    task_name: e.task_name.trim() || "Package task",
    task_implementer: e.task_implementer?.trim() ? e.task_implementer.trim() : null,
    task_time: e.task_time != null && Number.isFinite(e.task_time) ? e.task_time : null,
    task_duration: e.task_duration != null && Number.isFinite(e.task_duration) ? e.task_duration : null,
    task_dependencies: e.task_dependencies?.trim() ? e.task_dependencies.trim() : null,
    task_notes: e.task_notes?.trim() ? e.task_notes.trim() : null,
    task_create_date: placeholder,
    task_modified_date: placeholder,
  };
}

export function buildMergedTaskRowsForPackageTier(args: {
  tierId: string;
  vaultTasks: TaskRow[];
  taskOverrides: PackageTaskOverridesMap | null | undefined;
  taskExtensions: PackageTaskExtensions | null | undefined;
  /** When set, package-only `extra_tasks` render only for this tier (catalog / agency). */
  packageExtrasAnchorTierId?: string | null;
}): TaskRow[] {
  const hidden = new Set(args.taskExtensions?.hidden_task_ids ?? []);
  const ov = args.taskOverrides ?? {};
  const base = args.vaultTasks
    .filter((t) => t.solution_tier_id === args.tierId && !hidden.has(t.task_id))
    .sort(compareTasksByOrder)
    .map((t) => mergeTaskWithPackageOverride(t, ov[t.task_id]));
  const showExtras =
    args.packageExtrasAnchorTierId == null || args.packageExtrasAnchorTierId === args.tierId;
  const extras = showExtras
    ? (args.taskExtensions?.extra_tasks ?? []).map((e) => extraTaskToTaskRow(args.tierId, e))
    : [];
  return [...base, ...extras];
}

/** Package-only extras built from vault tasks on another tier (copy for overlay). */
export function materializeTierVaultTasksToPackageExtraTasks(
  allTasks: TaskRow[],
  sourceTierId: string,
  tiers: SolutionTier[]
): PackageExtraTaskRow[] {
  const { name } = sourceTierMeta(tiers, sourceTierId);
  const vault = tasksOnTierSorted(allTasks, sourceTierId);
  const out: PackageExtraTaskRow[] = [];
  for (const t of vault) {
    out.push({
      package_task_id: newPackageTaskId(),
      task_name: t.task_name,
      task_implementer: t.task_implementer,
      task_time: t.task_time,
      task_duration: t.task_duration,
      task_dependencies: t.task_dependencies,
      task_notes: mergeTaskNotesWithTierAttribution(t.task_notes, sourceTierId, name),
    });
  }
  return out;
}

export function materializeTaskGroupToPackageExtraTasks(
  lines: TaskGroupLineRow[],
  allTasks: TaskRow[]
): PackageExtraTaskRow[] {
  const sorted = [...lines].sort((a, b) => a.sort_order - b.sort_order);
  const out: PackageExtraTaskRow[] = [];
  for (const line of sorted) {
    const package_task_id = newPackageTaskId();
    if (line.line_type === "copy_from_task" && line.source_task_id) {
      const src = allTasks.find((t) => t.task_id === line.source_task_id);
      if (!src) continue;
      out.push({
        package_task_id,
        task_name: src.task_name,
        task_implementer: src.task_implementer,
        task_time: src.task_time,
        task_duration: src.task_duration,
        task_dependencies: src.task_dependencies,
        task_notes: src.task_notes,
      });
    } else {
      out.push({
        package_task_id,
        task_name: line.task_name.trim() || "Task",
        task_implementer: line.task_implementer?.trim() ? line.task_implementer.trim() : null,
        task_time: line.hours != null && Number.isFinite(line.hours) ? line.hours : null,
        task_duration: null,
        task_dependencies: null,
        task_notes: null,
      });
    }
  }
  return out;
}

export function pruneTaskOverridesForHidden(
  map: PackageTaskOverridesMap,
  hidden: Set<string>
): PackageTaskOverridesMap {
  const next: PackageTaskOverridesMap = { ...map };
  for (const id of hidden) delete next[id];
  return next;
}
