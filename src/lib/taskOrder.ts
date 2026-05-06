import type { TaskRow } from "../types";

/** Compare function for vault tasks within one tier (`sort_order` then `task_id`). */
export function compareTasksByOrder(a: TaskRow, b: TaskRow): number {
  const key = (t: TaskRow): number => {
    const o = t.sort_order;
    if (o == null || !Number.isFinite(Number(o))) return Number.POSITIVE_INFINITY;
    return Number(o);
  };
  const ka = key(a);
  const kb = key(b);
  if (ka !== kb) return ka - kb;
  return a.task_id.localeCompare(b.task_id, undefined, { numeric: true });
}

export function tierMaxSortOrder(allTasks: TaskRow[], tierId: string): number {
  let m = 0;
  for (const t of allTasks) {
    if (t.solution_tier_id !== tierId) continue;
    const o = t.sort_order;
    if (o != null && Number.isFinite(Number(o))) m = Math.max(m, Number(o));
  }
  return m;
}
