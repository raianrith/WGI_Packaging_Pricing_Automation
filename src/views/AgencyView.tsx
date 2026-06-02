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
import { anchorTierForPackage } from "../lib/packageCombinedTasks";
import { buildMergedTaskRowsForPackageTier, parseTaskExtensions } from "../lib/packageTaskLayout";
import {
  effectiveResourceExamples,
  effectiveResourceTools,
  stripRedundantResourceMarkdownHeading,
  tierHasAnyResourceSectionContent,
  tierTemplatesForProposalDisplay,
} from "../lib/tierResourceFields";
import { compareTasksByOrder } from "../lib/taskOrder";
import {
  computePackageUnifiedTaskRows,
  computePackageWorkspaceFormMetrics,
} from "../lib/packageWorkspaceMetrics";
import {
  ACCOUNT_MGMT_HOURS_ADDON_RATE,
  CONTINUOUS_IMPROVEMENT_HOURS_ADDON_RATE,
  computeResourceHourAddons,
  loadTierPricingMathConfigFromStorage,
  normalizeTierPricingMathConfig,
} from "../lib/tierPricingMath";
import {
  browserKeyConfigurationError,
  envConfigured,
  getSupabase,
} from "../lib/supabase";
import { TierResourceExamplesDisplay } from "../components/TierResourceExamplesDisplay";
import { useToast } from "../context/ToastContext";
import type {
  ImplementerHourGroupRow,
  Package,
  PackageSolutionTier,
  Solution,
  SolutionTier,
  SolutionTierPricing,
  TaskRow,
} from "../types";
import {
  CatalogPlaybookBrowser,
  filterCatalogTierRows,
  type PlaybookFilterValue,
} from "../components/CatalogPlaybookBrowser";
import type { CatalogTierSortCol } from "../components/CatalogTierTable";

type CatalogViewMode = "detail" | "all_table";

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
      implementerHourGroups: ImplementerHourGroupRow[];
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

function compareNamedRowsAsc(aName: string, bName: string, aId: string, bId: string): number {
  const byName = aName.localeCompare(bName, undefined, { sensitivity: "base" });
  return byName !== 0 ? byName : sortId(aId, bId);
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

function packageHasResourceNarrative(p: Package): boolean {
  return Boolean(
    p.package_resource_templates?.trim() ||
      p.package_resource_tools?.trim() ||
      p.package_resources?.trim() ||
      p.package_resource_examples?.some((r) => r.example.trim() || r.date.trim())
  );
}

function firstPackageNarrativeCategory(
  p: Package
): "overview" | "desc" | "scope" | "process" | "res" | null {
  if (
    p.package_overview?.trim() ||
    p.package_overview_link?.trim() ||
    p.package_direction?.trim()
  )
    return "overview";
  if (
    p.package_what_is_it?.trim() ||
    p.package_why_is_it_valuable?.trim() ||
    p.package_when_should_it_be_used?.trim()
  )
    return "desc";
  if (
    p.package_assumption_prerequisites?.trim() ||
    p.package_in_scope?.trim() ||
    p.package_out_of_scope?.trim() ||
    p.package_final_deliverable?.trim()
  )
    return "scope";
  if (p.package_how_do_we_get_this_work_done?.trim() || p.package_sop?.trim()) return "process";
  if (packageHasResourceNarrative(p)) return "res";
  return null;
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
  /** Catalog: all-tiers browser (default) vs. single-tier KPI detail. */
  const [catalogViewMode, setCatalogViewMode] = useState<CatalogViewMode>("all_table");
  const [catalogTierTableQuery, setCatalogTierTableQuery] = useState("");
  const [playbookPhase, setPlaybookPhase] = useState<PlaybookFilterValue>(null);
  const [playbookCategory, setPlaybookCategory] = useState<PlaybookFilterValue>(null);
  const [playbookTactic, setPlaybookTactic] = useState<PlaybookFilterValue>(null);
  const [catalogFlyoutSolutionId, setCatalogFlyoutSolutionId] = useState<string | null>(null);
  const [catalogTierSort, setCatalogTierSort] = useState<{
    col: CatalogTierSortCol;
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
  const catalogFlyoutCloseTimer = useRef<number | null>(null);

  const clearCatalogFlyoutCloseTimer = useCallback(() => {
    if (catalogFlyoutCloseTimer.current != null) {
      window.clearTimeout(catalogFlyoutCloseTimer.current);
      catalogFlyoutCloseTimer.current = null;
    }
  }, []);

  const scheduleCatalogFlyoutClose = useCallback(() => {
    clearCatalogFlyoutCloseTimer();
    catalogFlyoutCloseTimer.current = window.setTimeout(() => {
      setCatalogFlyoutSolutionId(null);
      catalogFlyoutCloseTimer.current = null;
    }, 180);
  }, [clearCatalogFlyoutCloseTimer]);

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

    const [pRes, sRes, tRes, kRes, prRes, ptRes, implRes] = await Promise.all([
      client.from("packages").select("*").order("package_id"),
      client.from("solutions").select("*").order("solution_id"),
      client.from("solution_tiers").select("*").order("solution_tier_id"),
      client.from("tasks").select("*").order("task_id"),
      client.from("solution_tier_pricing").select("*").order("solution_tier_id"),
      client.from("package_solution_tiers").select("*").order("package_id"),
      client.from("implementer_pricing_hour_groups").select("*").order("implementer_name"),
    ]);

    const err =
      pRes.error || sRes.error || tRes.error || kRes.error || prRes.error || ptRes.error
        ? [pRes.error, sRes.error, tRes.error, kRes.error, prRes.error, ptRes.error].find(Boolean)
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

    setState({
      status: "ok",
      packages,
      solutions,
      tiers,
      packageTiers,
      tasks,
      pricing,
      implementerHourGroups: implRes.error ? [] : ((implRes.data ?? []) as ImplementerHourGroupRow[]),
    });

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

  useEffect(
    () => () => {
      clearCatalogFlyoutCloseTimer();
    },
    [clearCatalogFlyoutCloseTimer]
  );

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
    setTierId(null);
    setSolId(null);
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
      .sort((a, b) => compareNamedRowsAsc(a.solution_name, b.solution_name, a.solution_id, b.solution_id));
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
      .sort((a, b) => compareNamedRowsAsc(a.solution_name, b.solution_name, a.solution_id, b.solution_id));
  }, [data, filterSol]);

  /** Sidebar always lists solutions in scope (catalog: all filtered; package: package scope). */
  const solutionSidebarMetaById = useMemo(() => {
    const out = new Map<string, { ownerLabel: string }>();
    if (!data) return out;
    const tiersBySolutionId = new Map<string, SolutionTier[]>();
    for (const tier of data.tiers) {
      const list = tiersBySolutionId.get(tier.solution_id) ?? [];
      list.push(tier);
      tiersBySolutionId.set(tier.solution_id, list);
    }
    for (const solution of data.solutions) {
      const tiersForSolution = tiersBySolutionId.get(solution.solution_id) ?? [];
      const owners = new Set<string>();
      for (const tier of tiersForSolution) {
        const owner = tier.solution_tier_owner?.trim();
        if (owner) owners.add(owner);
      }
      const ownerLabel =
        owners.size === 0 ? "No owner" : owners.size === 1 ? [...owners][0]! : "Multiple owners";
      out.set(solution.solution_id, {
        ownerLabel,
      });
    }
    return out;
  }, [data]);

  const solutionsNavRows = useMemo(() => {
    if (!data) return [];
    const base = mode === "catalog" && pkgId == null ? allSolutionsFiltered : solutionsVisible;
    return base.map((solution) => {
      const meta = solutionSidebarMetaById.get(solution.solution_id);
      return {
        ...solution,
        ownerLabel: meta?.ownerLabel ?? "No owner",
      };
    });
  }, [data, mode, pkgId, allSolutionsFiltered, solutionsVisible, solutionSidebarMetaById]);

  useEffect(() => {
    if (mode !== "catalog") {
      if (catalogFlyoutSolutionId !== null) setCatalogFlyoutSolutionId(null);
      return;
    }
    if (!catalogFlyoutSolutionId) return;
    if (!solutionsNavRows.some((row) => row.solution_id === catalogFlyoutSolutionId)) {
      setCatalogFlyoutSolutionId(null);
    }
  }, [mode, catalogFlyoutSolutionId, solutionsNavRows]);

  /** Package workspace: sidebar package list. */
  const packagesNavRows = useMemo(() => {
    if (!data || mode !== "package") return [];
    return data.packages
      .filter(
        (p) =>
          matchesQuery(p.package_name, filterPkg) ||
          matchesQuery(p.package_id, filterPkg)
      )
      .sort((a, b) => compareNamedRowsAsc(a.package_name, b.package_name, a.package_id, b.package_id));
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

  const packageExtrasAnchorTierId = useMemo(() => {
    if (!data || mode !== "package" || pkgId == null || pkgId === STANDALONE_PACKAGE_NAV_ID) return null;
    return anchorTierForPackage([...tierIdsForPackage(data.packageTiers, pkgId)]);
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

  const pricingByTierId = useMemo(() => {
    if (!data) return new Map<string, SolutionTierPricing>();
    return new Map(data.pricing.map((row) => [row.solution_tier_id, row]));
  }, [data]);

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
      packageExtrasAnchorTierId,
    });
  }, [data, tierId, packageWorkspaceLinkByTierId, packageExtrasAnchorTierId]);

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
    const addons = anyTime
      ? computeResourceHourAddons(sumTime)
      : { accountMgmtAddonHours: 0, continuousImprovementAddonHours: 0, billableHours: 0 };
    return {
      sumTime,
      sumDuration,
      anyTime,
      anyDuration,
      accountMgmtAddonHours: addons.accountMgmtAddonHours,
      continuousImprovementAddonHours: addons.continuousImprovementAddonHours,
      sumBillableHours: addons.billableHours,
    };
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
        const phaseRaw = tier.solution_tier_phase?.trim() ?? "";
        const categoryRaw = tier.solution_tier_category?.trim() ?? "";
        const tacticRaw = tier.solution_tier_tactic?.trim() ?? "";
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
          phaseRaw,
          categoryRaw,
          tacticRaw,
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

  const catalogAllTiersFilteredCount = useMemo(
    () =>
      filterCatalogTierRows(
        catalogTierTableRows,
        playbookPhase,
        playbookCategory,
        playbookTactic,
        catalogTierTableQuery
      ).length,
    [catalogTierTableRows, playbookPhase, playbookCategory, playbookTactic, catalogTierTableQuery]
  );

  const toggleCatalogTierSort = (col: CatalogTierSortCol) => {
    setCatalogTierSort((prev) =>
      prev.col === col ? { col, dir: prev.dir === "asc" ? "desc" : "asc" } : { col, dir: "asc" }
    );
  };

  const selectCatalogTier = useCallback((solutionId: string, id: string) => {
    setSolId(solutionId);
    setTierId(id);
    setFilterTier("");
    setFilterSol("");
  }, []);

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

    const extrasAnchorTier =
      useMergedPackage && tiersInPkg.length > 0
        ? anchorTierForPackage(tiersInPkg.map((t) => t.solution_tier_id))
        : null;

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
    let sumDuration = 0;
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
            packageExtrasAnchorTierId: extrasAnchorTier,
          })
        : data.tasks
            .filter((tk) => tk.solution_tier_id === t.solution_tier_id)
            .sort(compareTasksByOrder);
      for (const m of mergedList) {
        if (m.task_time != null && Number.isFinite(Number(m.task_time))) {
          sumTime += Number(m.task_time);
        }
        if (m.task_duration != null && Number.isFinite(Number(m.task_duration))) {
          sumDuration += Number(m.task_duration);
        }
        if (m.task_implementer?.trim()) roles.add(m.task_implementer.trim());
      }
    }

    const title =
      pkgId === STANDALONE_PACKAGE_NAV_ID
        ? "Standalone solutions"
        : data.packages.find((p) => p.package_id === pkgId)?.package_name ?? "Package";

    const vaultSellTotalDisplay = pricedCount > 0 ? formatUsd(sellSum) : "—";

    const workspaceTotals =
      pkgId === STANDALONE_PACKAGE_NAV_ID
        ? ({ ok: false } as ReturnType<typeof computePackageWorkspaceFormMetrics>)
        : (() => {
            const pkgObj = data.packages.find((p) => p.package_id === pkgId);
            if (!pkgObj) return { ok: false } as ReturnType<typeof computePackageWorkspaceFormMetrics>;
            const pkgLinks = data.packageTiers.filter((r) => r.package_id === pkgId);
            const sortedTierIds = [...new Set(pkgLinks.map((r) => r.solution_tier_id))].sort(sortId);
            return computePackageWorkspaceFormMetrics({
              pkg: pkgObj,
              tierIdsSorted: sortedTierIds,
              packageTierLinksForPackage: pkgLinks,
              vaultTasks: data.tasks,
              implementerHourGroups: data.implementerHourGroups,
              mathConfig:
                typeof globalThis.window !== "undefined"
                  ? loadTierPricingMathConfigFromStorage()
                  : normalizeTierPricingMathConfig(null),
            });
          })();

    const useWorkspaceTotals = workspaceTotals.ok === true;

    return {
      title,
      tiersCount: tiersInPkg.length,
      sellTotalDisplay: useWorkspaceTotals
        ? formatUsd(Math.round(workspaceTotals.netSellAfterSellDiscount))
        : vaultSellTotalDisplay,
      vaultSellTotalDisplay,
      vaultSumTaskTime: sumTime,
      vaultSumTaskDuration: sumDuration,
      useWorkspaceTotals,
      workspaceHoursDisplay: useWorkspaceTotals
        ? formatKpiNumber(workspaceTotals.totalResourceHoursAfterDiscount)
        : null,
      distinctImplementers: roles.size,
      sumTaskTime: sumTime,
      sumTaskDuration: sumDuration,
    };
  }, [data, pkgId, mode]);

  /** Full solution × tier price grid for the locked package workspace. */
  const packagePriceMatrix = useMemo(() => {
    if (!data || mode !== "package" || pkgId == null) return [];
    const tierList =
      pkgId === STANDALONE_PACKAGE_NAV_ID
        ? data.tiers.filter((t) => !assignedTierIdSet(data.packageTiers).has(t.solution_tier_id))
        : data.tiers.filter((t) => tierIdsForPackage(data.packageTiers, pkgId).has(t.solution_tier_id));
    const useMergedPackage = pkgId !== STANDALONE_PACKAGE_NAV_ID;
    const pkTierIds = tierList.map((x) => x.solution_tier_id);
    const extrasAnchor =
      useMergedPackage && pkTierIds.length ? anchorTierForPackage(pkTierIds) : null;
    const bySol = new Map<string, SolutionTier[]>();
    for (const t of tierList) {
      const arr = bySol.get(t.solution_id) ?? [];
      arr.push(t);
      bySol.set(t.solution_id, arr);
    }
    const rows: Array<{
      solution: Solution;
      tier: SolutionTier;
      hours: string;
      sell: string;
      tax: string;
    }> = [];
    for (const s of [...data.solutions].sort((a, b) => sortId(a.solution_id, b.solution_id))) {
      const trs = bySol.get(s.solution_id);
      if (!trs?.length) continue;
      for (const t of [...trs].sort((a, b) => sortId(a.solution_tier_id, b.solution_tier_id))) {
        const vault = data.pricing.find((p) => p.solution_tier_id === t.solution_tier_id) ?? null;
        const link =
          useMergedPackage
            ? data.packageTiers.find((r) => r.package_id === pkgId && r.solution_tier_id === t.solution_tier_id)
            : undefined;
        const pr =
          useMergedPackage
            ? mergePricingWithPackageOverrides(
                vault,
                t.solution_tier_id,
                parsePricingOverrides(link?.pricing_overrides)
              )
            : vault;
        const tierDisplay =
          useMergedPackage
            ? mergeTierWithPackageOverrides(t, parseTierOverrides(link?.tier_overrides))
            : t;
        const mergedTasks = useMergedPackage
          ? buildMergedTaskRowsForPackageTier({
              tierId: t.solution_tier_id,
              vaultTasks: data.tasks,
              taskOverrides: parseTaskOverridesMap(link?.task_overrides),
              taskExtensions: parseTaskExtensions(link?.task_extensions),
              packageExtrasAnchorTierId: extrasAnchor,
            })
          : data.tasks
              .filter((tk) => tk.solution_tier_id === t.solution_tier_id)
              .sort(compareTasksByOrder);
        let summedTaskHours = 0;
        let hasSummedTaskHours = false;
        for (const task of mergedTasks) {
          if (task.task_time == null || !Number.isFinite(Number(task.task_time))) continue;
          summedTaskHours += Number(task.task_time);
          hasSummedTaskHours = true;
        }
        const pricingHours =
          pr?.total_hours != null && Number.isFinite(Number(pr.total_hours)) ? Number(pr.total_hours) : null;
        rows.push({
          solution: s,
          tier: tierDisplay,
          hours:
            pricingHours != null
              ? formatKpiNumber(pricingHours)
              : hasSummedTaskHours
                ? formatKpiNumber(summedTaskHours)
                : "—",
          sell: sellPriceDisplay(pr),
          tax: taxableLabel(pr),
        });
      }
    }
    return rows;
  }, [data, mode, pkgId]);

  const packageWorkspacePkg = useMemo(() => {
    if (!data || mode !== "package" || pkgId == null || pkgId === STANDALONE_PACKAGE_NAV_ID) {
      return null;
    }
    return data.packages.find((p) => p.package_id === pkgId) ?? null;
  }, [data, mode, pkgId]);

  const packageWorkspaceUnifiedRows = useMemo(() => {
    if (!data || !packageWorkspacePkg || pkgId == null || pkgId === STANDALONE_PACKAGE_NAV_ID) return [];
    const pkgLinks = data.packageTiers.filter((r) => r.package_id === pkgId);
    const sortedTierIds = [...new Set(pkgLinks.map((r) => r.solution_tier_id))].sort(sortId);
    return computePackageUnifiedTaskRows({
      pkg: packageWorkspacePkg,
      tierIdsSorted: sortedTierIds,
      packageTierLinksForPackage: pkgLinks,
      vaultTasks: data.tasks,
    });
  }, [data, mode, pkgId, packageWorkspacePkg]);

  const tierMetaByIdForPackageWorkspace = useMemo(() => {
    const m = new Map<string, { tierName: string; solutionName: string }>();
    if (!data || mode !== "package" || pkgId == null || pkgId === STANDALONE_PACKAGE_NAV_ID) return m;
    const ids = tierIdsForPackage(data.packageTiers, pkgId);
    for (const t of data.tiers) {
      if (!ids.has(t.solution_tier_id)) continue;
      const sol = data.solutions.find((s) => s.solution_id === t.solution_id);
      m.set(t.solution_tier_id, {
        tierName: t.solution_tier_name,
        solutionName: sol?.solution_name ?? t.solution_id,
      });
    }
    return m;
  }, [data, mode, pkgId]);

  const packageUnifiedTaskTableTotals = useMemo(() => {
    let sumTime = 0;
    let sumDuration = 0;
    let anyTime = false;
    let anyDuration = false;
    for (const t of packageWorkspaceUnifiedRows) {
      if (t.task_time != null && Number.isFinite(Number(t.task_time))) {
        sumTime += Number(t.task_time);
        anyTime = true;
      }
      if (t.task_duration != null && Number.isFinite(Number(t.task_duration))) {
        sumDuration += Number(t.task_duration);
        anyDuration = true;
      }
    }
    const addons = anyTime
      ? computeResourceHourAddons(sumTime)
      : { accountMgmtAddonHours: 0, continuousImprovementAddonHours: 0, billableHours: 0 };
    return {
      sumTime,
      sumDuration,
      anyTime,
      anyDuration,
      accountMgmtAddonHours: addons.accountMgmtAddonHours,
      continuousImprovementAddonHours: addons.continuousImprovementAddonHours,
      sumBillableHours: addons.billableHours,
    };
  }, [packageWorkspaceUnifiedRows]);

  const showPackageTierPrompt = useMemo(
    () =>
      mode === "package" &&
      pkgId != null &&
      tierId == null &&
      tiersForWorkspacePackage.length > 0,
    [mode, pkgId, tierId, tiersForWorkspacePackage.length]
  );

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
      if (tierId == null) {
        if (solId !== null) setSolId(null);
        return;
      }
      if (!list.some((t) => t.solution_tier_id === tierId)) {
        setTierId(null);
        setSolId(null);
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
              Use the <Link className="agency-hub__link" to="/packages">Packages</Link> tab to build a new bundle or
              open an existing package workspace.
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
            className={mode === "catalog" ? "kb-nav kb-nav--catalog-flyout" : "kb-nav"}
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
                <div className="agency-nav-flyout-shell">
                  <div className="agency-nav-panel agency-nav-panel--solutions-flyout">
                    <section className="agency-nav-solutions-section" style={navSection}>
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
                      <div className="agency-nav-solutions-scroll">
                      <ul style={list}>
                        {solutionsNavRows.length === 0 ? (
                          <li>
                            <p style={{ ...emptyHint, padding: "0.35rem 0 0" }}>
                              No solutions match this search.
                            </p>
                          </li>
                        ) : (
                          solutionsNavRows.map((s) => (
                          <li
                            key={s.solution_id}
                            className="agency-nav-flyout-anchor"
                            onMouseLeave={scheduleCatalogFlyoutClose}
                          >
                            {(() => {
                              const flyoutTiers = data.tiers
                                .filter((tier) => tier.solution_id === s.solution_id)
                                .sort((a, b) => sortId(a.solution_tier_id, b.solution_tier_id));
                              return (
                                <>
                              <button
                                type="button"
                                className={
                                  solId === s.solution_id
                                    ? "kb-nav-item kb-nav-item--solution-rich kb-nav-item--active"
                                    : "kb-nav-item kb-nav-item--solution-rich"
                                }
                                title={`${solutionNavTitle(s)} · Owner: ${s.ownerLabel}`}
                                onMouseEnter={() => {
                                  clearCatalogFlyoutCloseTimer();
                                  setCatalogFlyoutSolutionId(s.solution_id);
                                }}
                                onFocus={() => {
                                  clearCatalogFlyoutCloseTimer();
                                  setCatalogFlyoutSolutionId(s.solution_id);
                                }}
                                onClick={() => {
                                  clearCatalogFlyoutCloseTimer();
                                  setCatalogFlyoutSolutionId(s.solution_id);
                                  setSolId(s.solution_id);
                                  const tr = data.tiers
                                    .filter((tier) => tier.solution_id === s.solution_id)
                                    .sort((a, b) =>
                                      sortId(a.solution_tier_id, b.solution_tier_id)
                                    )[0];
                                  setTierId(tr?.solution_tier_id ?? null);
                                }}
                              >
                                <span className="kb-nav-item__stack">
                                  <span className="kb-nav-item__label">{s.solution_name}</span>
                                  <span className="kb-nav-item__subline">{s.ownerLabel}</span>
                                </span>
                                <span className="kb-nav-item__meta kb-nav-item__meta--chevron" aria-hidden>
                                  ›
                                </span>
                              </button>
                                  {catalogFlyoutSolutionId === s.solution_id ? (
                                    <div
                                      className="agency-nav-flyout"
                                      role="menu"
                                      aria-label={`Solution tiers for ${s.solution_name}`}
                                      onMouseEnter={clearCatalogFlyoutCloseTimer}
                                      onMouseLeave={scheduleCatalogFlyoutClose}
                                    >
                                      <div className="agency-nav-flyout__header">
                                        <p className="agency-nav-flyout__eyebrow">Solution tiers</p>
                                        <p className="agency-nav-flyout__title">{s.solution_name}</p>
                                      </div>
                                      {flyoutTiers.length === 0 ? (
                                        <p className="agency-nav-flyout__hint">No tiers available for this solution.</p>
                                      ) : (
                                        <ul className="agency-nav-flyout__list">
                                          {flyoutTiers.map((t) => (
                                            <li key={t.solution_tier_id}>
                                              {(() => {
                                                const priceDisplay = formatUsd(
                                                  sellPriceNumber(
                                                    pricingByTierId.get(t.solution_tier_id) ?? null
                                                  )
                                                );
                                                return (
                                              <button
                                                type="button"
                                                className={
                                                  tierId === t.solution_tier_id
                                                    ? "agency-nav-flyout__item agency-nav-flyout__item--active"
                                                    : "agency-nav-flyout__item"
                                                }
                                                title={tierNavTitle(t, data.solutions)}
                                                onClick={() => {
                                                  setTierId(t.solution_tier_id);
                                                  setSolId(t.solution_id);
                                                  setCatalogFlyoutSolutionId(t.solution_id);
                                                }}
                                              >
                                                <span className="agency-nav-flyout__item-main">
                                                  <span className="agency-nav-flyout__item-name">
                                                    {t.solution_tier_name}
                                                  </span>
                                                  <span className="agency-nav-flyout__item-price">
                                                    {priceDisplay}
                                                  </span>
                                                </span>
                                              </button>
                                                );
                                              })()}
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                    </div>
                                  ) : null}
                                </>
                              );
                            })()}
                          </li>
                          ))
                        )}
                      </ul>
                      </div>
                    </section>
                  </div>
                </div>
              </>
            )}
          </nav>

          <main
            style={layout.main}
            className={mode === "package" ? "agency-package-workspace-main" : undefined}
          >
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
                    <span style={{ color: "var(--muted)", fontSize: "0.92rem" }}>
                      {selectedPackageOverview.useWorkspaceTotals ? (
                        <>
                          Totals match <strong>Package Builder</strong>: resource hour buckets after hour discount %, then
                          modeled sell and net sell after package sell discount %. They are not computed as simple “hours ×
                          rate.”
                        </>
                      ) : (
                        <>
                          Sell total is the sum of each tier’s modeled sell (vault + link overrides when in package mode).
                          Hours are the sum of task times in the checklist—they are not divided to get price.
                        </>
                      )}
                    </span>
                  </p>
                </div>
                <div className="agency-kpi-panel__grid agency-kpi-panel__grid--five">
                  <div className="agency-kpi-card agency-kpi-card--tasks">
                    <span className="agency-kpi-card__label">Tiers in package</span>
                    <span className="agency-kpi-card__value">
                      {selectedPackageOverview.tiersCount}
                    </span>
                  </div>
                  <div className="agency-kpi-card agency-kpi-card--pricing">
                    <span className="agency-kpi-card__label">
                      {selectedPackageOverview.useWorkspaceTotals ? "Net sell (workspace)" : "Sell total (Σ tiers)"}
                    </span>
                    <span className="agency-kpi-card__value">{selectedPackageOverview.sellTotalDisplay}</span>
                  </div>
                  <div className="agency-kpi-card agency-kpi-card--tasks">
                    <span className="agency-kpi-card__label">Distinct implementers</span>
                    <span className="agency-kpi-card__value">
                      {selectedPackageOverview.distinctImplementers}
                    </span>
                  </div>
                  <div className="agency-kpi-card agency-kpi-card--tasks">
                    <span className="agency-kpi-card__label">
                      {selectedPackageOverview.useWorkspaceTotals
                        ? "Resource hours · after hour discount %"
                        : "Sum of task time"}
                    </span>
                    <span className="agency-kpi-card__value">
                      {selectedPackageOverview.workspaceHoursDisplay ??
                        formatKpiNumber(selectedPackageOverview.sumTaskTime)}
                    </span>
                  </div>
                  <div className="agency-kpi-card agency-kpi-card--tasks">
                    <span className="agency-kpi-card__label">Sum of task duration</span>
                    <span className="agency-kpi-card__value">
                      {formatKpiNumber(selectedPackageOverview.sumTaskDuration)}
                    </span>
                  </div>
                </div>
                {selectedPackageOverview.useWorkspaceTotals ? (
                  <p
                    style={{
                      margin: "0.75rem 0 0",
                      color: "var(--muted)",
                      fontSize: "0.88rem",
                      lineHeight: 1.45,
                    }}
                  >
                    Catalog comparison: Σ tier vault sells <strong>{selectedPackageOverview.vaultSellTotalDisplay}</strong> ·
                    summed checklist task times <strong>{formatKpiNumber(selectedPackageOverview.vaultSumTaskTime)} h</strong> ·
                    summed checklist task duration{" "}
                    <strong>{formatKpiNumber(selectedPackageOverview.vaultSumTaskDuration)}</strong>.
                  </p>
                ) : null}
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
                    Sell price, hours, and tax reflect package overrides when set; otherwise hours fall back to summed task
                    time for that tier.
                  </p>
                </div>
                <div className="agency-package-matrix__scroll">
                  <table className="agency-package-matrix__table">
                    <thead>
                      <tr>
                        <th scope="col">Solution</th>
                        <th scope="col">Tier</th>
                        <th scope="col">Hours</th>
                        <th scope="col">Sell</th>
                        <th scope="col">Tax</th>
                      </tr>
                    </thead>
                    <tbody>
                      {packagePriceMatrix.map((row) => (
                        <tr key={row.tier.solution_tier_id}>
                          <td>{row.solution.solution_name}</td>
                          <td>{row.tier.solution_tier_name}</td>
                          <td>{row.hours}</td>
                          <td>{row.sell}</td>
                          <td>{row.tax}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {packageWorkspacePkg ? (
              <>
                <article className="agency-article agency-article--package" style={articleCard}>
                  <header style={articleHead}>
                    <h2 style={articleTitle}>{packageWorkspacePkg.package_name}</h2>
                    {packageWorkspacePkg.package_owner?.trim() ? (
                      <p style={ownerLine}>
                        Owner: <strong>{packageWorkspacePkg.package_owner.trim()}</strong>
                      </p>
                    ) : null}
                    {packageWorkspacePkg.package_category?.trim() ? (
                      <p style={metaLine}>Category: {packageWorkspacePkg.package_category.trim()}</p>
                    ) : null}
                  </header>

                  {(() => {
                    const p = packageWorkspacePkg;
                    const first = firstPackageNarrativeCategory(p);
                    const hasOverview = Boolean(
                      p.package_overview?.trim() ||
                        p.package_direction?.trim() ||
                        p.package_overview_link?.trim()
                    );
                    const hasDesc = Boolean(
                      p.package_what_is_it?.trim() ||
                        p.package_why_is_it_valuable?.trim() ||
                        p.package_when_should_it_be_used?.trim()
                    );
                    const hasScope = Boolean(
                      p.package_assumption_prerequisites?.trim() ||
                        p.package_in_scope?.trim() ||
                        p.package_out_of_scope?.trim() ||
                        p.package_final_deliverable?.trim()
                    );
                    const hasProcess = Boolean(
                      p.package_how_do_we_get_this_work_done?.trim() || p.package_sop?.trim()
                    );
                    const hasRes = packageHasResourceNarrative(p);
                    const resTemplatesRaw = (p.package_resource_templates ?? "").trim();
                    const resTemplates = stripRedundantResourceMarkdownHeading(resTemplatesRaw, "templates");
                    const resToolsRaw = (p.package_resource_tools ?? "").trim();
                    const resTools = stripRedundantResourceMarkdownHeading(resToolsRaw, "tools");
                    const resLegacy = (p.package_resources ?? "").trim();
                    const resExampleRows = (p.package_resource_examples ?? []).filter(
                      (r) => r.example.trim() || r.date.trim()
                    );

                    if (!hasOverview && !hasDesc && !hasScope && !hasProcess && !hasRes) {
                      return (
                        <p style={{ ...emptyHint, margin: "0.25rem 0 0" }}>
                          No package narrative saved yet. Edit details in{" "}
                          <Link className="agency-hub__link" to="/packages">
                            Packages
                          </Link>
                          .
                        </p>
                      );
                    }

                    return (
                      <>
                        {hasOverview ? (
                          <section
                            className={
                              first === "overview"
                                ? "agency-tier-category agency-tier-category--first"
                                : "agency-tier-category"
                            }
                          >
                            <h3 className="agency-tier-category__title">Overview</h3>
                            {p.package_overview?.trim() ? (
                              <AgencyTierSubsection
                                title="Package overview"
                                text={p.package_overview.trim()}
                                blockTitle={blockTitle}
                              />
                            ) : null}
                            {p.package_direction?.trim() ? (
                              <AgencyTierSubsection
                                title="Direction"
                                text={p.package_direction.trim()}
                                blockTitle={blockTitle}
                              />
                            ) : null}
                            {p.package_overview_link?.trim() ? (
                              <p style={{ ...metaLine, marginTop: "0.65rem" }}>
                                Overview link:{" "}
                                <a
                                  className="agency-hub__link"
                                  href={p.package_overview_link.trim()}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {p.package_overview_link.trim()}
                                </a>
                              </p>
                            ) : null}
                          </section>
                        ) : null}

                        {hasDesc ? (
                          <section
                            className={
                              first === "desc"
                                ? "agency-tier-category agency-tier-category--first"
                                : "agency-tier-category"
                            }
                          >
                            <h3 className="agency-tier-category__title">Description</h3>
                            {p.package_what_is_it?.trim() ? (
                              <AgencyTierSubsection
                                title="What is it"
                                text={p.package_what_is_it.trim()}
                                blockTitle={blockTitle}
                              />
                            ) : null}
                            {p.package_why_is_it_valuable?.trim() ? (
                              <AgencyTierSubsection
                                title="Why is it valuable"
                                text={p.package_why_is_it_valuable.trim()}
                                blockTitle={blockTitle}
                              />
                            ) : null}
                            {p.package_when_should_it_be_used?.trim() ? (
                              <AgencyTierSubsection
                                title="When should it be used"
                                text={p.package_when_should_it_be_used.trim()}
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
                            {p.package_assumption_prerequisites?.trim() ? (
                              <AgencyTierSubsection
                                title="Assumptions and prerequisites"
                                text={p.package_assumption_prerequisites.trim()}
                                blockTitle={blockTitle}
                              />
                            ) : null}
                            {p.package_in_scope?.trim() ? (
                              <AgencyTierSubsection
                                title="What is included in scope"
                                text={p.package_in_scope.trim()}
                                blockTitle={blockTitle}
                              />
                            ) : null}
                            {p.package_out_of_scope?.trim() ? (
                              <AgencyTierSubsection
                                title="What is not included in scope"
                                text={p.package_out_of_scope.trim()}
                                blockTitle={blockTitle}
                              />
                            ) : null}
                            {p.package_final_deliverable?.trim() ? (
                              <AgencyTierSubsection
                                title="What is the final deliverable"
                                text={p.package_final_deliverable.trim()}
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
                            {p.package_how_do_we_get_this_work_done?.trim() ? (
                              <AgencyTierSubsection
                                title="How we get this work done"
                                text={p.package_how_do_we_get_this_work_done.trim()}
                                blockTitle={blockTitle}
                              />
                            ) : null}
                            {p.package_sop?.trim() ? (
                              <AgencyTierSubsection title="SOP" text={p.package_sop.trim()} blockTitle={blockTitle} />
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
                            {resLegacy ? (
                              <AgencyTierSubsection title="Resources" text={resLegacy} blockTitle={blockTitle} />
                            ) : null}
                          </section>
                        ) : null}
                      </>
                    );
                  })()}
                </article>

                <section className="agency-tasks-panel" style={tasksSection}>
                  <h2 className="agency-tasks-panel__title" style={tasksTitle}>
                    Package tasks ({packageWorkspaceUnifiedRows.length})
                  </h2>
                  <p
                    style={{
                      margin: "0 0 1rem",
                      fontSize: "0.88rem",
                      color: "var(--muted)",
                      lineHeight: 1.45,
                    }}
                  >
                    Combined checklist for every tier in this package (same ordering as Package Builder).
                  </p>
                  {packageWorkspaceUnifiedRows.length === 0 ? (
                    <p style={emptyHint}>No tasks in this package checklist yet.</p>
                  ) : (
                    <div className="agency-task-table-wrap">
                      <table className="agency-task-table">
                        <thead>
                          <tr>
                            <th scope="col">Tier</th>
                            <th scope="col">Task</th>
                            <th scope="col">Implementer</th>
                            <th scope="col" className="agency-task-table__th--num">
                              Time
                            </th>
                            <th scope="col" className="agency-task-table__th--num">
                              Duration
                            </th>
                            <th scope="col">Dependencies</th>
                          </tr>
                        </thead>
                        <tbody>
                          {packageWorkspaceUnifiedRows.map((t) => {
                            const meta = tierMetaByIdForPackageWorkspace.get(t.solution_tier_id);
                            return (
                              <tr
                                key={`${t.solution_tier_id}:${t.task_id}`}
                                className={
                                  t.task_implementer == null &&
                                  t.task_time == null &&
                                  t.task_duration == null &&
                                  t.task_dependencies == null &&
                                  t.task_notes == null
                                    ? "agency-task-table__group-row"
                                    : undefined
                                }
                              >
                                <td>
                                  {meta ? (
                                    <>
                                      <span className="agency-task-table__name">{meta.tierName}</span>
                                      <div
                                        style={{
                                          fontSize: "0.82rem",
                                          color: "var(--muted)",
                                          marginTop: "0.2rem",
                                        }}
                                      >
                                        {meta.solutionName}
                                      </div>
                                    </>
                                  ) : (
                                    <span className="agency-task-table__name">{t.solution_tier_id}</span>
                                  )}
                                </td>
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
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          {packageUnifiedTaskTableTotals.anyTime ? (
                            <>
                              <tr className="agency-task-table__addon-row">
                                <td colSpan={3} className="agency-task-table__addon-label">
                                  Account mgmt add-on ({ACCOUNT_MGMT_HOURS_ADDON_RATE * 100}% of resource hours)
                                </td>
                                <td className="agency-task-table__td--num agency-task-table__addon-time">
                                  {formatKpiNumber(packageUnifiedTaskTableTotals.accountMgmtAddonHours)}
                                </td>
                                <td className="agency-task-table__td--num agency-task-table__addon-muted">—</td>
                                <td className="agency-task-table__td--meta agency-task-table__addon-muted">
                                  Included in tier pricing (Admin)
                                </td>
                              </tr>
                              <tr className="agency-task-table__addon-row">
                                <td colSpan={3} className="agency-task-table__addon-label">
                                  Continuous improvement add-on (
                                  {CONTINUOUS_IMPROVEMENT_HOURS_ADDON_RATE * 100}% of resource hours)
                                </td>
                                <td className="agency-task-table__td--num agency-task-table__addon-time">
                                  {formatKpiNumber(
                                    packageUnifiedTaskTableTotals.continuousImprovementAddonHours
                                  )}
                                </td>
                                <td className="agency-task-table__td--num agency-task-table__addon-muted">—</td>
                                <td className="agency-task-table__td--meta agency-task-table__addon-muted">
                                  Included in tier pricing (Admin)
                                </td>
                              </tr>
                            </>
                          ) : null}
                          <tr className="agency-task-table__totals-row">
                            <td colSpan={3} className="agency-task-table__totals-label">
                              Totals
                            </td>
                            <td className="agency-task-table__td--num agency-task-table__totals-value">
                              {packageUnifiedTaskTableTotals.anyTime
                                ? formatKpiNumber(packageUnifiedTaskTableTotals.sumBillableHours)
                                : "—"}
                            </td>
                            <td className="agency-task-table__td--num agency-task-table__totals-value">
                              {packageUnifiedTaskTableTotals.anyDuration
                                ? formatKpiNumber(packageUnifiedTaskTableTotals.sumDuration)
                                : "—"}
                            </td>
                            <td className="agency-task-table__totals-meta">
                              {packageWorkspaceUnifiedRows.length} task
                              {packageWorkspaceUnifiedRows.length === 1 ? "" : "s"}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </section>
              </>
            ) : null}

            {showPackageTierPrompt ? (
              <div className="agency-package-tier-prompt" role="status">
                <p className="agency-package-tier-prompt__eyebrow">Solution tier detail</p>
                <p className="agency-package-tier-prompt__title">Select a tier to continue</p>
                <p className="agency-package-tier-prompt__text">
                  Choose a solution tier in the left sidebar to open its narrative, scope, process, and task checklist
                  for this package.
                </p>
              </div>
            ) : null}

            {mode === "catalog" && (data.packages.length > 0 || data.solutions.length > 0) ? (
              <section
                className="agency-kpi-panel agency-kpi-panel--scope"
                style={kpiSectionWrap}
                aria-label={
                  catalogViewMode === "all_table" ? "All solution tiers browser" : "Tier pricing and task summary"
                }
              >
                <div className="agency-kpi-panel__head agency-kpi-panel__head--with-toggle">
                  <div className="agency-catalog-view-head">
                    <div>
                      <h2 className="agency-kpi-panel__title">
                        {catalogViewMode === "all_table" ? "All solution tiers" : "Tier summary"}
                      </h2>
                      <p className="agency-kpi-panel__scope agency-kpi-panel__scope--tight">
                        {catalogViewMode === "all_table"
                          ? `${catalogAllTiersFilteredCount} tier${catalogAllTiersFilteredCount === 1 ? "" : "s"} shown (${catalogTierTableRows.length} in vault)`
                          : kpiScopeLine}
                      </p>
                    </div>
                    <div className="agency-catalog-segment" role="group" aria-label="Catalog display mode">
                      <button
                        type="button"
                        className={
                          catalogViewMode === "all_table"
                            ? "agency-catalog-segment__btn agency-catalog-segment__btn--active"
                            : "agency-catalog-segment__btn"
                        }
                        onClick={() => setCatalogViewMode("all_table")}
                        aria-pressed={catalogViewMode === "all_table"}
                      >
                        All tiers
                      </button>
                      <button
                        type="button"
                        className={
                          catalogViewMode === "detail"
                            ? "agency-catalog-segment__btn agency-catalog-segment__btn--active"
                            : "agency-catalog-segment__btn"
                        }
                        onClick={() => setCatalogViewMode("detail")}
                        aria-pressed={catalogViewMode === "detail"}
                      >
                        Tier detail
                      </button>
                    </div>
                  </div>
                </div>
                {catalogViewMode === "detail" ? (
                  <div className="agency-kpi-panel__grid agency-kpi-panel__grid--five">
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
                    <div className="agency-kpi-card agency-kpi-card--tasks">
                      <span className="agency-kpi-card__label">Sum of task duration</span>
                      <span className="agency-kpi-card__value">
                        {formatKpiNumber(taskKpis.sumDuration)}
                      </span>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            {mode === "catalog" && catalogViewMode === "all_table" ? (
              <CatalogPlaybookBrowser
                allRows={catalogTierTableRows}
                phase={playbookPhase}
                category={playbookCategory}
                tactic={playbookTactic}
                onPhaseChange={setPlaybookPhase}
                onCategoryChange={setPlaybookCategory}
                onTacticChange={setPlaybookTactic}
                tableSearch={catalogTierTableQuery}
                onTableSearchChange={setCatalogTierTableQuery}
                sort={catalogTierSort}
                onToggleSort={toggleCatalogTierSort}
                onOpenTier={selectCatalogTier}
              />
            ) : null}

            {mode === "catalog" && catalogViewMode === "detail" && !selectedTier ? (
              <p style={emptyHint}>Select a tier to view details.</p>
            ) : null}

            {selectedTier && selectedTierDisplay ? (
              <div
                className={
                  mode === "package"
                    ? "agency-package-tier-detail-region"
                    : catalogViewMode === "all_table"
                      ? "agency-catalog-tier-detail-below-table"
                      : undefined
                }
              >
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
                          </tr>
                        </thead>
                        <tbody>
                          {tasksForTierDisplay.map((t) => (
                            <tr
                              key={t.task_id}
                              className={
                                t.task_implementer == null &&
                                t.task_time == null &&
                                t.task_duration == null &&
                                t.task_dependencies == null &&
                                t.task_notes == null
                                  ? "agency-task-table__group-row"
                                  : undefined
                              }
                            >
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
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          {taskTableTotals.anyTime ? (
                            <>
                              <tr className="agency-task-table__addon-row">
                                <td colSpan={2} className="agency-task-table__addon-label">
                                  Account mgmt add-on ({ACCOUNT_MGMT_HOURS_ADDON_RATE * 100}% of resource hours)
                                </td>
                                <td className="agency-task-table__td--num agency-task-table__addon-time">
                                  {formatKpiNumber(taskTableTotals.accountMgmtAddonHours)}
                                </td>
                                <td className="agency-task-table__td--num agency-task-table__addon-muted">—</td>
                                <td className="agency-task-table__td--meta agency-task-table__addon-muted">
                                  Included in tier pricing (Admin)
                                </td>
                              </tr>
                              <tr className="agency-task-table__addon-row">
                                <td colSpan={2} className="agency-task-table__addon-label">
                                  Continuous improvement add-on (
                                  {CONTINUOUS_IMPROVEMENT_HOURS_ADDON_RATE * 100}% of resource hours)
                                </td>
                                <td className="agency-task-table__td--num agency-task-table__addon-time">
                                  {formatKpiNumber(taskTableTotals.continuousImprovementAddonHours)}
                                </td>
                                <td className="agency-task-table__td--num agency-task-table__addon-muted">—</td>
                                <td className="agency-task-table__td--meta agency-task-table__addon-muted">
                                  Included in tier pricing (Admin)
                                </td>
                              </tr>
                            </>
                          ) : null}
                          <tr className="agency-task-table__totals-row">
                            <td colSpan={2} className="agency-task-table__totals-label">
                              Totals
                            </td>
                            <td className="agency-task-table__td--num agency-task-table__totals-value">
                              {taskTableTotals.anyTime
                                ? formatKpiNumber(taskTableTotals.sumBillableHours)
                                : "—"}
                            </td>
                            <td className="agency-task-table__td--num agency-task-table__totals-value">
                              {taskTableTotals.anyDuration
                                ? formatKpiNumber(taskTableTotals.sumDuration)
                                : "—"}
                            </td>
                            <td className="agency-task-table__totals-meta">
                              {tasksForTierDisplay.length} task{tasksForTierDisplay.length === 1 ? "" : "s"}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </section>
              </div>
            ) : null}
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
    gridTemplateColumns: "minmax(260px, 345px) 1fr",
    gap: "1.7rem",
    alignItems: "start",
  } satisfies CSSProperties,
  main: {
    minWidth: 0,
  },
};

const navSection: CSSProperties = {
  marginBottom: "1.05rem",
};

const navHeading: CSSProperties = {
  margin: "0 0 0.62rem",
  fontSize: "0.69rem",
  textTransform: "uppercase" as const,
  letterSpacing: "0.13em",
  color: "var(--accent)",
  fontWeight: 800,
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
