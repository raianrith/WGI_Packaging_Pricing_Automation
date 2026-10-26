import { NavLink, Outlet, useLocation } from "react-router-dom";

const TABS = [
  { to: "/solutions", label: "Catalog", end: true, match: "catalog" as const },
  { to: "/directory-details", label: "Solutions Overview", end: true, match: "solutions" as const },
  { to: "/package-overview", label: "Package Overview", end: true, match: "packages" as const },
  { to: "/custom-solutions", label: "Custom Solutions", end: true, match: "custom" as const },
] as const;

function tabIsActive(match: (typeof TABS)[number]["match"], pathname: string, navActive: boolean): boolean {
  if (match === "packages") {
    return pathname === "/package-overview" || pathname.startsWith("/package/");
  }
  return navActive;
}

export function AgencyTabsShell() {
  const { pathname } = useLocation();
  return (
    <div className="agency-tabs-shell">
      <header className="agency-tabs-shell__bar">
        <nav className="agency-tabs-nav" aria-label="Catalog views">
          <ul className="agency-tabs agency-tabs--catalog agency-tabs--catalog-4">
            {TABS.map((tab) => (
              <li key={tab.to}>
                <NavLink
                  to={tab.to}
                  end={tab.end}
                  className={({ isActive }) =>
                    `agency-tab${tabIsActive(tab.match, pathname, isActive) ? " agency-tab--active" : ""}`
                  }
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
