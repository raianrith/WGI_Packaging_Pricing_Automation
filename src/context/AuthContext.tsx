import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import {
  browserKeyConfigurationError,
  envConfigured,
  getSupabase,
} from "../lib/supabase";
import type { ProfileRow } from "../types";

type AuthState = {
  session: Session | null;
  profile: ProfileRow | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

async function fetchProfile(userId: string): Promise<ProfileRow | null> {
  const client = getSupabase();
  if (!client) return null;
  const { data, error } = await client
    .from("profiles")
    .select("id, full_name, email, is_admin, created_at, updated_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.warn("profiles load:", error.message);
    return null;
  }
  return data as ProfileRow | null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    const client = getSupabase();
    const uid = client ? (await client.auth.getSession()).data.session?.user.id : null;
    if (!uid) {
      setProfile(null);
      return;
    }
    setProfile(await fetchProfile(uid));
  }, []);

  useEffect(() => {
    if (browserKeyConfigurationError() || !envConfigured()) {
      setSession(null);
      setProfile(null);
      setLoading(false);
      return;
    }
    const client = getSupabase();
    if (!client) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    void (async () => {
      const { data } = await client.auth.getSession();
      if (cancelled) return;
      const sess = data.session ?? null;
      setSession(sess);
      if (sess?.user.id) {
        setProfile(await fetchProfile(sess.user.id));
      } else {
        setProfile(null);
      }
      setLoading(false);
    })();

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (!newSession?.user.id) {
        setProfile(null);
        return;
      }
      void fetchProfile(newSession.user.id).then(setProfile);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const client = getSupabase();
    if (!client) {
      return { error: "Supabase is not configured." };
    }
    const { error } = await client.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) {
      return { error: error.message };
    }
    return { error: null };
  }, []);

  const signOut = useCallback(async () => {
    const client = getSupabase();
    if (client) {
      await client.auth.signOut();
    }
    setSession(null);
    setProfile(null);
  }, []);

  const value = useMemo(
    () => ({
      session,
      profile,
      loading,
      signIn,
      signOut,
      refreshProfile,
    }),
    [session, profile, loading, signIn, signOut, refreshProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
