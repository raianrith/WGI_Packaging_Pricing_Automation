/**
 * Working-day duration bands from task hours (Chelsea / ops standard).
 * Overridable in the UI; used as the default when hours are entered.
 *
 *   hours < 4      → 3 days
 *   hours 4–8      → 4 days
 *   hours 8–12     → 5 days
 *   hours 12–24    → 8 days
 *   hours 24+      → 12 days
 */
export function suggestedTaskDurationDays(hours: number): number {
  if (hours < 4) return 3;
  if (hours <= 8) return 4;
  if (hours <= 12) return 5;
  if (hours <= 24) return 8;
  return 12;
}

export function parseTaskHoursInput(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function suggestedDurationStringFromHoursInput(hoursRaw: string): string | null {
  const h = parseTaskHoursInput(hoursRaw);
  if (h == null) return null;
  return String(suggestedTaskDurationDays(h));
}

/**
 * When hours change, auto-update duration if it is empty or still matches the
 * suggestion for the previous hours (so manual overrides are kept).
 * Returns the next duration string, or null if duration should be left alone.
 */
export function autoDurationAfterHoursChange(
  nextHoursRaw: string,
  prevHoursRaw: string,
  currentDurationRaw: string
): string | null {
  const suggested = suggestedDurationStringFromHoursInput(nextHoursRaw);
  if (suggested == null) return null;
  const cur = currentDurationRaw.trim();
  if (!cur) return suggested;
  const prevSuggested = suggestedDurationStringFromHoursInput(prevHoursRaw);
  if (prevSuggested != null && cur === prevSuggested) return suggested;
  return null;
}

/** Prefer explicit duration; otherwise derive from hours. */
export function durationFromHoursOrExisting(
  hours: number | null | undefined,
  duration: number | null | undefined
): number | null {
  if (duration != null && Number.isFinite(duration)) return duration;
  if (hours == null || !Number.isFinite(hours) || hours < 0) return null;
  return suggestedTaskDurationDays(hours);
}
