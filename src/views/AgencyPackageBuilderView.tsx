import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { PackageBuildWizard } from "../components/PackageBuildWizard";
import {
  PACKAGE_BUILDER_DESCRIPTION,
  PACKAGE_BUILDER_TITLE,
} from "../branding";
import {
  defaultPackageBuilderSlots,
  defaultPackageBuilderTypes,
  fetchPackageBuilderCatalog,
} from "../lib/packageBuilderSlots";
import { compareTasksByOrder } from "../lib/taskOrder";
import {
  browserKeyConfigurationError,
  envConfigured,
  getSupabase,
} from "../lib/supabase";
import type {
  Package,
  PackageBuilderPackageType,
  PackageBuilderSlotTemplate,
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

const shell: CSSProperties = {
  width: "100%",
  padding: "1rem 0 2.5rem",
};

const BUILD_STEPS = [
  { n: 1, label: "Package type", hint: "Choose a family" },
  { n: 2, label: "Package tier", hint: "Basic · Standard · Advanced" },
  { n: 3, label: "Vault tiers", hint: "Add solution tiers" },
  { n: 4, label: "Pricing", hint: "Confirm discounts" },
] as const;

export function AgencyPackageBuilderView() {
  const navigate = useNavigate();
  const location = useLocation();
  const initialPackageTypeId =
    (location.state as { packageBuilderTypeId?: string } | null)?.packageBuilderTypeId ?? null;
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [packages, setPackages] = useState<Package[]>([]);
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [tiers, setTiers] = useState<SolutionTier[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [pricing, setPricing] = useState<SolutionTierPricing[]>([]);
  const defaultTypeSeed = defaultPackageBuilderTypes()[0]!;
  const [packageTypes, setPackageTypes] = useState<PackageBuilderPackageType[]>(() =>
    defaultPackageBuilderTypes().map((t) => ({ ...t }))
  );
  const [slots, setSlots] = useState<PackageBuilderSlotTemplate[]>(() =>
    defaultPackageBuilderSlots(defaultTypeSeed.id).map((r) => ({ ...r }))
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

    const [pRes, sRes, tRes, kRes, prRes, slotPack] = await Promise.all([
      client.from("packages").select("*").order("package_id"),
      client.from("solutions").select("*").order("solution_id"),
      client.from("solution_tiers").select("*").order("solution_tier_id"),
      client.from("tasks").select("*").order("task_id"),
      client.from("solution_tier_pricing").select("*").order("solution_tier_id"),
      fetchPackageBuilderCatalog(client),
    ]);

    const err =
      pRes.error || sRes.error || tRes.error || kRes.error
        ? [pRes.error, sRes.error, tRes.error, kRes.error].find(Boolean)
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
    setPackageTypes(slotPack.catalog.types.map((t) => ({ ...t })));
    setSlots(slotPack.catalog.slots.map((r) => ({ ...r })));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const familyCount = packageTypes.length;

  return (
    <div className="agency-view-shell pkg-builder-page" style={shell}>
      <div className="pkg-builder-page__glow" aria-hidden />
      <div className="pkg-builder-page__shell">
        <header className="pkg-builder-page__header">
          <div className="pkg-builder-page__header-copy">
            <div className="pkg-builder-page__header-top">
              <p className="pkg-builder-page__eyebrow">Guided workflow</p>
              {!loading && !loadErr && familyCount > 0 ? (
                <span className="pkg-builder-page__stat">
                  {familyCount} {familyCount === 1 ? "family" : "families"}
                </span>
              ) : null}
            </div>
            <h1 className="pkg-builder-page__title">{PACKAGE_BUILDER_TITLE}</h1>
            <p className="pkg-builder-page__lead">{PACKAGE_BUILDER_DESCRIPTION}</p>
          </div>
          <Link className="pkg-builder-page__library-link" to="/packages">
            <span className="pkg-builder-page__library-icon" aria-hidden>
              ◫
            </span>
            Browse package library
            <span className="pkg-builder-page__library-arrow" aria-hidden>
              →
            </span>
          </Link>
        </header>

        <ol className="pkg-builder-page__rail" aria-label="Build steps">
          {BUILD_STEPS.map((step, index) => (
            <li
              key={step.n}
              className={
                step.n === 1
                  ? "pkg-builder-page__rail-item is-current"
                  : "pkg-builder-page__rail-item"
              }
              aria-current={step.n === 1 ? "step" : undefined}
            >
              <span className="pkg-builder-page__rail-marker">
                <span className="pkg-builder-page__rail-num">{step.n}</span>
              </span>
              <span className="pkg-builder-page__rail-text">
                <span className="pkg-builder-page__rail-label">{step.label}</span>
                <span className="pkg-builder-page__rail-hint">{step.hint}</span>
              </span>
              {index < BUILD_STEPS.length - 1 ? (
                <span className="pkg-builder-page__rail-connector" aria-hidden />
              ) : null}
            </li>
          ))}
        </ol>

        <div className="pkg-builder-page__body">
          {loading && (
            <p className="pkg-builder-page__loading" role="status">
              Loading package builder…
            </p>
          )}

          {!loading && loadErr && (
            <p className="pkg-builder-page__error" role="alert">
              {loadErr}
            </p>
          )}

          {!loading && !loadErr && (
            <PackageBuildWizard
              variant="page"
              packageTypes={packageTypes}
              slots={slots}
              packages={packages}
              solutions={solutions}
              tiers={tiers}
              tasks={tasks}
              pricing={pricing}
              onReload={load}
              onCreated={(id) => navigate(`/package/${encodeURIComponent(id)}`)}
              initialPackageTypeId={initialPackageTypeId}
            />
          )}
        </div>
      </div>
    </div>
  );
}
