/** Next id in the `2-n` sequence for solutions. */
export function nextAutoSolutionId(rows: readonly { solution_id: string }[]): string {
  let max = 0;
  const re = /^2-(\d+)$/i;
  for (const s of rows) {
    const m = s.solution_id.trim().match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `2-${max + 1}`;
}

/** Next id in the `3-n` sequence for solution tiers (global across all solutions). */
export function nextAutoTierId(rows: readonly { solution_tier_id: string }[]): string {
  let max = 0;
  const re = /^3-(\d+)$/i;
  for (const t of rows) {
    const m = t.solution_tier_id.trim().match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `3-${max + 1}`;
}
