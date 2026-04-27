import type { SupabaseClient } from "@supabase/supabase-js";

export type EntityType =
  | "packages"
  | "solutions"
  | "solution_tiers"
  | "solution_tier_pricing"
  | "package_solution_tiers"
  | "tasks"
  | "task_groups"
  | "task_group_lines"
  | "solution_tier_task_group_applied";

export type AuditAction = "insert" | "update" | "delete";

export async function insertAuditLog(
  client: SupabaseClient,
  params: {
    entityType: EntityType;
    entityId: string;
    action: AuditAction;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  }
): Promise<{ error: string | null }> {
  const { error } = await client.from("audit_log").insert({
    entity_type: params.entityType,
    entity_id: params.entityId,
    action: params.action,
    before_data: params.before,
    after_data: params.after,
  });
  return { error: error?.message ?? null };
}
