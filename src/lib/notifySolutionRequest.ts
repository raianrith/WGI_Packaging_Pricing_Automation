import { getSupabase } from "./supabase";
import type { SolutionRequestFormInput, SolutionRequestPriority } from "./solutionRequests";

export type SolutionRequestNotifyPayload = {
  requestId?: string | null;
  form: SolutionRequestFormInput;
  priority?: SolutionRequestPriority;
};

/**
 * Best-effort Slack notify when a new solution request is submitted.
 * Failures are logged and do not block the submit flow.
 */
export async function notifySolutionRequestSubmitted(
  payload: SolutionRequestNotifyPayload
): Promise<{ ok: boolean; error?: string }> {
  const client = getSupabase();
  if (!client) return { ok: false, error: "Supabase not configured" };

  try {
    const { data, error } = await client.functions.invoke("notify-solution-request", {
      body: {
        requestId: payload.requestId ?? null,
        form: payload.form,
        priority: payload.priority ?? payload.form.priority,
        appUrl: typeof window !== "undefined" ? window.location.origin : null,
      },
    });

    if (error) {
      console.warn("[notify-solution-request]", error.message, data);
      return { ok: false, error: error.message };
    }
    if (data && typeof data === "object" && "error" in data && data.error) {
      const msg = String((data as { error: unknown }).error);
      console.warn("[notify-solution-request]", msg);
      return { ok: false, error: msg };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[notify-solution-request]", msg);
    return { ok: false, error: msg };
  }
}
