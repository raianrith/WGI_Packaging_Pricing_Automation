import { NavLink, Outlet } from "react-router-dom";

const TABS = [
  { to: "/solutions", label: "Catalog", end: true },
  { to: "/directory-details", label: "Solutions Overview", end: true },
  { to: "/custom-solutions", label: "Custom Solutions", end: true },
] as const;

export function AgencyTabsShell() {
  return (
    <div className="agency-tabs-shell">
      <header className="agency-tabs-shell__bar">
        <nav className="agency-tabs-nav" aria-label="Catalog views">
          <ul className="agency-tabs agency-tabs--catalog agency-tabs--catalog-3">
            {TABS.map((tab) => (
              <li key={tab.to}>
                <NavLink
                  to={tab.to}
                  end={tab.end}
                  className={({ isActive }) => `agency-tab${isActive ? " agency-tab--active" : ""}`}
                >
                  {tab.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <Outlet />
    </div>
  );
}
