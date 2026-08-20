/**
 * One-off: fix Web Page Standard (missing pricing) and Advanced (pricing without tasks).
 *
 * Usage: npx tsx scripts/fix-web-page-tiers.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import type { SolutionTierPricing, TaskRow } from "../src/types";
import { buildImplementerToGroupMap, rollUpTaskTimesByPricingGroup } from "../src/lib/taskHoursRollup";
import {
  computeTierPricing,
  DEFAULT_TIER_PRICING_MATH_CONFIG,
} from "../src/lib/tierPricingMath";
import { percentChangeFromSellAndOld } from "../src/lib/pricingPercentChange";
import { todayISODate } from "../src/lib/dates";
import { fetchAllTaskIdRows, nextAutoTaskId } from "../src/lib/taskIds";

const STANDARD_ID = "3-179";
const ADVANCED_ID = "3-180";
const BASIC_ID = "3-178";

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

function pricingPayloadFromTasks(
  tierId: string,
  tierName: string,
  tasks: TaskRow[],
  implementerMap: ReturnType<typeof buildImplementerToGroupMap>,
  existing?: SolutionTierPricing | null
): Omit<SolutionTierPricing, "created_at" | "updated_at"> {
  const roll = rollUpTaskTimesByPricingGroup(tasks, implementerMap);
  const scopeRisk = existing?.scope_risk ?? 0;
  const internalCoordination = existing?.internal_coordination ?? 0;
  const clientRevisionRisk = existing?.client_revision_risk ?? 0;
  const strategicValueScore = existing?.strategic_value_score ?? 0;
  const derived = computeTierPricing(
    {
      hours: {
        client: roll.client_services,
        copy: roll.copy,
        design: roll.design,
        web: roll.web_dev,
        video: roll.video,
        data: roll.data,
        paidMedia: roll.paid_media,
        hubspot: roll.hubspot,
        other: roll.other,
      },
      scopeRisk,
      internalCoordination,
      clientRevisionRisk,
      strategicValueScore,
    },
    DEFAULT_TIER_PRICING_MATH_CONFIG
  );
  const oldPrice = existing?.old_price ?? null;
  const pc = percentChangeFromSellAndOld(derived.sellPrice, oldPrice != null ? String(oldPrice) : "");
  return {
    solution_tier_id: tierId,
    solution_label: existing?.solution_label ?? tierName,
    tier: existing?.tier ?? tierName,
    scope: existing?.scope ?? null,
    hours_client_services: roll.client_services,
    hours_copy: roll.copy,
    hours_design: roll.design,
    hours_web_dev: roll.web_dev,
    hours_video: roll.video,
    hours_data: roll.data,
    hours_paid_media: roll.paid_media,
    hours_hubspot: roll.hubspot,
    hours_other: roll.other,
    total_hours: derived.totalHours,
    expected_effort_base_price: derived.expectedEffortBase,
    scope_risk: derived.scopeRisk,
    internal_coordination: derived.internalCoordination,
    client_revision_risk: derived.clientRevisionRisk,
    risk_multiplier: derived.riskMultiplier,
    risk_mitigated_base_price: derived.riskMitigatedBase,
    strategic_value_score: derived.strategicValueScore,
    strategic_value_multiplier: derived.strategicMultiplier,
    sell_price: derived.sellPrice,
    standalone_sell_price: null,
    old_price: oldPrice,
    percent_change: pc.forDb,
    requires_customization: existing?.requires_customization ?? false,
    taxable: existing?.taxable ?? false,
    notes: existing?.notes ?? null,
    tags: existing?.tags ?? null,
  };
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

  const { data: groups, error: gErr } = await client
    .from("implementer_pricing_hour_groups")
    .select("*");
  if (gErr) {
    console.error("implementer_pricing_hour_groups:", gErr.message);
    process.exit(1);
  }
  const implementerMap = buildImplementerToGroupMap(groups ?? []);

  const { data: tiers } = await client
    .from("solution_tiers")
    .select("solution_tier_id, solution_tier_name")
    .in("solution_tier_id", [BASIC_ID, STANDARD_ID, ADVANCED_ID]);
  const nameById = new Map((tiers ?? []).map((t) => [t.solution_tier_id, t.solution_tier_name]));

  // --- Standard: create pricing from tasks ---
  const { data: stdTasks, error: stdTaskErr } = await client
    .from("tasks")
    .select("*")
    .eq("solution_tier_id", STANDARD_ID)
    .order("sort_order");
  if (stdTaskErr) {
    console.error("Standard tasks:", stdTaskErr.message);
    process.exit(1);
  }
  if (!stdTasks?.length) {
    console.error("Standard has no tasks — cannot build pricing.");
    process.exit(1);
  }

  const { data: existingStdPricing } = await client
    .from("solution_tier_pricing")
    .select("*")
    .eq("solution_tier_id", STANDARD_ID)
    .maybeSingle();

  const stdPayload = pricingPayloadFromTasks(
    STANDARD_ID,
    nameById.get(STANDARD_ID) ?? "Web Page - Standard",
    stdTasks as TaskRow[],
    implementerMap,
    (existingStdPricing as SolutionTierPricing | null) ?? null
  );
  console.log("Standard pricing from tasks:", {
    hours: stdPayload.total_hours,
    sell: stdPayload.sell_price,
    buckets: {
      cs: stdPayload.hours_client_services,
      copy: stdPayload.hours_copy,
      design: stdPayload.hours_design,
      web: stdPayload.hours_web_dev,
    },
  });

  const { error: stdUpsertErr } = await client
    .from("solution_tier_pricing")
    .upsert(stdPayload, { onConflict: "solution_tier_id" });
  if (stdUpsertErr) {
    console.error("Standard pricing upsert failed:", stdUpsertErr.message);
    process.exit(1);
  }
  console.log("✓ Standard pricing saved");

  // --- Advanced: copy Standard task structure, scale times to match stored 35h buckets ---
  const { data: advPricing, error: advPrErr } = await client
    .from("solution_tier_pricing")
    .select("*")
    .eq("solution_tier_id", ADVANCED_ID)
    .maybeSingle();
  if (advPrErr) {
    console.error("Advanced pricing:", advPrErr.message);
    process.exit(1);
  }
  if (!advPricing) {
    console.error("Advanced has no pricing row unexpectedly.");
    process.exit(1);
  }

  const { count: advTaskCount } = await client
    .from("tasks")
    .select("task_id", { count: "exact", head: true })
    .eq("solution_tier_id", ADVANCED_ID);

  if ((advTaskCount ?? 0) > 0) {
    console.log(`Advanced already has ${advTaskCount} task(s); rebuilding pricing from those tasks.`);
    const { data: advTasks } = await client
      .from("tasks")
      .select("*")
      .eq("solution_tier_id", ADVANCED_ID)
      .order("sort_order");
    const advPayload = pricingPayloadFromTasks(
      ADVANCED_ID,
      nameById.get(ADVANCED_ID) ?? "Web Page - Advanced",
      (advTasks ?? []) as TaskRow[],
      implementerMap,
      advPricing as SolutionTierPricing
    );
    const { error: advUpErr } = await client
      .from("solution_tier_pricing")
      .upsert(advPayload, { onConflict: "solution_tier_id" });
    if (advUpErr) {
      console.error("Advanced pricing update failed:", advUpErr.message);
      process.exit(1);
    }
    console.log("✓ Advanced pricing refreshed from tasks → sell", advPayload.sell_price);
  } else {
    // Clone Standard tasks onto Advanced, scaling each task's hours by Advanced/Standard resource hour ratio
    // so Advanced keeps ~35h / $8800 intent while gaining a real task list.
    const targetHours = Number(advPricing.total_hours) || 35;
    const stdRoll = rollUpTaskTimesByPricingGroup(stdTasks as TaskRow[], implementerMap);
    const stdHours = Object.values(stdRoll).reduce((a, b) => a + b, 0);
    const scale = stdHours > 0 ? targetHours / stdHours : 1;
    console.log(
      `Advanced has 0 tasks. Cloning ${stdTasks.length} Standard tasks scaled ×${scale.toFixed(3)} to ~${targetHours}h.`
    );

    const { rows: seedIds, error: seedErr } = await fetchAllTaskIdRows(client);
    if (seedErr) {
      console.error("task ids:", seedErr);
      process.exit(1);
    }
    let known = [...seedIds];
    const today = todayISODate();
    const inserts: Record<string, unknown>[] = [];
    let sort = 0;
    for (const t of stdTasks as TaskRow[]) {
      sort += 1;
      const id = nextAutoTaskId(known);
      known.push({ task_id: id });
      const time =
        t.task_time != null && Number.isFinite(Number(t.task_time))
          ? Math.round(Number(t.task_time) * scale * 100) / 100
          : t.task_time;
      inserts.push({
        task_id: id,
        solution_tier_id: ADVANCED_ID,
        sort_order: sort,
        task_name: t.task_name,
        task_implementer: t.task_implementer,
        task_time: time,
        task_duration: t.task_duration,
        task_dependencies: t.task_dependencies,
        task_notes:
          t.task_notes?.trim()
            ? `${t.task_notes}\n[Cloned from Web Page - Standard for data repair]`
            : "[Cloned from Web Page - Standard for data repair]",
        task_create_date: today,
        task_modified_date: today,
      });
    }

    const { error: insErr } = await client.from("tasks").insert(inserts);
    if (insErr) {
      console.error("Advanced task insert failed:", insErr.message);
      process.exit(1);
    }
    console.log(`✓ Inserted ${inserts.length} Advanced tasks`);

    const { data: newAdvTasks } = await client
      .from("tasks")
      .select("*")
      .eq("solution_tier_id", ADVANCED_ID)
      .order("sort_order");
    const advPayload = pricingPayloadFromTasks(
      ADVANCED_ID,
      nameById.get(ADVANCED_ID) ?? "Web Page - Advanced",
      (newAdvTasks ?? []) as TaskRow[],
      implementerMap,
      advPricing as SolutionTierPricing
    );
    // Preserve Advanced risk/strategic scores from existing row; refresh hours/sell from new tasks
    const { error: advUpErr } = await client
      .from("solution_tier_pricing")
      .upsert(advPayload, { onConflict: "solution_tier_id" });
    if (advUpErr) {
      console.error("Advanced pricing update failed:", advUpErr.message);
      process.exit(1);
    }
    console.log("✓ Advanced pricing refreshed from cloned tasks →", {
      hours: advPayload.total_hours,
      sell: advPayload.sell_price,
    });
  }

  // --- Verify ---
  for (const id of [BASIC_ID, STANDARD_ID, ADVANCED_ID]) {
    const { count } = await client
      .from("tasks")
      .select("task_id", { count: "exact", head: true })
      .eq("solution_tier_id", id);
    const { data: pr } = await client
      .from("solution_tier_pricing")
      .select("sell_price, total_hours")
      .eq("solution_tier_id", id)
      .maybeSingle();
    console.log("VERIFY", id, nameById.get(id), "tasks", count, "sell", pr?.sell_price, "hours", pr?.total_hours);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
