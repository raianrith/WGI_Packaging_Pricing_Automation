import type { SupabaseClient } from "@supabase/supabase-js";

export type AdminUsersPayload =
  | {
      action: "create";
      email: string;
      password: string;
      full_name: string;
      is_admin: boolean;
    }
  | { action: "update_password"; user_id: string; password: string }
  | { action: "delete"; user_id: string };

export type AdminUsersResult =
  | { ok: true; user_id?: string }
  | { ok: false; message: string };

async function readInvokeErrorMessage(
  err: { message?: string; context?: Response }
): Promise<string> {
  if (err.context) {
    try {
      const j = (await err.context.json()) as { error?: string };
      if (j?.error) return j.error;
    } catch {
      /* ignore */
    }
  }
  return err.message ?? "Request failed";
}

export async function invokeAdminUsers(
  client: SupabaseClient,
  payload: AdminUsersPayload
): Promise<AdminUsersResult> {
  const { data, error } = await client.functions.invoke("admin-users", {
    body: payload,
  });

  if (error) {
    const msg = await readInvokeErrorMessage(error as { message?: string; context?: Response });
    return { ok: false, message: msg };
  }

  const body = data as { error?: string; ok?: boolean; user_id?: string } | null;
  if (body && typeof body === "object" && body.error) {
    return { ok: false, message: body.error };
  }
  return { ok: true, user_id: body?.user_id };
}
