import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import {
  FilterCombobox,
  type FilterComboOption,
} from "../components/FilterCombobox";
import {
  AGENCY_HERO_TITLE,
  AGENCY_VIEW_DESCRIPTION,
} from "../branding";
import {
  ALL_SOLUTIONS_NAV_ID,
  STANDALONE_PACKAGE_NAV_ID,
} from "../lib/navIds";
import { notifyPackagingDataChanged } from "../lib/packagingEvents";
import {
  browserKeyConfigurationError,
  envConfigured,
  getSupabase,
} from "../lib/supabase";
import type {
  Package,
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

function solutionCatalogHint(s: Solution, packages: Package[]): string {
  if (s.package_id == null) return `${s.solution_id} · standalone`;
  const p = packages.find((x) => x.package_id === s.package_id);
  return p ? `${s.solution_id} · ${p.package_name}` : s.solution_id;
}

function tierCatalogHint(tier: SolutionTier, solutions: Solution[]): string {
  const sol = solutions.find((x) => x.solution_id === tier.solution_id);
  const name = sol?.solution_name ?? tier.solution_id;
  return `${tier.solution_tier_id} · ${name}`;
}

function solutionNavTitle(s: Solution, packages: Package[]): string {
  if (s.package_id == null) return `${s.solution_name} (${s.solution_id}) · standalone`;
  const p = packages.find((x) => x.package_id === s.package_id);
  return p
    ? `${s.solution_name} (${s.solution_id}) · ${p.package_name}`
    : `${s.solution_name} (${s.solution_id})`;
}

function tierNavTitle(tier: SolutionTier, solutions: Solution[]): string {
  const sol = solutions.find((x) => x.solution_id === tier.solution_id);
  const name = sol?.solution_name ?? tier.solution_id;
  return `${tier.solution_tier_name} (${tier.solution_tier_id}) · ${name}`;
}

export function AgencyView() {
  const [state, setState] = useState<LoadState>({ status: "idle" });
  const [pkgId, setPkgId] = useState<string | null>(null);
  const [solId, setSolId] = useState<string | null>(null);
  const [tierId, setTierId] = useState<string | null>(null);
  const [filterPkg, setFilterPkg] = useState("");
  const [filterSol, setFilterSol] = useState("");
  const [filterTier, setFilterTier] = useState("");
  const [openCombo, setOpenCombo] = useState<"pkg" | "sol" | "tier" | null>(
    null
  );

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

    const [pRes, sRes, tRes, kRes, prRes] = await Promise.all([
      client.from("packages").select("*").order("package_id"),
      client.from("solutions").select("*").order("solution_id"),
      client.from("solution_tiers").select("*").order("solution_tier_id"),
      client.from("tasks").select("*").order("task_id"),
      client.from("solution_tier_pricing").select("*").order("solution_tier_id"),
    ]);

    const err =
      pRes.error || sRes.error || tRes.error || kRes.error
        ? [pRes.error, sRes.error, tRes.error, kRes.error].find(Boolean)
        : null;

    if (err) {
      let extra = "";
      const m = err.message;
      if (m.includes("permission") || m.includes("RLS")) {
        extra =
          " — Check Row Level Security: allow SELECT for anon (or sign-in) on packages, solutions, solution_tiers, tasks, and solution_tier_pricing.";
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
    const tasks = (kRes.data ?? []) as TaskRow[];
    const pricing = prRes.error
      ? ([] as SolutionTierPricing[])
      : ((prRes.data ?? []) as SolutionTierPricing[]);

    packages.sort((a, b) => sortId(a.package_id, b.package_id));
    solutions.sort((a, b) => sortId(a.solution_id, b.solution_id));
    tiers.sort((a, b) => sortId(a.solution_tier_id, b.solution_tier_id));
    tasks.sort((a, b) => sortId(a.task_id, b.task_id));

    setState({ status: "ok", packages, solutions, tiers, tasks, pricing });

    const firstPkg = packages[0]?.package_id ?? null;
    const hasStandalone = solutions.some((s) => s.package_id == null);
    if (firstPkg) {
      setPkgId(firstPkg);
      const firstSol = solutions.find((s) => s.package_id === firstPkg)?.solution_id ?? null;
      setSolId(firstSol);
      const firstTier = tiers.find((t) => t.solution_id === firstSol)?.solution_tier_id ?? null;
      setTierId(firstTier);
    } else if (hasStandalone) {
      setPkgId(STANDALONE_PACKAGE_NAV_ID);
      const firstSol =
        solutions.find((s) => s.package_id == null)?.solution_id ?? null;
      setSolId(firstSol);
      const firstTier = tiers.find((t) => t.solution_id === firstSol)?.solution_tier_id ?? null;
      setTierId(firstTier);
    } else {
      setPkgId(null);
      setSolId(null);
      setTierId(null);
    }
    notifyPackagingDataChanged();
  }, []);

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

  const hasStandaloneSolutions = useMemo(
    () => data?.solutions.some((s) => s.package_id == null) ?? false,
    [data]
  );

  const packagesVisible = useMemo(() => {
    if (!data) return [];
    return data.packages
      .filter(
        (p) =>
          matchesQuery(p.package_name, filterPkg) ||
          matchesQuery(p.package_id, filterPkg)
      )
      .sort((a, b) => sortId(a.package_id, b.package_id));
  }, [data, filterPkg]);

  const standaloneNavVisible = useMemo(() => {
    if (!hasStandaloneSolutions) return false;
    if (!filterPkg.trim()) return true;
    return (
      matchesQuery("Standalone solutions", filterPkg) ||
      matchesQuery("standalone", filterPkg) ||
      matchesQuery(STANDALONE_PACKAGE_NAV_ID, filterPkg)
    );
  }, [hasStandaloneSolutions, filterPkg]);

  const validPackageNavIds = useMemo(() => {
    const ids: string[] = [];
    if (standaloneNavVisible) ids.push(STANDALONE_PACKAGE_NAV_ID);
    ids.push(...packagesVisible.map((p) => p.package_id));
    return ids;
  }, [standaloneNavVisible, packagesVisible]);

  const solutionsVisible = useMemo(() => {
    if (!data || pkgId == null) return [];
    const inScope =
      pkgId === STANDALONE_PACKAGE_NAV_ID
        ? data.solutions.filter((s) => s.package_id == null)
        : data.solutions.filter((s) => s.package_id === pkgId);
    return inScope
      .filter(
        (s) =>
          matchesQuery(s.solution_name, filterSol) ||
          matchesQuery(s.solution_id, filterSol)
      )
      .sort((a, b) => sortId(a.solution_id, b.solution_id));
  }, [data, pkgId, filterSol]);

  /** Every solution (for “All solutions” nav mode). */
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

  const solutionsNavRows = useMemo(() => {
    if (solId === ALL_SOLUTIONS_NAV_ID) return allSolutionsFiltered;
    return solutionsVisible;
  }, [solId, allSolutionsFiltered, solutionsVisible]);

  const tiersNavList = useMemo(() => {
    if (!data || !solId) return [];
    const inScope =
      solId === ALL_SOLUTIONS_NAV_ID
        ? data.tiers
        : data.tiers.filter((t) => t.solution_id === solId);
    return inScope
      .filter(
        (t) =>
          matchesQuery(t.solution_tier_name, filterTier) ||
          matchesQuery(t.solution_tier_id, filterTier)
      )
      .sort((a, b) => sortId(a.solution_tier_id, b.solution_tier_id));
  }, [data, solId, filterTier]);

  const pkgComboOptions = useMemo((): FilterComboOption[] => {
    if (!data) return [];
    const opts: FilterComboOption[] = [];
    if (data.solutions.some((s) => s.package_id == null)) {
      opts.push({
        value: STANDALONE_PACKAGE_NAV_ID,
        label: "Standalone solutions",
        hint: "no package",
      });
    }
    for (const p of [...data.packages].sort((a, b) =>
      sortId(a.package_id, b.package_id)
    )) {
      opts.push({
        value: p.package_id,
        label: p.package_name,
        hint: p.package_id,
      });
    }
    return opts;
  }, [data]);

  const pkgComboFiltered = useMemo(
    () =>
      pkgComboOptions.filter((o) =>
        matchesQuery(`${o.label} ${o.value} ${o.hint ?? ""}`, filterPkg)
      ),
    [pkgComboOptions, filterPkg]
  );

  const solComboOptions = useMemo((): FilterComboOption[] => {
    if (!data) return [];
    const allOpt: FilterComboOption = {
      value: ALL_SOLUTIONS_NAV_ID,
      label: "All solutions",
      hint: "entire catalog",
    };
    if (pkgId == null) {
      if (solId !== ALL_SOLUTIONS_NAV_ID) return [];
      const mapped = [...data.solutions]
        .sort((a, b) => sortId(a.solution_id, b.solution_id))
        .map((s) => ({
          value: s.solution_id,
          label: s.solution_name,
          hint: solutionCatalogHint(s, data.packages),
        }));
      return [allOpt, ...mapped];
    }
    const list =
      solId === ALL_SOLUTIONS_NAV_ID
        ? [...data.solutions]
        : pkgId === STANDALONE_PACKAGE_NAV_ID
          ? data.solutions.filter((s) => s.package_id == null)
          : data.solutions.filter((s) => s.package_id === pkgId);
    const mapped = [...list]
      .sort((a, b) => sortId(a.solution_id, b.solution_id))
      .map((s) => ({
        value: s.solution_id,
        label: s.solution_name,
        hint:
          solId === ALL_SOLUTIONS_NAV_ID
            ? solutionCatalogHint(s, data.packages)
            : s.solution_id,
      }));
    return [allOpt, ...mapped];
  }, [data, pkgId, solId]);

  const solComboFiltered = useMemo(() => {
    const allOpt: FilterComboOption = {
      value: ALL_SOLUTIONS_NAV_ID,
      label: "All solutions",
      hint: "entire catalog",
    };
    const tail = solComboOptions.filter(
      (o) =>
        o.value !== ALL_SOLUTIONS_NAV_ID &&
        matchesQuery(`${o.label} ${o.value} ${o.hint ?? ""}`, filterSol)
    );
    const showAll =
      (pkgId != null || solId === ALL_SOLUTIONS_NAV_ID) &&
      (!filterSol.trim() ||
        matchesQuery(
          `${allOpt.label} ${allOpt.hint} entire catalog all`,
          filterSol
        ));
    return showAll ? [allOpt, ...tail] : tail;
  }, [pkgId, solId, solComboOptions, filterSol]);

  const tierComboOptions = useMemo((): FilterComboOption[] => {
    if (!data || !solId) return [];
    const tiers =
      solId === ALL_SOLUTIONS_NAV_ID
        ? [...data.tiers]
        : data.tiers.filter((t) => t.solution_id === solId);
    return [...tiers]
      .sort((a, b) => sortId(a.solution_tier_id, b.solution_tier_id))
      .map((t) => ({
        value: t.solution_tier_id,
        label: t.solution_tier_name,
        hint:
          solId === ALL_SOLUTIONS_NAV_ID
            ? tierCatalogHint(t, data.solutions)
            : t.solution_tier_id,
      }));
  }, [data, solId]);

  const tierComboFiltered = useMemo(
    () =>
      tierComboOptions.filter((o) =>
        matchesQuery(`${o.label} ${o.value} ${o.hint ?? ""}`, filterTier)
      ),
    [tierComboOptions, filterTier]
  );

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
        const pkgOk =
          sol.package_id == null
            ? !filterPkg.trim() ||
              matchesQuery("Standalone solutions", filterPkg) ||
              matchesQuery("standalone", filterPkg)
            : (() => {
                const pkg = data.packages.find((x) => x.package_id === sol.package_id);
                if (!pkg) return false;
                return (
                  matchesQuery(pkg.package_name, filterPkg) ||
                  matchesQuery(pkg.package_id, filterPkg)
                );
              })();
        const solOk =
          matchesQuery(sol.solution_name, filterSol) ||
          matchesQuery(sol.solution_id, filterSol);
        const tierOk =
          matchesQuery(tier.solution_tier_name, filterTier) ||
          matchesQuery(tier.solution_tier_id, filterTier);
        return pkgOk && solOk && tierOk;
      })
      .sort((a, b) => sortId(a.task_id, b.task_id));
  }, [data, tierId, filterPkg, filterSol, filterTier]);

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
    if (!data || !solutionForSelectedTier?.package_id) return undefined;
    return data.packages.find((p) => p.package_id === solutionForSelectedTier.package_id);
  }, [data, solutionForSelectedTier]);

  /** Sum sell price across all tiers tied to the selected tier's package. */
  const packageTotalSellKpi = useMemo(() => {
    if (!data || !selectedTier || !solutionForSelectedTier) return "—";
    if (solutionForSelectedTier.package_id == null) return "Standalone";
    const solutionIds = new Set(
      data.solutions
        .filter((s) => s.package_id === solutionForSelectedTier.package_id)
        .map((s) => s.solution_id)
    );
    const tierIds = new Set(
      data.tiers
        .filter((t) => solutionIds.has(t.solution_id))
        .map((t) => t.solution_tier_id)
    );
    let sum = 0;
    let pricedCount = 0;
    for (const p of data.pricing) {
      if (!tierIds.has(p.solution_tier_id)) continue;
      const n = p.sell_price ?? p.standalone_sell_price;
      if (n != null && Number.isFinite(Number(n))) {
        sum += Number(n);
        pricedCount += 1;
      }
    }
    return pricedCount > 0 ? formatUsd(sum) : "—";
  }, [data, selectedTier, solutionForSelectedTier]);

  const kpiScopeLine = useMemo(() => {
    if (!data) return "";
    if (tierId && selectedTier && solutionForSelectedTier) {
      const parts: string[] = [];
      if (packageForSelectedTier) parts.push(packageForSelectedTier.package_name);
      else if (solutionForSelectedTier.package_id == null) parts.push("Standalone");
      parts.push(solutionForSelectedTier.solution_name);
      parts.push(selectedTier.solution_tier_name);
      return `Scope: ${parts.join(" → ")}`;
    }
    return "Scope: tasks matching your filters — select a tier to show pricing.";
  }, [data, tierId, selectedTier, solutionForSelectedTier, packageForSelectedTier]);

  const selectPackageFromCombo = useCallback(
    (id: string) => {
      if (!data) return;
      if (id === STANDALONE_PACKAGE_NAV_ID) {
        setPkgId(STANDALONE_PACKAGE_NAV_ID);
        const s = data.solutions
          .filter((x) => x.package_id == null)
          .sort((a, b) => sortId(a.solution_id, b.solution_id))[0];
        setSolId(s?.solution_id ?? null);
        const tr = s
          ? data.tiers
              .filter((t) => t.solution_id === s.solution_id)
              .sort((a, b) =>
                sortId(a.solution_tier_id, b.solution_tier_id)
              )[0]
          : null;
        setTierId(tr?.solution_tier_id ?? null);
      } else {
        setPkgId(id);
        const s = data.solutions
          .filter((x) => x.package_id === id)
          .sort((a, b) => sortId(a.solution_id, b.solution_id))[0];
        setSolId(s?.solution_id ?? null);
        const tr = s
          ? data.tiers
              .filter((t) => t.solution_id === s.solution_id)
              .sort((a, b) =>
                sortId(a.solution_tier_id, b.solution_tier_id)
              )[0]
          : null;
        setTierId(tr?.solution_tier_id ?? null);
      }
      setFilterPkg("");
    },
    [data]
  );

  const selectSolutionFromCombo = useCallback(
    (id: string) => {
      if (!data) return;
      setSolId(id);
      if (id === ALL_SOLUTIONS_NAV_ID) {
        const tr = [...data.tiers].sort((a, b) =>
          sortId(a.solution_tier_id, b.solution_tier_id)
        )[0];
        setTierId(tr?.solution_tier_id ?? null);
      } else {
        const tr = data.tiers
          .filter((t) => t.solution_id === id)
          .sort((a, b) => sortId(a.solution_tier_id, b.solution_tier_id))[0];
        setTierId(tr?.solution_tier_id ?? null);
      }
      setFilterSol("");
    },
    [data]
  );

  const selectTierFromCombo = useCallback((id: string) => {
    setTierId(id);
    setFilterTier("");
  }, []);

  useEffect(() => {
    if (!data) return;
    if (validPackageNavIds.length === 0) {
      if (pkgId !== null) setPkgId(null);
      return;
    }
    if (!pkgId || !validPackageNavIds.includes(pkgId)) {
      setPkgId(validPackageNavIds[0]!);
    }
  }, [data, validPackageNavIds, pkgId]);

  useEffect(() => {
    if (!pkgId && solId !== ALL_SOLUTIONS_NAV_ID) {
      if (solId !== null) setSolId(null);
      if (tierId !== null) setTierId(null);
    }
  }, [pkgId, solId, tierId]);

  useEffect(() => {
    if (!data) return;
    if (solId === ALL_SOLUTIONS_NAV_ID) {
      if (data.solutions.length === 0) setSolId(null);
      return;
    }
    if (pkgId == null) return;
    if (solutionsVisible.length === 0) {
      if (solId !== null) setSolId(null);
      return;
    }
    if (!solId || !solutionsVisible.some((s) => s.solution_id === solId)) {
      setSolId(solutionsVisible[0]?.solution_id ?? null);
    }
  }, [data, pkgId, solutionsVisible, solId]);

  useEffect(() => {
    if (!data || !solId) return;
    if (tiersNavList.length === 0) {
      if (tierId !== null) setTierId(null);
      return;
    }
    if (!tierId || !tiersNavList.some((t) => t.solution_tier_id === tierId)) {
      setTierId(tiersNavList[0]?.solution_tier_id ?? null);
    }
  }, [data, solId, tiersNavList, tierId]);

  return (
    <div style={layout.shell}>
      <header className="agency-page-header">
        <div className="agency-hero-top">
          <span className="agency-hero__eyebrow">Agency · browse only</span>
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
          {AGENCY_VIEW_DESCRIPTION}
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

      {data && (
        <div className="kb-grid" style={layout.grid}>
          <nav className="kb-nav" aria-label="Hierarchy">
            <section className="agency-nav-catalog" style={navSection}>
              <h2 style={navHeading}>Catalog</h2>
              <ul style={list}>
                <li key={ALL_SOLUTIONS_NAV_ID}>
                  <button
                    type="button"
                    className={
                      solId === ALL_SOLUTIONS_NAV_ID
                        ? "kb-nav-item kb-nav-item--active"
                        : "kb-nav-item"
                    }
                    onClick={() => {
                      setSolId(ALL_SOLUTIONS_NAV_ID);
                      const tr = [...data.tiers].sort((a, b) =>
                        sortId(a.solution_tier_id, b.solution_tier_id)
                      )[0];
                      setTierId(tr?.solution_tier_id ?? null);
                    }}
                  >
                    All solutions
                    <span style={idChip}>entire catalog</span>
                  </button>
                </li>
              </ul>
            </section>

            <section style={navSection}>
              <h2 style={navHeading}>Package</h2>
              {!standaloneNavVisible && packagesVisible.length === 0 ? (
                <p style={emptyHint}>No packages match this search.</p>
              ) : (
                <ul style={list}>
                  {standaloneNavVisible && (
                    <li key={STANDALONE_PACKAGE_NAV_ID}>
                      <button
                        type="button"
                        className={
                          pkgId === STANDALONE_PACKAGE_NAV_ID
                            ? "kb-nav-item kb-nav-item--active"
                            : "kb-nav-item"
                        }
                        onClick={() => {
                          setPkgId(STANDALONE_PACKAGE_NAV_ID);
                          const s = data.solutions
                            .filter((x) => x.package_id == null)
                            .sort((a, b) => sortId(a.solution_id, b.solution_id))[0];
                          setSolId(s?.solution_id ?? null);
                          const tr = s
                            ? data.tiers
                                .filter((t) => t.solution_id === s.solution_id)
                                .sort((a, b) =>
                                  sortId(a.solution_tier_id, b.solution_tier_id)
                                )[0]
                            : null;
                          setTierId(tr?.solution_tier_id ?? null);
                        }}
                      >
                        Standalone solutions
                        <span style={idChip}>no package</span>
                      </button>
                    </li>
                  )}
                  {packagesVisible.map((p) => (
                    <li key={p.package_id}>
                      <button
                        type="button"
                        className={
                          pkgId === p.package_id
                            ? "kb-nav-item kb-nav-item--active"
                            : "kb-nav-item"
                        }
                        onClick={() => {
                          setPkgId(p.package_id);
                          const s = data.solutions
                            .filter((x) => x.package_id === p.package_id)
                            .sort((a, b) => sortId(a.solution_id, b.solution_id))[0];
                          setSolId(s?.solution_id ?? null);
                          const tr = s
                            ? data.tiers
                                .filter((t) => t.solution_id === s.solution_id)
                                .sort((a, b) =>
                                  sortId(a.solution_tier_id, b.solution_tier_id)
                                )[0]
                            : null;
                          setTierId(tr?.solution_tier_id ?? null);
                        }}
                      >
                        {p.package_name}
                        <span style={idChip}>{p.package_id}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section style={navSection}>
              <h2 style={navHeading}>Solutions</h2>
              {pkgId == null && solId !== ALL_SOLUTIONS_NAV_ID ? (
                <p style={emptyHint}>Select a package or standalone group above.</p>
              ) : (
                <ul style={list}>
                  {solutionsNavRows.length === 0 ? (
                    <li>
                      <p style={{ ...emptyHint, padding: "0.35rem 0 0" }}>
                        {solId === ALL_SOLUTIONS_NAV_ID
                          ? "No solutions match this search."
                          : "No solutions in this package match this search."}
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
                          title={solutionNavTitle(s, data.packages)}
                          onClick={() => {
                            setSolId(s.solution_id);
                            const tr = data.tiers
                              .filter((t) => t.solution_id === s.solution_id)
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
              )}
            </section>

            <section style={navSection}>
              <h2 style={navHeading}>Solution tiers</h2>
              {!solId ? (
                <p style={emptyHint}>Select a solution above.</p>
              ) : tiersNavList.length === 0 ? (
                <p style={emptyHint}>No tiers match this search.</p>
              ) : (
                <ul style={list}>
                  {tiersNavList.map((t) => (
                    <li key={t.solution_tier_id}>
                      <button
                        type="button"
                        className={
                          tierId === t.solution_tier_id
                            ? "kb-nav-item kb-nav-item--active"
                            : "kb-nav-item"
                        }
                        title={tierNavTitle(t, data.solutions)}
                        onClick={() => setTierId(t.solution_tier_id)}
                      >
                        <span className="kb-nav-item__label">{t.solution_tier_name}</span>
                        <span className="kb-nav-item__meta" style={idChip}>
                          {t.solution_tier_id}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </nav>

          <main style={layout.main}>
            <div
              className="agency-main-filters"
              aria-label="Filter packages, solutions, and tiers"
            >
              <div className="agency-main-filters__row">
                <div
                  className="kb-filter-row agency-main-filters__grid"
                  style={filterRow}
                >
                  <FilterCombobox
                    label="Search packages"
                    labelStyle={filterLabel}
                    inputStyle={filterInput}
                    placeholder="Type to narrow…"
                    inputValue={filterPkg}
                    onInputChange={setFilterPkg}
                    options={pkgComboFiltered}
                    onOptionSelect={selectPackageFromCombo}
                    isOpen={openCombo === "pkg"}
                    onOpenChange={(open) => setOpenCombo(open ? "pkg" : null)}
                  />
                  <FilterCombobox
                    label="Search solutions"
                    labelStyle={filterLabel}
                    inputStyle={filterInput}
                    placeholder={
                      pkgId == null && solId !== ALL_SOLUTIONS_NAV_ID
                        ? "Select a package first"
                        : "Type to narrow…"
                    }
                    inputValue={filterSol}
                    onInputChange={setFilterSol}
                    options={solComboFiltered}
                    onOptionSelect={selectSolutionFromCombo}
                    disabled={pkgId == null && solId !== ALL_SOLUTIONS_NAV_ID}
                    isOpen={openCombo === "sol"}
                    onOpenChange={(open) => setOpenCombo(open ? "sol" : null)}
                  />
                  <FilterCombobox
                    label="Search tiers"
                    labelStyle={filterLabel}
                    inputStyle={filterInput}
                    placeholder={
                      !solId
                        ? "Select a solution first"
                        : solId === ALL_SOLUTIONS_NAV_ID
                          ? "Search all tiers…"
                          : "Type to narrow…"
                    }
                    inputValue={filterTier}
                    onInputChange={setFilterTier}
                    options={tierComboFiltered}
                    onOptionSelect={selectTierFromCombo}
                    disabled={!solId}
                    isOpen={openCombo === "tier"}
                    onOpenChange={(open) => setOpenCombo(open ? "tier" : null)}
                  />
                </div>
                {(filterPkg || filterSol || filterTier) && (
                  <button
                    type="button"
                    className="kb-filter-clear agency-main-filters__clear"
                    style={filterClearBtn}
                    onClick={() => {
                      setFilterPkg("");
                      setFilterSol("");
                      setFilterTier("");
                      setOpenCombo(null);
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </div>
            </div>

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
                <div className="agency-kpi-panel__grid">
                  <div className="agency-kpi-card agency-kpi-card--pricing">
                    <span className="agency-kpi-card__label">Package total</span>
                    <span className="agency-kpi-card__value agency-kpi-card__value--text">
                      {tierId && selectedTier ? packageTotalSellKpi : "—"}
                    </span>
                  </div>
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
                  ) : solutionForSelectedTier?.package_id == null ? (
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
    padding: "1.25rem clamp(1.5rem, 5vw, 4rem) 2.5rem",
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
    gridTemplateColumns: "minmax(248px, 292px) 1fr",
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

const filterRow: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: "0.75rem",
};

const filterLabel: CSSProperties = {
  display: "flex",
  flexDirection: "column" as const,
  gap: "0.25rem",
  fontSize: "0.72rem",
  fontWeight: 600,
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  color: "var(--muted)",
};

const filterInput: CSSProperties = {
  fontFamily: "inherit",
  fontSize: "0.88rem",
  padding: "0.5rem 0.65rem",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "rgba(255, 252, 247, 0.95)",
  color: "var(--text)",
};

const filterClearBtn: CSSProperties = {
  marginTop: 0,
  padding: "0.5rem 0.85rem",
  fontSize: "0.8rem",
  fontWeight: 650,
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "rgba(255, 252, 247, 0.9)",
  color: "var(--muted)",
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
