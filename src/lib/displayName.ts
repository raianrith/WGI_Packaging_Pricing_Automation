import type { User } from "@supabase/supabase-js";

export function nameFromUserMetadata(user: User | null | undefined): string | null {
  const meta = user?.user_metadata ?? {};
  const full =
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    "";
  const trimmed = full.trim();
  return trimmed || null;
}

export function preferredDisplayName(
  profileName: string | null | undefined,
  user: User | null | undefined
): string | null {
  const fromProfile = profileName?.trim() ?? "";
  const fromMeta = nameFromUserMetadata(user);
  const emailLocal = user?.email?.split("@")[0]?.trim() ?? "";
  if (fromMeta && (!fromProfile || fromProfile === emailLocal)) return fromMeta;
  if (fromProfile) return fromProfile;
  return fromMeta;
}

export function greetingFirstName(displayName: string | null | undefined): string | null {
  const first = displayName?.trim().split(/\s+/)[0] ?? "";
  return first || null;
}

export function displayInitial(displayName: string | null | undefined, email: string | null | undefined): string {
  const fromName = displayName?.trim().charAt(0);
  if (fromName) return fromName.toUpperCase();
  const fromEmail = email?.trim().charAt(0);
  return (fromEmail || "?").toUpperCase();
}
