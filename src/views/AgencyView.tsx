import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import {
  AGENCY_HERO_TITLE,
  AGENCY_VIEW_DESCRIPTION,
} from "../branding";
import { STANDALONE_PACKAGE_NAV_ID } from "../lib/navIds";
import {
  mergePricingWithPackageOverrides,
  parsePricingOverrides,
  parseTaskOverridesMap,
} from "../lib/packagePricingTaskOverrides";
import {
  mergeTierWithPackageOverrides,
  parseTierOverrides,
} from "../lib/packageTierOverrides";
import { PACKAGING_DATA_CHANGED_EVENT } from "../lib/packagingEvents";
import { buildMergedTaskRowsForPackageTier, parseTaskExtensions } from "../lib/packageTaskLayout";
import {
  effectiveResourceExamples,
  effectiveResourceTools,
  stripRedundantResourceMarkdownHeading,
  tierHasAnyResourceSectionContent,
  tierTemplatesForProposalDisplay,
} from "../lib/tierResourceFields";
import { compareTasksByOrder } from "../lib/taskOrder";
import { ACCOUNT_MGMT_HOURS_ADDON_RATE } from "../lib/tierPricingMath";
import {
  browserKeyConfigurationError,
  envConfigured,
  getSupabase,
} from "../lib/supabase";
import { TierResourceExamplesDisplay } from "../components/TierResourceExamplesDisplay";
import { useToast } from "../context/ToastContext";
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

function sellPriceNumber(pricing: SolutionTierPricing | null): number | null {
  if (!pricing) return null;
  const primary = pricing.sell_price;
  const fallback = pricing.standalone_sell_price;
  if (primary != null && Number.isFinite(Number(primary))) return Number(primary);
  if (fallback != null && Number.isFinite(Number(fallback))) return Number(fallback);
  return null;
}

function sellPriceDisplay(pricing: SolutionTierPricing | null): string {
  const n = sellPriceNumber(pricing);
  if (n != null) return formatUsd(n);
  return "—";
}

function taxableLabel(pricing: SolutionTierPricing | null): string {
  if (!pricing) return "—";
  return pricing.taxable ? "Taxable" : "Non-taxable";
}

function solutionNavTitle(s: Solution): string {
  return s.solution_name.trim() || "Solution";
}

function tierNavTitle(t: SolutionTier, solutions: Solution[]): string {
  const sol = solutions.find((s) => s.solution_id === t.solution_id);
  const solPart = sol ? `${sol.solution_name} · ` : "";
  return `${solPart}${t.solution_tier_name}`.trim() || "Tier";
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

function AgencyTierProse({ text }: { text: string }) {
  return (
    <div className="agency-tier-prose">
      <ReactMarkdown
        components={{
          a: ({ href, children }) => (
            <a href={href} className="agency-hub__link" target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function AgencyTierSubsection({
  title,
  text,
  blockTitle: bt,
}: {
  title: string;
  text: string;
  blockTitle: CSSProperties;
}) {
  return (
    <div className="agency-tier-sub">
      <h4 className="agency-block-title" style={bt}>
        {title}
      </h4>
      <AgencyTierProse text={text} />
    </div>
  );
}

function firstTierCategory(
  t: SolutionTier
): "desc" | "scope" | "process" | "res" | null {
  if (t.solution_tier_what_is_it || t.solution_tier_why_is_it_valuable || t.solution_tier_when_should_it_be_used)
    return "desc";
  if (
    t.solution_tier_assumption_prerequisites ||
    t.solution_tier_in_scope ||
    t.solution_tier_out_of_scope ||
    t.solution_tier_final_deliverable
  )
    return "scope";
  if (t.solution_tier_how_do_we_get_this_work_done || t.solution_tier_direction || t.solution_tier_sop)
    return "process";
  if (tierHasAnyResourceSectionContent(t)) return "res";
  return null;
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
  /** Catalog Solutions tab: spreadsheet-style list of every tier vs. single-tier detail. */
  const [catalogTierTableView, setCatalogTierTableView] = useState(false);
  const [catalogTierTableQuery, setCatalogTierTableQuery] = useState("");
  const catalogTierTableSearchId = useId();
  const [catalogTierSort, setCatalogTierSort] = useState<{
    col: "tier" | "price" | "hours" | "taxable" | "tags";
    dir: "asc" | "desc";
  }>({ col: "tier", dir: "asc" });
  const solSearchFieldId = useId();
  const pkgSearchFieldId = useId();
  const tierSearchFieldId = useId();
  const navigate = useNavigate();
  const { toastError, toastNote } = useToast();

  const prevErrMsg = useRef<string | null>(null);
  const emptyVaultNotified = useRef(false);
  const routeInvalidNotified = useRef(false);

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
    tasks.sort((a, b) => {
      const tc = sortId(a.solution_tier_id, b.solution_tier_id);
      if (tc !== 0) return tc;
      return compareTasksByOrder(a, b);
    });

    setState({ status: "ok", packages, solutions, tiers, packageTiers, tasks, pricing });

    if (mode === "package") {
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
      return;
    }
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

  /** When Admin (or other tools) save, reload so this view stays in sync without a manual refresh button. */
  useEffect(() => {
    function onPackagingChanged() {
      if (browserKeyConfigurationError() || !envConfigured()) return;
      void load();
    }
    window.addEventListener(PACKAGING_DATA_CHANGED_EVENT, onPackagingChanged);
    return () => window.removeEventListener(PACKAGING_DATA_CHANGED_EVENT, onPackagingChanged);
  }, [load]);

  const data = state.status === "ok" ? state : null;
  const agencyErrMsg = state.status === "error" ? state.message : null;

  useEffect(() => {
    if (agencyErrMsg === null) {
      prevErrMsg.current = null;
      return;
    }
    if (prevErrMsg.current === agencyErrMsg) return;
    prevErrMsg.current = agencyErrMsg;
    toastError(agencyErrMsg);
  }, [agencyErrMsg, toastError]);

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

  const pkgLen = state.status === "ok" ? state.packages.length : -1;

  useEffect(() => {
    if (pkgLen !== 0) {
      emptyVaultNotified.current = false;
      return;
    }
    if (state.status !== "ok") return;
    if (emptyVaultNotified.current) return;
    emptyVaultNotified.current = true;
    toastNote(
      "Vault returned zero packages — seed tables or check RLS. See Packages / Admin if data should already exist."
    );
  }, [pkgLen, state.status, toastNote]);

  useEffect(() => {
    if (!packageRouteInvalid) {
      routeInvalidNotified.current = false;
      return;
    }
    if (routeInvalidNotified.current) return;
    routeInvalidNotified.current = true;
    toastNote("This package link is not valid. Use the Packages tab to open a workspace.");
  }, [packageRouteInvalid, toastNote]);

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

  /** Full `package_solution_tiers` rows for the locked package workspace (for merged tier/pricing/tasks). */
  const packageWorkspaceLinkByTierId = useMemo(() => {
    if (!data || mode !== "package" || pkgId == null || pkgId === STANDALONE_PACKAGE_NAV_ID) {
      return null as Map<string, PackageSolutionTier> | null;
    }
    const m = new Map<string, PackageSolutionTier>();
    for (const r of data.packageTiers) {
      if (r.package_id !== pkgId) continue;
      m.set(r.solution_tier_id, r);
    }
    return m;
  }, [data, mode, pkgId]);

  const tiersNavList = useMemo(() => {
    const base =
      mode === "package" && pkgId != null ? tiersForWorkspacePackage : tiersForSolution;
    const decorated =
      packageWorkspaceLinkByTierId == null
        ? base
        : base.map((t) => {
            const link = packageWorkspaceLinkByTierId.get(t.solution_tier_id);
            return mergeTierWithPackageOverrides(t, parseTierOverrides(link?.tier_overrides));
          });
    return decorated.filter(
      (t) =>
        matchesQuery(t.solution_tier_name, filterTier) ||
        matchesQuery(t.solution_tier_id, filterTier)
    );
  }, [mode, pkgId, tiersForWorkspacePackage, tiersForSolution, filterTier, packageWorkspaceLinkByTierId]);

  const selectedTier = useMemo(() => {
    if (!data || !tierId) return null;
    return data.tiers.find((t) => t.solution_tier_id === tierId) ?? null;
  }, [data, tierId]);

  const selectedTierDisplay = useMemo(() => {
    if (!selectedTier) return null;
    if (!packageWorkspaceLinkByTierId) return selectedTier;
    const link = packageWorkspaceLinkByTierId.get(selectedTier.solution_tier_id);
    return mergeTierWithPackageOverrides(selectedTier, parseTierOverrides(link?.tier_overrides));
  }, [selectedTier, packageWorkspaceLinkByTierId]);

  const selectedPricing = useMemo(() => {
    if (!data || !tierId) return null;
    return data.pricing.find((p) => p.solution_tier_id === tierId) ?? null;
  }, [data, tierId]);

  const tasksForTierDisplay = useMemo(() => {
    if (!data || !tierId) return [];
    const vaultSorted = data.tasks
      .filter((t) => t.solution_tier_id === tierId)
      .sort(compareTasksByOrder);
    if (!packageWorkspaceLinkByTierId) return vaultSorted;
    const link = packageWorkspaceLinkByTierId.get(tierId);
    if (!link) return vaultSorted;
    return buildMergedTaskRowsForPackageTier({
      tierId,
      vaultTasks: data.tasks,
      taskOverrides: parseTaskOverridesMap(link.task_overrides),
      taskExtensions: parseTaskExtensions(link.task_extensions),
    });
  }, [data, tierId, packageWorkspaceLinkByTierId]);

  /** Sums for the tier tasks table footer (Time + Duration columns). */
  const taskTableTotals = useMemo(() => {
    let sumTime = 0;
    let sumDuration = 0;
    let anyTime = false;
    let anyDuration = false;
    for (const t of tasksForTierDisplay) {
      if (t.task_time != null && Number.isFinite(Number(t.task_time))) {
        sumTime += Number(t.task_time);
        anyTime = true;
      }
      if (t.task_duration != null && Number.isFinite(Number(t.task_duration))) {
        sumDuration += Number(t.task_duration);
        anyDuration = true;
      }
    }
    const accountMgmtAddonHours = anyTime ? sumTime * ACCOUNT_MGMT_HOURS_ADDON_RATE : 0;
    const sumTimeWithAccountMgmt = sumTime + accountMgmtAddonHours;
    return { sumTime, sumDuration, anyTime, anyDuration, accountMgmtAddonHours, sumTimeWithAccountMgmt };
  }, [tasksForTierDisplay]);

  /** Catalog mode KPIs: selected tier’s tasks, or tasks matching sidebar search filters. */
  const tasksForKpi = useMemo(() => {
    if (!data) return [];
    if (tierId) {
      return data.tasks.filter((t) => t.solution_tier_id === tierId).sort(compareTasksByOrder);
    }
    return data.tasks
      .filter((task) => {
        const tier = data.tiers.find((x) => x.solution_tier_id === task.solution_tier_id);
        if (!tier) return false;
        const sol = data.solutions.find((x) => x.solution_id === tier.solution_id);
        if (!sol) return false;
        const solOk =
          matchesQuery(sol.solution_name, filterSol) || matchesQuery(sol.solution_id, filterSol);
        const tierOk =
          matchesQuery(tier.solution_tier_name, filterTier) ||
          matchesQuery(tier.solution_tier_id, filterTier);
        return solOk && tierOk;
      })
      .sort((a, b) => {
        const tc = sortId(a.solution_tier_id, b.solution_tier_id);
        if (tc !== 0) return tc;
        return compareTasksByOrder(a, b);
      });
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

  const kpiScopeLine = useMemo(() => {
    if (!data) return "";
    if (tierId && selectedTier && solutionForSelectedTier) {
      const parts: string[] = [];
      if (packageForSelectedTier) parts.push(packageForSelectedTier.package_name);
      else parts.push("Standalone");
      parts.push(solutionForSelectedTier.solution_name);
      parts.push((selectedTierDisplay ?? selectedTier).solution_tier_name);
      return `Scope: ${parts.join(" → ")}`;
    }
    return "Scope: pick a tier in the sidebar to show pricing and task KPIs.";
  }, [data, tierId, selectedTier, selectedTierDisplay, solutionForSelectedTier, packageForSelectedTier]);

  const taskTimeSumByTierId = useMemo(() => {
    const m = new Map<string, number>();
    if (!data) return m;
    for (const k of data.tasks) {
      if (k.task_time == null || !Number.isFinite(Number(k.task_time))) continue;
      const tid = k.solution_tier_id;
      m.set(tid, (m.get(tid) ?? 0) + Number(k.task_time));
    }
    return m;
  }, [data]);

  /** One row per vault tier for catalog “all tiers” table (vault pricing only). */
  const catalogTierTableRows = useMemo(() => {
    if (!data) return [];
    return [...data.tiers]
      .sort((a, b) => sortId(a.solution_tier_id, b.solution_tier_id))
      .map((tier) => {
        const pr = data.pricing.find((p) => p.solution_tier_id === tier.solution_tier_id) ?? null;
        const link = data.packageTiers.find((r) => r.solution_tier_id === tier.solution_tier_id);
        const pname = link
          ? data.packages.find((p) => p.package_id === link.package_id)?.package_name?.trim() ||
            link.package_id ||
            "Standalone"
          : "Standalone";
        const solution = data.solutions.find((s) => s.solution_id === tier.solution_id);
        const solutionName = solution?.solution_name ?? tier.solution_id;
        const tierName = tier.solution_tier_name;
        const priceNum = sellPriceNumber(pr);
        const priceDisplay = sellPriceDisplay(pr);
        const vaultHours = pr?.total_hours != null && Number.isFinite(Number(pr.total_hours)) ? Number(pr.total_hours) : null;
        const sumTasks = taskTimeSumByTierId.get(tier.solution_tier_id) ?? null;
        const hoursNum = vaultHours ?? (sumTasks != null && sumTasks > 0 ? sumTasks : null);
        const hoursDisplay =
          hoursNum != null && Number.isFinite(hoursNum) ? formatKpiNumber(hoursNum) : "—";
        const taxable = pr?.taxable ?? false;
        const tagsRaw = pr?.tags?.trim() ?? "";
        return {
          tierId: tier.solution_tier_id,
          solutionId: tier.solution_id,
          pname,
          tierName,
          solutionName,
          priceNum,
          priceDisplay,
          hoursNum,
          hoursDisplay,
          taxable,
          taxableSort: taxable ? 1 : 0,
          taxableLabel: taxable ? "Taxable" : "Non-taxable",
          tagsRaw,
        };
      });
  }, [data, taskTimeSumByTierId]);

  const catalogTierRowsFilteredSorted = useMemo(() => {
    const q = catalogTierTableQuery.trim().toLowerCase();
    let rows = catalogTierTableRows;
    if (q) {
      rows = rows.filter((r) => {
        const blob = `${r.pname} ${r.tierName} ${r.solutionName} ${r.tagsRaw} ${r.taxableLabel} ${r.tierId} ${r.priceDisplay} ${r.hoursDisplay}`
          .toLowerCase()
          .replace(/\$/g, "");
        return blob.includes(q);
      });
    }
    const dir = catalogTierSort.dir === "asc" ? 1 : -1;
    const cmpNum = (a: number | null, b: number | null): number => {
      const aa = a == null || !Number.isFinite(a) ? null : a;
      const bb = b == null || !Number.isFinite(b) ? null : b;
      if (aa == null && bb == null) return 0;
      if (aa == null) return 1;
      if (bb == null) return -1;
      return (aa - bb) * dir;
    };
    const sorted = [...rows].sort((a, b) => {
      const tieTier = sortId(a.tierId, b.tierId);
      let c = 0;
      switch (catalogTierSort.col) {
        case "tier": {
          const byTier = a.tierName.localeCompare(b.tierName, undefined, { sensitivity: "base" }) * dir;
          c =
            byTier !== 0
              ? byTier
              : a.solutionName.localeCompare(b.solutionName, undefined, { sensitivity: "base" }) * dir;
          break;
        }
        case "price":
          c = cmpNum(a.priceNum, b.priceNum);
          break;
        case "hours":
          c = cmpNum(a.hoursNum, b.hoursNum);
          break;
        case "taxable": {
          const t = (a.taxableSort - b.taxableSort) * dir;
          c =
            t !== 0
              ? t
              : a.tierName.localeCompare(b.tierName, undefined, { sensitivity: "base" });
          break;
        }
        case "tags":
          c =
            (a.tagsRaw || "\uffff").localeCompare(b.tagsRaw || "\uffff", undefined, {
              sensitivity: "base",
            }) * dir;
          break;
        default:
          c = 0;
      }
      return c !== 0 ? c : tieTier;
    });
    return sorted;
  }, [catalogTierTableRows, catalogTierTableQuery, catalogTierSort]);

  const toggleCatalogTierSort = (col: "tier" | "price" | "hours" | "taxable" | "tags") => {
    setCatalogTierSort((prev) =>
      prev.col === col ? { col, dir: prev.dir === "asc" ? "desc" : "asc" } : { col, dir: "asc" }
    );
  };

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
    const tierIds = new Set(tiersInPkg.map((t) => t.solution_tier_id));

    const useMergedPackage =
      mode === "package" && pkgId != null && pkgId !== STANDALONE_PACKAGE_NAV_ID;

    let sellSum = 0;
    let pricedCount = 0;
    if (useMergedPackage) {
      for (const t of tiersInPkg) {
        const vault = data.pricing.find((p) => p.solution_tier_id === t.solution_tier_id) ?? null;
        const link = data.packageTiers.find(
          (r) => r.package_id === pkgId && r.solution_tier_id === t.solution_tier_id
        );
        const merged = mergePricingWithPackageOverrides(
          vault,
          t.solution_tier_id,
          parsePricingOverrides(link?.pricing_overrides)
        );
        const n = merged.sell_price ?? merged.standalone_sell_price;
        if (n != null && Number.isFinite(Number(n))) {
          sellSum += Number(n);
          pricedCount += 1;
        }
      }
    } else {
      for (const pr of data.pricing) {
        if (!tierIds.has(pr.solution_tier_id)) continue;
        const n = pr.sell_price ?? pr.standalone_sell_price;
        if (n != null && Number.isFinite(Number(n))) {
          sellSum += Number(n);
          pricedCount += 1;
        }
      }
    }

    const roles = new Set<string>();
    let sumTime = 0;
    const taskPatchByTier = new Map<string, ReturnType<typeof parseTaskOverridesMap>>();
    const taskExtByTier = new Map<string, ReturnType<typeof parseTaskExtensions>>();
    if (useMergedPackage) {
      for (const t of tiersInPkg) {
        const link = data.packageTiers.find(
          (r) => r.package_id === pkgId && r.solution_tier_id === t.solution_tier_id
        );
        taskPatchByTier.set(t.solution_tier_id, parseTaskOverridesMap(link?.task_overrides));
        taskExtByTier.set(t.solution_tier_id, parseTaskExtensions(link?.task_extensions));
      }
    }
    for (const t of tiersInPkg) {
      const mergedList = useMergedPackage
        ? buildMergedTaskRowsForPackageTier({
            tierId: t.solution_tier_id,
            vaultTasks: data.tasks,
            taskOverrides: taskPatchByTier.get(t.solution_tier_id),
            taskExtensions: taskExtByTier.get(t.solution_tier_id),
          })
        : data.tasks
            .filter((tk) => tk.solution_tier_id === t.solution_tier_id)
            .sort(compareTasksByOrder);
      for (const m of mergedList) {
        if (m.task_time != null && Number.isFinite(Number(m.task_time))) {
          sumTime += Number(m.task_time);
        }
        if (m.task_implementer?.trim()) roles.add(m.task_implementer.trim());
      }
    }

    const title =
      pkgId === STANDALONE_PACKAGE_NAV_ID
        ? "Standalone solutions"
        : data.packages.find((p) => p.package_id === pkgId)?.package_name ?? "Package";

    return {
      title,
      tiersCount: tiersInPkg.length,
      sellTotalDisplay: pricedCount > 0 ? formatUsd(sellSum) : "—",
      distinctImplementers: roles.size,
      sumTaskTime: sumTime,
    };
  }, [data, pkgId, mode]);

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
        const vault = data.pricing.find((p) => p.solution_tier_id === t.solution_tier_id) ?? null;
        const link =
          pkgId !== STANDALONE_PACKAGE_NAV_ID
            ? data.packageTiers.find((r) => r.package_id === pkgId && r.solution_tier_id === t.solution_tier_id)
            : undefined;
        const pr =
          pkgId !== STANDALONE_PACKAGE_NAV_ID
            ? mergePricingWithPackageOverrides(
                vault,
                t.solution_tier_id,
                parsePricingOverrides(link?.pricing_overrides)
              )
            : vault;
        const tierDisplay =
          pkgId !== STANDALONE_PACKAGE_NAV_ID
            ? mergeTierWithPackageOverrides(t, parseTierOverrides(link?.tier_overrides))
            : t;
        rows.push({
          solution: s,
          tier: tierDisplay,
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

  return (
    <div className="agency-view-shell" style={layout.shell}>
      <header className="agency-page-header">
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
              Use the <Link className="agency-hub__link" to="/">Solutions</Link> tab to search
              tiers across the entire catalog.
            </>
          )}
        </p>
      </header>

      {state.status === "loading" && (
        <div style={loadingBox}>Loading from Supabase…</div>
      )}

      {state.status === "error" && (
        <p style={loadHintMuted} role="status">
          Unable to load this view. Details are shown in the notification stack (bottom corner).
        </p>
      )}

      {data && mode === "package" && packageRouteInvalid && (
        <div className="agency-route-error" role="status">
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
                              placeholder="Filter by name…"
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
                                  title={p.package_name}
                                  onClick={() => {
                                    setFilterPkg("");
                                    navigate(`/package/${encodeURIComponent(p.package_id)}`);
                                  }}
                                >
                                  <span className="kb-nav-item__label">{p.package_name}</span>
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
                              placeholder="Filter by name…"
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
                          placeholder="Filter by name…"
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
                              placeholder="Filter by name…"
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
                  ← Solutions
                </Link>
                {selectedPackageOverview && (
                  <span className="agency-package-workspace-bar__context">
                    <strong>{selectedPackageOverview.title}</strong>
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
                    <br />
                    Totals include every tier in this package.
                  </p>
                </div>
                <div className="agency-kpi-panel__grid agency-kpi-panel__grid--four">
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
                    Sell price and tax reflect package overrides when set; otherwise the vault pricing row.
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

            {mode === "catalog" && (data.packages.length > 0 || data.solutions.length > 0) ? (
              <section
                className="agency-kpi-panel agency-kpi-panel--scope"
                style={kpiSectionWrap}
                aria-label={catalogTierTableView ? "All solution tiers browser" : "Tier pricing and task summary"}
              >
                <div className="agency-kpi-panel__head agency-kpi-panel__head--with-toggle">
                  <div className="agency-catalog-view-head">
                    <div>
                      <h2 className="agency-kpi-panel__title">
                        {catalogTierTableView ? "All solution tiers" : "Tier summary"}
                      </h2>
                      <p className="agency-kpi-panel__scope agency-kpi-panel__scope--tight">
                        {catalogTierTableView
                          ? `${catalogTierRowsFilteredSorted.length} tier${catalogTierRowsFilteredSorted.length === 1 ? "" : "s"} (${catalogTierTableRows.length} in vault)`
                          : kpiScopeLine}
                      </p>
                    </div>
                    <div className="agency-catalog-segment" role="group" aria-label="Catalog display mode">
                      <button
                        type="button"
                        className={
                          catalogTierTableView
                            ? "agency-catalog-segment__btn"
                            : "agency-catalog-segment__btn agency-catalog-segment__btn--active"
                        }
                        onClick={() => setCatalogTierTableView(false)}
                        aria-pressed={!catalogTierTableView}
                      >
                        Tier detail
                      </button>
                      <button
                        type="button"
                        className={
                          catalogTierTableView
                            ? "agency-catalog-segment__btn agency-catalog-segment__btn--active"
                            : "agency-catalog-segment__btn"
                        }
                        onClick={() => setCatalogTierTableView(true)}
                        aria-pressed={catalogTierTableView}
                      >
                        All tiers table
                      </button>
                    </div>
                  </div>
                </div>
                {!catalogTierTableView ? (
                  <div className="agency-kpi-panel__grid agency-kpi-panel__grid--four">
                    <div className="agency-kpi-card agency-kpi-card--pricing">
                      <span className="agency-kpi-card__label">Sell price</span>
                      <span className="agency-kpi-card__value">
                        {tierId && selectedTier ? sellPriceDisplay(selectedPricing) : "—"}
                      </span>
                    </div>
                    <div className="agency-kpi-card agency-kpi-card--pricing">
                      <span className="agency-kpi-card__label">Tax status</span>
                      <span className="agency-kpi-card__value agency-kpi-card__value--text">
                        {tierId && selectedTier ? taxableLabel(selectedPricing) : "—"}
                      </span>
                    </div>
                    <div className="agency-kpi-card agency-kpi-card--tasks">
                      <span className="agency-kpi-card__label">Distinct implementers</span>
                      <span className="agency-kpi-card__value">{taskKpis.distinctImplementers}</span>
                    </div>
                    <div className="agency-kpi-card agency-kpi-card--tasks">
                      <span className="agency-kpi-card__label">Sum of task time</span>
                      <span className="agency-kpi-card__value">
                        {formatKpiNumber(taskKpis.sumTime)}
                      </span>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            {mode === "catalog" && catalogTierTableView ? (
              <section className="agency-catalog-tier-sheet" aria-label="All tiers table">
                <div className="agency-catalog-tier-sheet__toolbar">
                  <label className="agency-catalog-tier-sheet__filter-label" htmlFor={catalogTierTableSearchId}>
                    Filter table
                  </label>
                  <div className="agency-catalog-tier-sheet__filter-row">
                    <input
                      id={catalogTierTableSearchId}
                      type="search"
                      className="agency-catalog-tier-sheet__filter-input"
                      value={catalogTierTableQuery}
                      onChange={(e) => setCatalogTierTableQuery(e.target.value)}
                      placeholder="Tier, solution, package, tags…"
                      autoComplete="off"
                    />
                    {catalogTierTableQuery.trim() ? (
                      <button
                        type="button"
                        className="agency-catalog-tier-sheet__clear"
                        onClick={() => setCatalogTierTableQuery("")}
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                  <p className="agency-catalog-tier-sheet__hint">
                    Rows use vault pricing. Hours use stored total hours when set; otherwise summed task times. Select a row
                    to open that tier in detail view.
                  </p>
                </div>
                <div className="agency-catalog-tier-sheet__scroll">
                  <table className="agency-catalog-tier-sheet__table">
                    <thead>
                      <tr>
                        <th scope="col">
                          <button
                            type="button"
                            className="agency-catalog-tier-sheet__th-btn"
                            onClick={() => toggleCatalogTierSort("tier")}
                            aria-sort={
                              catalogTierSort.col === "tier"
                                ? catalogTierSort.dir === "asc"
                                  ? "ascending"
                                  : "descending"
                                : "none"
                            }
                          >
                            Solution tier
                            <span className="agency-catalog-tier-sheet__sort" aria-hidden>
                              {catalogTierSort.col === "tier" ? (catalogTierSort.dir === "asc" ? " ▲" : " ▼") : ""}
                            </span>
                          </button>
                        </th>
                        <th scope="col" className="agency-catalog-tier-sheet__col--narrow">
                          <button
                            type="button"
                            className="agency-catalog-tier-sheet__th-btn"
                            onClick={() => toggleCatalogTierSort("price")}
                            aria-sort={
                              catalogTierSort.col === "price"
                                ? catalogTierSort.dir === "asc"
                                  ? "ascending"
                                  : "descending"
                                : "none"
                            }
                          >
                            Price
                            <span className="agency-catalog-tier-sheet__sort" aria-hidden>
                              {catalogTierSort.col === "price" ? (catalogTierSort.dir === "asc" ? " ▲" : " ▼") : ""}
                            </span>
                          </button>
                        </th>
                        <th scope="col" className="agency-catalog-tier-sheet__col--narrow">
                          <button
                            type="button"
                            className="agency-catalog-tier-sheet__th-btn"
                            onClick={() => toggleCatalogTierSort("hours")}
                            aria-sort={
                              catalogTierSort.col === "hours"
                                ? catalogTierSort.dir === "asc"
                                  ? "ascending"
                                  : "descending"
                                : "none"
                            }
                          >
                            Hours
                            <span className="agency-catalog-tier-sheet__sort" aria-hidden>
                              {catalogTierSort.col === "hours" ? (catalogTierSort.dir === "asc" ? " ▲" : " ▼") : ""}
                            </span>
                          </button>
                        </th>
                        <th scope="col" className="agency-catalog-tier-sheet__col--tax">
                          <button
                            type="button"
                            className="agency-catalog-tier-sheet__th-btn"
                            onClick={() => toggleCatalogTierSort("taxable")}
                            aria-sort={
                              catalogTierSort.col === "taxable"
                                ? catalogTierSort.dir === "asc"
                                  ? "ascending"
                                  : "descending"
                                : "none"
                            }
                          >
                            Taxable
                            <span className="agency-catalog-tier-sheet__sort" aria-hidden>
                              {catalogTierSort.col === "taxable" ? (catalogTierSort.dir === "asc" ? " ▲" : " ▼") : ""}
                            </span>
                          </button>
                        </th>
                        <th scope="col">
                          <button
                            type="button"
                            className="agency-catalog-tier-sheet__th-btn"
                            onClick={() => toggleCatalogTierSort("tags")}
                            aria-sort={
                              catalogTierSort.col === "tags"
                                ? catalogTierSort.dir === "asc"
                                  ? "ascending"
                                  : "descending"
                                : "none"
                            }
                          >
                            Tags
                            <span className="agency-catalog-tier-sheet__sort" aria-hidden>
                              {catalogTierSort.col === "tags" ? (catalogTierSort.dir === "asc" ? " ▲" : " ▼") : ""}
                            </span>
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {catalogTierRowsFilteredSorted.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="agency-catalog-tier-sheet__empty">
                            {catalogTierTableRows.length === 0
                              ? "No tiers loaded."
                              : "No tiers match your filter."}
                          </td>
                        </tr>
                      ) : (
                        catalogTierRowsFilteredSorted.map((r) => (
                          <tr
                            key={r.tierId}
                            className="agency-catalog-tier-sheet__data-row"
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              setSolId(r.solutionId);
                              setTierId(r.tierId);
                              setCatalogTierTableView(false);
                              setFilterTier("");
                              setFilterSol("");
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setSolId(r.solutionId);
                                setTierId(r.tierId);
                                setCatalogTierTableView(false);
                                setFilterTier("");
                                setFilterSol("");
                              }
                            }}
                            title={`${r.tierName} · ${r.solutionName}`}
                          >
                            <td>
                              <div className="agency-catalog-tier-sheet__tier-title">{r.tierName}</div>
                              <div className="agency-catalog-tier-sheet__submeta">
                                <span className="agency-catalog-tier-sheet__sol-name">{r.solutionName}</span>
                                <span className="agency-catalog-tier-sheet__subdot"> · </span>
                                <span>{r.pname}</span>
                              </div>
                            </td>
                            <td className="agency-catalog-tier-sheet__cell--num">{r.priceDisplay}</td>
                            <td className="agency-catalog-tier-sheet__cell--num">{r.hoursDisplay}</td>
                            <td>{r.taxableLabel}</td>
                            <td className="agency-catalog-tier-sheet__tags">
                              {r.tagsRaw.trim() ? r.tagsRaw : "—"}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            {mode === "catalog" && catalogTierTableView ? null : !selectedTier || !selectedTierDisplay ? (
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
                  <span>{selectedTierDisplay.solution_tier_name}</span>
                </div>

                <article className="agency-article" style={articleCard}>
                  <header style={articleHead}>
                    <h2 style={articleTitle}>{selectedTierDisplay.solution_tier_name}</h2>
                    {selectedTierDisplay.solution_tier_owner && (
                      <p style={ownerLine}>
                        Owner:{" "}
                        <strong>{selectedTierDisplay.solution_tier_owner}</strong>
                      </p>
                    )}
                    {selectedTierDisplay.solution_tier_overview_link && (
                      <p style={metaLine}>
                        Link label: {selectedTierDisplay.solution_tier_overview_link}
                      </p>
                    )}
                  </header>

                  {(() => {
                    const t = selectedTierDisplay;
                    const first = firstTierCategory(t);
                    const hasDesc = Boolean(
                      t.solution_tier_what_is_it ||
                        t.solution_tier_why_is_it_valuable ||
                        t.solution_tier_when_should_it_be_used
                    );
                    const hasScope = Boolean(
                      t.solution_tier_assumption_prerequisites ||
                        t.solution_tier_in_scope ||
                        t.solution_tier_out_of_scope ||
                        t.solution_tier_final_deliverable
                    );
                    const hasProcess = Boolean(
                      t.solution_tier_how_do_we_get_this_work_done ||
                        t.solution_tier_direction ||
                        t.solution_tier_sop
                    );
                    const hasRes = tierHasAnyResourceSectionContent(t);
                    const resTemplatesRaw = tierTemplatesForProposalDisplay(t).trim();
                    const resTemplates = stripRedundantResourceMarkdownHeading(resTemplatesRaw, "templates");
                    const resToolsRaw = effectiveResourceTools(t).trim();
                    const resTools = stripRedundantResourceMarkdownHeading(resToolsRaw, "tools");
                    const resExampleRows = effectiveResourceExamples(t).filter(
                      (r) => r.example.trim() || r.date.trim()
                    );
                    return (
                      <>
                        {hasDesc ? (
                          <section
                            className={
                              first === "desc"
                                ? "agency-tier-category agency-tier-category--first"
                                : "agency-tier-category"
                            }
                          >
                            <h3 className="agency-tier-category__title">Description</h3>
                            {t.solution_tier_what_is_it ? (
                              <AgencyTierSubsection
                                title="What is it"
                                text={t.solution_tier_what_is_it}
                                blockTitle={blockTitle}
                              />
                            ) : null}
                            {t.solution_tier_why_is_it_valuable ? (
                              <AgencyTierSubsection
                                title="Why is it valuable"
                                text={t.solution_tier_why_is_it_valuable}
                                blockTitle={blockTitle}
                              />
                            ) : null}
                            {t.solution_tier_when_should_it_be_used ? (
                              <AgencyTierSubsection
                                title="When should it be used"
                                text={t.solution_tier_when_should_it_be_used}
                                blockTitle={blockTitle}
                              />
                            ) : null}
                          </section>
                        ) : null}

                        {hasScope ? (
                          <section
                            className={
                              first === "scope"
                                ? "agency-tier-category agency-tier-category--first"
                                : "agency-tier-category"
                            }
                          >
                            <h3 className="agency-tier-category__title">Scope</h3>
                            {t.solution_tier_assumption_prerequisites ? (
                              <AgencyTierSubsection
                                title="Assumptions and prerequisites"
                                text={t.solution_tier_assumption_prerequisites}
                                blockTitle={blockTitle}
                              />
                            ) : null}
                            {t.solution_tier_in_scope ? (
                              <AgencyTierSubsection
                                title="What is included in scope"
                                text={t.solution_tier_in_scope}
                                blockTitle={blockTitle}
                              />
                            ) : null}
                            {t.solution_tier_out_of_scope ? (
                              <AgencyTierSubsection
                                title="What is not included in scope"
                                text={t.solution_tier_out_of_scope}
                                blockTitle={blockTitle}
                              />
                            ) : null}
                            {t.solution_tier_final_deliverable ? (
                              <AgencyTierSubsection
                                title="What is the final deliverable"
                                text={t.solution_tier_final_deliverable}
                                blockTitle={blockTitle}
                              />
                            ) : null}
                          </section>
                        ) : null}

                        {hasProcess ? (
                          <section
                            className={
                              first === "process"
                                ? "agency-tier-category agency-tier-category--first"
                                : "agency-tier-category"
                            }
                          >
                            <h3 className="agency-tier-category__title">Process</h3>
                            {t.solution_tier_how_do_we_get_this_work_done ? (
                              <AgencyTierSubsection
                                title="How we get this work done"
                                text={t.solution_tier_how_do_we_get_this_work_done}
                                blockTitle={blockTitle}
                              />
                            ) : null}
                            {t.solution_tier_sop ? (
                              <AgencyTierSubsection title="SOP" text={t.solution_tier_sop} blockTitle={blockTitle} />
                            ) : null}
                            {t.solution_tier_direction ? (
                              <AgencyTierSubsection
                                title="Direction"
                                text={t.solution_tier_direction}
                                blockTitle={blockTitle}
                              />
                            ) : null}
                          </section>
                        ) : null}

                        {hasRes ? (
                          <section
                            className={
                              first === "res"
                                ? "agency-tier-category agency-tier-category--first"
                                : "agency-tier-category"
                            }
                          >
                            <h3 className="agency-tier-category__title">Resources</h3>
                            {resTemplates ? (
                              <AgencyTierSubsection title="Templates" text={resTemplates} blockTitle={blockTitle} />
                            ) : null}
                            {resExampleRows.length > 0 ? (
                              <div className="agency-tier-sub">
                                <h4 className="agency-block-title" style={blockTitle}>
                                  Examples with dates
                                </h4>
                                <TierResourceExamplesDisplay rows={resExampleRows} />
                              </div>
                            ) : null}
                            {resTools ? (
                              <AgencyTierSubsection title="Tools" text={resTools} blockTitle={blockTitle} />
                            ) : null}
                          </section>
                        ) : null}
                      </>
                    );
                  })()}
                </article>

                <section className="agency-tasks-panel" style={tasksSection}>
                  <h2 className="agency-tasks-panel__title" style={tasksTitle}>
                    Tasks ({tasksForTierDisplay.length})
                  </h2>
                  {tasksForTierDisplay.length === 0 ? (
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
                          {tasksForTierDisplay.map((t) => (
                            <tr key={t.task_id}>
                              <td>
                                <span className="agency-task-table__name">{t.task_name}</span>
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
                          {taskTableTotals.anyTime ? (
                            <tr className="agency-task-table__addon-row">
                              <td colSpan={2} className="agency-task-table__addon-label">
                                Account mgmt add-on ({ACCOUNT_MGMT_HOURS_ADDON_RATE * 100}% of resource hours)
                              </td>
                              <td className="agency-task-table__td--num agency-task-table__addon-time">
                                {formatKpiNumber(taskTableTotals.accountMgmtAddonHours)}
                              </td>
                              <td className="agency-task-table__td--num agency-task-table__addon-muted">—</td>
                              <td colSpan={2} className="agency-task-table__td--meta agency-task-table__addon-muted">
                                Included in tier pricing (Admin)
                              </td>
                            </tr>
                          ) : null}
                          <tr className="agency-task-table__totals-row">
                            <td colSpan={2} className="agency-task-table__totals-label">
                              Totals
                            </td>
                            <td className="agency-task-table__td--num agency-task-table__totals-value">
                              {taskTableTotals.anyTime
                                ? formatKpiNumber(taskTableTotals.sumTimeWithAccountMgmt)
                                : "—"}
                            </td>
                            <td className="agency-task-table__td--num agency-task-table__totals-value">
                              {taskTableTotals.anyDuration
                                ? formatKpiNumber(taskTableTotals.sumDuration)
                                : "—"}
                            </td>
                            <td colSpan={2} className="agency-task-table__totals-meta">
                              {tasksForTierDisplay.length} task{tasksForTierDisplay.length === 1 ? "" : "s"}
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
    maxWidth: "100%",
  },
  subtitle: {
    margin: 0,
    color: "var(--muted)",
    fontSize: "0.94rem",
    maxWidth: "100%",
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

const emptyHint: CSSProperties = {
  margin: 0,
  fontSize: "0.85rem",
  color: "var(--muted)",
};

const loadHintMuted: CSSProperties = {
  margin: "0.75rem 0 0",
  fontSize: "0.9rem",
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
