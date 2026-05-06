import type { SupabaseClient } from "@supabase/supabase-js";
import { todayISODate } from "./dates";
import { friendlyMutationMessage } from "./supabaseErrors";

/** Writes contiguous `sort_order` 1…n on `tasks` for the ordered ids within this tier. */
export async function persistTaskSortOrdersForTier(
  client: SupabaseClient,
  tierId: string,
  orderedTaskIds: string[]
): Promise<{ ok: true } | { ok: false; message: string }> {
  const today = todayISODate();
  const outs = await Promise.all(
    orderedTaskIds.map((id, i) =>
      client
        .from("tasks")
        .update({ sort_order: i + 1, task_modified_date: today })
        .eq("task_id", id)
        .eq("solution_tier_id", tierId)
    )
  );
  const bad = outs.find((o) => o.error);
  if (bad?.error) return { ok: false, message: friendlyMutationMessage(bad.error.message) };
  return { ok: true };
}
