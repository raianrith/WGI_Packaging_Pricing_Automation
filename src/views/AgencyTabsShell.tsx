import { NavLink, Outlet, useLocation } from "react-router-dom";

export function AgencyTabsShell() {
  const { pathname } = useLocation();
  const packagesTabActive =
    pathname === "/packages" || pathname.startsWith("/package/");

  return (
    <div className="agency-tabs-shell">
      <div className="agency-tabs-shell__bar">
        <nav className="agency-tabs-nav" aria-label="Agency views">
          <ul className="agency-tabs">
            <li>
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  `agency-tab${isActive ? " agency-tab--active" : ""}`
                }
              >
                All solutions
              </NavLink>
            </li>
            <li>
              <NavLink
                to="/packages"
                className={() =>
                  `agency-tab${packagesTabActive ? " agency-tab--active" : ""}`
                }
              >
                Packages
              </NavLink>
            </li>
          </ul>
        </nav>
      </div>
      <Outlet />
    </div>
  );
}
