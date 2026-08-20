import type { SupabaseClient } from "@supabase/supabase-js";
import type { insertAuditLog } from "./audit";
import { friendlyMutationMessage } from "./supabaseErrors";
import { emptyPricingTemplate } from "./packagePricingTaskOverrides";
import { buildSolutionTierPricingMathUpdate } from "./recomputeStoredTierPricing";
import { buildImplementerToGroupMap, rollUpTaskTimesByPricingGroup } from "./taskHoursRollup";
import {
  loadTierPricingMathConfigFromStorage,
  normalizeTierPricingMathConfig,
  type TierPricingMathConfig,
} from "./tierPricingMath";
import type { ImplementerHourGroupRow, SolutionTierPricing, TaskRow } from "../types";

type LogAudit = (
  client: SupabaseClient,
  p: Parameters<typeof insertAuditLog>[1]
) => Promise<void>;

function rowJson(row: object): Record<string, unknown> {
  return JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
}

export type SyncTierPricingFromTasksResult =
  | { ok: true; updated: number; created: number }
  | { ok: false; message: string };

/**
 * Recompute `solution_tier_pricing` hour buckets + sell math from live vault tasks.
 * Preserves risk/strategic scores and metadata on existing pricing rows; creates a row when missing.
 */
export async function syncTierPricingFromTasks(params: {
  client: SupabaseClient;
  tierIds: string | string[];
  mathConfig?: TierPricingMathConfig | null;
  implementerHourGroups?: ImplementerHourGroupRow[] | null;
  logAudit?: LogAudit;
}): Promise<SyncTierPricingFromTasksResult> {
  const tierIds = [
    ...new Set(
      (Array.isArray(params.tierIds) ? params.tierIds : [params.tierIds])
        .map((id) => id.trim())
        .filter(Boolean)
    ),
  ];
  if (tierIds.length === 0) return { ok: true, updated: 0, created: 0 };

  let groups = params.implementerHourGroups ?? null;
  if (!groups) {
    const { data, error } = await params.client
      .from("implementer_pricing_hour_groups")
      .select("*")
      .order("implementer_name");
    if (error) return { ok: false, message: friendlyMutationMessage(error.message) };
    groups = (data ?? []) as ImplementerHourGroupRow[];
  }

  const { data: taskRows, error: taskErr } = await params.client
    .from("tasks")
    .select("*")
    .in("solution_tier_id", tierIds);
  if (taskErr) return { ok: false, message: friendlyMutationMessage(taskErr.message) };

  const { data: pricingRows, error: prErr } = await params.client
    .from("solution_tier_pricing")
    .select("*")
    .in("solution_tier_id", tierIds);
  if (prErr) return { ok: false, message: friendlyMutationMessage(prErr.message) };

  const { data: tierMeta, error: tierErr } = await params.client
    .from("solution_tiers")
    .select("solution_tier_id, solution_tier_name")
    .in("solution_tier_id", tierIds);
  if (tierErr) return { ok: false, message: friendlyMutationMessage(tierErr.message) };

  const tasksByTier = new Map<string, TaskRow[]>();
  for (const raw of taskRows ?? []) {
    const t = raw as TaskRow;
    const list = tasksByTier.get(t.solution_tier_id) ?? [];
    list.push(t);
    tasksByTier.set(t.solution_tier_id, list);
  }
  const pricingBy = new Map(
    ((pricingRows ?? []) as SolutionTierPricing[]).map((p) => [p.solution_tier_id, p])
  );
  const nameBy = new Map(
    (tierMeta ?? []).map((t) => [String(t.solution_tier_id), String(t.solution_tier_name ?? "")])
  );

  const implementerMap = buildImplementerToGroupMap(groups);
  const math = normalizeTierPricingMathConfig(
    params.mathConfig ?? loadTierPricingMathConfigFromStorage()
  );

  let updated = 0;
  let created = 0;

  for (const tid of tierIds) {
    const prev = pricingBy.get(tid) ?? null;
    const list = tasksByTier.get(tid) ?? [];
    const roll = rollUpTaskTimesByPricingGroup(list, implementerMap);
    const tierName = nameBy.get(tid)?.trim() || tid;

    const base: SolutionTierPricing = prev
      ? { ...prev }
      : {
          ...emptyPricingTemplate(tid),
          solution_label: tierName,
          tier: tierName,
          scope_risk: 0,
          internal_coordination: 0,
          client_revision_risk: 0,
          strategic_value_score: 0,
        };

    const withHours: SolutionTierPricing = {
      ...base,
      hours_client_services: roll.client_services,
      hours_copy: roll.copy,
      hours_design: roll.design,
      hours_web_dev: roll.web_dev,
      hours_video: roll.video,
      hours_data: roll.data,
      hours_paid_media: roll.paid_media,
      hours_hubspot: roll.hubspot,
      hours_other: roll.other,
      solution_label: base.solution_label?.trim() || tierName,
      tier: base.tier?.trim() || tierName,
    };

    const mathUpdate = buildSolutionTierPricingMathUpdate(withHours, math);
    const next: SolutionTierPricing = { ...withHours, ...mathUpdate };

    const { error: upErr } = await params.client
      .from("solution_tier_pricing")
      .upsert(next, { onConflict: "solution_tier_id" });
    if (upErr) return { ok: false, message: friendlyMutationMessage(upErr.message) };

    if (params.logAudit) {
      await params.logAudit(params.client, {
        entityType: "solution_tier_pricing",
        entityId: tid,
        action: prev ? "update" : "insert",
        before: prev ? rowJson(prev) : null,
        after: rowJson(next),
      });
    }

    if (prev) updated += 1;
    else created += 1;
  }

  return { ok: true, updated, created };
}
