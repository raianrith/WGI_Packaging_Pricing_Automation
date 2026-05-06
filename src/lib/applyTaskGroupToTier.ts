import type { SupabaseClient } from "@supabase/supabase-js";
import { insertAuditLog } from "./audit";
import { todayISODate } from "./dates";
import { getSupabase } from "./supabase";
import { friendlyMutationMessage } from "./supabaseErrors";
import { nextAutoTaskId } from "./taskIds";
import { resolveTemplateLineToTaskFields } from "./taskGroupTemplateTaskFields";
import type { TaskGroupLineRow, TaskRow } from "../types";
import { tierMaxSortOrder } from "./taskOrder";

function rowJson(row: object): Record<string, unknown> {
  return JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
}

type LogAudit = (
  client: SupabaseClient,
  p: Parameters<typeof insertAuditLog>[1]
) => Promise<void>;

/**
 * Inserts one new `tasks` row per template line for the given tier.
 * Records a row in `solution_tier_task_group_applied` and links tasks via lineage columns.
 */
export async function applyTaskGroupToTier(params: {
  solution_tier_id: string;
  task_group_id: string;
  lines: TaskGroupLineRow[];
  allTasks: TaskRow[];
  logAudit: LogAudit;
}): Promise<{ ok: true; created: number } | { ok: false; message: string }> {
  const client = getSupabase();
  if (!client) return { ok: false, message: "Supabase client not available." };

  const sorted = [...params.lines].sort((a, b) => a.sort_order - b.sort_order);
  if (sorted.length === 0) return { ok: false, message: "This task group has no lines." };

  const { data: appRow, error: appErr } = await client
    .from("solution_tier_task_group_applied")
    .insert({
      solution_tier_id: params.solution_tier_id,
      task_group_id: params.task_group_id,
    })
    .select("id")
    .single();

  if (appErr) {
    return { ok: false, message: friendlyMutationMessage(appErr.message) };
  }

  const applicationId = String(appRow?.id ?? "");
  if (!applicationId) {
    return { ok: false, message: "Could not create apply record." };
  }

  const today = todayISODate();
  let localTasks = [...params.allTasks];
  const insertedTaskIds: string[] = [];
  let baseSort = tierMaxSortOrder(params.allTasks, params.solution_tier_id);

  const rollbackPartial = async () => {
    if (insertedTaskIds.length > 0) {
      await client.from("tasks").delete().in("task_id", insertedTaskIds);
    }
    await client.from("solution_tier_task_group_applied").delete().eq("id", applicationId);
  };

  try {
    for (let lineIdx = 0; lineIdx < sorted.length; lineIdx++) {
      const line = sorted[lineIdx]!;
      baseSort += 1;
      const id = nextAutoTaskId(localTasks);
      const resolved = resolveTemplateLineToTaskFields(line, localTasks);
      if ("error" in resolved) {
        await rollbackPartial();
        return { ok: false, message: resolved.error };
      }

      const row: TaskRow = {
        task_id: id,
        solution_tier_id: params.solution_tier_id,
        ...resolved,
        sort_order: baseSort,
        task_create_date: today,
        task_modified_date: today,
        task_group_application_id: applicationId,
        spawned_from_task_group_line_id: line.id,
      };

      const insertPayload = {
        task_id: row.task_id,
        solution_tier_id: row.solution_tier_id,
        sort_order: baseSort,
        task_name: row.task_name,
        task_implementer: row.task_implementer,
        task_time: row.task_time,
        task_duration: row.task_duration,
        task_dependencies: row.task_dependencies,
        task_notes: row.task_notes,
        task_create_date: row.task_create_date,
        task_modified_date: row.task_modified_date,
        task_group_application_id: applicationId,
        spawned_from_task_group_line_id: line.id,
      };

      const { error } = await client.from("tasks").insert(insertPayload);
      if (error) {
        await rollbackPartial();
        return { ok: false, message: friendlyMutationMessage(error.message) };
      }

      await params.logAudit(client, {
        entityType: "tasks",
        entityId: id,
        action: "insert",
        before: null,
        after: rowJson(row),
      });
      insertedTaskIds.push(id);
      localTasks.push(row);
    }

    await params.logAudit(client, {
      entityType: "solution_tier_task_group_applied",
      entityId: applicationId,
      action: "insert",
      before: null,
      after: rowJson({
        solution_tier_id: params.solution_tier_id,
        task_group_id: params.task_group_id,
      }),
    });

    return { ok: true, created: sorted.length };
  } catch (e) {
    await rollbackPartial();
    return { ok: false, message: friendlyMutationMessage(String(e)) };
  }
}
