import { useEffect, useState } from "react";
import { Navigate, Outlet, NavLink, useLocation } from "react-router-dom";
import {
  APP_BRAND_NAME,
  APP_SCOPE_LABEL,
  APP_TITLE,
  NAV_PROPOSAL_BUILDER,
  NAV_SOLUTIONS_OVERVIEW,
} from "../branding";
import { useAuth } from "../context/AuthContext";
import { isAgencyRoute } from "../lib/agencyRoutes";
import { getSupabase } from "../lib/supabase";
import {
  presenceHeartbeatIntervalMs,
  upsertUserPresence,
} from "../lib/userPresence";

function AuthLoadingScreen() {
  return (
    <div className="auth-loading-screen" aria-busy aria-live="polite">
      <div className="auth-loading-screen__spinner" />
      <p className="auth-loading-screen__text">Signing you in…</p>
    </div>
  );
}

function SignOutButton() {
  const { signOut } = useAuth();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      className="app-user-menu__signout"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void signOut().finally(() => setBusy(false));
      }}
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}

export function ProtectedLayout() {
  const { session, loading, configured, profileLoading, isAdmin } = useAuth();
  const location = useLocation();
  const agencyTabActive = isAgencyRoute(location.pathname);

  useEffect(() => {
    const client = getSupabase();
    const user = session?.user;
    if (!client || !user) return;

    const heartbeat = () => {
      if (document.visibilityState === "hidden") return;
      void upsertUserPresence(client, user, location.pathname);
    };

    heartbeat();
    const intervalId = window.setInterval(heartbeat, presenceHeartbeatIntervalMs());
    const onVisible = () => heartbeat();
    const onFocus = () => heartbeat();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [location.pathname, session?.user]);

  if (!configured) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (loading) {
    return <AuthLoadingScreen />;
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  const email = session.user.email ?? "Account";

  return (
    <div style={{ minHeight: "100%" }}>
      <header className="app-top-bar">
        <div className="app-top-bar__inner">
          <div className="app-top-bar__brand" aria-label={APP_TITLE}>
            <div className="app-top-bar__brand-lockup">
              <span className="app-top-bar__brand-name">{APP_BRAND_NAME}</span>
            </div>
            <span className="app-top-bar__brand-divider" aria-hidden />
            <span className="app-top-bar__brand-scope">{APP_SCOPE_LABEL}</span>
          </div>

          <nav className="app-module-tabs app-top-bar__nav" aria-label="Application area">
            <NavLink
              end
              to="/"
              className={() =>
                `app-module-tab${agencyTabActive ? " app-module-tab--active" : ""}`
              }
            >
              {NAV_SOLUTIONS_OVERVIEW}
            </NavLink>
            <NavLink
              to="/roadmap"
              className={({ isActive }) =>
                `app-module-tab${isActive ? " app-module-tab--active" : ""}`
              }
            >
              {NAV_PROPOSAL_BUILDER}
            </NavLink>
            {!profileLoading && isAdmin ? (
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  `app-module-tab${isActive ? " app-module-tab--active" : ""}`
                }
              >
                Admin
              </NavLink>
            ) : null}
          </nav>

          <div className="app-top-bar__account">
            <div className="app-user-menu">
              <span className="app-user-menu__avatar" aria-hidden>
                {(email || "?").slice(0, 1).toUpperCase()}
              </span>
              <span className="app-user-menu__details">
                <span className="app-user-menu__label">Signed in</span>
                <span className="app-user-menu__email" title={email}>
                  {email}
                </span>
              </span>
              <SignOutButton />
            </div>
          </div>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
