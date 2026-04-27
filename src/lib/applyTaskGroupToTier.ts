import type { SupabaseClient } from "@supabase/supabase-js";
import { insertAuditLog } from "./audit";
import { todayISODate } from "./dates";
import { getSupabase } from "./supabase";
import { friendlyMutationMessage } from "./supabaseErrors";
import { nextAutoTaskId } from "./taskIds";
import type { TaskGroupLineRow, TaskRow } from "../types";

function rowJson(row: object): Record<string, unknown> {
  return JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
}

type LogAudit = (
  client: SupabaseClient,
  p: Parameters<typeof insertAuditLog>[1]
) => Promise<void>;

/**
 * Inserts one new `tasks` row per template line for the given tier.
 * Records a row in `solution_tier_task_group_applied`.
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

  const today = todayISODate();
  let localTasks = [...params.allTasks];

  for (const line of sorted) {
    const id = nextAutoTaskId(localTasks);
    let row: TaskRow;

    if (line.line_type === "copy_from_task" && line.source_task_id) {
      const src = localTasks.find((t) => t.task_id === line.source_task_id);
      if (!src) {
        return {
          ok: false,
          message: `Template line references missing task ${line.source_task_id}. Refresh data or fix the template.`,
        };
      }
      row = {
        task_id: id,
        solution_tier_id: params.solution_tier_id,
        task_name: src.task_name,
        task_implementer: src.task_implementer,
        task_time: src.task_time,
        task_duration: src.task_duration,
        task_dependencies: src.task_dependencies,
        task_notes: src.task_notes,
        task_create_date: today,
        task_modified_date: today,
      };
    } else {
      row = {
        task_id: id,
        solution_tier_id: params.solution_tier_id,
        task_name: line.task_name.trim(),
        task_implementer: line.task_implementer?.trim() ? line.task_implementer.trim() : null,
        task_time: line.hours,
        task_duration: null,
        task_dependencies: null,
        task_notes: null,
        task_create_date: today,
        task_modified_date: today,
      };
    }

    const { error } = await client.from("tasks").insert(row);
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

  await params.logAudit(client, {
    entityType: "solution_tier_task_group_applied",
    entityId: String(appRow?.id ?? ""),
    action: "insert",
    before: null,
    after: rowJson({
      solution_tier_id: params.solution_tier_id,
      task_group_id: params.task_group_id,
    }),
  });

  return { ok: true, created: sorted.length };
}
