/** Routes that share the Agency content column (tabs, catalog, package hub, package workspace). */
export function isAgencyRoute(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/packages" ||
    pathname.startsWith("/package/") ||
    pathname === "/catalog"
  );
}
