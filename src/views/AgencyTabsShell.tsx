import { NavLink, Outlet, useLocation } from "react-router-dom";

export function AgencyTabsShell() {
  const { pathname } = useLocation();
  const packagesTabActive =
    pathname === "/packages" || pathname.startsWith("/package/");
  const solutionsTabActive = pathname === "/solutions";

  return (
    <div className="agency-tabs-shell">
      <div className="agency-tabs-shell__bar">
        <nav className="agency-tabs-nav" aria-label="Solutions and package overview">
          <ul className="agency-tabs agency-tabs--three">
            <li>
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  `agency-tab${isActive ? " agency-tab--active" : ""}`
                }
              >
                Home
              </NavLink>
            </li>
            <li>
              <NavLink
                to="/solutions"
                className={() =>
                  `agency-tab${solutionsTabActive ? " agency-tab--active" : ""}`
                }
              >
                Solutions
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
