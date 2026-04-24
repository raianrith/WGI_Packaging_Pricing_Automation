import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AGENCY_HERO_TITLE,
  AGENCY_VIEW_DESCRIPTION,
} from "../branding";
import { STANDALONE_PACKAGE_NAV_ID } from "../lib/navIds";
import { notifyPackagingDataChanged } from "../lib/packagingEvents";
import {
  browserKeyConfigurationError,
  envConfigured,
  getSupabase,
} from "../lib/supabase";
import type {
  Package,
  PackageSolutionTier,
  Solution,
  SolutionTier,
  SolutionTierPricing,
  TaskRow,
} from "../types";

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ok";
      packages: Package[];
      solutions: Solution[];
      tiers: SolutionTier[];
      packageTiers: PackageSolutionTier[];
      tasks: TaskRow[];
      pricing: SolutionTierPricing[];
    };

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

function matchesQuery(haystack: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return haystack.toLowerCase().includes(q);
}

function formatKpiNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(n));
}

function sellPriceDisplay(pricing: SolutionTierPricing | null): string {
  if (!pricing) return "—";
  const primary = pricing.sell_price;
  const fallback = pricing.standalone_sell_price;
  if (primary != null && Number.isFinite(Number(primary))) {
    return formatUsd(primary);
  }
  if (fallback != null && Number.isFinite(Number(fallback))) {
    return formatUsd(fallback);
  }
  return "—";
}

function taxableLabel(pricing: SolutionTierPricing | null): string {
  if (!pricing) return "—";
  return pricing.taxable ? "Taxable" : "Non-taxable";
}

function solutionNavTitle(s: Solution): string {
  return `${s.solution_name} (${s.solution_id})`;
}

function tierNavTitle(t: SolutionTier, solutions: Solution[]): string {
  const sol = solutions.find((s) => s.solution_id === t.solution_id);
  const solPart = sol ? `${sol.solution_name} · ` : "";
  return `${solPart}${t.solution_tier_name} (${t.solution_tier_id})`;
}

function assignedTierIdSet(packageTiers: PackageSolutionTier[]): Set<string> {
  return new Set(packageTiers.map((r) => r.solution_tier_id));
}

function tierIdsForPackage(
  packageTiers: PackageSolutionTier[],
  packageId: string
): Set<string> {
  return new Set(
    packageTiers.filter((r) => r.package_id === packageId).map((r) => r.solution_tier_id)
  );
}

export type AgencyWorkspaceMode = "package" | "catalog";

type AgencyViewProps = {
  mode: AgencyWorkspaceMode;
};

export function AgencyView({ mode }: AgencyViewProps) {
  const { packageId: packageIdParam } = useParams<{ packageId: string }>();

  const [state, setState] = useState<LoadState>({ status: "idle" });
  const [pkgId, setPkgId] = useState<string | null>(null);
  const [solId, setSolId] = useState<string | null>(null);
  const [tierId, setTierId] = useState<string | null>(null);
  const [filterSol, setFilterSol] = useState("");
  const [filterPkg, setFilterPkg] = useState("");
  const [filterTier, setFilterTier] = useState("");
  const solSearchFieldId = useId();
  const pkgSearchFieldId = useId();
  const tierSearchFieldId = useId();
  const navigate = useNavigate();

  const load = useCallback(async () => {
    const keyErr = browserKeyConfigurationError();
    if (keyErr) {
      setState({ status: "error", message: keyErr });
      return;
    }
    const client = getSupabase();
    if (!client) {
      setState({
        status: "error",
        message:
          "Supabase URL and anon key are missing. Add .env with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
      });
      return;
    }

    setState({ status: "loading" });

    const [pRes, sRes, tRes, kRes, prRes, ptRes] = await Promise.all([
      client.from("packages").select("*").order("package_id"),
      client.from("solutions").select("*").order("solution_id"),
      client.from("solution_tiers").select("*").order("solution_tier_id"),
      client.from("tasks").select("*").order("task_id"),
      client.from("solution_tier_pricing").select("*").order("solution_tier_id"),
      client.from("package_solution_tiers").select("*").order("package_id"),
    ]);

    const err =
      pRes.error || sRes.error || tRes.error || kRes.error || ptRes.error
        ? [pRes.error, sRes.error, tRes.error, kRes.error, ptRes.error].find(Boolean)
        : null;

    if (err) {
      let extra = "";
      const m = err.message;
      if (m.includes("permission") || m.includes("RLS")) {
        extra =
          " — Check Row Level Security: allow SELECT for anon (or sign-in) on packages, solutions, solution_tiers, package_solution_tiers, tasks, and solution_tier_pricing.";
      }
      if (/forbidden/i.test(m) && /secret/i.test(m)) {
        extra =
          " — Use the anon public key in .env (VITE_SUPABASE_ANON_KEY), not the service_role secret. Restart the dev server after changing .env.";
      }
      setState({ status: "error", message: m + extra });
      return;
    }

    const packages = (pRes.data ?? []) as Package[];
    const solutions = (sRes.data ?? []) as Solution[];
    const tiers = (tRes.data ?? []) as SolutionTier[];
    const packageTiers = (ptRes.data ?? []) as PackageSolutionTier[];
    const tasks = (kRes.data ?? []) as TaskRow[];
    const pricing = prRes.error
      ? ([] as SolutionTierPricing[])
      : ((prRes.data ?? []) as SolutionTierPricing[]);

    packages.sort((a, b) => sortId(a.package_id, b.package_id));
    solutions.sort((a, b) => sortId(a.solution_id, b.solution_id));
    tiers.sort((a, b) => sortId(a.solution_tier_id, b.solution_tier_id));
    tasks.sort((a, b) => sortId(a.task_id, b.task_id));

    setState({ status: "ok", packages, solutions, tiers, packageTiers, tasks, pricing });

    if (mode === "package") {
      notifyPackagingDataChanged();
      return;
    }
    if (mode === "catalog") {
      setPkgId(null);
      const sortedSols = [...solutions].sort((a, b) =>
        sortId(a.solution_id, b.solution_id)
      );
      const firstSol = sortedSols[0];
      setSolId(firstSol?.solution_id ?? null);
      const tr = firstSol
        ? [...tiers]
            .filter((t) => t.solution_id === firstSol.solution_id)
            .sort((a, b) => sortId(a.solution_tier_id, b.solution_tier_id))[0]
        : null;
      setTierId(tr?.solution_tier_id ?? null);
      notifyPackagingDataChanged();
      return;
    }
    notifyPackagingDataChanged();
  }, [mode]);

  useEffect(() => {
    const keyErr = browserKeyConfigurationError();
    if (keyErr) {
      setState({ status: "error", message: keyErr });
      return;
    }
    if (!envConfigured()) {
      setState({
        status: "error",
        message: "Create a .env file in the project root with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see .env.example).",
      });
      return;
    }
    void load();
  }, [load]);

  const data = state.status === "ok" ? state : null;

  const packageRouteInvalid = useMemo(() => {
    if (!data || mode !== "package" || !packageIdParam) return false;
    const raw = decodeURIComponent(packageIdParam);
    const next = raw === "standalone" ? STANDALONE_PACKAGE_NAV_ID : raw;
    if (next === STANDALONE_PACKAGE_NAV_ID) {
      const assigned = assignedTierIdSet(data.packageTiers);
      return !data.tiers.some((t) => !assigned.has(t.solution_tier_id));
    }
    return !data.packages.some((p) => p.package_id === next);
  }, [data, mode, packageIdParam]);

  useEffect(() => {
    if (!data || mode !== "package" || !packageIdParam) return;
    const raw = decodeURIComponent(packageIdParam);
    const next = raw === "standalone" ? STANDALONE_PACKAGE_NAV_ID : raw;
    const ok =
      next === STANDALONE_PACKAGE_NAV_ID
        ? data.tiers.some((t) => !assignedTierIdSet(data.packageTiers).has(t.solution_tier_id))
        : data.packages.some((p) => p.package_id === next);
    if (!ok) return;
    setPkgId(next);
    const pkgTiers =
      next === STANDALONE_PACKAGE_NAV_ID
        ? data.tiers
            .filter((t) => !assignedTierIdSet(data.packageTiers).has(t.solution_tier_id))
            .sort((a, b) => sortId(a.solution_tier_id, b.solution_tier_id))
        : data.tiers
            .filter((t) => tierIdsForPackage(data.packageTiers, next).has(t.solution_tier_id))
            .sort((a, b) => sortId(a.solution_tier_id, b.solution_tier_id));
    const firstTier = pkgTiers[0] ?? null;
    setTierId(firstTier?.solution_tier_id ?? null);
    setSolId(firstTier?.solution_id ?? null);
  }, [data, mode, packageIdParam]);

  const solutionsVisible = useMemo(() => {
    if (!data || pkgId == null) return [];
    const assigned = assignedTierIdSet(data.packageTiers);
    const solIds =
      pkgId === STANDALONE_PACKAGE_NAV_ID
        ? new Set(
            data.tiers
              .filter((t) => !assigned.has(t.solution_tier_id))
              .map((t) => t.solution_id)
          )
        : new Set(
            data.packageTiers
              .filter((r) => r.package_id === pkgId)
              .map((r) => data.tiers.find((t) => t.solution_tier_id === r.solution_tier_id)?.solution_id)
              .filter((id): id is string => Boolean(id))
          );
    return data.solutions
      .filter((s) => solIds.has(s.solution_id))
      .filter(
        (s) =>
          matchesQuery(s.solution_name, filterSol) ||
          matchesQuery(s.solution_id, filterSol)
      )
      .sort((a, b) => sortId(a.solution_id, b.solution_id));
  }, [data, pkgId, filterSol]);

  /** Catalog: all solutions (sidebar list), filtered by search. */
  const allSolutionsFiltered = useMemo(() => {
    if (!data) return [];
    return data.solutions
      .filter(
        (s) =>
          matchesQuery(s.solution_name, filterSol) ||
          matchesQuery(s.solution_id, filterSol)
      )
      .sort((a, b) => sortId(a.solution_id, b.solution_id));
  }, [data, filterSol]);

  /** Sidebar always lists solutions in scope (catalog: all filtered; package: package scope). */
  const solutionsNavRows = useMemo(() => {
    if (!data) return [];
    if (mode === "catalog" && pkgId == null) return allSolutionsFiltered;
    return solutionsVisible;
  }, [data, mode, pkgId, allSolutionsFiltered, solutionsVisible]);

  /** Package workspace: sidebar package list. */
  const packagesNavRows = useMemo(() => {
    if (!data || mode !== "package") return [];
    return data.packages
      .filter(
        (p) =>
          matchesQuery(p.package_name, filterPkg) ||
          matchesQuery(p.package_id, filterPkg)
      )
      .sort((a, b) => sortId(a.package_id, b.package_id));
  }, [data, mode, filterPkg]);

  /** Package workspace: tiers linked to this package via package_solution_tiers (or unassigned tiers for standalone). */
  const tiersForWorkspacePackage = useMemo(() => {
    if (!data || mode !== "package" || pkgId == null) return [];
    if (pkgId === STANDALONE_PACKAGE_NAV_ID) {
      const assigned = assignedTierIdSet(data.packageTiers);
      return data.tiers
        .filter((t) => !assigned.has(t.solution_tier_id))
        .sort((a, b) => sortId(a.solution_tier_id, b.solution_tier_id));
    }
    const ids = tierIdsForPackage(data.packageTiers, pkgId);
    return data.tiers
      .filter((t) => ids.has(t.solution_tier_id))
      .sort((a, b) => sortId(a.solution_tier_id, b.solution_tier_id));
  }, [data, mode, pkgId]);

  /** All tiers for the selected solution (unfiltered) — used for tierId validation, not search UI. */
  const tiersForSolution = useMemo(() => {
    if (!data || !solId) return [];
    return data.tiers
      .filter((t) => t.solution_id === solId)
      .sort((a, b) => sortId(a.solution_tier_id, b.solution_tier_id));
  }, [data, solId]);

  const tiersNavList = useMemo(() => {
    const base =
      mode === "package" && pkgId != null ? tiersForWorkspacePackage : tiersForSolution;
    return base.filter(
      (t) =>
        matchesQuery(t.solution_tier_name, filterTier) ||
        matchesQuery(t.solution_tier_id, filterTier)
    );
  }, [mode, pkgId, tiersForWorkspacePackage, tiersForSolution, filterTier]);

  const selectedTier = useMemo(() => {
    if (!data || !tierId) return null;
    return data.tiers.find((t) => t.solution_tier_id === tierId) ?? null;
  }, [data, tierId]);

  const selectedPricing = useMemo(() => {
    if (!data || !tierId) return null;
    return data.pricing.find((p) => p.solution_tier_id === tierId) ?? null;
  }, [data, tierId]);

  const tasksForTier = useMemo(() => {
    if (!data || !tierId) return [];
    return data.tasks
      .filter((t) => t.solution_tier_id === tierId)
      .sort((a, b) => sortId(a.task_id, b.task_id));
  }, [data, tierId]);

  /** Sums for the tier tasks table footer (Time + Duration columns). */
  const taskTableTotals = useMemo(() => {
    let sumTime = 0;
    let sumDuration = 0;
    let anyTime = false;
    let anyDuration = false;
    for (const t of tasksForTier) {
      if (t.task_time != null && Number.isFinite(Number(t.task_time))) {
        sumTime += Number(t.task_time);
        anyTime = true;
      }
      if (t.task_duration != null && Number.isFinite(Number(t.task_duration))) {
        sumDuration += Number(t.task_duration);
        anyDuration = true;
      }
    }
    return { sumTime, sumDuration, anyTime, anyDuration };
  }, [tasksForTier]);

  /** KPI scope: selected tier’s tasks, or all tasks matching search filters across hierarchy. */
  const tasksForKpi = useMemo(() => {
    if (!data) return [];
    if (tierId) {
      return data.tasks
        .filter((t) => t.solution_tier_id === tierId)
        .sort((a, b) => sortId(a.task_id, b.task_id));
    }
    return data.tasks
      .filter((task) => {
        const tier = data.tiers.find(
          (x) => x.solution_tier_id === task.solution_tier_id
        );
        if (!tier) return false;
        const sol = data.solutions.find((x) => x.solution_id === tier.solution_id);
        if (!sol) return false;
        const solOk =
          matchesQuery(sol.solution_name, filterSol) ||
          matchesQuery(sol.solution_id, filterSol);
        const tierOk =
          matchesQuery(tier.solution_tier_name, filterTier) ||
          matchesQuery(tier.solution_tier_id, filterTier);
        return solOk && tierOk;
      })
      .sort((a, b) => sortId(a.task_id, b.task_id));
  }, [data, tierId, filterSol, filterTier]);

  const taskKpis = useMemo(() => {
    const list = tasksForKpi;
    const n = list.length;
    let sumTime = 0;
    let sumDur = 0;
    const roles = new Set<string>();
    for (const t of list) {
      if (t.task_time != null) sumTime += Number(t.task_time);
      if (t.task_duration != null) sumDur += Number(t.task_duration);
      if (t.task_implementer?.trim()) roles.add(t.task_implementer.trim());
    }
    return {
      count: n,
      sumTime,
      sumDuration: sumDur,
      distinctImplementers: roles.size,
      avgTime: n > 0 ? sumTime / n : 0,
    };
  }, [tasksForKpi]);

  /** Package / solution for the selected tier (not the left-nav package). */
  const solutionForSelectedTier = useMemo(() => {
    if (!data || !selectedTier) return undefined;
    return data.solutions.find((s) => s.solution_id === selectedTier.solution_id);
  }, [data, selectedTier]);

  const packageForSelectedTier = useMemo(() => {
    if (!data || !selectedTier) return undefined;
    const link = data.packageTiers.find(
      (r) => r.solution_tier_id === selectedTier.solution_tier_id
    );
    if (!link) return undefined;
    return data.packages.find((p) => p.package_id === link.package_id);
  }, [data, selectedTier]);

  /**
   * KPIs for the package selected in the catalog (left nav / pkgId) — not derived from the
   * selected tier’s solution, so totals stay correct when solutions appear under one package in the UI.
   */
  const selectedPackageOverview = useMemo(() => {
    if (!data || pkgId == null) return null;
    let tiersInPkg: SolutionTier[];
    if (pkgId === STANDALONE_PACKAGE_NAV_ID) {
      const assigned = assignedTierIdSet(data.packageTiers);
      tiersInPkg = data.tiers.filter((t) => !assigned.has(t.solution_tier_id));
    } else {
      const ids = tierIdsForPackage(data.packageTiers, pkgId);
      tiersInPkg = data.tiers.filter((t) => ids.has(t.solution_tier_id));
    }
    const solutionIds = new Set(tiersInPkg.map((t) => t.solution_id));
    const solutionsInScope = data.solutions.filter((s) => solutionIds.has(s.solution_id));
    const tierIds = new Set(tiersInPkg.map((t) => t.solution_tier_id));

    let sellSum = 0;
    let pricedCount = 0;
    for (const pr of data.pricing) {
      if (!tierIds.has(pr.solution_tier_id)) continue;
      const n = pr.sell_price ?? pr.standalone_sell_price;
      if (n != null && Number.isFinite(Number(n))) {
        sellSum += Number(n);
        pricedCount += 1;
      }
    }

    const tasksInPkg = data.tasks.filter((t) => tierIds.has(t.solution_tier_id));
    const roles = new Set<string>();
    let sumTime = 0;
    for (const t of tasksInPkg) {
      if (t.task_time != null && Number.isFinite(Number(t.task_time))) {
        sumTime += Number(t.task_time);
      }
      if (t.task_implementer?.trim()) roles.add(t.task_implementer.trim());
    }

    const title =
      pkgId === STANDALONE_PACKAGE_NAV_ID
        ? "Standalone solutions"
        : data.packages.find((p) => p.package_id === pkgId)?.package_name ?? "Package";

    return {
      title,
      packageIdLabel: pkgId === STANDALONE_PACKAGE_NAV_ID ? "Standalone" : pkgId,
      solutionsCount: solutionsInScope.length,
      tiersCount: tiersInPkg.length,
      sellTotalDisplay: pricedCount > 0 ? formatUsd(sellSum) : "—",
      distinctImplementers: roles.size,
      sumTaskTime: sumTime,
    };
  }, [data, pkgId]);

  const kpiScopeLine = useMemo(() => {
    if (!data) return "";
    if (tierId && selectedTier && solutionForSelectedTier) {
      const parts: string[] = [];
      if (packageForSelectedTier) parts.push(packageForSelectedTier.package_name);
      else parts.push("Standalone");
      parts.push(solutionForSelectedTier.solution_name);
      parts.push(selectedTier.solution_tier_name);
      return `Scope: ${parts.join(" → ")}`;
    }
    return "Scope: pick a tier in the sidebar to show pricing and task KPIs.";
  }, [data, tierId, selectedTier, solutionForSelectedTier, packageForSelectedTier]);

  /** Full solution × tier price grid for the locked package workspace. */
  const packagePriceMatrix = useMemo(() => {
    if (!data || mode !== "package" || pkgId == null) return [];
    const tierList =
      pkgId === STANDALONE_PACKAGE_NAV_ID
        ? data.tiers.filter((t) => !assignedTierIdSet(data.packageTiers).has(t.solution_tier_id))
        : data.tiers.filter((t) => tierIdsForPackage(data.packageTiers, pkgId).has(t.solution_tier_id));
    const bySol = new Map<string, SolutionTier[]>();
    for (const t of tierList) {
      const arr = bySol.get(t.solution_id) ?? [];
      arr.push(t);
      bySol.set(t.solution_id, arr);
    }
    const rows: Array<{
      solution: Solution;
      tier: SolutionTier;
      sell: string;
      tax: string;
    }> = [];
    for (const s of [...data.solutions].sort((a, b) => sortId(a.solution_id, b.solution_id))) {
      const trs = bySol.get(s.solution_id);
      if (!trs?.length) continue;
      for (const t of [...trs].sort((a, b) => sortId(a.solution_tier_id, b.solution_tier_id))) {
        const pr =
          data.pricing.find((p) => p.solution_tier_id === t.solution_tier_id) ?? null;
        rows.push({
          solution: s,
          tier: t,
          sell: sellPriceDisplay(pr),
          tax: taxableLabel(pr),
        });
      }
    }
    return rows;
  }, [data, mode, pkgId]);

  useEffect(() => {
    if (mode === "catalog") return;
    if (!pkgId && solId) {
      if (solId !== null) setSolId(null);
      if (tierId !== null) setTierId(null);
    }
  }, [mode, pkgId, solId, tierId]);

  useEffect(() => {
    if (!data) return;
    if (mode === "catalog" && pkgId == null) {
      const sorted = [...data.solutions].sort((a, b) =>
        sortId(a.solution_id, b.solution_id)
      );
      if (sorted.length === 0) {
        if (solId !== null) setSolId(null);
        return;
      }
      if (!solId || !sorted.some((s) => s.solution_id === solId)) {
        setSolId(sorted[0].solution_id);
      }
      return;
    }
    if (mode === "package") return;
    if (pkgId == null) return;
    if (solutionsVisible.length === 0) {
      if (solId !== null) setSolId(null);
      return;
    }
    if (!solId || !solutionsVisible.some((s) => s.solution_id === solId)) {
      setSolId(solutionsVisible[0]?.solution_id ?? null);
    }
  }, [data, mode, pkgId, solutionsVisible, solId]);

  useEffect(() => {
    if (!data) return;
    if (mode === "package" && pkgId != null) {
      const list = tiersForWorkspacePackage;
      if (list.length === 0) {
        if (tierId !== null) setTierId(null);
        if (solId !== null) setSolId(null);
        return;
      }
      if (!tierId || !list.some((t) => t.solution_tier_id === tierId)) {
        const pick = list[0];
        setTierId(pick.solution_tier_id);
        setSolId(pick.solution_id);
        return;
      }
      const match = list.find((t) => t.solution_tier_id === tierId);
      if (match && match.solution_id !== solId) setSolId(match.solution_id);
      return;
    }
    if (!solId) return;
    if (tiersForSolution.length === 0) {
      if (tierId !== null) setTierId(null);
      return;
    }
    if (!tierId || !tiersForSolution.some((t) => t.solution_tier_id === tierId)) {
      setTierId(tiersForSolution[0]?.solution_tier_id ?? null);
    }
  }, [data, mode, pkgId, tiersForWorkspacePackage, solId, tiersForSolution, tierId]);

  const heroEyebrow =
    mode === "package" ? "Agency · package workspace" : "Agency · full catalog";

  return (
    <div className="agency-view-shell" style={layout.shell}>
      <header className="agency-page-header">
        <div className="agency-hero-top">
          <span className="agency-hero__eyebrow">{heroEyebrow}</span>
          {state.status !== "loading" && state.status !== "idle" && (
            <button
              type="button"
              className="agency-btn-secondary agency-hero__refresh"
              style={btnSecondary}
              onClick={() => void load()}
            >
              Refresh data
            </button>
          )}
        </div>
        <h1 style={layout.title}>{AGENCY_HERO_TITLE}</h1>
        <p className="agency-hero__desc" style={layout.subtitle}>
          {AGENCY_VIEW_DESCRIPTION}{" "}
          {mode === "catalog" ? (
            <>
              Use the <Link className="agency-hub__link" to="/packages">Packages</Link> tab to open
              a package workspace (tiers and pricing for that bundle).
            </>
          ) : (
            <>
              Use the <Link className="agency-hub__link" to="/">All solutions</Link> tab to search
              tiers across the entire catalog.
            </>
          )}
        </p>
      </header>

      {state.status === "error" && (
        <div style={bannerError} role="alert">
          {state.message}
        </div>
      )}

      {state.status === "loading" && (
        <div style={loadingBox}>Loading from Supabase…</div>
      )}

      {data && data.packages.length === 0 && (
        <div style={bannerInfo} role="status">
          <strong>No rows returned from Supabase.</strong> The API call succeeded, but{" "}
          <code style={codeInline}>packages</code> is empty. Typical causes:
          <ol style={infoList}>
            <li>
              Tables have not been seeded — open{" "}
              <strong>Table Editor</strong> and confirm rows exist in{" "}
              <code style={codeInline}>packages</code>,{" "}
              <code style={codeInline}>solutions</code>,{" "}
              <code style={codeInline}>solution_tiers</code>,{" "}
              <code style={codeInline}>tasks</code>. Run your INSERT SQL from the SQL
              Editor if needed.
            </li>
            <li>
              <strong>Row Level Security</strong> is on without a SELECT policy for
              the role your key uses — run the policies script in{" "}
              <code style={codeInline}>supabase/read_policies_for_dashboard.sql</code>{" "}
              (or add equivalent SELECT policies), then refresh.
            </li>
            <li>
              Table names in the dashboard differ (must be lowercase{" "}
              <code style={codeInline}>packages</code>,{" "}
              <code style={codeInline}>solutions</code>, etc.).
            </li>
          </ol>
        </div>
      )}

      {data && mode === "package" && packageRouteInvalid && (
        <div className="agency-route-error" role="alert">
          <p className="agency-route-error__text">
            This package link is not valid. Use the Packages tab to load a workspace.
          </p>
          <Link className="agency-hub__link" to="/packages">
            ← Packages
          </Link>
        </div>
      )}

      {data && !(mode === "package" && packageRouteInvalid) && (
        <div className="kb-grid" style={layout.grid}>
          <nav
            className="kb-nav"
            aria-label={
              mode === "package" ? "Packages and solution tiers" : "Solutions and tiers"
            }
          >
            {mode === "package" ? (
              <>
                <div className="agency-nav-panel">
                  <section style={navSection}>
                    <h2 style={navHeading}>Packages</h2>
                    {data.packages.length === 0 ? (
                      <p style={emptyHint}>No packages in the vault yet.</p>
                    ) : (
                      <>
                        <div className="agency-nav-sol-filter">
                          <label className="agency-nav-sol-filter__label" htmlFor={pkgSearchFieldId}>
                            Search packages
                          </label>
                          <div className="agency-nav-sol-filter__row">
                            <input
                              id={pkgSearchFieldId}
                              type="search"
                              className="agency-nav-sol-filter__input"
                              value={filterPkg}
                              onChange={(e) => setFilterPkg(e.target.value)}
                              placeholder="Filter by name or package ID…"
                              autoComplete="off"
                            />
                            {filterPkg && (
                              <button
                                type="button"
                                className="agency-nav-sol-filter__clear"
                                onClick={() => setFilterPkg("")}
                              >
                                Clear
                              </button>
                            )}
                          </div>
                        </div>
                        <ul style={list}>
                          {packagesNavRows.length === 0 ? (
                            <li>
                              <p style={{ ...emptyHint, padding: "0.35rem 0 0" }}>
                                No packages match this search.
                              </p>
                            </li>
                          ) : (
                            packagesNavRows.map((p) => (
                              <li key={p.package_id}>
                                <button
                                  type="button"
                                  className={
                                    pkgId === p.package_id
                                      ? "kb-nav-item kb-nav-item--active"
                                      : "kb-nav-item"
                                  }
                                  title={`${p.package_name} (${p.package_id})`}
                                  onClick={() => {
                                    setFilterPkg("");
                                    navigate(`/package/${encodeURIComponent(p.package_id)}`);
                                  }}
                                >
                                  <span className="kb-nav-item__label">{p.package_name}</span>
                                  <span className="kb-nav-item__meta" style={idChip}>
                                    {p.package_id}
                                  </span>
                                </button>
                              </li>
                            ))
                          )}
                        </ul>
                      </>
                    )}
                  </section>
                </div>

                <div className="agency-nav-panel">
                  <section style={navSection}>
                    <h2 style={navHeading}>Solution tiers</h2>
                    {pkgId == null ? (
                      <p style={emptyHint}>Select a package above.</p>
                    ) : tiersForWorkspacePackage.length === 0 ? (
                      <p style={emptyHint}>No tiers in this package.</p>
                    ) : (
                      <>
                        <div className="agency-nav-sol-filter">
                          <label className="agency-nav-sol-filter__label" htmlFor={tierSearchFieldId}>
                            Search solution tiers
                          </label>
                          <div className="agency-nav-sol-filter__row">
                            <input
                              id={tierSearchFieldId}
                              type="search"
                              className="agency-nav-sol-filter__input"
                              value={filterTier}
                              onChange={(e) => setFilterTier(e.target.value)}
                              placeholder="Filter by name or tier ID…"
                              autoComplete="off"
                            />
                            {filterTier && (
                              <button
                                type="button"
                                className="agency-nav-sol-filter__clear"
                                onClick={() => setFilterTier("")}
                              >
                                Clear
                              </button>
                            )}
                          </div>
                        </div>
                        <ul style={list}>
                          {tiersNavList.length === 0 ? (
                            <li>
                              <p style={{ ...emptyHint, padding: "0.35rem 0 0" }}>
                                No solution tiers match this search.
                              </p>
                            </li>
                          ) : (
                            tiersNavList.map((t) => (
                              <li key={t.solution_tier_id}>
                                <button
                                  type="button"
                                  className={
                                    tierId === t.solution_tier_id
                                      ? "kb-nav-item kb-nav-item--active"
                                      : "kb-nav-item"
                                  }
                                  title={tierNavTitle(t, data.solutions)}
                                  onClick={() => {
                                    setTierId(t.solution_tier_id);
                                    setSolId(t.solution_id);
                                    setFilterTier("");
                                  }}
                                >
                                  <span className="kb-nav-item__label">{t.solution_tier_name}</span>
                                  <span className="kb-nav-item__meta" style={idChip}>
                                    {t.solution_tier_id}
                                  </span>
                                </button>
                              </li>
                            ))
                          )}
                        </ul>
                      </>
                    )}
                  </section>
                </div>
              </>
            ) : (
              <>
                <div className="agency-nav-panel">
                  <section style={navSection}>
                    <h2 style={navHeading}>Solutions</h2>
                    <div className="agency-nav-sol-filter">
                      <label className="agency-nav-sol-filter__label" htmlFor={solSearchFieldId}>
                        Search solutions
                      </label>
                      <div className="agency-nav-sol-filter__row">
                        <input
                          id={solSearchFieldId}
                          type="search"
                          className="agency-nav-sol-filter__input"
                          value={filterSol}
                          onChange={(e) => setFilterSol(e.target.value)}
                          placeholder="Filter by name or ID…"
                          autoComplete="off"
                        />
                        {filterSol && (
                          <button
                            type="button"
                            className="agency-nav-sol-filter__clear"
                            onClick={() => setFilterSol("")}
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>
                    <ul style={list}>
                      {solutionsNavRows.length === 0 ? (
                        <li>
                          <p style={{ ...emptyHint, padding: "0.35rem 0 0" }}>
                            No solutions match this search.
                          </p>
                        </li>
                      ) : (
                        solutionsNavRows.map((s) => (
                          <li key={s.solution_id}>
                            <button
                              type="button"
                              className={
                                solId === s.solution_id
                                  ? "kb-nav-item kb-nav-item--active"
                                  : "kb-nav-item"
                              }
                              title={solutionNavTitle(s)}
                              onClick={() => {
                                setSolId(s.solution_id);
                                const tr = data.tiers
                                  .filter((tier) => tier.solution_id === s.solution_id)
                                  .sort((a, b) =>
                                    sortId(a.solution_tier_id, b.solution_tier_id)
                                  )[0];
                                setTierId(tr?.solution_tier_id ?? null);
                              }}
                            >
                              <span className="kb-nav-item__label">{s.solution_name}</span>
                              <span className="kb-nav-item__meta" style={idChip}>
                                {s.solution_id}
                              </span>
                            </button>
                          </li>
                        ))
                      )}
                    </ul>
                  </section>
                </div>

                <div className="agency-nav-panel">
                  <section style={navSection}>
                    <h2 style={navHeading}>Tiers</h2>
                    {!solId ? (
                      <p style={emptyHint}>Pick a solution above to list its tiers.</p>
                    ) : tiersForSolution.length === 0 ? (
                      <p style={emptyHint}>No tiers for this solution.</p>
                    ) : (
                      <>
                        <div className="agency-nav-sol-filter">
                          <label className="agency-nav-sol-filter__label" htmlFor={tierSearchFieldId}>
                            Search tiers
                          </label>
                          <div className="agency-nav-sol-filter__row">
                            <input
                              id={tierSearchFieldId}
                              type="search"
                              className="agency-nav-sol-filter__input"
                              value={filterTier}
                              onChange={(e) => setFilterTier(e.target.value)}
                              placeholder="Filter by name or tier ID…"
                              autoComplete="off"
                            />
                            {filterTier && (
                              <button
                                type="button"
                                className="agency-nav-sol-filter__clear"
                                onClick={() => setFilterTier("")}
                              >
                                Clear
                              </button>
                            )}
                          </div>
                        </div>
                        <ul style={list}>
                          {tiersNavList.length === 0 ? (
                            <li>
                              <p style={{ ...emptyHint, padding: "0.35rem 0 0" }}>
                                No tiers match this search.
                              </p>
                            </li>
                          ) : (
                            tiersNavList.map((t) => (
                              <li key={t.solution_tier_id}>
                                <button
                                  type="button"
                                  className={
                                    tierId === t.solution_tier_id
                                      ? "kb-nav-item kb-nav-item--active"
                                      : "kb-nav-item"
                                  }
                                  title={tierNavTitle(t, data.solutions)}
                                  onClick={() => {
                                    setTierId(t.solution_tier_id);
                                    setSolId(t.solution_id);
                                    setFilterTier("");
                                  }}
                                >
                                  <span className="kb-nav-item__label">{t.solution_tier_name}</span>
                                  <span className="kb-nav-item__meta" style={idChip}>
                                    {t.solution_tier_id}
                                  </span>
                                </button>
                              </li>
                            ))
                          )}
                        </ul>
                      </>
                    )}
                  </section>
                </div>
              </>
            )}
          </nav>

          <main style={layout.main}>
            {mode === "package" && pkgId != null && (
              <div className="agency-package-workspace-bar">
                <Link className="agency-hub__link agency-package-workspace-bar__back" to="/">
                  ← All solutions
                </Link>
                {selectedPackageOverview && (
                  <span className="agency-package-workspace-bar__context">
                    <strong>{selectedPackageOverview.title}</strong>
                    <span className="agency-package-workspace-bar__id">
                      {" "}
                      · {selectedPackageOverview.packageIdLabel}
                    </span>
                  </span>
                )}
              </div>
            )}

            {selectedPackageOverview && (
              <section
                className="agency-kpi-panel agency-kpi-panel--scope agency-kpi-panel--package"
                style={kpiSectionWrap}
                aria-label="Package overview"
              >
                <div className="agency-kpi-panel__head">
                  <h2 className="agency-kpi-panel__title">Package overview</h2>
                  <p className="agency-kpi-panel__scope">
                    <strong>{selectedPackageOverview.title}</strong>
                    <span style={{ opacity: 0.85 }}> · {selectedPackageOverview.packageIdLabel}</span>
                    <br />
                    Totals include every solution and tier in this package (not tied to the tier
                    selected for scope summary below).
                  </p>
                </div>
                <div className="agency-kpi-panel__grid">
                  <div className="agency-kpi-card agency-kpi-card--tasks">
                    <span className="agency-kpi-card__label">Solutions in package</span>
                    <span className="agency-kpi-card__value">
                      {selectedPackageOverview.solutionsCount}
                    </span>
                  </div>
                  <div className="agency-kpi-card agency-kpi-card--tasks">
                    <span className="agency-kpi-card__label">Tiers in package</span>
                    <span className="agency-kpi-card__value">
                      {selectedPackageOverview.tiersCount}
                    </span>
                  </div>
                  <div className="agency-kpi-card agency-kpi-card--pricing">
                    <span className="agency-kpi-card__label">Sell total (package)</span>
                    <span className="agency-kpi-card__value">
                      {selectedPackageOverview.sellTotalDisplay}
                    </span>
                  </div>
                  <div className="agency-kpi-card agency-kpi-card--tasks">
                    <span className="agency-kpi-card__label">Distinct implementers</span>
                    <span className="agency-kpi-card__value">
                      {selectedPackageOverview.distinctImplementers}
                    </span>
                  </div>
                  <div className="agency-kpi-card agency-kpi-card--tasks">
                    <span className="agency-kpi-card__label">Sum of task time</span>
                    <span className="agency-kpi-card__value">
                      {formatKpiNumber(selectedPackageOverview.sumTaskTime)}
                    </span>
                  </div>
                </div>
              </section>
            )}

            {mode === "package" && packagePriceMatrix.length > 0 && (
              <section
                className="agency-package-matrix"
                aria-label="Sell prices for every tier in this package"
              >
                <div className="agency-package-matrix__head">
                  <h2 className="agency-package-matrix__title">Price sheet (this package)</h2>
                  <p className="agency-package-matrix__lede">
                    Every solution tier in the package and its sell price from the vault.
                  </p>
                </div>
                <div className="agency-package-matrix__scroll">
                  <table className="agency-package-matrix__table">
                    <thead>
                      <tr>
                        <th scope="col">Solution</th>
                        <th scope="col">Tier</th>
                        <th scope="col">Sell</th>
                        <th scope="col">Tax</th>
                      </tr>
                    </thead>
                    <tbody>
                      {packagePriceMatrix.map((row) => (
                        <tr key={row.tier.solution_tier_id}>
                          <td>{row.solution.solution_name}</td>
                          <td>{row.tier.solution_tier_name}</td>
                          <td>{row.sell}</td>
                          <td>{row.tax}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {(data.packages.length > 0 || data.solutions.length > 0) && (
              <section
                className="agency-kpi-panel agency-kpi-panel--scope"
                style={kpiSectionWrap}
                aria-label="Tier pricing and task summary"
              >
                <div className="agency-kpi-panel__head">
                  <h2 className="agency-kpi-panel__title">Scope summary</h2>
                  <p className="agency-kpi-panel__scope">{kpiScopeLine}</p>
                </div>
                <div className="agency-kpi-panel__grid agency-kpi-panel__grid--four">
                  <div className="agency-kpi-card agency-kpi-card--pricing">
                    <span className="agency-kpi-card__label">Sell price</span>
                    <span className="agency-kpi-card__value">
                      {tierId && selectedTier
                        ? sellPriceDisplay(selectedPricing)
                        : "—"}
                    </span>
                  </div>
                  <div className="agency-kpi-card agency-kpi-card--pricing">
                    <span className="agency-kpi-card__label">Tax status</span>
                    <span className="agency-kpi-card__value agency-kpi-card__value--text">
                      {tierId && selectedTier
                        ? taxableLabel(selectedPricing)
                        : "—"}
                    </span>
                  </div>
                  <div className="agency-kpi-card agency-kpi-card--tasks">
                    <span className="agency-kpi-card__label">
                      Distinct implementers
                    </span>
                    <span className="agency-kpi-card__value">
                      {taskKpis.distinctImplementers}
                    </span>
                  </div>
                  <div className="agency-kpi-card agency-kpi-card--tasks">
                    <span className="agency-kpi-card__label">Sum of task time</span>
                    <span className="agency-kpi-card__value">
                      {formatKpiNumber(taskKpis.sumTime)}
                    </span>
                  </div>
                </div>
              </section>
            )}

            {!selectedTier ? (
              <p style={emptyHint}>Select a tier to view details.</p>
            ) : (
              <>
                <div className="agency-breadcrumb" style={breadcrumb}>
                  {packageForSelectedTier ? (
                    <span>
                      <strong>{packageForSelectedTier.package_name}</strong>
                    </span>
                  ) : !packageForSelectedTier ? (
                    <span>
                      <strong>Standalone solutions</strong>
                    </span>
                  ) : null}
                  {solutionForSelectedTier && (
                    <>
                      <span style={bcSep}>›</span>
                      <span>{solutionForSelectedTier.solution_name}</span>
                    </>
                  )}
                  <span style={bcSep}>›</span>
                  <span>{selectedTier.solution_tier_name}</span>
                </div>

                <article className="agency-article" style={articleCard}>
                  <header style={articleHead}>
                    <h2 style={articleTitle}>{selectedTier.solution_tier_name}</h2>
                    {selectedTier.solution_tier_owner && (
                      <p style={ownerLine}>
                        Owner:{" "}
                        <strong>{selectedTier.solution_tier_owner}</strong>
                      </p>
                    )}
                    {selectedTier.solution_tier_overview_link && (
                      <p style={metaLine}>
                        Link label: {selectedTier.solution_tier_overview_link}
                      </p>
                    )}
                  </header>

                  {selectedPricing ? (
                    <section className="agency-pricing" style={block}>
                      <h3 className="agency-block-title" style={blockTitle}>
                        Pricing
                      </h3>
                      {selectedPricing.scope ? (
                        <div className="agency-pricing__scope-wrap">
                          <p className="agency-pricing__scope pre-wrap">
                            {selectedPricing.scope}
                          </p>
                        </div>
                      ) : null}
                      <div className="agency-pricing__panel">
                        <div className="agency-pricing__band agency-pricing__band--money">
                          <span className="agency-pricing__band-label">
                            Revenue & cost basis
                          </span>
                          <div className="agency-pricing__grid agency-pricing__grid--money">
                            <div className="agency-pricing__stat agency-pricing__stat--money">
                              <span className="agency-pricing__stat-label">Sell price</span>
                              <span className="agency-pricing__stat-value">
                                {formatUsd(selectedPricing.sell_price)}
                              </span>
                            </div>
                            <div className="agency-pricing__stat agency-pricing__stat--money">
                              <span className="agency-pricing__stat-label">
                                Standalone sell
                              </span>
                              <span className="agency-pricing__stat-value">
                                {formatUsd(selectedPricing.standalone_sell_price)}
                              </span>
                            </div>
                            <div className="agency-pricing__stat agency-pricing__stat--money">
                              <span className="agency-pricing__stat-label">Effort base</span>
                              <span className="agency-pricing__stat-value">
                                {formatUsd(
                                  selectedPricing.expected_effort_base_price
                                )}
                              </span>
                            </div>
                            <div className="agency-pricing__stat agency-pricing__stat--money">
                              <span className="agency-pricing__stat-label">
                                Risk-mitigated base
                              </span>
                              <span className="agency-pricing__stat-value">
                                {formatUsd(
                                  selectedPricing.risk_mitigated_base_price
                                )}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="agency-pricing__band agency-pricing__band--meta">
                          <span className="agency-pricing__band-label">
                            Hours & commercial terms
                          </span>
                          <div className="agency-pricing__grid agency-pricing__grid--meta">
                            <div className="agency-pricing__stat agency-pricing__stat--meta">
                              <span className="agency-pricing__stat-label">
                                Total hours
                              </span>
                              <span className="agency-pricing__stat-value agency-pricing__stat-value--meta">
                                {formatKpiNumber(
                                  Number(selectedPricing.total_hours ?? 0)
                                )}
                              </span>
                            </div>
                            <div className="agency-pricing__stat agency-pricing__stat--meta">
                              <span className="agency-pricing__stat-label">
                                Customization
                              </span>
                              <span className="agency-pricing__stat-value agency-pricing__stat-value--meta">
                                {selectedPricing.requires_customization
                                  ? "Yes"
                                  : "No"}
                              </span>
                            </div>
                            <div className="agency-pricing__stat agency-pricing__stat--meta">
                              <span className="agency-pricing__stat-label">Taxable</span>
                              <span className="agency-pricing__stat-value agency-pricing__stat-value--meta">
                                {selectedPricing.taxable ? "Yes" : "No"}
                              </span>
                            </div>
                            <div className="agency-pricing__stat agency-pricing__stat--meta">
                              <span className="agency-pricing__stat-label">
                                % change vs old
                              </span>
                              <span className="agency-pricing__stat-value agency-pricing__stat-value--meta">
                                {(selectedPricing.percent_change ?? "").trim()
                                  ? selectedPricing.percent_change
                                  : "—"}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                      {selectedPricing.tags ? (
                        <p className="agency-pricing__tags">
                          <span className="agency-pricing__tags-label">Tags</span>
                          {selectedPricing.tags}
                        </p>
                      ) : null}
                      {selectedPricing.notes ? (
                        <div className="agency-pricing__notes">
                          <h4 className="agency-pricing__notes-title">Pricing notes</h4>
                          <div className="agency-pricing__notes-body pre-wrap">
                            {selectedPricing.notes}
                          </div>
                        </div>
                      ) : null}
                    </section>
                  ) : (
                    <section style={block}>
                      <h3 className="agency-block-title" style={blockTitle}>
                        Pricing
                      </h3>
                      <p style={emptyHint}>
                        No pricing row for this tier yet. Add one in Admin → Pricing.
                      </p>
                    </section>
                  )}

                  {selectedTier.solution_tier_overview && (
                    <section style={block}>
                      <h3 className="agency-block-title" style={blockTitle}>
                        Overview
                      </h3>
                      <div className="pre-wrap">{selectedTier.solution_tier_overview}</div>
                    </section>
                  )}

                  {selectedTier.solution_tier_what_is_it && (
                    <section style={block}>
                      <h3 className="agency-block-title" style={blockTitle}>
                        What is it
                      </h3>
                      <div className="pre-wrap">{selectedTier.solution_tier_what_is_it}</div>
                    </section>
                  )}

                  {selectedTier.solution_tier_why_is_it_valuable && (
                    <section style={block}>
                      <h3 className="agency-block-title" style={blockTitle}>
                        Why is it valuable
                      </h3>
                      <div className="pre-wrap">{selectedTier.solution_tier_why_is_it_valuable}</div>
                    </section>
                  )}

                  {selectedTier.solution_tier_when_should_it_be_used && (
                    <section style={block}>
                      <h3 className="agency-block-title" style={blockTitle}>
                        When should it be used
                      </h3>
                      <div className="pre-wrap">{selectedTier.solution_tier_when_should_it_be_used}</div>
                    </section>
                  )}

                  {selectedTier.solution_tier_assumption_prerequisites && (
                    <section style={block}>
                      <h3 className="agency-block-title" style={blockTitle}>
                        Assumptions and prerequisites
                      </h3>
                      <div className="pre-wrap">{selectedTier.solution_tier_assumption_prerequisites}</div>
                    </section>
                  )}

                  {selectedTier.solution_tier_in_scope && (
                    <section style={block}>
                      <h3 className="agency-block-title" style={blockTitle}>
                        In scope
                      </h3>
                      <div className="pre-wrap">{selectedTier.solution_tier_in_scope}</div>
                    </section>
                  )}

                  {selectedTier.solution_tier_out_of_scope && (
                    <section style={block}>
                      <h3 className="agency-block-title" style={blockTitle}>
                        Out of scope
                      </h3>
                      <div className="pre-wrap">{selectedTier.solution_tier_out_of_scope}</div>
                    </section>
                  )}

                  {selectedTier.solution_tier_final_deliverable && (
                    <section style={block}>
                      <h3 className="agency-block-title" style={blockTitle}>
                        Final deliverable
                      </h3>
                      <div className="pre-wrap">{selectedTier.solution_tier_final_deliverable}</div>
                    </section>
                  )}

                  {selectedTier.solution_tier_how_do_we_get_this_work_done && (
                    <section style={block}>
                      <h3 className="agency-block-title" style={blockTitle}>
                        How we get this work done
                      </h3>
                      <div className="pre-wrap">{selectedTier.solution_tier_how_do_we_get_this_work_done}</div>
                    </section>
                  )}

                  {selectedTier.solution_tier_direction && (
                    <section style={block}>
                      <h3 className="agency-block-title" style={blockTitle}>
                        Direction
                      </h3>
                      <div className="pre-wrap">{selectedTier.solution_tier_direction}</div>
                    </section>
                  )}

                  {selectedTier.solution_tier_sop && (
                    <section style={block}>
                      <h3 className="agency-block-title" style={blockTitle}>
                        SOP
                      </h3>
                      <div className="pre-wrap">{selectedTier.solution_tier_sop}</div>
                    </section>
                  )}

                  {selectedTier.solution_tier_described_to_client && (
                    <section style={block}>
                      <h3 className="agency-block-title" style={blockTitle}>
                        How this can be described to the client
                      </h3>
                      <div className="pre-wrap">{selectedTier.solution_tier_described_to_client}</div>
                    </section>
                  )}

                  {selectedTier.solution_tier_resources && (
                    <section style={block}>
                      <h3 className="agency-block-title" style={blockTitle}>
                        Resources
                      </h3>
                      <div className="pre-wrap">
                        {selectedTier.solution_tier_resources}
                      </div>
                    </section>
                  )}
                </article>

                <section className="agency-tasks-panel" style={tasksSection}>
                  <h2 className="agency-tasks-panel__title" style={tasksTitle}>
                    Tasks ({tasksForTier.length})
                  </h2>
                  {tasksForTier.length === 0 ? (
                    <p style={emptyHint}>No tasks for this tier.</p>
                  ) : (
                    <div className="agency-task-table-wrap">
                      <table className="agency-task-table">
                        <thead>
                          <tr>
                            <th scope="col">Task</th>
                            <th scope="col">Implementer</th>
                            <th scope="col" className="agency-task-table__th--num">
                              Time
                            </th>
                            <th scope="col" className="agency-task-table__th--num">
                              Duration
                            </th>
                            <th scope="col">Dependencies</th>
                            <th scope="col">Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tasksForTier.map((t) => (
                            <tr key={t.task_id}>
                              <td>
                                <span className="agency-task-table__name">{t.task_name}</span>
                                <span className="agency-task-table__task-id">{t.task_id}</span>
                              </td>
                              <td>{t.task_implementer ?? "—"}</td>
                              <td className="agency-task-table__td--num">
                                {t.task_time != null ? formatKpiNumber(Number(t.task_time)) : "—"}
                              </td>
                              <td className="agency-task-table__td--num">
                                {t.task_duration != null
                                  ? formatKpiNumber(Number(t.task_duration))
                                  : "—"}
                              </td>
                              <td className="agency-task-table__td--meta">
                                {t.task_dependencies ?? "—"}
                              </td>
                              <td className="agency-task-table__td--meta">
                                {t.task_notes ?? "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="agency-task-table__totals-row">
                            <td colSpan={2} className="agency-task-table__totals-label">
                              Totals
                            </td>
                            <td className="agency-task-table__td--num agency-task-table__totals-value">
                              {taskTableTotals.anyTime
                                ? formatKpiNumber(taskTableTotals.sumTime)
                                : "—"}
                            </td>
                            <td className="agency-task-table__td--num agency-task-table__totals-value">
                              {taskTableTotals.anyDuration
                                ? formatKpiNumber(taskTableTotals.sumDuration)
                                : "—"}
                            </td>
                            <td colSpan={2} className="agency-task-table__totals-meta">
                              {tasksForTier.length} task{tasksForTier.length === 1 ? "" : "s"}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </section>
              </>
            )}
          </main>
        </div>
      )}
    </div>
  );
}

const layout = {
  shell: {
    minHeight: "100%",
  } satisfies CSSProperties,
  title: {
    margin: "0 0 0.6rem",
    fontSize: "1.5rem",
    fontWeight: 700,
    letterSpacing: "-0.035em",
    lineHeight: 1.22,
    maxWidth: "min(100%, 42rem)",
  },
  subtitle: {
    margin: 0,
    color: "var(--muted)",
    fontSize: "0.94rem",
    maxWidth: "min(100%, 68rem)",
    lineHeight: 1.55,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "minmax(220px, 280px) 1fr",
    gap: "1.85rem",
    alignItems: "start",
  } satisfies CSSProperties,
  main: {
    minWidth: 0,
  },
};

const navSection: CSSProperties = {
  marginBottom: "1.25rem",
};

const navHeading: CSSProperties = {
  margin: "0 0 0.5rem",
  fontSize: "0.7rem",
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  color: "var(--muted)",
  fontWeight: 600,
};

const list: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column" as const,
  gap: 6,
};

const idChip: CSSProperties = {
  fontSize: "0.7rem",
  color: "var(--muted)",
  fontWeight: 500,
  flexShrink: 0,
};

const emptyHint: CSSProperties = {
  margin: 0,
  fontSize: "0.85rem",
  color: "var(--muted)",
};

const bannerError: CSSProperties = {
  padding: "0.85rem 1rem",
  borderRadius: "var(--radius)",
  background: "#fef2f2",
  border: "1px solid #fecaca",
  color: "var(--danger)",
  marginBottom: "1rem",
  fontSize: "0.9rem",
};

const bannerInfo: CSSProperties = {
  padding: "1rem 1.1rem",
  borderRadius: "var(--radius)",
  background: "#f0f9ff",
  border: "1px solid #bae6fd",
  color: "#0c4a6e",
  marginBottom: "1rem",
  fontSize: "0.9rem",
  lineHeight: 1.55,
};

const infoList: CSSProperties = {
  margin: "0.65rem 0 0",
  paddingLeft: "1.25rem",
};

const codeInline: CSSProperties = {
  fontSize: "0.85em",
  background: "rgba(0,0,0,0.06)",
  padding: "0.1em 0.35em",
  borderRadius: 4,
  fontFamily: "ui-monospace, monospace",
};

const kpiSectionWrap: CSSProperties = {
  marginBottom: "1.35rem",
};

const loadingBox: CSSProperties = {
  padding: "2rem",
  textAlign: "center" as const,
  color: "var(--muted)",
};

const btnSecondary: CSSProperties = {
  padding: "0.5rem 1rem",
  fontSize: "0.85rem",
  fontWeight: 600,
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
};

const breadcrumb: CSSProperties = {
  fontSize: "0.84rem",
  color: "var(--muted)",
  marginBottom: "1rem",
  display: "flex",
  flexWrap: "wrap" as const,
  alignItems: "center",
  gap: "0.45rem",
  fontWeight: 500,
};

const bcSep: CSSProperties = { opacity: 0.6 };

const articleCard: CSSProperties = {
  padding: "1.35rem 1.4rem 1.4rem 1.55rem",
  marginBottom: "1.35rem",
};

const articleHead: CSSProperties = { marginBottom: "1rem" };

const articleTitle: CSSProperties = {
  margin: 0,
  fontSize: "1.35rem",
  fontWeight: 700,
  letterSpacing: "-0.02em",
};

const ownerLine: CSSProperties = {
  margin: "0.5rem 0 0",
  fontSize: "0.9rem",
  color: "var(--muted)",
};

const metaLine: CSSProperties = {
  margin: "0.35rem 0 0",
  fontSize: "0.85rem",
  color: "var(--muted)",
};

const block: CSSProperties = {
  marginTop: "1.1rem",
  paddingTop: "1rem",
  borderTop: "1px solid var(--border)",
};

const blockTitle: CSSProperties = {
  margin: "0 0 0.55rem",
  fontSize: "0.78rem",
  textTransform: "uppercase" as const,
  letterSpacing: "0.07em",
  color: "var(--text)",
  fontWeight: 700,
};

const tasksSection: CSSProperties = {
  padding: "1.35rem 1.4rem",
};

const tasksTitle: CSSProperties = {
  margin: "0 0 1rem",
  fontSize: "1.08rem",
  fontWeight: 700,
  letterSpacing: "-0.02em",
};
