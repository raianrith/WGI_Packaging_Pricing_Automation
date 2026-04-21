import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Body = {
  action: "create" | "update_password" | "delete";
  email?: string;
  password?: string;
  full_name?: string;
  is_admin?: boolean;
  user_id?: string;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ error: "Server misconfigured" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Missing or invalid authorization" }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: profile, error: profErr } = await adminClient
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (profErr || !profile?.is_admin) {
    return json({ error: "Forbidden" }, 403);
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (body.action === "create") {
    const email = body.email?.trim().toLowerCase();
    const password = body.password ?? "";
    const full_name = (body.full_name ?? "").trim();
    const is_admin = Boolean(body.is_admin);

    if (!email || !email.includes("@")) {
      return json({ error: "Valid email is required" }, 400);
    }
    if (password.length < 8) {
      return json({ error: "Password must be at least 8 characters" }, 400);
    }

    const { data: created, error: createErr } =
      await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name },
      });

    if (createErr || !created.user) {
      return json(
        { error: createErr?.message ?? "Could not create user" },
        400
      );
    }

    const { error: upErr } = await adminClient
      .from("profiles")
      .update({ full_name: full_name || splitNameFromEmail(email), is_admin })
      .eq("id", created.user.id);

    if (upErr) {
      await adminClient.auth.admin.deleteUser(created.user.id);
      return json({ error: upErr.message }, 400);
    }

    return json({ ok: true, user_id: created.user.id });
  }

  if (body.action === "update_password") {
    const user_id = body.user_id;
    const password = body.password ?? "";
    if (!user_id) {
      return json({ error: "user_id is required" }, 400);
    }
    if (password.length < 8) {
      return json({ error: "Password must be at least 8 characters" }, 400);
    }

    const { error } = await adminClient.auth.admin.updateUserById(user_id, {
      password,
    });
    if (error) {
      return json({ error: error.message }, 400);
    }
    return json({ ok: true });
  }

  if (body.action === "delete") {
    const user_id = body.user_id;
    if (!user_id) {
      return json({ error: "user_id is required" }, 400);
    }
    if (user_id === user.id) {
      return json({ error: "You cannot delete your own account" }, 400);
    }

    const { data: target } = await adminClient
      .from("profiles")
      .select("is_admin")
      .eq("id", user_id)
      .maybeSingle();

    if (!target) {
      return json({ error: "User not found" }, 404);
    }

    if (target.is_admin) {
      const { count, error: cErr } = await adminClient
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("is_admin", true);
      if (cErr) {
        return json({ error: cErr.message }, 400);
      }
      if ((count ?? 0) <= 1) {
        return json({ error: "Cannot delete the last admin user" }, 400);
      }
    }

    const { error: delErr } = await adminClient.auth.admin.deleteUser(user_id);
    if (delErr) {
      return json({ error: delErr.message }, 400);
    }
    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, 400);
});

function splitNameFromEmail(email: string): string {
  return email.split("@")[0] ?? email;
}
