/** YYYY-MM-DD in UTC (matches prior date columns). */
export function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}
