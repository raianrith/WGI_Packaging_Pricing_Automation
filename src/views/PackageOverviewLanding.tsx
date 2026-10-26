import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useToast } from "../context/ToastContext";
import { packageOverviewPath } from "../lib/entityLinks";
import { getSupabase } from "../lib/supabase";
import type { Package } from "../types";

function searchBlob(pkg: Package): string {
  return [pkg.package_name, pkg.package_owner, pkg.package_category, pkg.package_overview]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function PackageOverviewLanding() {
  const searchId = useId();
  const navigate = useNavigate();
  const { toastError } = useToast();
  const [rows, setRows] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    const client = getSupabase();
    if (!client) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await client
      .from("packages")
      .select("package_id, package_name, package_owner, package_category, package_overview")
      .order("package_name");
    if (error) {
      toastError(error.message || "Could not load packages.");
      setRows([]);
    } else {
      setRows((data ?? []) as Package[]);
    }
    setLoading(false);
  }, [toastError]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => searchBlob(row).includes(q));
  }, [query, rows]);

  return (
    <div className="agency-view-shell agency-view-shell--catalog">
      <p className="agency-catalog-lede">
        Pricing, components, and tasks for a package. Click a row to open it.
      </p>
      <div className="agency-playbook-browser agency-playbook-browser--directory agency-playbook-browser--catalog">
        <div className="catalog-toolbar" role="search">
          <div className="catalog-toolbar__fields">
            <div
              className={`agency-tier-filter-field agency-tier-filter-field--search agency-tier-filter-field--search-directory${
                query.trim() ? " agency-tier-filter-field--active" : ""
              }`}
            >
              <label className="agency-tier-filter-field__label" htmlFor={searchId}>
                Search
              </label>
              <div className="agency-tier-filter-field__control agency-tier-filter-field__control--search">
                <input
                  id={searchId}
                  type="search"
                  className="agency-tier-filter-field__input"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Package, owner…"
                  autoComplete="off"
                />
              </div>
            </div>
            <span className="catalog-toolbar__count">{filtered.length} shown</span>
          </div>
        </div>

        <div className="agency-catalog-tier-sheet__scroll agency-catalog-directory__scroll">
          <table className="agency-catalog-tier-sheet__table agency-catalog-directory__table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Owner</th>
                <th scope="col">Type</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={3} className="agency-catalog-tier-sheet__empty">
                    Loading packages…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={3} className="agency-catalog-tier-sheet__empty">
                    {rows.length === 0 ? (
                      <>
                        No packages yet.{" "}
                        <Link to="/package-builder">Build a package</Link>
                      </>
                    ) : (
                      "Nothing matches this search."
                    )}
                  </td>
                </tr>
              ) : (
                filtered.map((row) => {
                  const href = packageOverviewPath(row.package_id);
                  const preview = row.package_overview?.trim() || "";
                  return (
                    <tr
                      key={row.package_id}
                      className="agency-catalog-directory__parent"
                      role="link"
                      tabIndex={0}
                      onClick={() => navigate(href)}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter" && e.key !== " ") return;
                        e.preventDefault();
                        navigate(href);
                      }}
                    >
                      <td>
                        <div className="agency-catalog-directory__name-cell">
                          <div className="agency-catalog-directory__name-copy">
                            <span className="agency-catalog-tier-sheet__tier-title">
                              {row.package_name}
                            </span>
                            {preview ? (
                              <span className="agency-catalog-directory__inline-meta">{preview}</span>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td>{row.package_owner?.trim() || "—"}</td>
                      <td>{row.package_category?.trim() || "Package"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
