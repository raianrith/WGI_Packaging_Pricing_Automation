import { NavLink, Route, Routes } from "react-router-dom";
import { APP_TITLE } from "./branding";
import { AdminGate } from "./components/AdminGate";
import { GlobalKpiStrip } from "./components/GlobalKpiStrip";
import { AgencyView } from "./views/AgencyView";
import { AdminView } from "./views/AdminView";

export default function App() {
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
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                `app-module-tab${isActive ? " app-module-tab--active" : ""}`
              }
            >
              Admin
            </NavLink>
          </nav>
        </div>
      </header>
      <GlobalKpiStrip />
      <Routes>
        <Route path="/" element={<AgencyView />} />
        <Route
          path="/admin"
          element={
            <AdminGate>
              <AdminView />
            </AdminGate>
          }
        />
      </Routes>
    </div>
  );
}
