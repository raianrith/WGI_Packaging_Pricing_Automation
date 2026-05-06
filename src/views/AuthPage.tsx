import { useEffect, useRef, useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  APP_BRAND_NAME,
  APP_SCOPE_LABEL,
  AUTH_HERO_DESCRIPTION,
} from "../branding";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { friendlyAuthMessage } from "../lib/authMessages";
import {
  browserKeyConfigurationError,
  envConfigured,
  getSupabase,
} from "../lib/supabase";

type AuthMode = "signin" | "signup" | "forgot";

const MIN_PASSWORD_LEN = 8;

export function AuthPage() {
  const { toastError, toastSuccess } = useToast();
  const envWarnShown = useRef(false);
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from =
    (location.state as { from?: string } | null)?.from && (location.state as { from: string }).from !== "/login"
      ? (location.state as { from: string }).from
      : "/";

  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const keyErr = browserKeyConfigurationError();
  const hasEnv = envConfigured() && !keyErr;

  useEffect(() => {
    if (!loading && session) {
      navigate(from, { replace: true });
    }
  }, [from, loading, session, navigate]);

  useEffect(() => {
    if (hasEnv) {
      envWarnShown.current = false;
      return;
    }
    if (envWarnShown.current) return;
    envWarnShown.current = true;
    toastError(
      keyErr ??
        "Add valid Supabase URL and anon/publishable key in `.env` (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY), then restart the dev server."
    );
  }, [hasEnv, keyErr, toastError]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const client = getSupabase();
    if (!client) {
      toastError(
        "Supabase isn’t configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file."
      );
      return;
    }
    const em = email.trim();
    if (!em) {
      toastError("Enter your email.");
      return;
    }
    if (mode === "forgot") {
      setBusy(true);
      const { error: err } = await client.auth.resetPasswordForEmail(em, {
        redirectTo: `${window.location.origin}/login`,
      });
      setBusy(false);
      if (err) {
        toastError(friendlyAuthMessage(err.message));
        return;
      }
      toastSuccess("Check your email for a password reset link.");
      return;
    }
    if (!password) {
      toastError("Enter your password.");
      return;
    }
    if (mode === "signup" && password.length < MIN_PASSWORD_LEN) {
      toastError(`Use at least ${MIN_PASSWORD_LEN} characters for your password.`);
      return;
    }

    setBusy(true);
    if (mode === "signup") {
      const { error: err } = await client.auth.signUp({
        email: em,
        password,
        options: {
          emailRedirectTo: window.location.origin,
        },
      });
      setBusy(false);
      if (err) {
        toastError(friendlyAuthMessage(err.message));
        return;
      }
      toastSuccess(
        "Account created — if email confirmation is enabled in Supabase, check your inbox to verify before signing in."
      );
      setPassword("");
      setMode("signin");
      return;
    }

    const { error: err } = await client.auth.signInWithPassword({
      email: em,
      password,
    });
    setBusy(false);
    if (err) {
      toastError(friendlyAuthMessage(err.message));
      return;
    }
    navigate(from, { replace: true });
  }

  if (!loading && session) {
    return <Navigate to={from} replace />;
  }

  if (loading && !session && hasEnv) {
    return (
      <div className="auth-loading-screen auth-loading-screen--auth" aria-busy aria-live="polite">
        <div className="auth-loading-screen__spinner" />
        <p className="auth-loading-screen__text">Loading session…</p>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-page__ambient" aria-hidden />
      <div className="auth-page__frame">
        <div className="auth-page__shell">
        <aside className="auth-page__hero">
          <p className="auth-page__hero-org">{APP_BRAND_NAME}</p>
          <h1 className="auth-page__hero-title">{APP_SCOPE_LABEL}</h1>
          <p className="auth-page__hero-lead">{AUTH_HERO_DESCRIPTION}</p>
          <ul className="auth-page__hero-list">
            <li>
              <strong>Solutions &amp; packages</strong> — tier overviews, KPIs, task lists, and how work is scoped
            </li>
            <li>
              <strong>Proposal Builder</strong> — roadmap-style workspace to shape what you take to the client
            </li>
            <li>
              <strong>Admin (editors only)</strong> — packages, tiers, task groups, pricing math, and audit history
            </li>
          </ul>
        </aside>

        <main className="auth-page__panel">
          <div className="auth-card">
            <header className="auth-card__head">
              <div className="auth-card__identity" aria-label={`${APP_BRAND_NAME} ${APP_SCOPE_LABEL}`}>
                <div className="auth-card__identity-copy">
                  <span className="auth-card__eyebrow">{APP_BRAND_NAME}</span>
                  <p className="auth-card__product">{APP_SCOPE_LABEL}</p>
                </div>
              </div>
              {mode !== "forgot" ? (
                <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === "signin"}
                    className={`auth-tab${mode === "signin" ? " auth-tab--active" : ""}`}
                    onClick={() => {
                      setMode("signin");
                    }}
                  >
                    Sign in
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === "signup"}
                    className={`auth-tab${mode === "signup" ? " auth-tab--active" : ""}`}
                    onClick={() => {
                      setMode("signup");
                    }}
                  >
                    Sign up
                  </button>
                </div>
              ) : (
                <h2 className="auth-card__title">Reset password</h2>
              )}
            </header>

            <form className="auth-form" onSubmit={onSubmit} noValidate>
              <label className="auth-field">
                <span className="auth-field__label">Email</span>
                <input
                  type="email"
                  autoComplete="email"
                  className="auth-field__input"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy || !hasEnv}
                  spellCheck={false}
                  aria-required={true}
                />
              </label>

              {mode !== "forgot" && (
                <label className="auth-field">
                  <span className="auth-field__label">
                    Password
                    {mode === "signup" ? (
                      <span className="auth-field__hint"> · min {MIN_PASSWORD_LEN} characters</span>
                    ) : null}
                  </span>
                  <input
                    type="password"
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    className="auth-field__input"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={busy || !hasEnv}
                    aria-required={true}
                  />
                </label>
              )}

              {mode === "signin" && (
                <button
                  type="button"
                  className="auth-linkish"
                  onClick={() => {
                    setMode("forgot");
                  }}
                >
                  Forgot password?
                </button>
              )}

              {mode === "forgot" && (
                <button
                  type="button"
                  className="auth-linkish"
                  onClick={() => {
                    setMode("signin");
                  }}
                >
                  ← Back to sign in
                </button>
              )}

              <button
                type="submit"
                className="auth-submit"
                disabled={busy || !hasEnv || loading}
              >
                {busy ? (
                  "Working…"
                ) : mode === "signup" ? (
                  "Create account"
                ) : mode === "forgot" ? (
                  "Send reset email"
                ) : (
                  "Sign in"
                )}
              </button>
            </form>

            <footer className="auth-card__footer">
              <span className="auth-card__footer-muted">Protected workspace — sign in required.</span>
            </footer>
          </div>
          <p className="auth-page__terms">
            By continuing you agree to your organization&apos;s policies. Authentication is powered by Supabase Auth.
          </p>
        </main>
        </div>
      </div>
    </div>
  );
}
