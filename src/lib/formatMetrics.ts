/** Catalog and inspector hours: one decimal, always with a unit. */
export function formatCatalogHours(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const rounded = Math.round(n * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} h`;
}

export function formatCatalogUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(n));
}

export function formatEffortAndDuration(effortHours: number, durationDays: number): string {
  const effort = formatCatalogHours(effortHours);
  const days = Math.round(durationDays * 10) / 10;
  const dayText = Number.isInteger(days) ? String(days) : days.toFixed(1);
  return `${effort} effort / ${dayText} days to deliver`;
}
