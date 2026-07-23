import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Link } from "react-router-dom";
import { AgencyPackageEditModal } from "../components/AgencyPackageEditModal";
import {
  AGENCY_HERO_TITLE,
  AGENCY_HUB_DESCRIPTION,
} from "../branding";
import { insertAuditLog } from "../lib/audit";
import { fetchPackageBuilderCatalog } from "../lib/packageBuilderSlots";
import { compareTasksByOrder } from "../lib/taskOrder";
import { vaultSellPriceUsd, vaultTierHours } from "../lib/vaultTierMetrics";
import {
  loadTierPricingMathConfigFromStorage,
  normalizeTierPricingMathConfig,
  type TierPricingMathConfig,
} from "../lib/tierPricingMath";
import { computePackageWorkspaceFormMetrics } from "../lib/packageWorkspaceMetrics";
import {
  browserKeyConfigurationError,
  envConfigured,
  getSupabase,
} from "../lib/supabase";
import { useToast } from "../context/ToastContext";
import type {
  AuditLogRow,
  ImplementerHourGroupRow,
  Package,
  PackageBuilderPackageType,
  PackageSolutionTier,
  Solution,
  SolutionTier,
  SolutionTierPricing,
  TaskRow,
} from "../types";

function sortId(a: string, b: string): number {
  const pa = a.split("-").map(Number);
  const pb = b.split("-").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return a.localeCompare(b);
}

function fmtUsd(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtHoursTotal(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

type PackageCardRollup = {
  tierCount: number;
  hoursSum: number;
  priceSum: number;
  hoursPartial: boolean;
  pricePartial: boolean;
};

type PackageLayoutMode = "cards" | "list";
type PackageListSortCol = "package" | "tiers" | "creator" | "hours" | "sell";
type PackageListSort = { col: PackageListSortCol; dir: "asc" | "desc" };

const PKG_LAYOUT_STORAGE_KEY = "wgi-packages-hub-layout";

const EMPTY_PACKAGE_ROLLUP: PackageCardRollup = {
  tierCount: 0,
  hoursSum: 0,
  priceSum: 0,
  hoursPartial: false,
  pricePartial: false,
};

function loadPackageLayoutMode(): PackageLayoutMode {
  if (typeof globalThis.window === "undefined") return "cards";
  return globalThis.window.localStorage.getItem(PKG_LAYOUT_STORAGE_KEY) === "list" ? "list" : "cards";
}

type PackageHubItemMeta = {
  rollup: PackageCardRollup;
  ws: ReturnType<typeof computePackageWorkspaceFormMetrics> | undefined;
  wsOk: boolean;
  tierLabel: string;
  workspaceHoursDisplay: string;
  workspaceSellDisplay: string;
  isCustomPackage: boolean;
  sourceLabel: string;
  creatorEmail: string | null;
  partialNote: string | null;
  a11yLabel: string;
};

function buildPackageHubItemMeta(
  p: Package,
  pkgRollupById: Map<string, PackageCardRollup>,
  pkgWorkspaceById: Map<string, ReturnType<typeof computePackageWorkspaceFormMetrics>>,
  packageTypeNameSet: Set<string>,
  packageCreatorById: Map<string, string>
): PackageHubItemMeta {
  const rollup = pkgRollupById.get(p.package_id) ?? {
    tierCount: 0,
    hoursSum: 0,
    priceSum: 0,
    hoursPartial: false,
    pricePartial: false,
  };
  const ws = pkgWorkspaceById.get(p.package_id);
  const wsOk = ws?.ok === true;
  const tierLabel =
    rollup.tierCount === 0 ? "No tiers" : rollup.tierCount === 1 ? "1 tier" : `${rollup.tierCount} tiers`;
  const workspaceHoursDisplay =
    rollup.tierCount === 0 ? "—" : wsOk ? `${fmtHoursTotal(ws.totalResourceHoursAfterDiscount)} h` : "—";
  const workspaceSellDisplay =
    rollup.tierCount === 0 ? "—" : wsOk ? fmtUsd(Math.round(ws.netSellAfterSellDiscount)) : "—";
  const isCustomPackage = packageTypeNameSet.has((p.package_category ?? "").trim().toLowerCase());
  const sourceLabel = "Custom package";
  const creatorEmail = packageCreatorById.get(p.package_id) ?? null;
  const partialNote =
    rollup.tierCount > 0 && (rollup.hoursPartial || rollup.pricePartial)
      ? "* Some linked tiers have no hours or sell price in the vault."
      : null;
  const a11yLabel = [
    p.package_name,
    sourceLabel,
    creatorEmail ? `Created by ${creatorEmail}` : null,
    tierLabel,
    rollup.tierCount === 0
      ? "No linked tiers"
      : [
          wsOk
            ? `${fmtHoursTotal(ws.totalResourceHoursAfterDiscount)} workspace hours after hour discount`
            : null,
          wsOk ? `${fmtUsd(Math.round(ws.netSellAfterSellDiscount))} workspace net sell` : null,
          `Σ vault ${fmtHoursTotal(rollup.hoursSum)} hours`,
          rollup.hoursPartial ? "vault hours incomplete" : null,
          `Σ vault sell ${fmtUsd(rollup.priceSum)}`,
          rollup.pricePartial ? "vault pricing incomplete" : null,
        ]
          .filter(Boolean)
          .join(", "),
    `Reference ${p.package_id}`,
  ]
    .filter(Boolean)
    .join(". ");

  return {
    rollup,
    ws,
    wsOk,
    tierLabel,
    workspaceHoursDisplay,
    workspaceSellDisplay,
    isCustomPackage,
    sourceLabel,
    creatorEmail,
    partialNote,
    a11yLabel,
  };
}

function compareStringsNullLast(a: string | null | undefined, b: string | null | undefined): number {
  const av = (a ?? "").trim();
  const bv = (b ?? "").trim();
  if (!av && !bv) return 0;
  if (!av) return 1;
  if (!bv) return -1;
  return av.localeCompare(bv, undefined, { sensitivity: "base" });
}

function compareNumbersNullLast(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function packageWorkspaceHours(
  p: Package,
  rollup: PackageCardRollup,
  pkgWorkspaceById: Map<string, ReturnType<typeof computePackageWorkspaceFormMetrics>>
): number | null {
  if (rollup.tierCount === 0) return null;
  const ws = pkgWorkspaceById.get(p.package_id);
  if (ws?.ok !== true) return null;
  return ws.totalResourceHoursAfterDiscount;
}

function packageWorkspaceSell(
  p: Package,
  rollup: PackageCardRollup,
  pkgWorkspaceById: Map<string, ReturnType<typeof computePackageWorkspaceFormMetrics>>
): number | null {
  if (rollup.tierCount === 0) return null;
  const ws = pkgWorkspaceById.get(p.package_id);
  if (ws?.ok !== true) return null;
  return ws.netSellAfterSellDiscount;
}

function comparePackagesForListSort(
  a: Package,
  b: Package,
  col: PackageListSortCol,
  pkgRollupById: Map<string, PackageCardRollup>,
  pkgWorkspaceById: Map<string, ReturnType<typeof computePackageWorkspaceFormMetrics>>,
  packageCreatorById: Map<string, string>
): number {
  const rollupA = pkgRollupById.get(a.package_id) ?? EMPTY_PACKAGE_ROLLUP;
  const rollupB = pkgRollupById.get(b.package_id) ?? EMPTY_PACKAGE_ROLLUP;

  let cmp = 0;
  switch (col) {
    case "package": {
      cmp = compareStringsNullLast(a.package_name, b.package_name);
      break;
    }
    case "tiers": {
      cmp = compareNumbersNullLast(rollupA.tierCount, rollupB.tierCount);
      break;
    }
    case "creator": {
      cmp = compareStringsNullLast(packageCreatorById.get(a.package_id), packageCreatorById.get(b.package_id));
      break;
    }
    case "hours": {
      cmp = compareNumbersNullLast(
        packageWorkspaceHours(a, rollupA, pkgWorkspaceById),
        packageWorkspaceHours(b, rollupB, pkgWorkspaceById)
      );
      break;
    }
    case "sell": {
      cmp = compareNumbersNullLast(
        packageWorkspaceSell(a, rollupA, pkgWorkspaceById),
        packageWorkspaceSell(b, rollupB, pkgWorkspaceById)
      );
      break;
    }
    default:
      cmp = 0;
  }

  if (cmp !== 0) return cmp;
  return sortId(a.package_id, b.package_id);
}

function PackageListSortTh({
  col,
  label,
  align,
  sort,
  onToggle,
}: {
  col: PackageListSortCol;
  label: string;
  align?: "left" | "right";
  sort: PackageListSort;
  onToggle: (col: PackageListSortCol) => void;
}) {
  return (
    <th scope="col" className={align === "right" ? "agency-pkg-hub__list-th--num" : undefined}>
      <button
        type="button"
        className="agency-pkg-hub__list-th-btn"
        onClick={() => onToggle(col)}
        aria-sort={sort.col === col ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      >
        {label}
        <span className="agency-pkg-hub__list-th-sort" aria-hidden>
          {sort.col === col ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
        </span>
      </button>
    </th>
  );
}

const shell: CSSProperties = {
  width: "100%",
  padding: "1.25rem 0 2.5rem",
};

const title: CSSProperties = {
  fontSize: "clamp(1.35rem, 2.5vw, 1.85rem)",
  fontWeight: 700,
  letterSpacing: "-0.03em",
  margin: "0 0 0.35rem",
};

const subtitle: CSSProperties = {
  margin: 0,
  color: "var(--muted)",
  maxWidth: "52rem",
  lineHeight: 1.55,
};

export function AgencyPackagesHub() {
  const { toastError, setOpErr, setOpOk } = useToast();
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [packages, setPackages] = useState<Package[]>([]);
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [tiers, setTiers] = useState<SolutionTier[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [pricing, setPricing] = useState<SolutionTierPricing[]>([]);
  const [packageTiers, setPackageTiers] = useState<PackageSolutionTier[]>([]);
  const [packageCreateAuditRows, setPackageCreateAuditRows] = useState<AuditLogRow[]>([]);
  const [implementerHourGroups, setImplementerHourGroups] = useState<ImplementerHourGroupRow[]>([]);
  const [packageTypes, setPackageTypes] = useState<PackageBuilderPackageType[]>([]);
  const [pkgFilter, setPkgFilter] = useState("");
  const [packageLayoutMode, setPackageLayoutMode] = useState<PackageLayoutMode>(() => loadPackageLayoutMode());
  const [packageListSort, setPackageListSort] = useState<PackageListSort>({ col: "package", dir: "asc" });
  const [packageCreatorFilter, setPackageCreatorFilter] = useState("all");
  const [editPackageId, setEditPackageId] = useState<string | null>(null);
  const [tierPricingMathConfig] = useState<TierPricingMathConfig>(() => loadTierPricingMathConfigFromStorage());

  const logAudit = useCallback(
    async (client: SupabaseClient, params: Parameters<typeof insertAuditLog>[1]) => {
      const { error } = await insertAuditLog(client, params);
      if (error) toastError(`Audit log failed: ${error}`);
    },
    [toastError]
  );

  const load = useCallback(async () => {
    const keyErr = browserKeyConfigurationError();
    if (keyErr) {
      setLoadErr(keyErr);
      setLoading(false);
      return;
    }
    if (!envConfigured()) {
      setLoadErr("Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env (see .env.example).");
      setLoading(false);
      return;
    }
    const client = getSupabase();
    if (!client) {
      setLoadErr("Supabase client is not available.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadErr(null);

    const [pRes, sRes, tRes, kRes, prRes, ptRes, implRes, auditRes, slotPack] = await Promise.all([
      client.from("packages").select("*").order("package_id"),
      client.from("solutions").select("*").order("solution_id"),
      client.from("solution_tiers").select("*").order("solution_tier_id"),
      client.from("tasks").select("*").order("task_id"),
      client.from("solution_tier_pricing").select("*").order("solution_tier_id"),
      client.from("package_solution_tiers").select("*").order("package_id"),
      client.from("implementer_pricing_hour_groups").select("*").order("implementer_name"),
      client
        .from("audit_log")
        .select("id, entity_type, entity_id, action, before_data, after_data, created_at, changed_by_user_id, changed_by_email")
        .eq("entity_type", "packages")
        .eq("action", "insert")
        .order("created_at", { ascending: false })
        .limit(1000),
      fetchPackageBuilderCatalog(client),
    ]);

    const err =
      pRes.error || sRes.error || tRes.error || kRes.error || prRes.error || ptRes.error
        ? [pRes.error, sRes.error, tRes.error, kRes.error, prRes.error, ptRes.error].find(Boolean)
        : null;

    if (err) {
      setLoadErr(err.message);
      setLoading(false);
      return;
    }

    const nextPackages = (pRes.data ?? []) as Package[];
    const nextSolutions = (sRes.data ?? []) as Solution[];
    const nextTiers = (tRes.data ?? []) as SolutionTier[];
    const nextTasks = (kRes.data ?? []) as TaskRow[];
    const nextPricing = prRes.error ? ([] as SolutionTierPricing[]) : ((prRes.data ?? []) as SolutionTierPricing[]);
    const nextPackageTiers = (ptRes.data ?? []) as PackageSolutionTier[];

    nextPackages.sort((a, b) => sortId(a.package_id, b.package_id));
    nextSolutions.sort((a, b) => sortId(a.solution_id, b.solution_id));
    nextTiers.sort((a, b) => sortId(a.solution_tier_id, b.solution_tier_id));
    nextTasks.sort((a, b) => {
      const tc = sortId(a.solution_tier_id, b.solution_tier_id);
      if (tc !== 0) return tc;
      return compareTasksByOrder(a, b);
    });

    setPackages(nextPackages);
    setSolutions(nextSolutions);
    setTiers(nextTiers);
    setTasks(nextTasks);
    setPricing(nextPricing);
    setPackageTiers(nextPackageTiers);
    setPackageCreateAuditRows(auditRes.error ? [] : ((auditRes.data ?? []) as AuditLogRow[]));
    setImplementerHourGroups(implRes.error ? [] : ((implRes.data ?? []) as ImplementerHourGroupRow[]));
    setPackageTypes(slotPack.catalog.types.map((t) => ({ ...t })));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pricingByTierId = useMemo(() => {
    const m = new Map<string, SolutionTierPricing>();
    for (const p of pricing) m.set(p.solution_tier_id, p);
    return m;
  }, [pricing]);

  const pkgRollupById = useMemo(() => {
    const tiersByPkg = new Map<string, PackageSolutionTier[]>();
    for (const row of packageTiers) {
      const prev = tiersByPkg.get(row.package_id) ?? [];
      prev.push(row);
      tiersByPkg.set(row.package_id, prev);
    }
    const m = new Map<string, PackageCardRollup>();
    for (const pkg of packages) {
      const links = tiersByPkg.get(pkg.package_id) ?? [];
      let hoursSum = 0;
      let priceSum = 0;
      let hoursPartial = false;
      let pricePartial = false;
      let tierLineCount = 0;
      for (const link of links) {
        const tid = link.solution_tier_id;
        const qty = link.quantity != null && link.quantity > 0 ? link.quantity : 1;
        tierLineCount += qty;
        const pr = pricingByTierId.get(tid) ?? null;
        const h = vaultTierHours(pr, tasks, tid);
        const usd = vaultSellPriceUsd(pr);
        if (h == null) hoursPartial = true;
        else hoursSum += h * qty;
        if (usd == null) pricePartial = true;
        else priceSum += usd * qty;
      }
      m.set(pkg.package_id, {
        tierCount: tierLineCount,
        hoursSum,
        priceSum,
        hoursPartial,
        pricePartial,
      });
    }
    return m;
  }, [packages, packageTiers, pricingByTierId, tasks]);

  const pkgWorkspaceById = useMemo(() => {
    const math =
      typeof globalThis.window !== "undefined"
        ? normalizeTierPricingMathConfig(loadTierPricingMathConfigFromStorage())
        : normalizeTierPricingMathConfig(null);
    const m = new Map<
      string,
      ReturnType<typeof computePackageWorkspaceFormMetrics>
    >();
    const tiersByPkg = new Map<string, PackageSolutionTier[]>();
    for (const row of packageTiers) {
      const prev = tiersByPkg.get(row.package_id) ?? [];
      prev.push(row);
      tiersByPkg.set(row.package_id, prev);
    }
    for (const pkg of packages) {
      const links = tiersByPkg.get(pkg.package_id) ?? [];
      const ids = [...new Set(links.map((r) => r.solution_tier_id))].sort(sortId);
      m.set(
        pkg.package_id,
        computePackageWorkspaceFormMetrics({
          pkg,
          tierIdsSorted: ids,
          packageTierLinksForPackage: links,
          vaultTasks: tasks,
          implementerHourGroups,
          mathConfig: math,
        })
      );
    }
    return m;
  }, [packages, packageTiers, tasks, implementerHourGroups]);

  const packageTypeNameSet = useMemo(() => {
    return new Set(packageTypes.map((pt) => pt.name.trim().toLowerCase()).filter(Boolean));
  }, [packageTypes]);

  const packageCreatorById = useMemo(() => {
    const m = new Map<string, string>();
    for (const row of packageCreateAuditRows) {
      const email = row.changed_by_email?.trim();
      if (!email) continue;
      if (!m.has(row.entity_id)) m.set(row.entity_id, email);
    }
    return m;
  }, [packageCreateAuditRows]);

  const packageCreatorOptions = useMemo(() => {
    return [...new Set([...packageCreatorById.values()])].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
  }, [packageCreatorById]);

  useEffect(() => {
    if (packageCreatorFilter === "all") return;
    if (!packageCreatorOptions.includes(packageCreatorFilter)) setPackageCreatorFilter("all");
  }, [packageCreatorFilter, packageCreatorOptions]);

  const editPackage = useMemo(
    () => (editPackageId ? packages.find((p) => p.package_id === editPackageId) ?? null : null),
    [editPackageId, packages]
  );

  const closePackageEdit = useCallback(() => {
    setEditPackageId(null);
    setOpErr(null);
    setOpOk(null);
  }, [setOpErr, setOpOk]);

  const deletePackageById = useCallback(
    async (packageId: string, packageName: string) => {
      const label = packageName.trim() || packageId;
      if (
        !globalThis.confirm(
          `Delete package “${label}” and all its tier links? This cannot be undone.`
        )
      ) {
        return;
      }
      const client = getSupabase();
      if (!client) {
        toastError("Supabase client is not available.");
        return;
      }
      const beforePkg = packages.find((p) => p.package_id === packageId) ?? null;
      const beforeTierIds = packageTiers
        .filter((x) => x.package_id === packageId)
        .map((x) => x.solution_tier_id);

      const { error: d1 } = await client.from("package_solution_tiers").delete().eq("package_id", packageId);
      if (d1) {
        toastError(d1.message);
        return;
      }
      const { error: d2 } = await client.from("packages").delete().eq("package_id", packageId);
      if (d2) {
        toastError(d2.message);
        await load();
        return;
      }
      await logAudit(client, {
        entityType: "packages",
        entityId: packageId,
        action: "delete",
        before: beforePkg
          ? {
              ...(beforePkg as unknown as Record<string, unknown>),
              solution_tier_ids: beforeTierIds,
            }
          : null,
        after: null,
      });
      if (editPackageId === packageId) setEditPackageId(null);
      setOpOk(`Package ${label} deleted.`);
      await load();
    },
    [editPackageId, load, logAudit, packageTiers, packages, setOpOk, toastError]
  );

  const setLayoutMode = useCallback((mode: PackageLayoutMode) => {
    setPackageLayoutMode(mode);
    if (typeof globalThis.window !== "undefined") {
      globalThis.window.localStorage.setItem(PKG_LAYOUT_STORAGE_KEY, mode);
    }
  }, []);

  const togglePackageListSort = useCallback((col: PackageListSortCol) => {
    setPackageListSort((prev) =>
      prev.col === col ? { col, dir: prev.dir === "asc" ? "desc" : "asc" } : { col, dir: "asc" }
    );
  }, []);

  const filteredPackages = useMemo(() => {
    const q = pkgFilter.trim().toLowerCase();
    return packages.filter((p) => {
      if (packageCreatorFilter !== "all" && packageCreatorById.get(p.package_id) !== packageCreatorFilter) return false;
      if (!q) return true;
      return p.package_id.toLowerCase().includes(q) || (p.package_name ?? "").toLowerCase().includes(q);
    });
  }, [packages, pkgFilter, packageCreatorFilter, packageCreatorById]);

  const sortedListPackages = useMemo(() => {
    const rows = [...filteredPackages];
    const dir = packageListSort.dir === "asc" ? 1 : -1;
    rows.sort(
      (a, b) =>
        comparePackagesForListSort(
          a,
          b,
          packageListSort.col,
          pkgRollupById,
          pkgWorkspaceById,
          packageCreatorById
        ) * dir
    );
    return rows;
  }, [
    filteredPackages,
    packageListSort,
    pkgRollupById,
    pkgWorkspaceById,
    packageCreatorById,
  ]);

  return (
    <div className="agency-view-shell" style={shell}>
      <header className="agency-page-header">
        <h1 style={title}>{AGENCY_HERO_TITLE}</h1>
        <p className="agency-hero__desc" style={subtitle}>
          {AGENCY_HUB_DESCRIPTION}{" "}
          <Link className="agency-hub__link" to="/package-builder">
            Build a new package
          </Link>
        </p>
      </header>

      {loading && (
        <p style={{ color: "var(--muted)", textAlign: "center", padding: "2rem" }}>Loading packages…</p>
      )}

      {!loading && loadErr && (
        <p style={{ color: "var(--danger, #b00020)", padding: "1rem 0" }} role="alert">
          {loadErr}
        </p>
      )}

      {!loading && !loadErr && (
        <>
          <section className="agency-pkg-open-panel" aria-labelledby="pkg-open-title">
            <div className="agency-pkg-open-panel__head">
              <div>
                <span className="agency-pkg-open-panel__eyebrow">Package Library</span>
                <h2 id="pkg-open-title" className="agency-pkg-open-panel__title">
                  Open a package
                </h2>
                <p className="agency-pkg-open-panel__lead">
                  Open, edit, and jump back into your custom packages.
                </p>
              </div>
              <div className="agency-pkg-open-panel__controls">
                <div className="agency-pkg-open-panel__search">
                  <label className="agency-nav-sol-filter__label" htmlFor="hub-pkg-filter">
                    Search packages
                  </label>
                  <div className="agency-nav-sol-filter__row">
                    <input
                      id="hub-pkg-filter"
                      type="search"
                      className="agency-nav-sol-filter__input"
                      value={pkgFilter}
                      onChange={(e) => setPkgFilter(e.target.value)}
                      placeholder="Filter by name or id…"
                      autoComplete="off"
                    />
                    {pkgFilter ? (
                      <button type="button" className="agency-nav-sol-filter__clear" onClick={() => setPkgFilter("")}>
                        Clear
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="agency-pkg-open-panel__creator-filter">
                  <label className="agency-nav-sol-filter__label" htmlFor="hub-pkg-creator-filter">
                    Created by
                  </label>
                  <select
                    id="hub-pkg-creator-filter"
                    className="agency-pkg-open-panel__creator-select"
                    value={packageCreatorFilter}
                    onChange={(e) => setPackageCreatorFilter(e.target.value)}
                  >
                    <option value="all">All creators</option>
                    {packageCreatorOptions.map((email) => (
                      <option key={email} value={email}>
                        {email}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="agency-pkg-open-panel__filters-row agency-pkg-open-panel__filters-row--layout-only">
              <div className="agency-pkg-open-panel__count-label" role="status" aria-live="polite">
                <strong>{filteredPackages.length}</strong>{" "}
                custom package{filteredPackages.length === 1 ? "" : "s"}
              </div>
              <div className="agency-pkg-open-panel__layout">
                <span className="agency-pkg-open-panel__layout-label" id="hub-pkg-layout-label">
                  Layout
                </span>
                <div
                  className="agency-catalog-segment agency-catalog-segment--compact"
                  role="group"
                  aria-labelledby="hub-pkg-layout-label"
                >
                  <button
                    type="button"
                    className={
                      packageLayoutMode === "cards"
                        ? "agency-catalog-segment__btn agency-catalog-segment__btn--active"
                        : "agency-catalog-segment__btn"
                    }
                    onClick={() => setLayoutMode("cards")}
                    aria-pressed={packageLayoutMode === "cards"}
                  >
                    Cards
                  </button>
                  <button
                    type="button"
                    className={
                      packageLayoutMode === "list"
                        ? "agency-catalog-segment__btn agency-catalog-segment__btn--active"
                        : "agency-catalog-segment__btn"
                    }
                    onClick={() => setLayoutMode("list")}
                    aria-pressed={packageLayoutMode === "list"}
                  >
                    List
                  </button>
                </div>
              </div>
            </div>

            {filteredPackages.length === 0 ? (
              <p className="agency-pkg-open-panel__empty">
                {packages.length === 0 ? "No packages in the vault yet." : "No packages match this filter."}
              </p>
            ) : packageLayoutMode === "list" ? (
              <div className="agency-pkg-hub__list-wrap">
                <table className="agency-pkg-hub__list" aria-label="Packages">
                  <thead>
                    <tr>
                      <PackageListSortTh col="package" label="Package" sort={packageListSort} onToggle={togglePackageListSort} />
                      <PackageListSortTh
                        col="tiers"
                        label="Tiers"
                        align="right"
                        sort={packageListSort}
                        onToggle={togglePackageListSort}
                      />
                      <PackageListSortTh col="creator" label="Created by" sort={packageListSort} onToggle={togglePackageListSort} />
                      <PackageListSortTh
                        col="hours"
                        label="Hours"
                        align="right"
                        sort={packageListSort}
                        onToggle={togglePackageListSort}
                      />
                      <PackageListSortTh
                        col="sell"
                        label="Net sell"
                        align="right"
                        sort={packageListSort}
                        onToggle={togglePackageListSort}
                      />
                      <th scope="col" className="agency-pkg-hub__list-th--actions">
                        <span className="agency-pkg-hub__list-sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedListPackages.map((p) => {
                      const meta = buildPackageHubItemMeta(
                        p,
                        pkgRollupById,
                        pkgWorkspaceById,
                        packageTypeNameSet,
                        packageCreatorById
                      );
                      const workspacePath = `/package/${encodeURIComponent(p.package_id)}`;
                      return (
                        <tr key={p.package_id} className="agency-pkg-hub__list-row">
                          <td className="agency-pkg-hub__list-cell agency-pkg-hub__list-cell--name">
                            <div className="agency-pkg-hub__list-name-wrap">
                              <span className="agency-pkg-hub__list-name">{p.package_name}</span>
                              <span className="agency-pkg-hub__source-pill agency-pkg-hub__source-pill--custom">
                                {meta.sourceLabel}
                              </span>
                            </div>
                          </td>
                          <td className="agency-pkg-hub__list-cell agency-pkg-hub__list-cell--tiers">
                            <span
                              className={
                                meta.rollup.tierCount === 0
                                  ? "agency-pkg-hub__tier-pill agency-pkg-hub__tier-pill--empty agency-pkg-hub__list-tier-pill"
                                  : "agency-pkg-hub__tier-pill agency-pkg-hub__list-tier-pill"
                              }
                            >
                              {meta.tierLabel}
                            </span>
                          </td>
                          <td className="agency-pkg-hub__list-cell agency-pkg-hub__list-cell--creator">
                            {meta.creatorEmail ?? "—"}
                          </td>
                          <td className="agency-pkg-hub__list-cell agency-pkg-hub__list-cell--num">
                            <span className="agency-pkg-hub__list-metric">{meta.workspaceHoursDisplay}</span>
                          </td>
                          <td className="agency-pkg-hub__list-cell agency-pkg-hub__list-cell--num">
                            <span className="agency-pkg-hub__list-metric agency-pkg-hub__list-metric--sell">
                              {meta.workspaceSellDisplay}
                            </span>
                          </td>
                          <td className="agency-pkg-hub__list-cell agency-pkg-hub__list-cell--actions">
                            <div className="agency-pkg-hub__list-actions">
                              <button
                                type="button"
                                className="agency-pkg-hub__card-edit agency-pkg-hub__list-edit"
                                onClick={() => setEditPackageId(p.package_id)}
                              >
                                Edit
                              </button>
                              <Link className="agency-pkg-hub__card-open agency-pkg-hub__list-open" to={workspacePath}>
                                Open
                              </Link>
                              <button
                                type="button"
                                className="agency-pkg-hub__card-delete agency-pkg-hub__list-delete"
                                onClick={() => void deletePackageById(p.package_id, p.package_name)}
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <ul className="agency-pkg-hub__grid" role="list" aria-label="Packages">
                {filteredPackages.map((p) => {
                  const meta = buildPackageHubItemMeta(
                    p,
                    pkgRollupById,
                    pkgWorkspaceById,
                    packageTypeNameSet,
                    packageCreatorById
                  );
                  const cardBody = (
                    <div className="agency-pkg-hub__card-body">
                      <div className="agency-pkg-hub__card-head">
                        <h3 className="agency-pkg-hub__card-title">{p.package_name}</h3>
                        <span className="agency-pkg-hub__pills">
                          <span className="agency-pkg-hub__source-pill agency-pkg-hub__source-pill--custom">
                            {meta.sourceLabel}
                          </span>
                          <span
                            className={
                              meta.rollup.tierCount === 0
                                ? "agency-pkg-hub__tier-pill agency-pkg-hub__tier-pill--empty"
                                : "agency-pkg-hub__tier-pill"
                            }
                          >
                            {meta.tierLabel}
                          </span>
                        </span>
                      </div>
                      {meta.creatorEmail ? (
                        <p className="agency-pkg-hub__creator">Created by {meta.creatorEmail}</p>
                      ) : null}
                      <div
                        className="agency-pkg-hub__card-stats"
                        aria-label="Package workspace totals from Package Builder pricing"
                      >
                        <div className="agency-pkg-hub__stat agency-pkg-hub__stat--hours">
                          <div className="agency-pkg-hub__stat-inner">
                            <span className="agency-pkg-hub__stat-label">Hours</span>
                            <span className="agency-pkg-hub__stat-hint">Workspace · after hour discount %</span>
                            <span className="agency-pkg-hub__stat-value">{meta.workspaceHoursDisplay}</span>
                          </div>
                        </div>
                        <div className="agency-pkg-hub__stat agency-pkg-hub__stat--sell">
                          <div className="agency-pkg-hub__stat-inner">
                            <span className="agency-pkg-hub__stat-label">Net sell</span>
                            <span className="agency-pkg-hub__stat-hint">Workspace · after sell discount %</span>
                            <span className="agency-pkg-hub__stat-value">{meta.workspaceSellDisplay}</span>
                          </div>
                        </div>
                      </div>
                      {meta.rollup.tierCount > 0 && !meta.wsOk ? (
                        <p className="agency-pkg-hub__card-partial">Workspace totals could not be calculated.</p>
                      ) : null}
                      {meta.partialNote ? (
                        <p className="agency-pkg-hub__card-partial">{meta.partialNote}</p>
                      ) : null}
                      <div className="agency-pkg-hub__card-foot agency-pkg-hub__card-foot--actions">
                        <button
                          type="button"
                          className="agency-pkg-hub__card-edit"
                          onClick={() => setEditPackageId(p.package_id)}
                        >
                          Edit package
                        </button>
                        <button
                          type="button"
                          className="agency-pkg-hub__card-delete"
                          onClick={() => void deletePackageById(p.package_id, p.package_name)}
                        >
                          Delete
                        </button>
                        <Link
                          className="agency-pkg-hub__card-open"
                          to={`/package/${encodeURIComponent(p.package_id)}`}
                        >
                          Open workspace
                          <span className="agency-pkg-hub__card-arrow" aria-hidden="true">
                            →
                          </span>
                        </Link>
                      </div>
                    </div>
                  );
                  return (
                    <li key={p.package_id}>
                      <article className="agency-pkg-hub__card agency-pkg-hub__card--static" aria-label={meta.a11yLabel}>
                        {cardBody}
                      </article>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}

      {editPackage ? (
        <AgencyPackageEditModal
          packageId={editPackage.package_id}
          packageName={editPackage.package_name ?? editPackage.package_id}
          packages={packages}
          solutions={solutions}
          tiers={tiers}
          tasks={tasks}
          tierPricing={pricing}
          packageTiers={packageTiers}
          implementerHourGroups={implementerHourGroups}
          tierPricingMathConfig={normalizeTierPricingMathConfig(tierPricingMathConfig)}
          onClose={closePackageEdit}
          onSaved={load}
          setOpErr={setOpErr}
          setOpOk={setOpOk}
          logAudit={logAudit}
        />
      ) : null}
    </div>
  );
}
