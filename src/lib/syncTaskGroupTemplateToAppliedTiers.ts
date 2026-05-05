import type { SupabaseClient } from "@supabase/supabase-js";
import { insertAuditLog } from "./audit";
import { todayISODate } from "./dates";
import { getSupabase } from "./supabase";
import { friendlyMutationMessage } from "./supabaseErrors";
import { resolveTemplateLineToTaskFields } from "./taskGroupTemplateTaskFields";
import type { TaskGroupLineRow, TaskRow } from "../types";

function rowJson(row: object): Record<string, unknown> {
  return JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
}

type LogAudit = (
  client: SupabaseClient,
  p: Parameters<typeof insertAuditLog>[1]
) => Promise<void>;

/**
 * Updates vault `tasks` that were created from this task group template (see lineage columns
 * on `tasks` and `tasks_task_group_lineage.sql`). Skips apply batches that predate lineage.
 */
export async function syncTaskGroupTemplateToAppliedTiers(params: {
  task_group_id: string;
  lines: TaskGroupLineRow[];
  allTasks: TaskRow[];
  logAudit: LogAudit;
  /** When set, only application batches for these `solution_tier_id` values are synced. */
  solutionTierIds?: string[] | null;
}): Promise<
  | { ok: true; updated: number; skippedSlots: number }
  | { ok: false; message: string }
> {
  const client = getSupabase();
  if (!client) return { ok: false, message: "Supabase client not available." };

  const sorted = [...params.lines].sort((a, b) => a.sort_order - b.sort_order);
  if (sorted.length === 0) {
    return { ok: false, message: "This task group has no lines." };
  }

  const { data: apps, error: appErr } = await client
    .from("solution_tier_task_group_applied")
    .select("id, solution_tier_id")
    .eq("task_group_id", params.task_group_id);

  if (appErr) {
    return { ok: false, message: friendlyMutationMessage(appErr.message) };
  }

  let applicationRows = apps ?? [];
  if (params.solutionTierIds != null && params.solutionTierIds.length > 0) {
    const allow = new Set(params.solutionTierIds);
    applicationRows = applicationRows.filter((a) => allow.has(a.solution_tier_id));
  }
  if (applicationRows.length === 0) {
    return { ok: true, updated: 0, skippedSlots: 0 };
  }

  const appIds = applicationRows.map((a) => a.id);
  const { data: spawnTasks, error: stErr } = await client
    .from("tasks")
    .select("*")
    .in("task_group_application_id", appIds);

  if (stErr) {
    return { ok: false, message: friendlyMutationMessage(stErr.message) };
  }

  const taskMap = new Map<string, TaskRow>();
  for (const t of spawnTasks ?? []) {
    const tr = t as TaskRow;
    if (tr.task_group_application_id && tr.spawned_from_task_group_line_id) {
      taskMap.set(`${tr.task_group_application_id}:${tr.spawned_from_task_group_line_id}`, tr);
    }
  }

  const today = todayISODate();
  let updated = 0;
  let skippedSlots = 0;

  for (const app of applicationRows) {
    for (const line of sorted) {
      const task = taskMap.get(`${app.id}:${line.id}`);
      if (!task) {
        skippedSlots += 1;
        continue;
      }

      const resolved = resolveTemplateLineToTaskFields(line, params.allTasks);
      if ("error" in resolved) {
        return { ok: false, message: resolved.error };
      }

      const payload = {
        ...resolved,
        task_modified_date: today,
      };

      const { error: upErr } = await client.from("tasks").update(payload).eq("task_id", task.task_id);
      if (upErr) {
        return { ok: false, message: friendlyMutationMessage(upErr.message) };
      }

      const after: TaskRow = { ...task, ...payload };
      await params.logAudit(client, {
        entityType: "tasks",
        entityId: task.task_id,
        action: "update",
        before: rowJson(task),
        after: rowJson(after),
      });
      updated += 1;
    }
  }

  return { ok: true, updated, skippedSlots };
}
