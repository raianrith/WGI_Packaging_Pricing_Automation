/**
 * Recompute all solution_tier_pricing rows in Supabase using current tier pricing math
 * (includes 18% account mgmt + 1% continuous improvement on resource hours).
 *
 * Usage (from repo root):
 *   npx tsx scripts/recompute-all-tier-pricing.ts
 *
 * Requires .env with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (admin-capable key).
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import type { SolutionTierPricing } from "../src/types";
import { recomputeAllSavedTierPricing } from "../src/lib/recomputeAllSavedTierPricing";
import { DEFAULT_TIER_PRICING_MATH_CONFIG } from "../src/lib/tierPricingMath";

function loadEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const env = loadEnvFile(resolve(root, ".env"));
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) {
    console.error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env");
    process.exit(1);
  }

  const client = createClient(url, key);
  const { data, error } = await client.from("solution_tier_pricing").select("*").order("solution_tier_id");
  if (error) {
    console.error("Fetch failed:", error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as SolutionTierPricing[];
  console.log(`Loaded ${rows.length} pricing row(s). Using default workspace math (hourly $${DEFAULT_TIER_PRICING_MATH_CONFIG.hourlyRate}).`);

  const { updated, skipped, failures } = await recomputeAllSavedTierPricing({
    client,
    rows,
    config: DEFAULT_TIER_PRICING_MATH_CONFIG,
  });

  if (failures.length) {
    console.error(`Failures (${failures.length}):`);
    for (const f of failures.slice(0, 10)) console.error("  ", f);
    if (failures.length > 10) console.error("  …");
  }

  console.log(`Done. Updated ${updated}, unchanged ${skipped}, failed ${failures.length}.`);
  if (updated === 0 && failures.length === 0) {
    console.log("All rows already match current math, or no rows in database.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
