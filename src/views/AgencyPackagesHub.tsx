import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AGENCY_HERO_TITLE,
  AGENCY_VIEW_DESCRIPTION,
} from "../branding";
import { todayISODate } from "../lib/dates";
import { insertAuditLog } from "../lib/audit";
import { notifyPackagingDataChanged } from "../lib/packagingEvents";
import { fetchPackageBuilderSlots, defaultPackageBuilderSlots } from "../lib/packageBuilderSlots";
import {
  applyPackageTierMembership,
  emptyPackageLinkPayload,
} from "../lib/packageTierLinkPersistence";
import { compareTasksByOrder } from "../lib/taskOrder";
import { vaultSellPriceUsd, vaultTierHours } from "../lib/vaultTierMetrics";
import {
  browserKeyConfigurationError,
  envConfigured,
  getSupabase,
} from "../lib/supabase";
import { friendlyMutationMessage } from "../lib/supabaseErrors";
import { useToast } from "../context/ToastContext";
import type {
  Package,
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

type PackageCardRollup = {
  tierCount: number;
  hoursSum: number;
  priceSum: number;
  hoursPartial: boolean;
  pricePartial: boolean;
};

const shell: CSSProperties = {
  maxWidth: "var(--agency-page-max, 100rem)",
  margin: "0 auto",
  padding: "1.25rem var(--agency-page-pad-x, 1rem) 2.5rem",
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

const cardGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
  gap: "0.75rem",
  marginTop: "0.75rem",
};

const slotCard: CSSProperties = {
  textAlign: "left",
  padding: "1rem",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "rgba(255, 252, 247, 0.96)",
  cursor: "pointer",
  font: "inherit",
};

const slotCardActive: CSSProperties = {
  ...slotCard,
  borderColor: "var(--accent)",
  boxShadow: "0 0 0 2px rgba(13, 92, 77, 0.18)",
};

const meterWrap: CSSProperties = {
  marginTop: "1rem",
  padding: "0.85rem 1rem",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "rgba(255, 252, 247, 0.96)",
};

const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
  padding: "1rem",
};

const dialog: CSSProperties = {
  maxWidth: 720,
  width: "100%",
  maxHeight: "min(90vh, 900px)",
  overflow: "auto",
  background: "var(--panel, #fffdf9)",
  borderRadius: 14,
  padding: "1.25rem 1.35rem",
  boxShadow: "0 12px 48px rgba(0,0,0,0.18)",
  border: "1px solid var(--border)",
};

const inputBase: CSSProperties = {
  width: "100%",
  padding: "0.45rem 0.55rem",
  borderRadius: 8,
  border: "1px solid var(--border)",
  font: "inherit",
};

const btnRow: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "0.5rem",
  marginTop: "1rem",
};

const primaryBtn: CSSProperties = {
  padding: "0.55rem 1rem",
  borderRadius: 10,
  border: "none",
  background: "var(--accent, #c45c26)",
  color: "#fff",
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryBtn: CSSProperties = {
  padding: "0.55rem 1rem",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "transparent",
  fontWeight: 600,
  cursor: "pointer",
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
  const [slots, setSlots] = useState<PackageBuilderSlotTemplate[]>(() =>
    defaultPackageBuilderSlots().map((r) => ({ ...r }))
  );
  const [pkgFilter, setPkgFilter] = useState("");

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizStep, setWizStep] = useState<1 | 2>(1);
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

    const [pRes, sRes, tRes, kRes, prRes, ptRes, slotPack] = await Promise.all([
      client.from("packages").select("*").order("package_id"),
      client.from("solutions").select("*").order("solution_id"),
      client.from("solution_tiers").select("*").order("solution_tier_id"),
      client.from("tasks").select("*").order("task_id"),
      client.from("solution_tier_pricing").select("*").order("solution_tier_id"),
      client.from("package_solution_tiers").select("package_id, solution_tier_id").order("package_id"),
      fetchPackageBuilderSlots(client),
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
    setSlots(slotPack.rows.map((r) => ({ ...r })));
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

  const filteredPackages = useMemo(() => {
    const q = pkgFilter.trim().toLowerCase();
    if (!q) return packages;
    return packages.filter(
      (p) =>
        p.package_id.toLowerCase().includes(q) || (p.package_name ?? "").toLowerCase().includes(q)
    );
  }, [packages, pkgFilter]);

  const tierRows = useMemo(() => {
    const q = tierSearch.trim().toLowerCase();
    const rows = [...tiers].sort((a, b) => sortId(a.solution_tier_id, b.solution_tier_id));
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
  }, [tiers, tierSearch, solutionById]);

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
  const overHours = ceiling != null && usage.hours > ceiling.hour_ceiling;
  const overPrice = ceiling != null && usage.price > ceiling.price_ceiling;
  const canCreate =
    ceiling != null &&
    pkgName.trim().length > 0 &&
    tierPickIds.length > 0 &&
    !overHours &&
    !overPrice &&
    !createBusy;

  const openWizard = () => {
    setWizardOpen(true);
    setWizStep(1);
    setSelectedSlot(null);
    setTierPickIds([]);
    setTierSearch("");
    setPkgName("");
  };

  const closeWizard = () => {
    if (createBusy) return;
    setWizardOpen(false);
  };

  const toggleTierPick = (tierId: string, on: boolean) => {
    setTierPickIds((prev) => {
      if (on) return prev.includes(tierId) ? prev : [...prev, tierId];
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
      const row: Package = {
        package_id: newId,
        package_name: name,
        package_create_date: today,
        package_modified_date: today,
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
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem", marginTop: "0.5rem" }}>
            <button type="button" style={primaryBtn} onClick={openWizard}>
              Build a Package
            </button>
            <span style={{ color: "var(--muted)", fontSize: "0.92rem" }}>
              Pick a tier slot (hour and price ceilings), then add vault solution tiers.
            </span>
          </div>

          <section style={{ marginTop: "1.75rem" }}>
            <h2 style={{ ...title, fontSize: "1.15rem", marginBottom: "0.5rem" }}>Open a package</h2>
            <div className="agency-nav-sol-filter" style={{ maxWidth: 420 }}>
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
            {filteredPackages.length === 0 ? (
              <p style={{ color: "var(--muted)", marginTop: "0.75rem" }}>
                {packages.length === 0 ? "No packages in the vault yet." : "No packages match this search."}
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
                  const tierLabel =
                    rollup.tierCount === 0
                      ? "No tiers"
                      : rollup.tierCount === 1
                        ? "1 tier"
                        : `${rollup.tierCount} tiers`;
                  const hoursDisplay =
                    rollup.tierCount === 0
                      ? "—"
                      : `${fmtHoursTotal(rollup.hoursSum)} h${rollup.hoursPartial ? " *" : ""}`;
                  const priceDisplay =
                    rollup.tierCount === 0 ? "—" : fmtUsd(rollup.priceSum) + (rollup.pricePartial ? " *" : "");
                  const partialNote =
                    rollup.tierCount > 0 && (rollup.hoursPartial || rollup.pricePartial)
                      ? "* Some linked tiers have no hours or sell price in the vault."
                      : null;
                  const a11yLabel = [
                    p.package_name,
                    tierLabel,
                    rollup.tierCount === 0
                      ? "No linked tiers"
                      : [
                          `${fmtHoursTotal(rollup.hoursSum)} hours from vault`,
                          rollup.hoursPartial ? "hours incomplete" : null,
                          `${fmtUsd(rollup.priceSum)} sell total from vault`,
                          rollup.pricePartial ? "pricing incomplete" : null,
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
                            <span
                              className={
                                rollup.tierCount === 0
                                  ? "agency-pkg-hub__tier-pill agency-pkg-hub__tier-pill--empty"
                                  : "agency-pkg-hub__tier-pill"
                              }
                            >
                              {tierLabel}
                            </span>
                          </div>
                          <div className="agency-pkg-hub__card-stats" aria-label="Vault totals for linked tiers">
                            <div className="agency-pkg-hub__stat agency-pkg-hub__stat--hours">
                              <div className="agency-pkg-hub__stat-inner">
                                <span className="agency-pkg-hub__stat-label">Hours</span>
                                <span className="agency-pkg-hub__stat-hint">Vault · linked tiers</span>
                                <span className="agency-pkg-hub__stat-value">{hoursDisplay}</span>
                              </div>
                            </div>
                            <div className="agency-pkg-hub__stat agency-pkg-hub__stat--sell">
                              <div className="agency-pkg-hub__stat-inner">
                                <span className="agency-pkg-hub__stat-label">Sell total</span>
                                <span className="agency-pkg-hub__stat-hint">Vault · USD</span>
                                <span className="agency-pkg-hub__stat-value">{priceDisplay}</span>
                              </div>
                            </div>
                          </div>
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
        <div style={overlay} role="presentation" onClick={closeWizard}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pkg-wiz-title"
            style={dialog}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="pkg-wiz-title" style={{ ...title, fontSize: "1.2rem", marginTop: 0 }}>
              Build a Package
            </h2>

            {wizStep === 1 && (
              <>
                <p style={{ color: "var(--muted)", marginTop: "0.35rem" }}>
                  Choose a package tier slot. Ceilings are set in{" "}
                  <Link className="agency-hub__link" to="/admin">
                    Admin → Package Builder → Edit Tier Slot Ceilings
                  </Link>
                  .
                </p>
                <div style={cardGrid}>
                  {slots.map((s) => {
                    const active = selectedSlot?.id === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        style={active ? slotCardActive : slotCard}
                        onClick={() => setSelectedSlot({ ...s })}
                      >
                        <div style={{ fontWeight: 700, marginBottom: "0.35rem" }}>{s.label}</div>
                        <div style={{ fontSize: "0.9rem", color: "var(--muted)" }}>
                          ≤ {s.hour_ceiling} hours
                        </div>
                        <div style={{ fontSize: "0.9rem", color: "var(--muted)" }}>
                          ≤ {fmtUsd(Number(s.price_ceiling) || 0)} sell (vault sum)
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div style={btnRow}>
                  <button
                    type="button"
                    style={primaryBtn}
                    disabled={!selectedSlot}
                    onClick={() => {
                      if (!selectedSlot) return;
                      setWizStep(2);
                      setPkgName((n) => (n.trim() ? n : `${selectedSlot.label} package`));
                    }}
                  >
                    Next: add solution tiers
                  </button>
                  <button type="button" style={secondaryBtn} onClick={closeWizard}>
                    Cancel
                  </button>
                </div>
              </>
            )}

            {wizStep === 2 && selectedSlot && (
              <>
                <p style={{ color: "var(--muted)", marginTop: "0.35rem" }}>
                  Slot: <strong>{selectedSlot.label}</strong> — add vault tiers. Totals use the same hours and sell
                  price rules as the catalog.
                </p>

                <div style={meterWrap}>
                  <div
                    style={{
                      fontWeight: 650,
                      color: overHours ? "var(--danger, #b00020)" : "inherit",
                    }}
                  >
                    Hours (vault): {usage.hours.toLocaleString(undefined, { maximumFractionDigits: 1 })} /{" "}
                    {selectedSlot.hour_ceiling}
                    {usage.missingHours ? (
                      <span style={{ fontWeight: 400, color: "var(--muted)", marginLeft: "0.35rem" }}>
                        (some selected tiers have no hour total)
                      </span>
                    ) : null}
                  </div>
                  <div
                    style={{
                      fontWeight: 650,
                      marginTop: "0.35rem",
                      color: overPrice ? "var(--danger, #b00020)" : "inherit",
                    }}
                  >
                    Sell price (vault sum): {fmtUsd(usage.price)} / {fmtUsd(Number(selectedSlot.price_ceiling) || 0)}
                    {usage.missingPrice ? (
                      <span style={{ fontWeight: 400, color: "var(--muted)", marginLeft: "0.35rem" }}>
                        (some selected tiers have no sell price)
                      </span>
                    ) : null}
                  </div>
                  {(overHours || overPrice) && (
                    <p style={{ margin: "0.55rem 0 0", fontSize: "0.9rem", color: "var(--danger, #b00020)" }}>
                      Over the slot ceiling — remove tiers or pick another slot before creating the package.
                    </p>
                  )}
                </div>

                <label style={{ display: "block", marginTop: "1rem" }}>
                  <span style={{ display: "block", fontWeight: 600, marginBottom: "0.25rem" }}>Package name</span>
                  <input
                    style={inputBase}
                    value={pkgName}
                    onChange={(e) => setPkgName(e.target.value)}
                    placeholder="Display name"
                    autoComplete="off"
                  />
                </label>

                <div className="agency-nav-sol-filter" style={{ marginTop: "1rem", maxWidth: "100%" }}>
                  <label className="agency-nav-sol-filter__label" htmlFor="wiz-tier-search">
                    Add solution tiers
                  </label>
                  <div className="agency-nav-sol-filter__row">
                    <input
                      id="wiz-tier-search"
                      type="search"
                      className="agency-nav-sol-filter__input"
                      value={tierSearch}
                      onChange={(e) => setTierSearch(e.target.value)}
                      placeholder="Filter tiers…"
                      autoComplete="off"
                    />
                    {tierSearch ? (
                      <button type="button" className="agency-nav-sol-filter__clear" onClick={() => setTierSearch("")}>
                        Clear
                      </button>
                    ) : null}
                  </div>
                </div>

                <div style={{ overflowX: "auto", marginTop: "0.65rem" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.92rem" }}>
                    <thead>
                      <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                        <th style={{ padding: "0.35rem 0.5rem" }} />
                        <th style={{ padding: "0.35rem 0.5rem" }}>Solution</th>
                        <th style={{ padding: "0.35rem 0.5rem" }}>Tier</th>
                        <th style={{ padding: "0.35rem 0.5rem" }}>Hours</th>
                        <th style={{ padding: "0.35rem 0.5rem" }}>Sell</th>
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
                          <tr key={t.solution_tier_id} style={{ borderBottom: "1px solid var(--border)" }}>
                            <td style={{ padding: "0.35rem 0.5rem" }}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => toggleTierPick(t.solution_tier_id, e.target.checked)}
                                aria-label={`Include ${t.solution_tier_name}`}
                              />
                            </td>
                            <td style={{ padding: "0.35rem 0.5rem" }}>{sol?.solution_name ?? t.solution_id}</td>
                            <td style={{ padding: "0.35rem 0.5rem" }}>{t.solution_tier_name}</td>
                            <td style={{ padding: "0.35rem 0.5rem" }}>
                              {h != null ? h.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "—"}
                            </td>
                            <td style={{ padding: "0.35rem 0.5rem" }}>{usd != null ? fmtUsd(usd) : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div style={btnRow}>
                  <button type="button" style={primaryBtn} disabled={!canCreate} onClick={() => void createPackage()}>
                    {createBusy ? "Creating…" : "Create package"}
                  </button>
                  <button
                    type="button"
                    style={secondaryBtn}
                    disabled={createBusy}
                    onClick={() => {
                      setWizStep(1);
                    }}
                  >
                    Back
                  </button>
                  <button type="button" style={secondaryBtn} disabled={createBusy} onClick={closeWizard}>
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
