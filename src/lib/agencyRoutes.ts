/** Routes that share the Agency content column (tabs, catalog, package hub, package workspace). */
export function isAgencyRoute(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/solutions" ||
    pathname === "/packages" ||
    pathname.startsWith("/package/") ||
    pathname === "/catalog"
  );
}

/** Top-level Package Builder tab (Build a Package wizard). */
export function isPackageBuilderRoute(pathname: string): boolean {
  return pathname === "/package-builder" || pathname.startsWith("/package-builder/");
}
