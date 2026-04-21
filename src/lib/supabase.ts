import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** JWT payload role; only applies to legacy `eyJ…` keys. */
function jwtRole(jwt: string): string | null {
  try {
    const part = jwt.split(".")[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as { role?: string };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

/** New-format secret key — blocked in browsers by Supabase. */
function isNewSecretKey(k: string): boolean {
  return k.trim().startsWith("sb_secret_");
}

/** Legacy JWT service_role — must not be used in the browser. */
function isLegacyServiceRoleJwt(k: string): boolean {
  return jwtRole(k.trim()) === "service_role";
}

export function isForbiddenKeyInBrowser(): boolean {
  if (!key?.trim()) return false;
  const k = key.trim();
  return isNewSecretKey(k) || isLegacyServiceRoleJwt(k);
}

/**
 * Wrong key in VITE_SUPABASE_ANON_KEY: secret or service_role. Use publishable or legacy anon.
 */
export function browserKeyConfigurationError(): string | null {
  if (!key?.trim()) return null;
  const k = key.trim();
  if (isNewSecretKey(k)) {
    return (
      "You pasted a Secret API key (sb_secret_…). That cannot run in a browser. " +
      "Copy the Publishable key (sb_publishable_…) from Project Settings → API Keys, " +
      "or use the Legacy tab → anon (public) JWT. Put it in VITE_SUPABASE_ANON_KEY and restart npm run dev."
    );
  }
  if (isLegacyServiceRoleJwt(k)) {
    return (
      "You pasted the service_role JWT (legacy secret). Use the Publishable key or the legacy anon public JWT instead. " +
      "Project Settings → API Keys → Publishable, or tab “Legacy anon, service_role API keys” → anon. " +
      "Restart npm run dev after updating .env."
    );
  }
  return null;
}

export function getSupabase() {
  if (!url || !key) {
    return null;
  }
  if (isForbiddenKeyInBrowser()) {
    return null;
  }
  return createClient(url, key.trim());
}

export function envConfigured(): boolean {
  return Boolean(url?.trim() && key?.trim());
}
