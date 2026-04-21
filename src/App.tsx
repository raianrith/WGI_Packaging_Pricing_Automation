import { NavLink, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { APP_TITLE } from "./branding";
import { GlobalKpiStrip } from "./components/GlobalKpiStrip";
import { RequireAdmin } from "./components/RequireAdmin";
import { RequireAuth } from "./components/RequireAuth";
import { useAuth } from "./context/AuthContext";
import { AgencyView } from "./views/AgencyView";
import { AdminView } from "./views/AdminView";
import { LoginView } from "./views/LoginView";

function AppShell() {
  const { profile, signOut } = useAuth();

  return (
    <div style={{ minHeight: "100%" }}>
      <header className="app-top-bar">
        <div className="app-top-bar__inner">
          <div className="app-top-bar__brand" aria-label={APP_TITLE}>
            <span className="app-top-bar__brand-name">Weidert Group, Inc.</span>
            <span className="app-top-bar__brand-divider" aria-hidden />
            <span className="app-top-bar__brand-scope">
              Packaging & Pricing Knowledge Vault
            </span>
          </div>
          <div className="app-top-bar__trailing">
            <nav className="app-module-tabs" aria-label="Application area">
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  `app-module-tab${isActive ? " app-module-tab--active" : ""}`
                }
              >
                Agency
              </NavLink>
              {profile?.is_admin ? (
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
            <div className="app-top-bar__actions">
              <span className="app-top-bar__user" title={profile?.email ?? undefined}>
                {profile?.full_name?.trim() || profile?.email || "Signed in"}
              </span>
              <button type="button" className="app-top-bar__signout" onClick={() => void signOut()}>
                Sign out
              </button>
            </div>
          </div>
        </div>
      </header>
      <GlobalKpiStrip />
      <Outlet />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginView />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<AgencyView />} />
        <Route
          path="admin"
          element={
            <RequireAdmin>
              <AdminView />
            </RequireAdmin>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
