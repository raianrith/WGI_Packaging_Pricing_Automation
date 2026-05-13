import type { SupabaseClient, User } from "@supabase/supabase-js";

export const ACTIVE_NOW_WINDOW_MS = 3 * 60 * 1000;
export const ACTIVE_RECENT_WINDOW_MS = 15 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 45 * 1000;

let presenceWritesDisabled = false;

type PresencePayload = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  current_path: string;
  last_seen_at: string;
};

export function presenceHeartbeatIntervalMs(): number {
  return HEARTBEAT_INTERVAL_MS;
}

export function buildPresencePayload(user: User, currentPath: string): PresencePayload {
  const fullName =
    normalizePresenceText(readUserMetaString(user, "full_name")) ??
    normalizePresenceText(readUserMetaString(user, "name")) ??
    normalizePresenceText(user.email?.split("@")[0] ?? "");
  return {
    user_id: user.id,
    email: normalizePresenceText(user.email),
    full_name: fullName,
    current_path: currentPath,
    last_seen_at: new Date().toISOString(),
  };
}

export async function upsertUserPresence(
  client: SupabaseClient,
  user: User,
  currentPath: string
): Promise<void> {
  if (presenceWritesDisabled) return;
  const { error } = await client
    .from("user_presence")
    .upsert(buildPresencePayload(user, currentPath), { onConflict: "user_id" });
  if (error) {
    if (isMissingPresenceTableError(error.message)) {
      presenceWritesDisabled = true;
      console.warn("[presence] user_presence table missing. Run supabase/user_presence.sql.");
      return;
    }
    console.warn("[presence] heartbeat failed:", error.message);
  }
}

export async function clearUserPresence(client: SupabaseClient, userId: string): Promise<void> {
  if (presenceWritesDisabled) return;
  const { error } = await client.from("user_presence").delete().eq("user_id", userId);
  if (error && isMissingPresenceTableError(error.message)) {
    presenceWritesDisabled = true;
    return;
  }
}

export function routePresenceLabel(pathname: string | null | undefined): string {
  const path = (pathname ?? "").trim();
  if (!path) return "Unknown";
  if (path === "/") return "Solutions Overview";
  if (path === "/packages") return "Packages";
  if (path.startsWith("/package/")) return "Package Workspace";
  if (path === "/roadmap") return "Proposal Builder";
  if (path === "/admin") return "Admin";
  return path;
}

export function presenceStatus(
  iso: string | null | undefined,
  now = Date.now()
): "active_now" | "recent" | "inactive" {
  const ts = iso ? new Date(iso).getTime() : Number.NaN;
  if (!Number.isFinite(ts)) return "inactive";
  const age = now - ts;
  if (age <= ACTIVE_NOW_WINDOW_MS) return "active_now";
  if (age <= ACTIVE_RECENT_WINDOW_MS) return "recent";
  return "inactive";
}

export function formatPresenceRelativeTime(
  iso: string | null | undefined,
  now = Date.now()
): string {
  const ts = iso ? new Date(iso).getTime() : Number.NaN;
  if (!Number.isFinite(ts)) return "Unknown";
  const delta = Math.max(0, Math.round((now - ts) / 1000));
  if (delta < 10) return "Just now";
  if (delta < 60) return `${delta}s ago`;
  const minutes = Math.round(delta / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function formatPresenceLocalDateTime(iso: string | null | undefined): string {
  if (!iso) return "Unknown";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function normalizePresenceText(value: string | null | undefined): string | null {
  const next = value?.trim() ?? "";
  return next || null;
}

function readUserMetaString(user: User, key: string): string | null {
  const value = user.user_metadata?.[key];
  return typeof value === "string" ? value : null;
}

function isMissingPresenceTableError(message: string | null | undefined): boolean {
  const text = (message ?? "").toLowerCase();
  return text.includes("user_presence") && (text.includes("does not exist") || text.includes("schema cache"));
}
