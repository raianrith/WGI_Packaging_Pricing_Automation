/** Persist “intentional manual price” ignores for Data Health (no schema change). */

const STORAGE_KEY = "wgi.admin.healthIgnoreTier.v1";

export type HealthIgnoreReason = "manual_price";

export type HealthIgnoreEntry = {
  tierId: string;
  reason: HealthIgnoreReason;
  at: string;
};

function readAll(): HealthIgnoreEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is HealthIgnoreEntry =>
        Boolean(x) &&
        typeof x === "object" &&
        typeof (x as HealthIgnoreEntry).tierId === "string" &&
        (x as HealthIgnoreEntry).tierId.trim() !== ""
    );
  } catch {
    return [];
  }
}

function writeAll(entries: HealthIgnoreEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function listHealthIgnoredTier(): HealthIgnoreEntry[] {
  return readAll();
}

export function isHealthTierIgnored(tierId: string): boolean {
  const id = tierId.trim();
  if (!id) return false;
  return readAll().some((e) => e.tierId === id);
}

export function ignoreHealthTier(tierId: string, reason: HealthIgnoreReason = "manual_price"): void {
  const id = tierId.trim();
  if (!id) return;
  const next = readAll().filter((e) => e.tierId !== id);
  next.push({ tierId: id, reason, at: new Date().toISOString() });
  writeAll(next);
}

export function unignoreHealthTier(tierId: string): void {
  const id = tierId.trim();
  if (!id) return;
  writeAll(readAll().filter((e) => e.tierId !== id));
}
