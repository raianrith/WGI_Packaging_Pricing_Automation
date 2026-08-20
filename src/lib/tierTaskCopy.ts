import type { SupabaseClient } from "@supabase/supabase-js";
import type { SolutionTier, TaskRow } from "../types";
import { insertAuditLog } from "./audit";
import { todayISODate } from "./dates";
import { getSupabase } from "./supabase";
import { friendlyMutationMessage } from "./supabaseErrors";
import { syncTierPricingFromTasks } from "./syncTierPricingFromTasks";
import { fetchAllTaskIdRows, nextAutoTaskId } from "./taskIds";
import { compareTasksByOrder, tierMaxSortOrder } from "./taskOrder";

function rowJson(row: object): Record<string, unknown> {
  return JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
}

type LogAudit = (
  client: SupabaseClient,
  p: Parameters<typeof insertAuditLog>[1]
) => Promise<void>;

/** First line tagging tasks copied from another tier vault (used for SOURCE UI + attribution). */
export function attributionLineForTierCopy(sourceTierId: string, sourceTierName: string): string {
  return `Copied from tier ${sourceTierId} (${sourceTierName}).`;
}

/** Prepend attribution; keep original notes below when present. */
export function mergeTaskNotesWithTierAttribution(
  originalNotes: string | null | undefined,
  sourceTierId: string,
  sourceTierDisplayName: string
): string | null {
  const line = attributionLineForTierCopy(sourceTierId, sourceTierDisplayName);
  const base = (originalNotes ?? "").trim();
  if (!base) return line;
  return `${line}\n\n${base}`;
}

/** Readable badge for Tasks table SOURCE column — first line if it matches tier-copy pattern. */
export function tierCopySourceLabelFromNotes(notes: string | null | undefined): string | null {
  const raw = notes?.trim() ?? "";
  const head = raw.split(/\n/)[0]?.trim() ?? "";
  return head.startsWith("Copied from tier ") ? head : null;
}

export function tasksOnTierSorted(allTasks: TaskRow[], tierId: string): TaskRow[] {
  return allTasks.filter((t) => t.solution_tier_id === tierId).sort(compareTasksByOrder);
}

export function sourceTierMeta(
  tiers: SolutionTier[],
  sourceTierId: string
): { id: string; name: string } {
  const t = tiers.find((x) => x.solution_tier_id === sourceTierId);
  return { id: sourceTierId, name: t?.solution_tier_name ?? sourceTierId };
}

export type DraftFieldsFromVaultTask = {
  name: string;
  impl: string;
  time: string;
  dur: string;
  dep: string;
  notes: string;
  source: string;
};

/** Map vault tasks → draft-task fields (Solutions Builder drafts / bulk-add table). */
export function draftFieldsFromTierVaultTasks(
  allTasks: TaskRow[],
  sourceTierId: string,
  sourceTierDisplayName: string
): DraftFieldsFromVaultTask[] {
  const sorted = tasksOnTierSorted(allTasks, sourceTierId);
  const srcLabel = `${sourceTierId} — ${sourceTierDisplayName}`;
  return sorted.map((t) => ({
    name: t.task_name,
    impl: t.task_implementer?.trim() ?? "",
    time: t.task_time != null && Number.isFinite(Number(t.task_time)) ? String(t.task_time) : "",
    dur: t.task_duration != null && Number.isFinite(Number(t.task_duration)) ? String(t.task_duration) : "",
    dep: (t.task_dependencies ?? "").trim(),
    notes: mergeTaskNotesWithTierAttribution(t.task_notes, sourceTierId, sourceTierDisplayName) ?? "",
    source: `Copied from ${srcLabel}`,
  }));
}

/**
 * Insert new vault tasks on `targetTierId` cloning field values from the source tier’s tasks (new ids).
 */
export async function insertCopiedVaultTasksFromTier(params: {
  targetTierId: string;
  sourceTierId: string;
  allTasks: TaskRow[];
  tiers: SolutionTier[];
  logAudit: LogAudit;
}): Promise<{ ok: true; created: number } | { ok: false; message: string }> {
  const client = getSupabase();
  if (!client) return { ok: false, message: "Supabase client is not available." };

  if (params.sourceTierId === params.targetTierId) {
    return { ok: false, message: "Choose a different tier to copy from (source and target must differ)." };
  }

  const { name: sourceName } = sourceTierMeta(params.tiers, params.sourceTierId);
  const sourceRows = tasksOnTierSorted(params.allTasks, params.sourceTierId);
  if (sourceRows.length === 0) {
    return { ok: false, message: "That tier has no tasks to copy." };
  }

  const today = todayISODate();
  const { rows: seedTaskIds, error: seedErr } = await fetchAllTaskIdRows(client);
  if (seedErr) return { ok: false, message: friendlyMutationMessage(seedErr) };
  let localTasks = [...seedTaskIds];
  const baseMax = tierMaxSortOrder(params.allTasks, params.targetTierId);

  try {
    for (let i = 0; i < sourceRows.length; i++) {
      const src = sourceRows[i]!;
      const id = nextAutoTaskId(localTasks);
      const notes = mergeTaskNotesWithTierAttribution(src.task_notes, params.sourceTierId, sourceName);
      const sortOrder = baseMax + i + 1;
      const row: TaskRow = {
        task_id: id,
        solution_tier_id: params.targetTierId,
        sort_order: sortOrder,
        task_name: src.task_name,
        task_implementer: src.task_implementer,
        task_time: src.task_time,
        task_duration: src.task_duration,
        task_dependencies: src.task_dependencies,
        task_notes: notes,
        task_create_date: today,
        task_modified_date: today,
      };

      const insertPayload = {
        task_id: row.task_id,
        solution_tier_id: row.solution_tier_id,
        sort_order: sortOrder,
        task_name: row.task_name,
        task_implementer: row.task_implementer,
        task_time: row.task_time,
        task_duration: row.task_duration,
        task_dependencies: row.task_dependencies,
        task_notes: row.task_notes,
        task_create_date: row.task_create_date,
        task_modified_date: row.task_modified_date,
      };

      const { error } = await client.from("tasks").insert(insertPayload);
      if (error) {
        return { ok: false, message: friendlyMutationMessage(error.message) };
      }
      await params.logAudit(client, {
        entityType: "tasks",
        entityId: id,
        action: "insert",
        before: null,
        after: rowJson(row),
      });
      localTasks.push(row);
    }

    const pricingSync = await syncTierPricingFromTasks({
      client,
      tierIds: params.targetTierId,
      logAudit: params.logAudit,
    });
    if (!pricingSync.ok) {
      return {
        ok: false,
        message: `Tasks were copied, but pricing could not be updated: ${pricingSync.message}`,
      };
    }

    return { ok: true, created: sourceRows.length };
  } catch (e) {
    return { ok: false, message: friendlyMutationMessage(String(e)) };
  }
}
