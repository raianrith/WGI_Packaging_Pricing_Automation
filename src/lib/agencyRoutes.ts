/** Routes that share the Agency content column (tabs, catalog, package hub, package workspace). */
export function isAgencyRoute(pathname: string): boolean {
  return (
    pathname === "/solutions" ||
    pathname === "/directory-details" ||
    pathname === "/packages" ||
    pathname.startsWith("/package/") ||
    pathname === "/catalog" ||
    pathname === "/custom-solutions" ||
    pathname === "/solution-requests"
  );
}

export function isProposalBuilderRoute(pathname: string): boolean {
  return pathname === "/roadmap" || pathname.startsWith("/roadmap/");
}

/** Top-level Package Builder tab (Build a Package wizard). */
export function isPackageBuilderRoute(pathname: string): boolean {
  return pathname === "/package-builder" || pathname.startsWith("/package-builder/");
}
