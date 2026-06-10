import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PackageExtraTaskRow,
  PackageSolutionTier,
  PackageTaskOverride,
  PackageTaskOverridesMap,
  TaskRow,
} from "../types";
import { mergeTaskWithPackageOverride, parseTaskOverridesMap } from "./packagePricingTaskOverrides";
import type { PackageLinkSavePayload } from "./packageTierLinkPersistence";
import { emptyPackageLinkPayload } from "./packageTierLinkPersistence";
import {
  expandTierQuantities,
  normalizeTierQuantity,
  tierIdsFromQuantities,
  type PackageTierQuantities,
} from "./packageTierQuantities";
import { persistTaskSortOrdersForTier } from "./persistTaskSortOrdersForTier";
import { compareTasksByOrder } from "./taskOrder";
import {
  extraTaskToTaskRow,
  parseTaskExtensions,
  pruneTaskOverridesForHidden,
  sanitizeTaskExtensionsForDb,
} from "./packageTaskLayout";

export type PackageUnifiedOrderEntry =
  | { k: "vault"; solution_tier_id: string; task_id: string }
  | { k: "extra"; package_task_id: string };

export type PackageCombinedTasksState = {
  order: PackageUnifiedOrderEntry[];
  hidden_vault: { solution_tier_id: string; task_id: string }[];
  extras: PackageExtraTaskRow[];
  task_patches: Record<string, PackageTaskOverride>;
};

function sortTierIds(a: string, b: string): number {
  const pa = a.split("-").map(Number);
  const pb = b.split("-").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return a.localeCompare(b);
}

export function patchKeyForVaultTask(tierId: string, taskId: string): string {
  return `${tierId}:::${taskId}`;
}

export function emptyCombinedTasksState(): PackageCombinedTasksState {
  return { order: [], hidden_vault: [], extras: [], task_patches: {} };
}

export function anchorTierForPackage(tierIds: string[]): string {
  if (tierIds.length === 0) return "";
  return [...tierIds].sort(sortTierIds)[0] ?? "";
}

export function defaultCombinedTasksForTiers(tierIds: string[], vaultTasks: TaskRow[]): PackageCombinedTasksState {
  const order: PackageUnifiedOrderEntry[] = [];
  for (const tid of [...tierIds].sort(sortTierIds)) {
    const vault = vaultTasks.filter((t) => t.solution_tier_id === tid).sort(compareTasksByOrder);
    for (const t of vault) {
      order.push({ k: "vault", solution_tier_id: tid, task_id: t.task_id });
    }
  }
  return { order, hidden_vault: [], extras: [], task_patches: {} };
}

/** When tier membership or quantities change, rebuild vault task order and preserve extras/patches. */
export function reconcileCombinedTasksForTierSelection(
  prev: PackageCombinedTasksState,
  quantities: PackageTierQuantities,
  vaultTasks: TaskRow[]
): PackageCombinedTasksState {
  const activeTids = new Set(tierIdsFromQuantities(quantities));
  const hidden_vault = prev.hidden_vault.filter((h) => activeTids.has(h.solution_tier_id));
  const extras = prev.extras;
  const extraOrder = prev.order.filter((e) => e.k === "extra");
  const vaultOrder = defaultCombinedTasksForTiers(expandTierQuantities(quantities), vaultTasks).order;
  const task_patches: Record<string, PackageTaskOverride> = {};
  for (const [key, patch] of Object.entries(prev.task_patches)) {
    const tid = key.split(":::")[0];
    if (tid && activeTids.has(tid)) task_patches[key] = patch;
  }
  return {
    order: [...vaultOrder, ...extraOrder],
    hidden_vault,
    extras,
    task_patches,
  };
}

export function parsePackageCombinedTasks(raw: unknown): PackageCombinedTasksState | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const orderRaw = o.order;
  const hiddenRaw = o.hidden_vault;
  const extrasRaw = o.extras;
  const patchesRaw = o.task_patches;
  const order: PackageUnifiedOrderEntry[] = [];
  if (Array.isArray(orderRaw)) {
    for (const item of orderRaw) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      if (r.k === "vault" && typeof r.solution_tier_id === "string" && typeof r.task_id === "string") {
        order.push({ k: "vault", solution_tier_id: r.solution_tier_id, task_id: r.task_id });
      } else if (r.k === "extra" && typeof r.package_task_id === "string") {
        order.push({ k: "extra", package_task_id: r.package_task_id });
      }
    }
  }
  const hidden_vault: { solution_tier_id: string; task_id: string }[] = [];
  if (Array.isArray(hiddenRaw)) {
    for (const item of hiddenRaw) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      if (typeof r.solution_tier_id === "string" && typeof r.task_id === "string") {
        hidden_vault.push({ solution_tier_id: r.solution_tier_id, task_id: r.task_id });
      }
    }
  }
  const extras: PackageExtraTaskRow[] = [];
  if (Array.isArray(extrasRaw)) {
    for (const item of extrasRaw) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      const pid = r.package_task_id;
      if (typeof pid !== "string" || !pid.trim()) continue;
      extras.push({
        package_task_id: pid.trim(),
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
  }
  const task_patches: Record<string, PackageTaskOverride> = {};
  if (patchesRaw && typeof patchesRaw === "object" && !Array.isArray(patchesRaw)) {
    for (const [key, val] of Object.entries(patchesRaw)) {
      if (!key || typeof val !== "object" || val === null || Array.isArray(val)) continue;
      task_patches[key] = val as PackageTaskOverride;
    }
  }
  return { order, hidden_vault, extras, task_patches };
}

export function sanitizePackageCombinedTasksForDb(s: PackageCombinedTasksState): Record<string, unknown> {
  return {
    order: s.order,
    hidden_vault: s.hidden_vault,
    ...sanitizeTaskExtensionsForDb({ hidden_task_ids: [], extra_tasks: s.extras }),
    task_patches: s.task_patches,
  };
}

/** Rebuild unified task state from legacy `package_solution_tiers` rows (pre–Package Builder v2). */
export function deriveCombinedTasksFromLegacyLinks(
  tierIds: string[],
  tasks: TaskRow[],
  linksByTierId: Map<string, PackageSolutionTier>
): PackageCombinedTasksState {
  const order: PackageUnifiedOrderEntry[] = [];
  const hidden_vault: { solution_tier_id: string; task_id: string }[] = [];
  const extras: PackageExtraTaskRow[] = [];
  const task_patches: Record<string, PackageTaskOverride> = {};
  const extrasSeen = new Set<string>();

  for (const tid of [...tierIds].sort(sortTierIds)) {
    const link = linksByTierId.get(tid);
    const qty = normalizeTierQuantity(link?.quantity);
    const ext = parseTaskExtensions(link?.task_extensions);
    const hiddenSet = new Set(ext.hidden_task_ids ?? []);
    for (const id of hiddenSet) hidden_vault.push({ solution_tier_id: tid, task_id: id });
    const vault = tasks.filter((t) => t.solution_tier_id === tid).sort(compareTasksByOrder);
    for (let copy = 0; copy < qty; copy++) {
      for (const t of vault) {
        if (hiddenSet.has(t.task_id)) continue;
        order.push({ k: "vault", solution_tier_id: tid, task_id: t.task_id });
      }
    }
    const ov = parseTaskOverridesMap(link?.task_overrides);
    for (const [taskId, p] of Object.entries(ov)) {
      task_patches[patchKeyForVaultTask(tid, taskId)] = { ...p };
    }
    for (const row of ext.extra_tasks ?? []) {
      if (!extrasSeen.has(row.package_task_id)) {
        extrasSeen.add(row.package_task_id);
        extras.push(row);
      }
      order.push({ k: "extra", package_task_id: row.package_task_id });
    }
  }

  return { order, hidden_vault, extras, task_patches };
}

export function vaultHiddenIdsForTier(tierId: string, vaultTasks: TaskRow[], state: PackageCombinedTasksState): string[] {
  const hid = new Set<string>();
  for (const h of state.hidden_vault) {
    if (h.solution_tier_id === tierId) hid.add(h.task_id);
  }
  const allVaultIds = vaultTasks.filter((t) => t.solution_tier_id === tierId).map((t) => t.task_id);
  const visible = new Set(
    state.order
      .filter(
        (e): e is Extract<PackageUnifiedOrderEntry, { k: "vault" }> =>
          e.k === "vault" && e.solution_tier_id === tierId
      )
      .map((e) => e.task_id)
  );
  for (const id of allVaultIds) {
    if (!visible.has(id)) hid.add(id);
  }
  return [...hid];
}

function overridesForTier(tierId: string, patches: Record<string, PackageTaskOverride>): PackageTaskOverridesMap {
  const prefix = `${tierId}:::`;
  const out: PackageTaskOverridesMap = {};
  for (const [key, patch] of Object.entries(patches)) {
    if (!key.startsWith(prefix)) continue;
    const taskId = key.slice(prefix.length);
    if (!taskId) continue;
    out[taskId] = patch;
  }
  return out;
}

export function packageCombinedTasksToLinkPayloads(
  state: PackageCombinedTasksState,
  tierIds: string[],
  vaultTasks: TaskRow[]
): Record<string, PackageLinkSavePayload> {
  const anchor = anchorTierForPackage(tierIds);
  const payloads: Record<string, PackageLinkSavePayload> = {};
  for (const tid of tierIds) {
    const hiddenSet = new Set(vaultHiddenIdsForTier(tid, vaultTasks, state));
    const rawOv = overridesForTier(tid, state.task_patches);
    const task_overrides = pruneTaskOverridesForHidden(rawOv, hiddenSet);
    const extra_tasks = tid === anchor ? state.extras : [];
    payloads[tid] = {
      tier_overrides: {},
      pricing_overrides: {},
      task_overrides,
      task_extensions: {
        hidden_task_ids: [...hiddenSet],
        extra_tasks,
      },
    };
  }
  for (const tid of tierIds) {
    if (!payloads[tid]) payloads[tid] = emptyPackageLinkPayload();
  }
  return payloads;
}

export function unifiedTasksToRows(
  state: PackageCombinedTasksState,
  vaultTasks: TaskRow[],
  anchorTierIdForExtras: string
): TaskRow[] {
  const byTaskId = new Map(vaultTasks.map((t) => [t.task_id, t]));
  const extrasById = new Map(state.extras.map((e) => [e.package_task_id, e]));
  const hidden = new Set(state.hidden_vault.map((h) => patchKeyForVaultTask(h.solution_tier_id, h.task_id)));
  const out: TaskRow[] = [];

  for (const e of state.order) {
    if (e.k === "vault") {
      if (hidden.has(patchKeyForVaultTask(e.solution_tier_id, e.task_id))) continue;
      const base = byTaskId.get(e.task_id);
      if (!base || base.solution_tier_id !== e.solution_tier_id) continue;
      const p = state.task_patches[patchKeyForVaultTask(e.solution_tier_id, e.task_id)];
      out.push(p && Object.keys(p).length > 0 ? mergeTaskWithPackageOverride(base, p) : base);
    } else {
      const row = extrasById.get(e.package_task_id);
      if (!row) continue;
      out.push(extraTaskToTaskRow(anchorTierIdForExtras, row));
    }
  }
  return out;
}

export async function persistVaultOrdersFromUnifiedState(
  client: SupabaseClient,
  state: PackageCombinedTasksState,
  tierIds: string[],
  vaultTasks: TaskRow[]
): Promise<string | null> {
  for (const tid of tierIds) {
    const orderedVaultIds = state.order
      .filter(
        (e): e is Extract<PackageUnifiedOrderEntry, { k: "vault" }> =>
          e.k === "vault" && e.solution_tier_id === tid
      )
      .map((e) => e.task_id);
    const hiddenIds = vaultHiddenIdsForTier(tid, vaultTasks, state);
    const hiddenSorted = vaultTasks
      .filter((t) => t.solution_tier_id === tid && hiddenIds.includes(t.task_id))
      .sort(compareTasksByOrder)
      .map((t) => t.task_id);
    const res = await persistTaskSortOrdersForTier(client, tid, [...orderedVaultIds, ...hiddenSorted]);
    if (!res.ok) return res.message ?? "Failed updating task order.";
  }
  return null;
}
