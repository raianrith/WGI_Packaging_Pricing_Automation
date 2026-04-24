/**
 * Percent change from rounded calculated sell price vs. old price input: (round(sell) − old) / old.
 * Used in admin pricing forms so the stored `percent_change` matches the live sell line.
 */
export function percentChangeFromSellAndOld(
  sellPrice: number,
  oldPriceInput: string
): { display: string; forDb: string | null } {
  const t = oldPriceInput.trim();
  if (t === "" || t.toLowerCase() === "n/a") {
    return { display: "—", forDb: null };
  }
  const old = Number(t);
  if (!Number.isFinite(old) || old <= 0) {
    return { display: "—", forDb: null };
  }
  const newSell = Math.round(sellPrice);
  const pct = ((newSell - old) / old) * 100;
  const sign = pct > 0 ? "+" : "";
  const formatted = `${sign}${pct.toFixed(2)}%`;
  return { display: formatted, forDb: formatted };
}
