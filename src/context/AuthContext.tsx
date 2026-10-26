import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { preferredDisplayName } from "../lib/displayName";
import { getSupabase } from "../lib/supabase";
import { clearUserPresence } from "../lib/userPresence";

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  /** True while loading `profiles` for the current session. */
  profileLoading: boolean;
  /** From `public.profiles.is_admin` (false if no row, error, or not admin). */
  isAdmin: boolean;
  /** Preferred name from `profiles.full_name`, then auth metadata. */
  displayName: string | null;
  configured: boolean;
  updateDisplayName: (name: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const NAME_MAX = 80;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [profileName, setProfileName] = useState<string | null>(null);

  const configured = getSupabase() != null;
  const displayName = preferredDisplayName(profileName, session?.user ?? null);

  useEffect(() => {
    const client = getSupabase();
    if (!client) {
      setSession(null);
      setLoading(false);
      return;
    }

    void client.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setLoading(false);
    });

    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const client = getSupabase();
    const userId = session?.user?.id;
    if (!client || !userId) {
      setIsAdmin(false);
      setProfileName(null);
      setProfileLoading(false);
      return;
    }

    let cancelled = false;
    setProfileLoading(true);

    void client
      .from("profiles")
      .select("is_admin, full_name")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        setProfileLoading(false);
        if (error) {
          console.warn("[auth] profiles lookup failed:", error.message);
          setIsAdmin(false);
          setProfileName(null);
          return;
        }
        setIsAdmin(Boolean(data?.is_admin));
        const name = typeof data?.full_name === "string" ? data.full_name.trim() : "";
        setProfileName(name || null);
      });

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  const updateDisplayName = useCallback(
    async (name: string): Promise<{ error: string | null }> => {
      const cleaned = name.trim().replace(/\s+/g, " ").slice(0, NAME_MAX);
      if (!cleaned) return { error: "Enter a name to show on Home." };
      const client = getSupabase();
      const userId = session?.user?.id;
      if (!client || !userId) return { error: "You need to be signed in to change your name." };

      const { error: profileError } = await client
        .from("profiles")
        .update({ full_name: cleaned })
        .eq("id", userId);

      const { data, error: authError } = await client.auth.updateUser({
        data: { full_name: cleaned, name: cleaned },
      });
      if (profileError && authError) return { error: profileError.message };

      if (data.user) {
        setSession((prev) => (prev ? { ...prev, user: data.user } : prev));
      }
      setProfileName(cleaned);
      return { error: null };
    },
    [session?.user?.id]
  );

  const signOut = useCallback(async () => {
    const c = getSupabase();
    const userId = session?.user?.id;
    if (c && userId) {
      await clearUserPresence(c, userId).catch(() => {});
    }
    if (c) await c.auth.signOut();
    setSession(null);
    setIsAdmin(false);
    setProfileName(null);
    setProfileLoading(false);
  }, [session?.user?.id]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      profileLoading,
      isAdmin,
      displayName,
      configured,
      updateDisplayName,
      signOut,
    }),
    [session, loading, profileLoading, isAdmin, displayName, configured, updateDisplayName, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
