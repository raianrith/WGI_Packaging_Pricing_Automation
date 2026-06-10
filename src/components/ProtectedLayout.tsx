import { useEffect, useState, type ReactNode } from "react";
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  APP_BRAND_NAME,
  APP_SCOPE_LABEL,
  APP_TITLE,
  CLAUDE_AI_CHAT_PROJECT_URL,
  NAV_AI_CHAT,
  NAV_PROPOSAL_BUILDER,
  NAV_SOLUTIONS_OVERVIEW,
} from "../branding";
import { useAuth } from "../context/AuthContext";
import { useProposalDraftGuard } from "../context/ProposalDraftGuardContext";
import { isAgencyRoute } from "../lib/agencyRoutes";
import { getSupabase } from "../lib/supabase";
import {
  presenceHeartbeatIntervalMs,
  upsertUserPresence,
} from "../lib/userPresence";

const THEME_STORAGE_KEY = "wgi-app-theme";
type AppTheme = "light" | "dark";

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

function GuardedNavLink({
  to,
  end,
  className,
  children,
}: {
  to: string;
  end?: boolean;
  className: string | ((props: { isActive: boolean }) => string);
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { guard, confirmLeave } = useProposalDraftGuard();

  return (
    <NavLink
      end={end}
      to={to}
      className={className}
      onClick={(e) => {
        if (location.pathname !== "/roadmap") return;
        if (to === "/roadmap") return;
        if (!guard?.isActive || !guard.isDirty) return;
        e.preventDefault();
        confirmLeave(() => navigate(to));
      }}
    >
      {children}
    </NavLink>
  );
}

function ThemeToggle({
  theme,
  onToggle,
}: {
  theme: AppTheme;
  onToggle: () => void;
}) {
  const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";

  return (
    <div className="app-theme-control">
      <span className="app-theme-control__label">{label}</span>
      <button
        type="button"
        className="app-user-menu__theme-toggle"
        onClick={onToggle}
        aria-label={label}
        aria-pressed={theme === "dark"}
        title={theme === "dark" ? "Light mode" : "Dark mode"}
      >
        <span className="app-user-menu__theme-toggle-track" aria-hidden>
          <span className="app-user-menu__theme-toggle-thumb">
            {theme === "dark" ? "☾" : "☀"}
          </span>
        </span>
      </button>
    </div>
  );
}

export function ProtectedLayout() {
  const { session, loading, configured, profileLoading, isAdmin } = useAuth();
  const location = useLocation();
  const agencyTabActive = isAgencyRoute(location.pathname);
  const [theme, setTheme] = useState<AppTheme>(() => readInitialTheme());

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

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage failures; theme still applies for the current session.
    }
  }, [theme]);

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
            <GuardedNavLink
              end
              to="/"
              className={() =>
                `app-module-tab${agencyTabActive ? " app-module-tab--active" : ""}`
              }
            >
              {NAV_SOLUTIONS_OVERVIEW}
            </GuardedNavLink>
            <NavLink
              to="/roadmap"
              className={({ isActive }) =>
                `app-module-tab${isActive ? " app-module-tab--active" : ""}`
              }
            >
              {NAV_PROPOSAL_BUILDER}
            </NavLink>
            {!profileLoading && isAdmin ? (
              <GuardedNavLink
                to="/admin"
                className={({ isActive }) =>
                  `app-module-tab${isActive ? " app-module-tab--active" : ""}`
                }
              >
                Admin
              </GuardedNavLink>
            ) : null}
            <a
              className="app-module-tab app-module-tab--external"
              href={CLAUDE_AI_CHAT_PROJECT_URL}
              target="_blank"
              rel="noopener noreferrer"
              title={`${NAV_AI_CHAT} (opens in a new tab)`}
            >
              {NAV_AI_CHAT}
            </a>
          </nav>

          <div className="app-top-bar__account">
            <div className="app-top-bar__account-controls">
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
              <ThemeToggle
                theme={theme}
                onToggle={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
              />
            </div>
          </div>
        </div>
      </header>
      <div className="app-main">
        <Outlet />
      </div>
    </div>
  );
}

function readInitialTheme(): AppTheme {
  if (typeof window === "undefined") return "light";
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Ignore storage failures; default to light below.
  }
  return "light";
}
