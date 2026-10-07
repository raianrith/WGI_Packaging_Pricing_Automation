import type { SupabaseClient } from "@supabase/supabase-js";

/** Admin allow-lists for Playbook Package building (`public.playbook_package_config`). */
export type PlaybookPackageConfig = {
  limitPackageTypes: boolean;
  allowedPackageTypeIds: string[];
  limitSolutionTiers: boolean;
  allowedSolutionTierIds: string[];
  updatedByEmail: string | null;
  updatedAt: string | null;
};

export const PLAYBOOK_CONFIG_ROW_ID = "default";

export function defaultPlaybookPackageConfig(): PlaybookPackageConfig {
  return {
    limitPackageTypes: false,
    allowedPackageTypeIds: [],
    limitSolutionTiers: false,
    allowedSolutionTierIds: [],
    updatedByEmail: null,
    updatedAt: null,
  };
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map((x) => String(x ?? "").trim()).filter(Boolean))];
}

function fromRow(r: Record<string, unknown>): PlaybookPackageConfig {
  return {
    limitPackageTypes: Boolean(r.limit_package_types),
    allowedPackageTypeIds: strArray(r.allowed_package_type_ids),
    limitSolutionTiers: Boolean(r.limit_solution_tiers),
    allowedSolutionTierIds: strArray(r.allowed_solution_tier_ids),
    updatedByEmail: r.updated_by_email != null ? String(r.updated_by_email) : null,
    updatedAt: r.updated_at != null ? String(r.updated_at) : null,
  };
}

/** Missing table/row falls back to "everything allowed" so Proposal Builder keeps working. */
export async function fetchPlaybookPackageConfig(
  client: SupabaseClient
): Promise<{ config: PlaybookPackageConfig; error: string | null }> {
  const { data, error } = await client
    .from("playbook_package_config")
    .select("*")
    .eq("id", PLAYBOOK_CONFIG_ROW_ID)
    .maybeSingle();
  if (error) return { config: defaultPlaybookPackageConfig(), error: error.message };
  if (!data) return { config: defaultPlaybookPackageConfig(), error: null };
  return { config: fromRow(data as Record<string, unknown>), error: null };
}

export async function savePlaybookPackageConfig(
  client: SupabaseClient,
  config: PlaybookPackageConfig,
  updatedByEmail: string | null
): Promise<{ config: PlaybookPackageConfig | null; error: string | null }> {
  const { data, error } = await client
    .from("playbook_package_config")
    .upsert(
      {
        id: PLAYBOOK_CONFIG_ROW_ID,
        limit_package_types: config.limitPackageTypes,
        allowed_package_type_ids: strArray(config.allowedPackageTypeIds),
        limit_solution_tiers: config.limitSolutionTiers,
        allowed_solution_tier_ids: strArray(config.allowedSolutionTierIds),
        updated_by_email: updatedByEmail,
      },
      { onConflict: "id" }
    )
    .select("*")
    .single();
  if (error) return { config: null, error: error.message };
  return { config: fromRow(data as Record<string, unknown>), error: null };
}

export function playbookAllowsPackageType(config: PlaybookPackageConfig, typeId: string): boolean {
  return !config.limitPackageTypes || config.allowedPackageTypeIds.includes(typeId);
}

export function playbookAllowsSolutionTier(config: PlaybookPackageConfig, tierId: string): boolean {
  return !config.limitSolutionTiers || config.allowedSolutionTierIds.includes(tierId);
}
