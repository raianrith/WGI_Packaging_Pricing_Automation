import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AGENCY_HERO_TITLE,
  AGENCY_VIEW_DESCRIPTION,
} from "../branding";
import { todayISODate } from "../lib/dates";
import { insertAuditLog } from "../lib/audit";
import { notifyPackagingDataChanged } from "../lib/packagingEvents";
import {
  defaultPackageBuilderSlots,
  defaultPackageBuilderTypes,
  fetchPackageBuilderCatalog,
  isVaultTierAllowedForSlot,
  slotEnforcesHourCeiling,
  slotEnforcesPriceCeiling,
  slotEnforcesTierCountLimit,
  slotTierNotes,
  slotsForPackageType,
} from "../lib/packageBuilderSlots";
import {
  applyPackageTierMembership,
  emptyPackageLinkPayload,
} from "../lib/packageTierLinkPersistence";
import { compareTasksByOrder } from "../lib/taskOrder";
import { vaultSellPriceUsd, vaultTierHours } from "../lib/vaultTierMetrics";
import { loadTierPricingMathConfigFromStorage, normalizeTierPricingMathConfig } from "../lib/tierPricingMath";
import {
  computePackageWizardDiscountPreview,
  computePackageWorkspaceFormMetrics,
  parsePackageDiscountPct,
} from "../lib/packageWorkspaceMetrics";
import {
  browserKeyConfigurationError,
  envConfigured,
  getSupabase,
} from "../lib/supabase";
import { friendlyMutationMessage } from "../lib/supabaseErrors";
import { useToast } from "../context/ToastContext";
import type {
  AuditLogRow,
  ImplementerHourGroupRow,
  Package,
  PackageBuilderPackageType,
  PackageBuilderSlotTemplate,
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

function nextAutoPackageId(packages: Package[]): string {
  let max = 0;
  const re = /^1-(\d+)$/i;
  for (const p of packages) {
    const m = p.package_id.trim().match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `1-${max + 1}`;
}

function fmtUsd(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtHoursTotal(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function displayTierLabel(typeName: string, slotLabel: string): string {
  const label = slotLabel.trim();
  const name = typeName.trim();
  if (!name) return label || "Tier";
  const prefixes = [`${name} - `, `${name} – `, `${name}: `];
  for (const prefix of prefixes) {
    if (label.toLowerCase().startsWith(prefix.toLowerCase())) {
      return label.slice(prefix.length).trim() || label;
    }
  }
  return label || "Tier";
}

function slotLimitTags(slot: PackageBuilderSlotTemplate): string[] {
  const tags: string[] = [];
  if (slotEnforcesHourCeiling(slot)) {
    tags.push(`${slot.hour_ceiling}h max`);
  }
  if (slotEnforcesPriceCeiling(slot)) {
    tags.push(`${fmtUsd(Number(slot.price_ceiling))} max`);
  }
  if (slotEnforcesTierCountLimit(slot)) {
    tags.push(`${slot.solution_tier_limit} tier${slot.solution_tier_limit === 1 ? "" : "s"} max`);
  }
  if (slot.allowed_solution_tier_ids.length > 0) {
    tags.push(`${slot.allowed_solution_tier_ids.length} allowed vault tiers`);
  }
  if (tags.length === 0) tags.push("No limits");
  return tags;
}

type WizardStep = 1 | 2 | 3 | 4;

function WizardStepper({ step }: { step: WizardStep }) {
  const steps = [
    { n: 1 as const, label: "Package type" },
    { n: 2 as const, label: "Package tier" },
    { n: 3 as const, label: "Solution tiers" },
    { n: 4 as const, label: "Discounts" },
  ];
  return (
    <ol className="agency-pkg-wizard__steps" aria-label="Progress">
      {steps.map((s) => (
        <li
          key={s.n}
          className={[
            "agency-pkg-wizard__step",
            step > s.n ? "is-done" : "",
            step === s.n ? "is-current" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-current={step === s.n ? "step" : undefined}
        >
          <span className="agency-pkg-wizard__step-num">{s.n}</span>
          {s.label}
        </li>
      ))}
    </ol>
  );
}

function PackageTierDisclaimer({ notes }: { notes: string | null }) {
  if (!notes) return null;
  return (
    <div className="agency-pkg-wizard__disclaimer" role="note" aria-live="polite">
      <div className="agency-pkg-wizard__disclaimer-inner">
        <span className="agency-pkg-wizard__disclaimer-icon" aria-hidden>
          !
        </span>
        <div className="agency-pkg-wizard__disclaimer-body">
          <span className="agency-pkg-wizard__disclaimer-label">Important</span>
          <p className="agency-pkg-wizard__disclaimer-text">{notes}</p>
        </div>
      </div>
    </div>
  );
}

function WizardMeter({
  label,
  value,
  max,
  format,
  over,
  note,
}: {
  label: string;
  value: number;
  max: number | null;
  format: (n: number) => string;
  over?: boolean;
  note?: string | null;
}) {
  const hasMax = max != null && Number.isFinite(max) && max > 0;
  const pct = hasMax ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={over ? "agency-pkg-wizard__meter is-over" : "agency-pkg-wizard__meter"}>
      <div className="agency-pkg-wizard__meter-head">
        <span className="agency-pkg-wizard__meter-label">{label}</span>
        <span className="agency-pkg-wizard__meter-value">
          {format(value)}
          {hasMax ? ` / ${format(max)}` : ""}
        </span>
      </div>
      {hasMax ? (
        <div className="agency-pkg-wizard__meter-bar" aria-hidden="true">
          <div className="agency-pkg-wizard__meter-fill" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      {note ? <p className="agency-pkg-wizard__meter-note">{note}</p> : null}
    </div>
  );
}

type PackageCardRollup = {
  tierCount: number;
  hoursSum: number;
  priceSum: number;
  hoursPartial: boolean;
  pricePartial: boolean;
};

type PackageSourceFilter = "prebuilt" | "custom";

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
  const navigate = useNavigate();
  const { toastError, toastNote } = useToast();
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
  const defaultTypeSeed = defaultPackageBuilderTypes()[0]!;
  const [packageTypes, setPackageTypes] = useState<PackageBuilderPackageType[]>(() =>
    defaultPackageBuilderTypes().map((t) => ({ ...t }))
  );
  const [slots, setSlots] = useState<PackageBuilderSlotTemplate[]>(() =>
    defaultPackageBuilderSlots(defaultTypeSeed.id).map((r) => ({ ...r }))
  );
  const [pkgFilter, setPkgFilter] = useState("");
  const [packageSourceFilter, setPackageSourceFilter] = useState<PackageSourceFilter>("prebuilt");
  const [packageCreatorFilter, setPackageCreatorFilter] = useState("all");

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizStep, setWizStep] = useState<WizardStep>(1);
  const [hourDiscountPctStr, setHourDiscountPctStr] = useState("0");
  const [sellDiscountPctStr, setSellDiscountPctStr] = useState("0");
  const [selectedPackageType, setSelectedPackageType] = useState<PackageBuilderPackageType | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<PackageBuilderSlotTemplate | null>(null);
  const [tierPickIds, setTierPickIds] = useState<string[]>([]);
  const [tierSearch, setTierSearch] = useState("");
  const [pkgName, setPkgName] = useState("");
  const [createBusy, setCreateBusy] = useState(false);

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
    setSlots(slotPack.catalog.slots.map((r) => ({ ...r })));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const solutionById = useMemo(() => {
    const m = new Map<string, Solution>();
    for (const s of solutions) m.set(s.solution_id, s);
    return m;
  }, [solutions]);

  const pricingByTierId = useMemo(() => {
    const m = new Map<string, SolutionTierPricing>();
    for (const p of pricing) m.set(p.solution_tier_id, p);
    return m;
  }, [pricing]);

  const pkgRollupById = useMemo(() => {
    const tiersByPkg = new Map<string, Set<string>>();
    for (const row of packageTiers) {
      const set = tiersByPkg.get(row.package_id) ?? new Set<string>();
      set.add(row.solution_tier_id);
      tiersByPkg.set(row.package_id, set);
    }
    const m = new Map<string, PackageCardRollup>();
    for (const pkg of packages) {
      const ids = [...(tiersByPkg.get(pkg.package_id) ?? new Set<string>())];
      let hoursSum = 0;
      let priceSum = 0;
      let hoursPartial = false;
      let pricePartial = false;
      for (const tid of ids) {
        const pr = pricingByTierId.get(tid) ?? null;
        const h = vaultTierHours(pr, tasks, tid);
        const usd = vaultSellPriceUsd(pr);
        if (h == null) hoursPartial = true;
        else hoursSum += h;
        if (usd == null) pricePartial = true;
        else priceSum += usd;
      }
      m.set(pkg.package_id, {
        tierCount: ids.length,
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

  const packageSourceCounts = useMemo(() => {
    let custom = 0;
    let prebuilt = 0;
    for (const pkg of packages) {
      const isCustom = packageTypeNameSet.has((pkg.package_category ?? "").trim().toLowerCase());
      if (isCustom) custom += 1;
      else prebuilt += 1;
    }
    return { custom, prebuilt };
  }, [packages, packageTypeNameSet]);

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

  const filteredPackages = useMemo(() => {
    const q = pkgFilter.trim().toLowerCase();
    return packages.filter((p) => {
      const isCustom = packageTypeNameSet.has((p.package_category ?? "").trim().toLowerCase());
      if (packageSourceFilter === "custom" && !isCustom) return false;
      if (packageSourceFilter === "prebuilt" && isCustom) return false;
      if (packageCreatorFilter !== "all" && packageCreatorById.get(p.package_id) !== packageCreatorFilter) return false;
      if (!q) return true;
      return p.package_id.toLowerCase().includes(q) || (p.package_name ?? "").toLowerCase().includes(q);
    });
  }, [packages, pkgFilter, packageSourceFilter, packageTypeNameSet, packageCreatorFilter, packageCreatorById]);

  const slotsForSelectedType = useMemo(() => {
    if (!selectedPackageType) return [];
    return slotsForPackageType(slots, selectedPackageType.id);
  }, [slots, selectedPackageType]);

  const tierRows = useMemo(() => {
    const q = tierSearch.trim().toLowerCase();
    let rows = [...tiers].sort((a, b) => sortId(a.solution_tier_id, b.solution_tier_id));
    if (selectedSlot) {
      rows = rows.filter((t) => isVaultTierAllowedForSlot(selectedSlot, t.solution_tier_id));
    }
    if (!q) return rows;
    return rows.filter((t) => {
      const sol = solutionById.get(t.solution_id);
      const solName = sol?.solution_name?.toLowerCase() ?? "";
      return (
        t.solution_tier_name.toLowerCase().includes(q) ||
        t.solution_tier_id.toLowerCase().includes(q) ||
        t.solution_id.toLowerCase().includes(q) ||
        solName.includes(q)
      );
    });
  }, [tiers, tierSearch, solutionById, selectedSlot]);

  const usage = useMemo(() => {
    let hours = 0;
    let price = 0;
    let missingHours = false;
    let missingPrice = false;
    for (const id of tierPickIds) {
      const pr = pricingByTierId.get(id) ?? null;
      const h = vaultTierHours(pr, tasks, id);
      const usd = vaultSellPriceUsd(pr);
      if (h == null) missingHours = true;
      else hours += h;
      if (usd == null) missingPrice = true;
      else price += usd;
    }
    return { hours, price, missingHours, missingPrice };
  }, [tierPickIds, pricingByTierId, tasks]);

  const ceiling = selectedSlot;
  const overHours =
    ceiling != null &&
    slotEnforcesHourCeiling(ceiling) &&
    usage.hours > (ceiling.hour_ceiling ?? 0);
  const overPrice =
    ceiling != null &&
    slotEnforcesPriceCeiling(ceiling) &&
    usage.price > (ceiling.price_ceiling ?? 0);
  const overTierCount =
    ceiling != null &&
    slotEnforcesTierCountLimit(ceiling) &&
    tierPickIds.length > (ceiling.solution_tier_limit ?? 0);
  const tierStepValid =
    ceiling != null &&
    selectedPackageType != null &&
    pkgName.trim().length > 0 &&
    tierPickIds.length > 0 &&
    !overHours &&
    !overPrice &&
    !overTierCount;

  const canCreate = tierStepValid && !createBusy;

  const discountPreview = useMemo(() => {
    return computePackageWizardDiscountPreview({
      tierIdsSorted: [...tierPickIds].sort(sortId),
      pricingRows: pricing,
      vaultTasks: tasks,
      catalogHours: usage.hours,
      catalogSell: usage.price,
      missingHours: usage.missingHours,
      missingPrice: usage.missingPrice,
      hourPct: parsePackageDiscountPct(hourDiscountPctStr),
      sellPct: parsePackageDiscountPct(sellDiscountPctStr),
    });
  }, [hourDiscountPctStr, sellDiscountPctStr, usage, tierPickIds, pricing, tasks]);

  const resetWizardDiscounts = () => {
    setHourDiscountPctStr("0");
    setSellDiscountPctStr("0");
  };

  const beginPackageBuild = (packageType: PackageBuilderPackageType) => {
    setWizardOpen(true);
    setWizStep(2);
    setSelectedPackageType({ ...packageType });
    setSelectedSlot(null);
    setTierPickIds([]);
    setTierSearch("");
    setPkgName(`${packageType.name} package`);
    resetWizardDiscounts();
  };

  const closeWizard = () => {
    if (createBusy) return;
    setWizardOpen(false);
    resetWizardDiscounts();
  };

  const toggleTierPick = (tierId: string, on: boolean) => {
    if (on && selectedSlot && !isVaultTierAllowedForSlot(selectedSlot, tierId)) return;
    setTierPickIds((prev) => {
      if (on) {
        if (prev.includes(tierId)) return prev;
        if (
          selectedSlot &&
          slotEnforcesTierCountLimit(selectedSlot) &&
          prev.length >= (selectedSlot.solution_tier_limit ?? 0)
        ) {
          return prev;
        }
        return [...prev, tierId];
      }
      return prev.filter((x) => x !== tierId);
    });
  };

  const createPackage = async () => {
    const client = getSupabase();
    if (!client || !ceiling) return;
    const name = pkgName.trim();
    if (!name) {
      toastError("Enter a package name.");
      return;
    }
    const wanted = [...tierPickIds].sort(sortId);
    for (const tid of wanted) {
      const t = tiers.find((x) => x.solution_tier_id === tid);
      if (!t?.solution_tier_name.trim()) {
        toastError(`Tier ${tid} needs a name in the vault before it can be added to a package.`);
        return;
      }
    }
    setCreateBusy(true);
    try {
      const today = todayISODate();
      const newId = nextAutoPackageId(packages);
      const hourPct = parsePackageDiscountPct(hourDiscountPctStr);
      const sellPct = parsePackageDiscountPct(sellDiscountPctStr);
      const row: Package = {
        package_id: newId,
        package_name: name,
        package_create_date: today,
        package_modified_date: today,
        package_category: selectedPackageType?.name?.trim() || null,
        package_hour_discount_pct: hourPct,
        package_sell_discount_pct: sellPct,
      };
      const { error: insErr } = await client.from("packages").insert(row);
      if (insErr) {
        toastError(friendlyMutationMessage(insErr.message));
        return;
      }
      const payloadByTier: Record<string, ReturnType<typeof emptyPackageLinkPayload>> = {};
      for (const tid of wanted) payloadByTier[tid] = emptyPackageLinkPayload();
      const assignErr = await applyPackageTierMembership(client, newId, wanted, payloadByTier);
      if (assignErr) {
        toastError(
          `${assignErr} Package ${newId} was created; fix tier links in Admin → Package Builder if needed.`
        );
        notifyPackagingDataChanged();
        await load();
        return;
      }
      const { error: auditErr } = await insertAuditLog(client, {
        entityType: "packages",
        entityId: newId,
        action: "insert",
        before: null,
        after: {
          ...(JSON.parse(JSON.stringify(row)) as Record<string, unknown>),
          solution_tier_ids: wanted,
        },
      });
      if (auditErr) {
        toastNote(
          `Package created, but change history was not recorded (${auditErr}). Run the audit_log migration in Supabase if this persists.`
        );
      }
      notifyPackagingDataChanged();
      toastNote(`Package ${newId} created (${wanted.length} tier(s)).`);
      setWizardOpen(false);
      await load();
      navigate(`/package/${encodeURIComponent(newId)}`);
    } finally {
      setCreateBusy(false);
    }
  };

  return (
    <div className="agency-view-shell" style={shell}>
      <header className="agency-page-header">
        <h1 style={title}>{AGENCY_HERO_TITLE}</h1>
        <p className="agency-hero__desc" style={subtitle}>
          {AGENCY_VIEW_DESCRIPTION}{" "}
          <Link className="agency-hub__link" to="/">
            Solutions overview
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
          <section className="agency-pkg-build-start" aria-labelledby="pkg-build-start-title">
            <div className="agency-pkg-build-start__copy">
              <span className="agency-pkg-build-start__eyebrow">Build a Package</span>
              <h2 id="pkg-build-start-title" className="agency-pkg-build-start__title">
                Step 1: choose the kind of package you are building
              </h2>
              <p className="agency-pkg-build-start__lead">
                Pick a package family below. We’ll open the tier setup next, then you can add vault solution tiers.
                Limits are managed in{" "}
                <Link className="agency-hub__link" to="/admin">
                  Admin → Build-a-Package configuration
                </Link>
                .
              </p>
            </div>

            {packageTypes.length === 0 ? (
              <p className="agency-pkg-build-start__empty">
                No package types are configured yet.
              </p>
            ) : (
              <div className="agency-pkg-build-start__grid">
                {packageTypes.map((pt, index) => {
                  const tierCount = slotsForPackageType(slots, pt.id).length;
                  return (
                    <button
                      key={pt.id}
                      type="button"
                      className="agency-pkg-build-start__card"
                      onClick={() => beginPackageBuild(pt)}
                    >
                      <span className="agency-pkg-build-start__card-num">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="agency-pkg-build-start__card-title">{pt.name}</span>
                      <span className="agency-pkg-build-start__card-meta">
                        {tierCount} package tier{tierCount === 1 ? "" : "s"}
                      </span>
                      <span className="agency-pkg-build-start__card-cta">
                        Choose type <span aria-hidden>→</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className="agency-pkg-open-panel" aria-labelledby="pkg-open-title">
            <div className="agency-pkg-open-panel__head">
              <div>
                <span className="agency-pkg-open-panel__eyebrow">Package Library</span>
                <h2 id="pkg-open-title" className="agency-pkg-open-panel__title">
                  Open a package
                </h2>
                <p className="agency-pkg-open-panel__lead">
                  Jump back into a custom build, or open an Admin-built package.
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

            <div className="agency-pkg-open-panel__filters" role="tablist" aria-label="Package library">
              <button
                type="button"
                role="tab"
                aria-selected={packageSourceFilter === "prebuilt"}
                className={
                  packageSourceFilter === "prebuilt"
                    ? "agency-pkg-open-panel__filter is-active"
                    : "agency-pkg-open-panel__filter"
                }
                onClick={() => setPackageSourceFilter("prebuilt")}
              >
                <span>Preset Packages (Admin Packages)</span>
                <strong>{packageSourceCounts.prebuilt}</strong>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={packageSourceFilter === "custom"}
                className={
                  packageSourceFilter === "custom"
                    ? "agency-pkg-open-panel__filter is-active"
                    : "agency-pkg-open-panel__filter"
                }
                onClick={() => setPackageSourceFilter("custom")}
              >
                <span>Custom Packages</span>
                <strong>{packageSourceCounts.custom}</strong>
              </button>
            </div>

            {filteredPackages.length === 0 ? (
              <p className="agency-pkg-open-panel__empty">
                {packages.length === 0 ? "No packages in the vault yet." : "No packages match this filter."}
              </p>
            ) : (
              <ul className="agency-pkg-hub__grid" role="list" aria-label="Packages">
                {filteredPackages.map((p) => {
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
                    rollup.tierCount === 0
                      ? "No tiers"
                      : rollup.tierCount === 1
                        ? "1 tier"
                        : `${rollup.tierCount} tiers`;
                  const vaultHoursDisplay =
                    rollup.tierCount === 0
                      ? "—"
                      : `${fmtHoursTotal(rollup.hoursSum)} h${rollup.hoursPartial ? " *" : ""}`;
                  const vaultPriceDisplay =
                    rollup.tierCount === 0 ? "—" : fmtUsd(rollup.priceSum) + (rollup.pricePartial ? " *" : "");
                  const workspaceHoursDisplay =
                    rollup.tierCount === 0
                      ? "—"
                      : wsOk
                        ? `${fmtHoursTotal(ws.totalResourceHoursAfterDiscount)} h`
                        : "—";
                  const workspaceSellDisplay =
                    rollup.tierCount === 0 ? "—" : wsOk ? fmtUsd(Math.round(ws.netSellAfterSellDiscount)) : "—";
                  const isCustomPackage = packageTypeNameSet.has((p.package_category ?? "").trim().toLowerCase());
                  const sourceLabel = isCustomPackage ? "Custom built" : "Admin built";
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
                  return (
                    <li key={p.package_id}>
                      <Link
                        className="agency-pkg-hub__card"
                        to={`/package/${encodeURIComponent(p.package_id)}`}
                        aria-label={a11yLabel}
                      >
                        <div className="agency-pkg-hub__card-body">
                          <div className="agency-pkg-hub__card-head">
                            <h3 className="agency-pkg-hub__card-title">{p.package_name}</h3>
                            <span className="agency-pkg-hub__pills">
                              <span
                                className={
                                  isCustomPackage
                                    ? "agency-pkg-hub__source-pill agency-pkg-hub__source-pill--custom"
                                    : "agency-pkg-hub__source-pill agency-pkg-hub__source-pill--prebuilt"
                                }
                              >
                                {sourceLabel}
                              </span>
                              <span
                                className={
                                  rollup.tierCount === 0
                                    ? "agency-pkg-hub__tier-pill agency-pkg-hub__tier-pill--empty"
                                    : "agency-pkg-hub__tier-pill"
                                }
                              >
                                {tierLabel}
                              </span>
                            </span>
                          </div>
                          {creatorEmail ? (
                            <p className="agency-pkg-hub__creator">Created by {creatorEmail}</p>
                          ) : null}
                          <div
                            className="agency-pkg-hub__card-stats"
                            aria-label="Package workspace totals from Package Builder pricing"
                          >
                            <div className="agency-pkg-hub__stat agency-pkg-hub__stat--hours">
                              <div className="agency-pkg-hub__stat-inner">
                                <span className="agency-pkg-hub__stat-label">Hours</span>
                                <span className="agency-pkg-hub__stat-hint">Workspace · after hour discount %</span>
                                <span className="agency-pkg-hub__stat-value">{workspaceHoursDisplay}</span>
                              </div>
                            </div>
                            <div className="agency-pkg-hub__stat agency-pkg-hub__stat--sell">
                              <div className="agency-pkg-hub__stat-inner">
                                <span className="agency-pkg-hub__stat-label">Net sell</span>
                                <span className="agency-pkg-hub__stat-hint">Workspace · after sell discount %</span>
                                <span className="agency-pkg-hub__stat-value">{workspaceSellDisplay}</span>
                              </div>
                            </div>
                          </div>
                          {rollup.tierCount > 0 ? (
                            <p className="agency-pkg-hub__vault-mini">
                              Σ vault tiers (catalog){rollup.hoursPartial || rollup.pricePartial ? " *" : ""}:{" "}
                              {vaultHoursDisplay} · {vaultPriceDisplay}
                            </p>
                          ) : null}
                          {rollup.tierCount > 0 && !wsOk ? (
                            <p className="agency-pkg-hub__card-partial">Workspace totals could not be calculated.</p>
                          ) : null}
                          {partialNote ? (
                            <p className="agency-pkg-hub__card-partial">{partialNote}</p>
                          ) : null}
                          <div className="agency-pkg-hub__card-foot">
                            <span className="agency-pkg-hub__card-cta">Open workspace</span>
                            <span className="agency-pkg-hub__card-arrow" aria-hidden="true">
                              →
                            </span>
                          </div>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}

      {wizardOpen && (
        <div className="agency-pkg-wizard-overlay" role="presentation" onClick={closeWizard}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pkg-wiz-title"
            className={wizStep >= 3 ? "agency-pkg-wizard agency-pkg-wizard--wide" : "agency-pkg-wizard"}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="agency-pkg-wizard__header">
              <h2 id="pkg-wiz-title" className="agency-pkg-wizard__title">
                Build a Package
              </h2>
              <WizardStepper step={wizStep} />
            </header>

            <div className="agency-pkg-wizard__body">
              {wizStep === 1 && (
                <>
                  <p className="agency-pkg-wizard__lead">
                    Choose the kind of package you are building. Limits for each tier are configured in{" "}
                    <Link className="agency-hub__link" to="/admin">
                      Admin → Build-a-Package configuration
                    </Link>
                    .
                  </p>
                  <div className="agency-pkg-wizard__choice-grid">
                    {packageTypes.map((pt) => {
                      const active = selectedPackageType?.id === pt.id;
                      const tierCount = slotsForPackageType(slots, pt.id).length;
                      return (
                        <button
                          key={pt.id}
                          type="button"
                          className={
                            active
                              ? "agency-pkg-wizard__choice is-selected"
                              : "agency-pkg-wizard__choice"
                          }
                          onClick={() => {
                            setSelectedPackageType({ ...pt });
                            setSelectedSlot(null);
                            setTierPickIds([]);
                          }}
                        >
                          <span className="agency-pkg-wizard__choice-title">{pt.name}</span>
                          <span className="agency-pkg-wizard__choice-meta">
                            {tierCount} package tier{tierCount === 1 ? "" : "s"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {wizStep === 2 && selectedPackageType && (
                <>
                  <div className="agency-pkg-wizard__context">
                    <span className="agency-pkg-wizard__chip">{selectedPackageType.name}</span>
                  </div>
                  <p className="agency-pkg-wizard__lead">
                    Pick a tier level. Each option can enforce hour, price, and vault tier limits.
                  </p>
                  <div className="agency-pkg-wizard__tier-pick-block">
                  <div className="agency-pkg-wizard__choice-grid">
                    {slotsForSelectedType.map((s) => {
                      const active = selectedSlot?.id === s.id;
                      const tags = slotLimitTags(s);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          className={
                            active
                              ? "agency-pkg-wizard__choice is-selected"
                              : "agency-pkg-wizard__choice"
                          }
                          onClick={() => {
                            setSelectedSlot({ ...s });
                            setTierPickIds([]);
                          }}
                        >
                          <span className="agency-pkg-wizard__choice-title">
                            {displayTierLabel(selectedPackageType.name, s.label)}
                          </span>
                          <span className="agency-pkg-wizard__choice-tags">
                            {tags.map((tag) => (
                              <span key={tag} className="agency-pkg-wizard__choice-tag">
                                {tag}
                              </span>
                            ))}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <PackageTierDisclaimer
                    notes={selectedSlot ? slotTierNotes(selectedSlot) : null}
                  />
                  </div>
                </>
              )}

              {wizStep === 3 && selectedSlot && selectedPackageType && (
                <>
                  <div className="agency-pkg-wizard__context">
                    <span className="agency-pkg-wizard__chip">{selectedPackageType.name}</span>
                    <span className="agency-pkg-wizard__chip">
                      {displayTierLabel(selectedPackageType.name, selectedSlot.label)}
                    </span>
                  </div>
                  <div className="agency-pkg-wizard__solution-step-block">
                  <p className="agency-pkg-wizard__lead">
                    Select vault solution tiers for this package. Running totals use catalog hours and sell prices.
                  </p>

                  <PackageTierDisclaimer notes={slotTierNotes(selectedSlot)} />

                  <div className="agency-pkg-wizard__meters">
                    {slotEnforcesHourCeiling(selectedSlot) ? (
                      <WizardMeter
                        label="Hours"
                        value={usage.hours}
                        max={selectedSlot.hour_ceiling}
                        format={(n) => fmtHoursTotal(n) + "h"}
                        over={overHours}
                        note={
                          usage.missingHours
                            ? "Some selected tiers have no hour total in the vault."
                            : null
                        }
                      />
                    ) : null}
                    {slotEnforcesPriceCeiling(selectedSlot) ? (
                      <WizardMeter
                        label="Sell price"
                        value={usage.price}
                        max={Number(selectedSlot.price_ceiling) || 0}
                        format={fmtUsd}
                        over={overPrice}
                        note={
                          usage.missingPrice
                            ? "Some selected tiers have no sell price in the vault."
                            : null
                        }
                      />
                    ) : null}
                    {slotEnforcesTierCountLimit(selectedSlot) ? (
                      <WizardMeter
                        label="Tiers selected"
                        value={tierPickIds.length}
                        max={selectedSlot.solution_tier_limit}
                        format={(n) => String(Math.round(n))}
                        over={overTierCount}
                      />
                    ) : null}
                  </div>

                  {(overHours || overPrice || overTierCount) && (
                    <p className="agency-pkg-wizard__alert" role="alert">
                      You are over a configured limit. Remove tiers or go back and choose a different package tier.
                    </p>
                  )}
                  </div>

                  <label className="agency-pkg-wizard__field">
                    <span className="agency-pkg-wizard__field-label">Package name</span>
                    <input
                      className="agency-pkg-wizard__field-input"
                      value={pkgName}
                      onChange={(e) => setPkgName(e.target.value)}
                      placeholder="Display name for this package"
                      autoComplete="off"
                    />
                  </label>

                  <div className="agency-nav-sol-filter agency-pkg-wizard__filter">
                    <label className="agency-nav-sol-filter__label" htmlFor="wiz-tier-search">
                      Solution tiers
                    </label>
                    <div className="agency-nav-sol-filter__row">
                      <input
                        id="wiz-tier-search"
                        type="search"
                        className="agency-nav-sol-filter__input"
                        value={tierSearch}
                        onChange={(e) => setTierSearch(e.target.value)}
                        placeholder="Filter by solution or tier name…"
                        autoComplete="off"
                      />
                      {tierSearch ? (
                        <button
                          type="button"
                          className="agency-nav-sol-filter__clear"
                          onClick={() => setTierSearch("")}
                        >
                          Clear
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="agency-pkg-wizard__table-wrap">
                    <div className="agency-pkg-wizard__table-scroll">
                      <table className="agency-pkg-wizard__table">
                        <thead>
                          <tr>
                            <th className="col-check" scope="col" />
                            <th scope="col">Solution</th>
                            <th scope="col">Tier</th>
                            <th className="col-hours" scope="col">
                              Hours
                            </th>
                            <th className="col-sell" scope="col">
                              Sell
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {tierRows.map((t) => {
                            const pr = pricingByTierId.get(t.solution_tier_id) ?? null;
                            const h = vaultTierHours(pr, tasks, t.solution_tier_id);
                            const usd = vaultSellPriceUsd(pr);
                            const sol = solutionById.get(t.solution_id);
                            const checked = tierPickIds.includes(t.solution_tier_id);
                            return (
                              <tr
                                key={t.solution_tier_id}
                                className={checked ? "is-selected" : undefined}
                              >
                                <td className="col-check">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) =>
                                      toggleTierPick(t.solution_tier_id, e.target.checked)
                                    }
                                    aria-label={`Include ${t.solution_tier_name}`}
                                  />
                                </td>
                                <td>{sol?.solution_name ?? t.solution_id}</td>
                                <td>{t.solution_tier_name}</td>
                                <td className="col-hours">
                                  {h != null
                                    ? h.toLocaleString(undefined, { maximumFractionDigits: 1 })
                                    : "—"}
                                </td>
                                <td className="col-sell">{usd != null ? fmtUsd(usd) : "—"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}

              {wizStep === 4 && selectedSlot && selectedPackageType && (
                <>
                  <div className="agency-pkg-wizard__context">
                    <span className="agency-pkg-wizard__chip">{selectedPackageType.name}</span>
                    <span className="agency-pkg-wizard__chip">
                      {displayTierLabel(selectedPackageType.name, selectedSlot.label)}
                    </span>
                    <span className="agency-pkg-wizard__chip">{tierPickIds.length} tiers</span>
                  </div>
                  <p className="agency-pkg-wizard__lead">
                    Optional package-level discounts. Leave at 0% if you do not need them — you can change these later in
                    Package Builder.
                  </p>

                  <div className="agency-pkg-wizard__discount-grid">
                    <div className="agency-pkg-wizard__discount-card">
                      <div className="agency-pkg-wizard__discount-card-head">
                        <h3 className="agency-pkg-wizard__discount-title">Hour Discount</h3>
                        <p className="agency-pkg-wizard__discount-hint">
                          Lowers catalog hours and scales each tier’s sell in proportion (same totals as step 3).
                        </p>
                      </div>
                      <label className="agency-pkg-wizard__discount-field">
                        <span className="agency-pkg-wizard__discount-field-label">Discount %</span>
                        <div className="agency-pkg-wizard__discount-input-wrap">
                          <input
                            className="agency-pkg-wizard__field-input agency-pkg-wizard__discount-input"
                            inputMode="decimal"
                            value={hourDiscountPctStr}
                            onChange={(e) => setHourDiscountPctStr(e.target.value)}
                            aria-label="Hour discount percent"
                          />
                          <span className="agency-pkg-wizard__discount-suffix" aria-hidden>
                            %
                          </span>
                        </div>
                      </label>
                      <p className="agency-pkg-wizard__discount-result">
                        Hours{" "}
                        {usage.missingHours ? (
                          <strong>—</strong>
                        ) : (
                          <>
                            <span className="agency-pkg-wizard__discount-was">{fmtHoursTotal(discountPreview.catalogHours)} h</span>
                            <span className="agency-pkg-wizard__discount-arrow" aria-hidden>
                              →
                            </span>
                            <strong>{fmtHoursTotal(discountPreview.hoursAfter ?? 0)} h</strong>
                          </>
                        )}
                      </p>
                      <p className="agency-pkg-wizard__discount-result">
                        Catalog sell{" "}
                        {discountPreview.modeledSellBeforeHourDiscount == null ? (
                          <strong>—</strong>
                        ) : (
                          <>
                            <span className="agency-pkg-wizard__discount-was">
                              {fmtUsd(discountPreview.modeledSellBeforeHourDiscount)}
                            </span>
                            <span className="agency-pkg-wizard__discount-arrow" aria-hidden>
                              →
                            </span>
                            <strong>{fmtUsd(discountPreview.modeledSellAfterHourDiscount ?? 0)}</strong>
                          </>
                        )}
                      </p>
                    </div>

                    <div className="agency-pkg-wizard__discount-card">
                      <div className="agency-pkg-wizard__discount-card-head">
                        <h3 className="agency-pkg-wizard__discount-title">Sell Price Discount</h3>
                        <p className="agency-pkg-wizard__discount-hint">
                          Taken off modeled sell after any hour discount. Does not change hour buckets.
                        </p>
                      </div>
                      <label className="agency-pkg-wizard__discount-field">
                        <span className="agency-pkg-wizard__discount-field-label">Discount %</span>
                        <div className="agency-pkg-wizard__discount-input-wrap">
                          <input
                            className="agency-pkg-wizard__field-input agency-pkg-wizard__discount-input"
                            inputMode="decimal"
                            value={sellDiscountPctStr}
                            onChange={(e) => setSellDiscountPctStr(e.target.value)}
                            aria-label="Sell price discount percent"
                          />
                          <span className="agency-pkg-wizard__discount-suffix" aria-hidden>
                            %
                          </span>
                        </div>
                      </label>
                      <p className="agency-pkg-wizard__discount-result">
                        Net sell{" "}
                        {discountPreview.modeledSellAfterHourDiscount == null ||
                        discountPreview.netSellAfterSellDiscount == null ? (
                          <strong>—</strong>
                        ) : (
                          <>
                            <span className="agency-pkg-wizard__discount-was">
                              {fmtUsd(discountPreview.modeledSellAfterHourDiscount)}
                            </span>
                            <span className="agency-pkg-wizard__discount-arrow" aria-hidden>
                              →
                            </span>
                            <strong>{fmtUsd(discountPreview.netSellAfterSellDiscount)}</strong>
                          </>
                        )}
                      </p>
                    </div>
                  </div>

                  <p className="agency-pkg-wizard__discount-footnote">
                    Estimates use vault tier totals from your selection. Package Builder refines totals from the full task
                    checklist.
                  </p>
                </>
              )}
            </div>

            <footer className="agency-pkg-wizard__footer">
              {wizStep === 1 && (
                <>
                  <button type="button" className="agency-pkg-wizard__btn agency-pkg-wizard__btn--secondary" onClick={closeWizard}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="agency-pkg-wizard__btn agency-pkg-wizard__btn--primary"
                    disabled={!selectedPackageType}
                    onClick={() => {
                      if (!selectedPackageType) return;
                      setWizStep(2);
                      setPkgName((n) => (n.trim() ? n : `${selectedPackageType.name} package`));
                    }}
                  >
                    Next: package tier
                  </button>
                </>
              )}
              {wizStep === 2 && selectedPackageType && (
                <>
                  <button type="button" className="agency-pkg-wizard__btn agency-pkg-wizard__btn--secondary" onClick={closeWizard}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="agency-pkg-wizard__btn agency-pkg-wizard__btn--secondary"
                    onClick={() => {
                      setWizardOpen(false);
                      setSelectedSlot(null);
                    }}
                  >
                    Change package type
                  </button>
                  <button
                    type="button"
                    className="agency-pkg-wizard__btn agency-pkg-wizard__btn--primary"
                    disabled={!selectedSlot}
                    onClick={() => {
                      if (!selectedSlot) return;
                      setWizStep(3);
                      setPkgName((n) =>
                        n.trim()
                          ? n
                          : `${selectedPackageType.name} — ${displayTierLabel(selectedPackageType.name, selectedSlot.label)}`
                      );
                    }}
                  >
                    Next: solution tiers
                  </button>
                </>
              )}
              {wizStep === 3 && selectedSlot && selectedPackageType && (
                <>
                  <button
                    type="button"
                    className="agency-pkg-wizard__btn agency-pkg-wizard__btn--secondary"
                    disabled={createBusy}
                    onClick={closeWizard}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="agency-pkg-wizard__btn agency-pkg-wizard__btn--secondary"
                    disabled={createBusy}
                    onClick={() => setWizStep(2)}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    className="agency-pkg-wizard__btn agency-pkg-wizard__btn--primary"
                    disabled={!tierStepValid || createBusy}
                    onClick={() => setWizStep(4)}
                  >
                    Next: package discounts
                  </button>
                </>
              )}
              {wizStep === 4 && selectedSlot && selectedPackageType && (
                <>
                  <button
                    type="button"
                    className="agency-pkg-wizard__btn agency-pkg-wizard__btn--secondary"
                    disabled={createBusy}
                    onClick={closeWizard}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="agency-pkg-wizard__btn agency-pkg-wizard__btn--secondary"
                    disabled={createBusy}
                    onClick={() => setWizStep(3)}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    className="agency-pkg-wizard__btn agency-pkg-wizard__btn--primary"
                    disabled={!canCreate}
                    onClick={() => void createPackage()}
                  >
                    {createBusy ? "Creating…" : "Create package"}
                  </button>
                </>
              )}
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
