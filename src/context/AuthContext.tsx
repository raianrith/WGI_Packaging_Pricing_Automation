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
import { getSupabase } from "../lib/supabase";
import { clearUserPresence } from "../lib/userPresence";

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  /** True while loading `profiles.is_admin` for the current session. */
  profileLoading: boolean;
  /** From `public.profiles.is_admin` (false if no row, error, or not admin). */
  isAdmin: boolean;
  configured: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const configured = getSupabase() != null;

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
      setProfileLoading(false);
      return;
    }

    let cancelled = false;
    setProfileLoading(true);

    void client
      .from("profiles")
      .select("is_admin")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        setProfileLoading(false);
        if (error) {
          console.warn("[auth] profiles lookup failed:", error.message);
          setIsAdmin(false);
          return;
        }
        setIsAdmin(Boolean(data?.is_admin));
      });

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  const signOut = useCallback(async () => {
    const c = getSupabase();
    const userId = session?.user?.id;
    if (c && userId) {
      await clearUserPresence(c, userId).catch(() => {});
    }
    if (c) await c.auth.signOut();
    setSession(null);
    setIsAdmin(false);
    setProfileLoading(false);
  }, [session?.user?.id]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      profileLoading,
      isAdmin,
      configured,
      signOut,
    }),
    [session, loading, profileLoading, isAdmin, configured, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
