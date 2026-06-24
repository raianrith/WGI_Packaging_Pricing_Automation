import { NavLink, Outlet, useLocation } from "react-router-dom";

export function AgencyTabsShell() {
  const { pathname } = useLocation();
  const packagesTabActive =
    pathname === "/packages" || pathname.startsWith("/package/");
  const directoryTabActive = pathname === "/solutions";
  const directoryDetailsTabActive = pathname === "/directory-details";

  return (
    <div className="agency-tabs-shell">
      <div className="agency-tabs-shell__bar">
        <nav className="agency-tabs-nav" aria-label="Directory and package overview">
          <ul className="agency-tabs agency-tabs--four">
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
                  `agency-tab${directoryTabActive ? " agency-tab--active" : ""}`
                }
              >
                Directory
              </NavLink>
            </li>
            <li>
              <NavLink
                to="/directory-details"
                className={() =>
                  `agency-tab${directoryDetailsTabActive ? " agency-tab--active" : ""}`
                }
              >
                Directory Details
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
