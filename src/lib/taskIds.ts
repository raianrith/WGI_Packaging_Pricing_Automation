import type { SupabaseClient } from "@supabase/supabase-js";
import type { TaskRow } from "../types";

/** Next id in the `4-n` sequence for tasks (global across all tiers). */
export function nextAutoTaskId(tasks: readonly Pick<TaskRow, "task_id">[]): string {
  let max = 0;
  const re = /^4-(\d+)$/i;
  for (const k of tasks) {
    const m = k.task_id.trim().match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `4-${max + 1}`;
}

/**
 * Fetch every `task_id` (paginated). Plain `.select()` is capped by Supabase (~1000 rows),
 * which makes `nextAutoTaskId` collide once the vault grows past that limit.
 */
export async function fetchAllTaskIdRows(
  client: SupabaseClient
): Promise<{ rows: Pick<TaskRow, "task_id">[]; error: string | null }> {
  const pageSize = 1000;
  const rows: Pick<TaskRow, "task_id">[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await client
      .from("tasks")
      .select("task_id")
      .range(from, from + pageSize - 1);
    if (error) return { rows, error: error.message };
    const batch = (data ?? []) as Pick<TaskRow, "task_id">[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return { rows, error: null };
}

/**
 * Fetch every task row (paginated). Plain `.select("*")` is capped by Supabase (~1000 rows),
 * so later tiers (e.g. Copy XL) can appear to have zero tasks in the UI.
 */
export async function fetchAllTaskRows(
  client: SupabaseClient
): Promise<{ rows: TaskRow[]; error: string | null }> {
  const pageSize = 1000;
  const rows: TaskRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await client
      .from("tasks")
      .select("*")
      .order("task_id")
      .range(from, from + pageSize - 1);
    if (error) return { rows, error: error.message };
    const batch = (data ?? []) as TaskRow[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return { rows, error: null };
}
