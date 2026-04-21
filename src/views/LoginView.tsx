import { type FormEvent, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { APP_TITLE } from "../branding";
import { browserKeyConfigurationError, envConfigured } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";

export function LoginView() {
  const { session, signIn, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const keyErr = browserKeyConfigurationError();
  const configured = envConfigured();

  if (!loading && session) {
    return <Navigate to={from.startsWith("/login") ? "/" : from} replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const { error } = await signIn(email, password);
    setBusy(false);
    if (error) {
      setErr(error);
      return;
    }
    navigate(from.startsWith("/login") ? "/" : from, { replace: true });
  }

  return (
    <div className="login-page">
      <div className="login-page__brand" aria-label={APP_TITLE}>
        <span className="login-page__brand-name">Weidert Group, Inc.</span>
        <span className="login-page__brand-divider" aria-hidden />
        <span className="login-page__brand-scope">Packaging & Pricing Knowledge Vault</span>
      </div>

      <div className="admin-gate">
        <form className="admin-gate__card" onSubmit={onSubmit}>
          <h1 className="admin-gate__title">Sign in</h1>
          <p className="admin-gate__hint">
            Accounts are created by an administrator. There is no self-service sign up.
          </p>

          {keyErr && (
            <p className="admin-gate__err" role="alert">
              {keyErr}
            </p>
          )}
          {!keyErr && !configured && (
            <p className="admin-gate__err" role="alert">
              Configure <code className="login-page__code">VITE_SUPABASE_URL</code> and{" "}
              <code className="login-page__code">VITE_SUPABASE_ANON_KEY</code>.
            </p>
          )}

          {err && (
            <p className="admin-gate__err" role="alert">
              {err}
            </p>
          )}

          <label className="admin-gate__label">
            Email
            <input
              className="admin-gate__input kb-filter-input"
              type="email"
              name="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={!configured || Boolean(keyErr)}
              required
            />
          </label>
          <label className="admin-gate__label">
            Password
            <input
              className="admin-gate__input kb-filter-input"
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={!configured || Boolean(keyErr)}
              required
            />
          </label>
          <button
            type="submit"
            className="admin-gate__submit"
            disabled={busy || !configured || Boolean(keyErr)}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
