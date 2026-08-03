/** Package tier level (Basic / Standard / Advanced) → fixed hour discount %. */
export type PackageTierLevel = "basic" | "standard" | "advanced";

export const PACKAGE_TIER_HOUR_DISCOUNT_PCT: Record<PackageTierLevel, number> = {
  basic: 20,
  standard: 25,
  advanced: 30,
};

const TIER_LEVEL_LABEL: Record<PackageTierLevel, string> = {
  basic: "Basic",
  standard: "Standard",
  advanced: "Advanced",
};

/** Strip package type prefix from slot label (e.g. "MPG - Standard" → "Standard"). */
export function slotTierShortLabel(slotLabel: string, packageTypeName?: string): string {
  const label = slotLabel.trim();
  const name = (packageTypeName ?? "").trim();
  if (!name) return label || "Tier";
  const prefixes = [`${name} - `, `${name} – `, `${name}: `];
  for (const prefix of prefixes) {
    if (label.toLowerCase().startsWith(prefix.toLowerCase())) {
      return label.slice(prefix.length).trim() || label;
    }
  }
  return label || "Tier";
}

export function resolvePackageTierLevel(label: string): PackageTierLevel | null {
  const n = label.trim().toLowerCase();
  if (/\bbasic\b/.test(n)) return "basic";
  if (/\bstandard\b/.test(n)) return "standard";
  if (/\badvanced\b/.test(n)) return "advanced";
  return null;
}

export function packageHourDiscountPctForSlotLabel(
  slotLabel: string,
  packageTypeName?: string
): number {
  const short = slotTierShortLabel(slotLabel, packageTypeName);
  const level = resolvePackageTierLevel(short) ?? resolvePackageTierLevel(slotLabel);
  return level ? PACKAGE_TIER_HOUR_DISCOUNT_PCT[level] : 0;
}

function clampHourDiscountPct(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n * 10) / 10));
}

/**
 * Prefer an explicit slot `hour_discount_pct`; otherwise Basic/Standard/Advanced from the label.
 */
export function packageTierDiscountSummary(
  slotLabel: string,
  packageTypeName?: string,
  configuredHourDiscountPct?: number | null
): {
  level: PackageTierLevel | null;
  hourPct: number;
  tierLabel: string;
  source: "configured" | "label" | "none";
} {
  const tierLabel = slotTierShortLabel(slotLabel, packageTypeName);
  const level = resolvePackageTierLevel(tierLabel) ?? resolvePackageTierLevel(slotLabel);
  const configured = clampHourDiscountPct(configuredHourDiscountPct);
  if (configured != null) {
    return { level, hourPct: configured, tierLabel, source: "configured" };
  }
  if (level) {
    return { level, hourPct: PACKAGE_TIER_HOUR_DISCOUNT_PCT[level], tierLabel, source: "label" };
  }
  return { level: null, hourPct: 0, tierLabel, source: "none" };
}

export function formatPackageTierDiscountRule(
  level: PackageTierLevel | null,
  hourPct: number,
  tierLabel?: string
): string {
  const name = level ? TIER_LEVEL_LABEL[level] : tierLabel?.trim() || "Tier";
  return `${name} — ${hourPct}% hour discount`;
}

export function suggestedHourDiscountPctForLabel(
  slotLabel: string,
  packageTypeName?: string
): number | null {
  const level =
    resolvePackageTierLevel(slotTierShortLabel(slotLabel, packageTypeName)) ??
    resolvePackageTierLevel(slotLabel);
  return level ? PACKAGE_TIER_HOUR_DISCOUNT_PCT[level] : null;
}
