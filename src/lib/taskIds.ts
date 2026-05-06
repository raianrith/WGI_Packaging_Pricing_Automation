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
