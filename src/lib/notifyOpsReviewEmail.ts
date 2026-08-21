import { getSupabase } from "./supabase";

export type OpsReviewNotifyPayload = {
  proposalId?: string | null;
  clientLabel: string;
  roadmapTitle: string;
  submittedByEmail?: string | null;
};

/**
 * Best-effort Slack notify when a proposal is submitted for Ops Review.
 * Failures are logged and do not block the submit flow.
 */
export async function notifyOpsReviewSubmitted(
  payload: OpsReviewNotifyPayload
): Promise<{ ok: boolean; error?: string }> {
  const client = getSupabase();
  if (!client) return { ok: false, error: "Supabase not configured" };

  try {
    const { data, error } = await client.functions.invoke("notify-ops-review", {
      body: {
        proposalId: payload.proposalId ?? null,
        clientLabel: payload.clientLabel,
        roadmapTitle: payload.roadmapTitle,
        submittedByEmail: payload.submittedByEmail ?? null,
        appUrl: typeof window !== "undefined" ? window.location.origin : null,
      },
    });

    if (error) {
      console.warn("[notify-ops-review]", error.message, data);
      return { ok: false, error: error.message };
    }
    if (data && typeof data === "object" && "error" in data && data.error) {
      const msg = String((data as { error: unknown }).error);
      console.warn("[notify-ops-review]", msg);
      return { ok: false, error: msg };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[notify-ops-review]", msg);
    return { ok: false, error: msg };
  }
}
