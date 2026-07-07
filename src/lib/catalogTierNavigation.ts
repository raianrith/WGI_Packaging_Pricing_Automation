export type CatalogTierNavTarget = { solutionId: string; tierId: string };

const STORAGE_KEY = "wgi:catalogTierNav";

export function stashCatalogTierNavigation(target: CatalogTierNavTarget): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(target));
  } catch {
    /* ignore quota / private mode */
  }
}

export function readStashedCatalogTierNavigation(): CatalogTierNavTarget | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CatalogTierNavTarget;
    if (parsed?.solutionId && parsed?.tierId) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

export function clearStashedCatalogTierNavigation(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function readCatalogTierNavFromLocationState(
  locationState: unknown
): CatalogTierNavTarget | null {
  const nav = locationState as { openTierDetail?: CatalogTierNavTarget } | null;
  const target = nav?.openTierDetail;
  if (!target?.solutionId || !target?.tierId) return null;
  return target;
}

export function readPendingCatalogTierNavigation(
  locationState: unknown
): CatalogTierNavTarget | null {
  return (
    readCatalogTierNavFromLocationState(locationState) ?? readStashedCatalogTierNavigation()
  );
}
