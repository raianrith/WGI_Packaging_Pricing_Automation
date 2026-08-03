import { PackageBuilderFamilyDetail } from "./PackageBuilderFamilyDetail";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { todayISODate } from "../lib/dates";
import { packageNarrativeFromSlot } from "../lib/packageSlotNarrative";
import { insertAuditLog } from "../lib/audit";
import { notifyPackagingDataChanged } from "../lib/packagingEvents";
import {
  isVaultTierAllowedForSlot,
  packagePricingOverridesFromSlot,
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
import { sanitizePricingOverridesForDb } from "../lib/packagePricingTaskOverrides";
import {
  ACCOUNT_MGMT_HOURS_ADDON_RATE,
  CONTINUOUS_IMPROVEMENT_HOURS_ADDON_RATE,
  loadTierPricingMathConfigFromStorage,
  normalizeTierPricingMathConfig,
} from "../lib/tierPricingMath";
import {
  adjustTierQuantity,
  catalogUsageFromQuantities,
  emptyTierQuantities,
  tierIdsFromQuantities,
  totalTierLineCount,
  type PackageTierQuantities,
} from "../lib/packageTierQuantities";
import {
  bucketSelectedCount,
  isBucketComplete,
  lockedMinQtyForTier,
  reservedSolutionTierIds,
  seedQtyFromPreselected,
  selectionRulesSummary,
  selectionRulesValid,
} from "../lib/packageSlotSelectionRules";
import { vaultSellPriceUsd, vaultTierHours } from "../lib/vaultTierMetrics";
import { computePackageWizardDiscountPreview } from "../lib/packageWorkspaceMetrics";
import {
  formatPackageTierDiscountRule,
  packageTierDiscountSummary,
  slotTierShortLabel,
} from "../lib/packageTierDiscounts";
import { getSupabase } from "../lib/supabase";
import { friendlyMutationMessage } from "../lib/supabaseErrors";
import { useToast } from "../context/ToastContext";
import type {
  Package,
  PackageBuilderPackageType,
  PackageBuilderSlotBucket,
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
  return slotTierShortLabel(slotLabel, typeName);
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
    tags.push(`${slot.allowed_solution_tier_ids.length} allowed solution components`);
  }
  const selection = selectionRulesSummary(slot);
  if (selection) tags.push(selection);
  if (tags.length === 0) tags.push("No limits");
  return tags;
}

type WizardStep = 1 | 2 | 3 | 4;

function WizardStepper({ step }: { step: WizardStep }) {
  const steps = [
    { n: 1 as const, label: "Template" },
    { n: 2 as const, label: "Tier" },
    { n: 3 as const, label: "Solution components" },
    { n: 4 as const, label: "Pricing" },
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

export type PackageBuildWizardProps = {
  variant?: "page" | "embedded" | "proposal";
  packageTypes: PackageBuilderPackageType[];
  slots: PackageBuilderSlotTemplate[];
  packages: Package[];
  solutions: Solution[];
  tiers: SolutionTier[];
  tasks: TaskRow[];
  pricing: SolutionTierPricing[];
  onCreated: (packageId: string, createdPackage?: Package) => void;
  onReload?: () => Promise<void>;
  /** When set (e.g. from Solutions directory), open the wizard for this package family. */
  initialPackageTypeId?: string | null;
  /** When set (e.g. from Proposal Builder), open the wizard for this package family. */
  launchPackageTypeId?: string | null;
  onLaunchPackageTypeConsumed?: () => void;
  wizardTitle?: string;
};

function WizardSolutionTierTable({
  rows,
  tierPickQty,
  pricingByTierId,
  tasks,
  solutionById,
  clientFacingLabels,
  minQtyForTier,
  onDecrease,
  onIncrease,
  onEditLabel,
  emptyMessage,
}: {
  rows: SolutionTier[];
  tierPickQty: PackageTierQuantities;
  pricingByTierId: Map<string, SolutionTierPricing>;
  tasks: TaskRow[];
  solutionById: Map<string, Solution>;
  clientFacingLabels: Record<string, string>;
  minQtyForTier: (tierId: string) => number;
  onDecrease: (tierId: string) => void;
  onIncrease: (tier: SolutionTier, solutionName: string) => void;
  onEditLabel: (tier: SolutionTier, solutionName: string) => void;
  emptyMessage?: string;
}) {
  if (rows.length === 0) {
    return emptyMessage ? (
      <p className="agency-pkg-wizard__section-empty">{emptyMessage}</p>
    ) : null;
  }
  return (
    <div className="agency-pkg-wizard__table-wrap">
      <div className="agency-pkg-wizard__table-scroll">
        <table className="agency-pkg-wizard__table">
          <thead>
            <tr>
              <th className="col-qty" scope="col">
                Qty
              </th>
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
            {rows.map((t) => {
              const pr = pricingByTierId.get(t.solution_tier_id) ?? null;
              const h = vaultTierHours(pr, tasks, t.solution_tier_id);
              const usd = vaultSellPriceUsd(pr);
              const sol = solutionById.get(t.solution_id);
              const qty = tierPickQty[t.solution_tier_id] ?? 0;
              const minQty = minQtyForTier(t.solution_tier_id);
              const lineHours = h != null ? h * Math.max(qty, 1) : null;
              const lineSell = usd != null && qty > 0 ? usd * qty : null;
              const locked = minQty > 0;
              return (
                <tr
                  key={t.solution_tier_id}
                  className={[qty > 0 ? "is-selected" : "", locked ? "is-locked" : ""]
                    .filter(Boolean)
                    .join(" ") || undefined}
                >
                  <td className="col-qty">
                    <div className="agency-pkg-wizard__qty">
                      <button
                        type="button"
                        className="agency-pkg-wizard__qty-btn"
                        aria-label={`Decrease quantity for ${t.solution_tier_name}`}
                        disabled={qty <= minQty}
                        onClick={() => onDecrease(t.solution_tier_id)}
                      >
                        −
                      </button>
                      <span className="agency-pkg-wizard__qty-value" aria-live="polite">
                        {qty}
                      </span>
                      <button
                        type="button"
                        className="agency-pkg-wizard__qty-btn"
                        aria-label={`Increase quantity for ${t.solution_tier_name}`}
                        onClick={() =>
                          onIncrease(t, sol?.solution_name ?? t.solution_tier_name)
                        }
                      >
                        +
                      </button>
                    </div>
                    {locked ? (
                      <span className="agency-pkg-wizard__locked-hint">Min {minQty}</span>
                    ) : null}
                  </td>
                  <td>
                    <div className="agency-pkg-wizard__sol-cell">
                      <span>{sol?.solution_name ?? t.solution_id}</span>
                      {qty > 0 ? (
                        <button
                          type="button"
                          className="agency-pkg-wizard__label-chip"
                          onClick={() =>
                            onEditLabel(t, sol?.solution_name ?? t.solution_tier_name)
                          }
                          title="Edit client facing label"
                        >
                          <span className="agency-pkg-wizard__label-chip-kicker">
                            Client label
                          </span>
                          <span className="agency-pkg-wizard__label-chip-value">
                            {clientFacingLabels[t.solution_tier_id]?.trim() ||
                              sol?.solution_name ||
                              t.solution_tier_name}
                          </span>
                        </button>
                      ) : null}
                    </div>
                  </td>
                  <td>{t.solution_tier_name}</td>
                  <td className="col-hours">
                    {qty > 0 && h != null
                      ? lineHours!.toLocaleString(undefined, { maximumFractionDigits: 1 })
                      : h != null
                        ? h.toLocaleString(undefined, { maximumFractionDigits: 1 })
                        : "—"}
                  </td>
                  <td className="col-sell">
                    {qty > 0 && usd != null ? fmtUsd(lineSell!) : usd != null ? fmtUsd(usd) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function PackageBuildWizard({
  variant = "embedded",
  packageTypes,
  slots,
  packages,
  solutions,
  tiers,
  tasks,
  pricing,
  onCreated,
  onReload,
  initialPackageTypeId = null,
  launchPackageTypeId = null,
  onLaunchPackageTypeConsumed,
  wizardTitle = "Build a Package",
}: PackageBuildWizardProps) {
  const { toastError, toastNote } = useToast();
  const startedFromDirectoryRef = useRef(false);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizStep, setWizStep] = useState<WizardStep>(1);
  const [selectedPackageType, setSelectedPackageType] = useState<PackageBuilderPackageType | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<PackageBuilderSlotTemplate | null>(null);
  const [tierPickQty, setTierPickQty] = useState<PackageTierQuantities>(() => emptyTierQuantities());
  const [clientFacingLabels, setClientFacingLabels] = useState<Record<string, string>>({});
  const [labelPrompt, setLabelPrompt] = useState<{
    tierId: string;
    solutionName: string;
    tierName: string;
    draft: string;
    mode: "add" | "edit";
  } | null>(null);
  const [tierSearch, setTierSearch] = useState("");
  const [pkgName, setPkgName] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [expandedFamilyTypeId, setExpandedFamilyTypeId] = useState<string | null>(null);

  const familyDetailType = useMemo(
    () => (expandedFamilyTypeId ? packageTypes.find((t) => t.id === expandedFamilyTypeId) ?? null : null),
    [expandedFamilyTypeId, packageTypes]
  );

  const familyDetailSlots = useMemo(
    () => (familyDetailType ? slotsForPackageType(slots, familyDetailType.id) : []),
    [familyDetailType, slots]
  );

  const closeFamilyDetail = useCallback(() => {
    setExpandedFamilyTypeId(null);
  }, []);

  useEffect(() => {
    if (!expandedFamilyTypeId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeFamilyDetail();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandedFamilyTypeId, closeFamilyDetail]);

  useEffect(() => {
    if (!labelPrompt) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLabelPrompt(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [labelPrompt]);

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

  const slotsForSelectedType = useMemo(() => {
    if (!selectedPackageType) return [];
    return slotsForPackageType(slots, selectedPackageType.id);
  }, [slots, selectedPackageType]);

  const tierById = useMemo(() => {
    const m = new Map<string, SolutionTier>();
    for (const t of tiers) m.set(t.solution_tier_id, t);
    return m;
  }, [tiers]);

  const matchesTierSearch = useCallback(
    (t: SolutionTier) => {
      const q = tierSearch.trim().toLowerCase();
      if (!q) return true;
      const sol = solutionById.get(t.solution_id);
      const solName = sol?.solution_name?.toLowerCase() ?? "";
      return (
        t.solution_tier_name.toLowerCase().includes(q) ||
        t.solution_tier_id.toLowerCase().includes(q) ||
        t.solution_id.toLowerCase().includes(q) ||
        solName.includes(q)
      );
    },
    [tierSearch, solutionById]
  );

  const alwaysIncludedRows = useMemo(() => {
    if (!selectedSlot) return [] as SolutionTier[];
    const rows: SolutionTier[] = [];
    for (const p of selectedSlot.preselected_tiers) {
      const t = tierById.get(p.solution_tier_id);
      if (t && matchesTierSearch(t)) rows.push(t);
    }
    return rows;
  }, [selectedSlot, tierById, matchesTierSearch]);

  const bucketSections = useMemo(() => {
    if (!selectedSlot) return [] as { bucket: PackageBuilderSlotBucket; rows: SolutionTier[] }[];
    return selectedSlot.buckets.map((bucket) => {
      const rows: SolutionTier[] = [];
      for (const tid of bucket.member_tier_ids) {
        const t = tierById.get(tid);
        if (t && matchesTierSearch(t)) rows.push(t);
      }
      return { bucket, rows };
    });
  }, [selectedSlot, tierById, matchesTierSearch]);

  /** Free picks: allow-list filtered, excluding locked + bucket members. */
  const additionalTierRows = useMemo(() => {
    if (!selectedSlot) return [] as SolutionTier[];
    const reserved = reservedSolutionTierIds(selectedSlot);
    return [...tiers]
      .filter((t) => !reserved.has(t.solution_tier_id))
      .filter((t) => isVaultTierAllowedForSlot(selectedSlot, t.solution_tier_id))
      .filter(matchesTierSearch)
      .sort((a, b) => sortId(a.solution_tier_id, b.solution_tier_id));
  }, [tiers, selectedSlot, matchesTierSearch]);

  const hasSelectionSections =
    (selectedSlot?.preselected_tiers.length ?? 0) > 0 || (selectedSlot?.buckets.length ?? 0) > 0;

  const usage = useMemo(
    () => catalogUsageFromQuantities(tierPickQty, pricingByTierId, tasks),
    [tierPickQty, pricingByTierId, tasks]
  );

  const labelForVaultTier = useCallback(
    (tierId: string) => {
      const t = tierById.get(tierId);
      if (!t) return tierId;
      const sol = solutionById.get(t.solution_id);
      const solName = sol?.solution_name?.trim();
      const tierName = t.solution_tier_name.trim();
      if (solName && tierName) return `${solName} · ${tierName}`;
      return tierName || solName || tierId;
    },
    [tierById, solutionById]
  );

  const tierLineCount = totalTierLineCount(tierPickQty);

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
    tierLineCount > (ceiling.solution_tier_limit ?? 0);
  const tierStepValid =
    ceiling != null &&
    selectedPackageType != null &&
    pkgName.trim().length > 0 &&
    tierLineCount > 0 &&
    !overHours &&
    !overPrice &&
    !overTierCount &&
    selectionRulesValid(ceiling, tierPickQty);

  const canCreate = tierStepValid && !createBusy;

  const wizardTierDiscount = useMemo(() => {
    if (!selectedSlot) return { level: null, hourPct: 0, tierLabel: "Tier", source: "none" as const };
    return packageTierDiscountSummary(
      selectedSlot.label,
      selectedPackageType?.name,
      selectedSlot.hour_discount_pct
    );
  }, [selectedSlot, selectedPackageType?.name]);

  const tierPricingMathConfig = useMemo(
    () => normalizeTierPricingMathConfig(loadTierPricingMathConfigFromStorage()),
    []
  );

  const discountPreview = useMemo(() => {
    const presets = selectedSlot ? packagePricingOverridesFromSlot(selectedSlot) : null;
    return computePackageWizardDiscountPreview({
      tierQuantities: tierPickQty,
      pricingRows: pricing,
      vaultTasks: tasks,
      catalogHours: usage.hours,
      catalogSell: usage.price,
      missingHours: usage.missingHours,
      missingPrice: usage.missingPrice,
      hourPct: wizardTierDiscount.hourPct,
      sellPct: 0,
      scopeRisk: presets?.scope_risk,
      internalCoordination: presets?.internal_coordination,
      clientRevisionRisk: presets?.client_revision_risk,
      strategicValueScore: presets?.strategic_value_score,
      mathConfig: tierPricingMathConfig,
    });
  }, [
    usage,
    tierPickQty,
    pricing,
    tasks,
    wizardTierDiscount.hourPct,
    selectedSlot,
    tierPricingMathConfig,
  ]);

  const beginPackageBuild = useCallback((packageType: PackageBuilderPackageType) => {
    setWizardOpen(true);
    setWizStep(2);
    setSelectedPackageType({ ...packageType });
    setSelectedSlot(null);
    setTierPickQty(emptyTierQuantities());
    setClientFacingLabels({});
    setLabelPrompt(null);
    setTierSearch("");
    setPkgName(`${packageType.name} package`);
  }, []);

  useEffect(() => {
    if (!initialPackageTypeId || startedFromDirectoryRef.current) return;
    const pt = packageTypes.find((t) => t.id === initialPackageTypeId);
    if (!pt) return;
    startedFromDirectoryRef.current = true;
    beginPackageBuild(pt);
  }, [initialPackageTypeId, packageTypes, beginPackageBuild]);

  useEffect(() => {
    if (!launchPackageTypeId) return;
    const pt = packageTypes.find((t) => t.id === launchPackageTypeId);
    if (!pt) {
      onLaunchPackageTypeConsumed?.();
      return;
    }
    beginPackageBuild(pt);
    onLaunchPackageTypeConsumed?.();
  }, [launchPackageTypeId, packageTypes, beginPackageBuild, onLaunchPackageTypeConsumed]);

  const closeWizard = () => {
    if (createBusy) return;
    setWizardOpen(false);
  };

  const applySlotSelection = useCallback(
    (slot: PackageBuilderSlotTemplate) => {
      setSelectedSlot({ ...slot });
      setTierPickQty(seedQtyFromPreselected(slot));
      const labels: Record<string, string> = {};
      for (const p of slot.preselected_tiers) {
        const t = tiers.find((x) => x.solution_tier_id === p.solution_tier_id);
        const sol = t ? solutions.find((s) => s.solution_id === t.solution_id) : null;
        labels[p.solution_tier_id] =
          sol?.solution_name?.trim() ||
          t?.solution_tier_name?.trim() ||
          p.solution_tier_id;
      }
      setClientFacingLabels(labels);
      setLabelPrompt(null);
    },
    [tiers, solutions]
  );

  const changeTierQty = (tierId: string, delta: number) => {
    if (!selectedSlot) return;
    const reserved = reservedSolutionTierIds(selectedSlot);
    const isReserved = reserved.has(tierId);
    if (delta > 0 && !isVaultTierAllowedForSlot(selectedSlot, tierId) && !isReserved) return;

    const minQty = lockedMinQtyForTier(selectedSlot, tierId);
    const maxTiers = slotEnforcesTierCountLimit(selectedSlot)
      ? selectedSlot.solution_tier_limit
      : null;

    setTierPickQty((prev) => {
      const cur = prev[tierId] ?? 0;
      if (delta < 0 && cur + delta < minQty) {
        return prev;
      }

      // New distinct pick inside a bucket: enforce pick_count.
      if (delta > 0 && cur < 1) {
        for (const b of selectedSlot.buckets) {
          if (!b.member_tier_ids.includes(tierId)) continue;
          if (bucketSelectedCount(b, prev) >= b.pick_count) {
            queueMicrotask(() =>
              toastNote(
                `Pick exactly ${b.pick_count} from “${b.name}”. Deselect one before choosing another.`
              )
            );
            return prev;
          }
        }
      }

      const result = adjustTierQuantity(prev, tierId, delta, maxTiers);
      if (result.blockedByMaxTiers) {
        queueMicrotask(() =>
          toastNote(
            `This tier allows at most ${selectedSlot.solution_tier_limit} solution component line${
              selectedSlot.solution_tier_limit === 1 ? "" : "s"
            }. Remove one to add another.`
          )
        );
        return prev;
      }

      let quantities = result.quantities;
      if (minQty > 0 && (quantities[tierId] ?? 0) < minQty) {
        quantities = { ...quantities, [tierId]: minQty };
      }

      const nextQty = quantities[tierId] ?? 0;
      if (nextQty <= 0 && minQty <= 0) {
        queueMicrotask(() => {
          setClientFacingLabels((labels) => {
            if (!(tierId in labels)) return labels;
            const { [tierId]: _, ...rest } = labels;
            return rest;
          });
        });
      }
      return quantities;
    });
  };

  const requestAddTier = (tier: SolutionTier, solutionName: string) => {
    if (!selectedSlot) return;
    const reserved = reservedSolutionTierIds(selectedSlot);
    const isReserved = reserved.has(tier.solution_tier_id);
    if (!isVaultTierAllowedForSlot(selectedSlot, tier.solution_tier_id) && !isReserved) return;

    const maxTiers = slotEnforcesTierCountLimit(selectedSlot)
      ? selectedSlot.solution_tier_limit
      : null;
    const currentQty = tierPickQty[tier.solution_tier_id] ?? 0;
    if (maxTiers != null && currentQty <= 0) {
      const probe = adjustTierQuantity(tierPickQty, tier.solution_tier_id, 1, maxTiers);
      if (probe.blockedByMaxTiers) {
        toastNote(
          `This tier allows at most ${selectedSlot.solution_tier_limit} solution component line${
            selectedSlot.solution_tier_limit === 1 ? "" : "s"
          }. Remove one to add another.`
        );
        return;
      }
    }
    if (currentQty > 0) {
      changeTierQty(tier.solution_tier_id, 1);
      return;
    }
    // Bucket gate before label prompt
    for (const b of selectedSlot.buckets) {
      if (!b.member_tier_ids.includes(tier.solution_tier_id)) continue;
      if (bucketSelectedCount(b, tierPickQty) >= b.pick_count) {
        toastNote(
          `Pick exactly ${b.pick_count} from “${b.name}”. Deselect one before choosing another.`
        );
        return;
      }
    }
    const defaultLabel = solutionName.trim() || tier.solution_tier_name.trim() || tier.solution_tier_id;
    setLabelPrompt({
      tierId: tier.solution_tier_id,
      solutionName: solutionName.trim() || tier.solution_tier_name,
      tierName: tier.solution_tier_name,
      draft: defaultLabel,
      mode: "add",
    });
  };

  const openEditLabel = (tier: SolutionTier, solutionName: string) => {
    const existing = clientFacingLabels[tier.solution_tier_id]?.trim();
    const defaultLabel = existing || solutionName.trim() || tier.solution_tier_name.trim() || tier.solution_tier_id;
    setLabelPrompt({
      tierId: tier.solution_tier_id,
      solutionName: solutionName.trim() || tier.solution_tier_name,
      tierName: tier.solution_tier_name,
      draft: defaultLabel,
      mode: "edit",
    });
  };

  const confirmLabelPrompt = () => {
    if (!labelPrompt) return;
    const label =
      labelPrompt.draft.trim() ||
      labelPrompt.solutionName.trim() ||
      labelPrompt.tierName.trim() ||
      labelPrompt.tierId;
    setClientFacingLabels((prev) => ({ ...prev, [labelPrompt.tierId]: label }));
    if (labelPrompt.mode === "add") {
      changeTierQty(labelPrompt.tierId, 1);
    }
    setLabelPrompt(null);
  };

  const cancelLabelPrompt = () => setLabelPrompt(null);

  const createPackage = async () => {
    const client = getSupabase();
    if (!client || !ceiling) return;
    const name = pkgName.trim();
    if (!name) {
      toastError("Enter a package name.");
      return;
    }
    const wantedIds = tierIdsFromQuantities(tierPickQty);
    for (const tid of wantedIds) {
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
      const hourPct = wizardTierDiscount.hourPct;
      const sellPct = 0;
      const row: Package = {
        package_id: newId,
        package_name: name,
        package_create_date: today,
        package_modified_date: today,
        package_category: selectedPackageType?.name?.trim() || null,
        package_hour_discount_pct: hourPct,
        package_sell_discount_pct: sellPct,
        ...(selectedSlot
          ? {
              package_pricing_overrides: packagePricingOverridesFromSlot(selectedSlot),
            }
          : {}),
        ...(selectedSlot ? packageNarrativeFromSlot(selectedSlot) : {}),
      };
      const insertRow = {
        ...row,
        ...(row.package_pricing_overrides
          ? {
              package_pricing_overrides: sanitizePricingOverridesForDb(row.package_pricing_overrides),
            }
          : {}),
      };
      const { error: insErr } = await client.from("packages").insert(insertRow);
      if (insErr) {
        toastError(friendlyMutationMessage(insErr.message));
        return;
      }
      const payloadByTier: Record<string, ReturnType<typeof emptyPackageLinkPayload>> = {};
      for (const tid of wantedIds) {
        const label = clientFacingLabels[tid]?.trim();
        const payload = emptyPackageLinkPayload();
        if (label) {
          payload.tier_overrides = { solution_tier_name: label };
        }
        payloadByTier[tid] = payload;
      }
      const assignErr = await applyPackageTierMembership(client, newId, tierPickQty, payloadByTier);
      if (assignErr) {
        toastError(
          `${assignErr} Package ${newId} was created; fix tier links in Admin → Package Builder if needed.`
        );
        notifyPackagingDataChanged();
        await onReload?.();
        return;
      }
      const { error: auditErr } = await insertAuditLog(client, {
        entityType: "packages",
        entityId: newId,
        action: "insert",
        before: null,
        after: {
          ...(JSON.parse(JSON.stringify(row)) as Record<string, unknown>),
          solution_tier_ids: wantedIds,
          solution_tier_quantities: tierPickQty,
        },
      });
      if (auditErr) {
        toastNote(
          `Package created, but change history was not recorded (${auditErr}). Run the audit_log migration in Supabase if this persists.`
        );
      }
      notifyPackagingDataChanged();
      toastNote(`Package ${newId} created (${tierLineCount} tier line(s)).`);
      setWizardOpen(false);
      await onReload?.();
      onCreated(newId, row);
    } finally {
      setCreateBusy(false);
    }
  };

  const showFamilyGrid = variant !== "proposal";

  return (
    <>
      {showFamilyGrid ? (
      <section
        className={
          variant === "page"
            ? "agency-pkg-build-start agency-pkg-build-start--page"
            : "agency-pkg-build-start"
        }
        aria-labelledby="pkg-build-start-title"
      >
        <div className="agency-pkg-build-start__copy">
          {variant !== "page" ? (
            <span className="agency-pkg-build-start__eyebrow">Build a Package</span>
          ) : null}
          <div className="agency-pkg-build-start__title-row">
            <h2 id="pkg-build-start-title" className="agency-pkg-build-start__title">
              {variant === "page"
                ? "Choose a template"
                : "Step 1: choose a template"}
            </h2>
            {variant === "page" && packageTypes.length > 0 ? (
              <span className="agency-pkg-build-start__count">
                {packageTypes.length} available
              </span>
            ) : null}
          </div>
          <p className="agency-pkg-build-start__lead">
            {variant === "page"
              ? "Select a template below to start the wizard. Tier limits are configured in "
              : "Pick a template below. We’ll open tier setup next, then you can add solution components. Limits are managed in "}
            <Link className="agency-hub__link" to="/admin">
              Admin → Configurable Package
            </Link>
            .
          </p>
        </div>

        {packageTypes.length === 0 ? (
          <p className="agency-pkg-build-start__empty">
            No templates are configured yet.
          </p>
        ) : (
          <div className="agency-pkg-build-start__grid">
            {packageTypes.map((pt, index) => {
              const typeSlots = slotsForPackageType(slots, pt.id);
              const tierCount = typeSlots.length;
              const cardClass =
                variant === "page"
                  ? "agency-pkg-build-start__card agency-pkg-build-start__card--page"
                  : "agency-pkg-build-start__card";
              return (
                <div
                  key={pt.id}
                  className="agency-pkg-build-start__card-wrap"
                  style={
                    variant === "page"
                      ? { animationDelay: `${index * 0.055}s` }
                      : undefined
                  }
                >
                  <article
                    className={cardClass}
                    data-accent-index={variant === "page" ? String(index % 7) : undefined}
                  >
                    <button
                      type="button"
                      className="agency-pkg-build-start__card-main"
                      onClick={() => beginPackageBuild(pt)}
                    >
                      <span className="agency-pkg-build-start__card-top">
                        <span className="agency-pkg-build-start__card-num">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span className="agency-pkg-build-start__card-arrow" aria-hidden>
                          →
                        </span>
                      </span>
                      <span className="agency-pkg-build-start__card-title">{pt.name}</span>
                      <span className="agency-pkg-build-start__card-meta">
                        {tierCount} tier{tierCount === 1 ? "" : "s"}
                      </span>
                      {pt.card_description ? (
                        <span className="agency-pkg-build-start__card-desc">{pt.card_description}</span>
                      ) : null}
                    </button>
                    <div
                      className={
                        variant === "page"
                          ? "agency-pkg-build-start__card-foot"
                          : "agency-pkg-build-start__card-actions"
                      }
                    >
                      <button
                        type="button"
                        className="agency-pkg-build-start__card-detail-btn"
                        aria-haspopup="dialog"
                        onClick={() => setExpandedFamilyTypeId(pt.id)}
                      >
                        Show detail
                      </button>
                      {variant === "page" ? (
                        <button
                          type="button"
                          className="agency-pkg-build-start__card-start"
                          onClick={() => beginPackageBuild(pt)}
                        >
                          Start build
                          <span aria-hidden>→</span>
                        </button>
                      ) : null}
                    </div>
                  </article>
                </div>
              );
            })}
          </div>
        )}
      </section>
      ) : null}

      {familyDetailType ? (
        <div
          className="pkg-family-detail-overlay"
          role="presentation"
          onClick={closeFamilyDetail}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pkg-family-detail-title"
            className="pkg-family-detail-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="pkg-family-detail-modal__header">
              <div className="pkg-family-detail-modal__head-copy">
                <p className="pkg-family-detail-modal__eyebrow">Template</p>
                <h2 id="pkg-family-detail-title" className="pkg-family-detail-modal__title">
                  {familyDetailType.name}
                </h2>
              </div>
              <button
                type="button"
                className="pkg-family-detail-modal__close"
                onClick={closeFamilyDetail}
                aria-label="Close"
              >
                ×
              </button>
            </header>
            <div className="pkg-family-detail-modal__body">
              <PackageBuilderFamilyDetail slots={familyDetailSlots} />
            </div>
            <footer className="pkg-family-detail-modal__footer">
              <button
                type="button"
                className="pkg-family-detail-modal__btn pkg-family-detail-modal__btn--secondary"
                onClick={closeFamilyDetail}
              >
                Close
              </button>
              <button
                type="button"
                className="pkg-family-detail-modal__btn pkg-family-detail-modal__btn--primary"
                onClick={() => {
                  closeFamilyDetail();
                  beginPackageBuild(familyDetailType);
                }}
              >
                Start build
              </button>
            </footer>
          </div>
        </div>
      ) : null}

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
                {wizardTitle}
              </h2>
              <WizardStepper step={wizStep} />
            </header>

            <div className="agency-pkg-wizard__body">
              {wizStep === 1 && (
                <>
                  <p className="agency-pkg-wizard__lead">
                    Choose a template. Limits for each tier are configured in{" "}
                    <Link className="agency-hub__link" to="/admin">
                      Admin → Configurable Package
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
                            setTierPickQty(emptyTierQuantities());
                            setClientFacingLabels({});
                            setLabelPrompt(null);
                          }}
                        >
                          <span className="agency-pkg-wizard__choice-title">{pt.name}</span>
                          <span className="agency-pkg-wizard__choice-meta">
                            {tierCount} tier{tierCount === 1 ? "" : "s"}
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
                    Pick a tier. Each option can enforce hour, price, and solution component limits.
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
                            applySlotSelection(s);
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
                    Set how many of each solution component to include. Use the + button to add duplicates — for example,
                    3× Customer Interviews - Basic. Running totals multiply solution hours and sell by quantity.
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
                        label="Components selected"
                        value={tierLineCount}
                        max={selectedSlot.solution_tier_limit}
                        format={(n) => String(Math.round(n))}
                        over={overTierCount}
                      />
                    ) : null}
                  </div>

                  {(overHours || overPrice || overTierCount) && (
                    <p className="agency-pkg-wizard__alert" role="alert">
                      You are over a configured limit. Remove components or go back and choose a different tier.
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
                      Solution components
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

                  {!selectionRulesValid(selectedSlot, tierPickQty) ? (
                    <p className="agency-pkg-wizard__alert" role="status">
                      Complete always-included quantities and pick exactly the required number from
                      each choice group before continuing.
                    </p>
                  ) : null}

                  {selectedSlot.preselected_tiers.length > 0 ? (
                    <section className="agency-pkg-wizard__sel-section">
                      <header className="agency-pkg-wizard__sel-head">
                        <h3 className="agency-pkg-wizard__sel-title">Always included</h3>
                        <p className="agency-pkg-wizard__sel-lead">
                          Locked in this tier. You can increase quantity but cannot remove them.
                        </p>
                      </header>
                      <WizardSolutionTierTable
                        rows={alwaysIncludedRows}
                        tierPickQty={tierPickQty}
                        pricingByTierId={pricingByTierId}
                        tasks={tasks}
                        solutionById={solutionById}
                        clientFacingLabels={clientFacingLabels}
                        minQtyForTier={(id) => lockedMinQtyForTier(selectedSlot, id)}
                        onDecrease={(id) => changeTierQty(id, -1)}
                        onIncrease={requestAddTier}
                        onEditLabel={openEditLabel}
                        emptyMessage="No matching always-included components for this filter."
                      />
                    </section>
                  ) : null}

                  {bucketSections.map(({ bucket, rows }) => {
                    const picked = bucketSelectedCount(bucket, tierPickQty);
                    const complete = isBucketComplete(bucket, tierPickQty);
                    return (
                      <section
                        key={bucket.id}
                        className={
                          complete
                            ? "agency-pkg-wizard__sel-section agency-pkg-wizard__sel-section--bucket is-complete"
                            : "agency-pkg-wizard__sel-section agency-pkg-wizard__sel-section--bucket"
                        }
                      >
                        <header className="agency-pkg-wizard__sel-head">
                          <h3 className="agency-pkg-wizard__sel-title">
                            Pick {bucket.pick_count} from {bucket.name}
                          </h3>
                          <p className="agency-pkg-wizard__sel-lead">
                            {picked} of {bucket.pick_count} selected
                            {!complete ? " — choose exactly this many distinct components." : " — done."}
                          </p>
                        </header>
                        <WizardSolutionTierTable
                          rows={rows}
                          tierPickQty={tierPickQty}
                          pricingByTierId={pricingByTierId}
                          tasks={tasks}
                          solutionById={solutionById}
                          clientFacingLabels={clientFacingLabels}
                          minQtyForTier={() => 0}
                          onDecrease={(id) => changeTierQty(id, -1)}
                          onIncrease={requestAddTier}
                          onEditLabel={openEditLabel}
                          emptyMessage="No matching options in this group for this filter."
                        />
                      </section>
                    );
                  })}

                  <section className="agency-pkg-wizard__sel-section">
                    <header className="agency-pkg-wizard__sel-head">
                      <h3 className="agency-pkg-wizard__sel-title">
                        {hasSelectionSections ? "Additional components" : "Solution components"}
                      </h3>
                      {hasSelectionSections ? (
                        <p className="agency-pkg-wizard__sel-lead">
                          Optional picks outside always-included and choice groups
                          {selectedSlot.allowed_solution_tier_ids.length > 0
                            ? " (filtered by this tier’s allow-list)."
                            : "."}
                        </p>
                      ) : null}
                    </header>
                    <WizardSolutionTierTable
                      rows={additionalTierRows}
                      tierPickQty={tierPickQty}
                      pricingByTierId={pricingByTierId}
                      tasks={tasks}
                      solutionById={solutionById}
                      clientFacingLabels={clientFacingLabels}
                      minQtyForTier={() => 0}
                      onDecrease={(id) => changeTierQty(id, -1)}
                      onIncrease={requestAddTier}
                      onEditLabel={openEditLabel}
                      emptyMessage="No solution components match this filter."
                    />
                  </section>
                </>
              )}

              {wizStep === 4 && selectedSlot && selectedPackageType && (
                <>
                  <div className="agency-pkg-wizard__context">
                    <span className="agency-pkg-wizard__chip">{selectedPackageType.name}</span>
                    <span className="agency-pkg-wizard__chip">
                      {displayTierLabel(selectedPackageType.name, selectedSlot.label)}
                    </span>
                    <span className="agency-pkg-wizard__chip">{tierLineCount} tier lines</span>
                  </div>

                  <div className="agency-pkg-wizard__pricing agency-pkg-wizard__pricing--simple">
                    <header className="agency-pkg-wizard__pricing-head">
                      <div>
                        <h3 className="agency-pkg-wizard__discount-title">Package pricing</h3>
                        {wizardTierDiscount.hourPct > 0 || wizardTierDiscount.source !== "none" ? (
                          <p className="agency-pkg-wizard__discount-rule">
                            {formatPackageTierDiscountRule(
                              wizardTierDiscount.level,
                              wizardTierDiscount.hourPct,
                              wizardTierDiscount.tierLabel
                            )}
                          </p>
                        ) : null}
                      </div>
                      <div className="agency-pkg-wizard__pricing-sell">
                        <span className="agency-pkg-wizard__pricing-sell-label">Package sell</span>
                        <strong>
                          {discountPreview.packageModeledSell == null
                            ? "—"
                            : fmtUsd(discountPreview.packageModeledSell)}
                        </strong>
                      </div>
                    </header>

                    <dl className="agency-pkg-wizard__pricing-rows">
                      {usage.missingHours || usage.missingPrice || usage.hours <= 0 ? (
                        <div className="agency-pkg-wizard__pricing-row agency-pkg-wizard__pricing-row--alert">
                          <dt>Vault data</dt>
                          <dd>
                            {usage.hours <= 0 ? (
                              <p className="agency-pkg-wizard__pricing-alert-lead">
                                Selected components have no hour totals in the vault, so pricing
                                cannot be modeled.
                              </p>
                            ) : (
                              <p className="agency-pkg-wizard__pricing-alert-lead">
                                Some selected components are missing vault data. Totals below use
                                only the components that have hours and/or sell price.
                              </p>
                            )}
                            {usage.missingHoursTierIds.length > 0 ? (
                              <div className="agency-pkg-wizard__pricing-alert-list">
                                <span className="agency-pkg-wizard__pricing-alert-list-label">
                                  Missing hours
                                </span>
                                <ul>
                                  {usage.missingHoursTierIds.map((id) => (
                                    <li key={`h-${id}`}>{labelForVaultTier(id)}</li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                            {usage.missingPriceTierIds.length > 0 ? (
                              <div className="agency-pkg-wizard__pricing-alert-list">
                                <span className="agency-pkg-wizard__pricing-alert-list-label">
                                  Missing sell price
                                </span>
                                <ul>
                                  {usage.missingPriceTierIds.map((id) => (
                                    <li key={`p-${id}`}>{labelForVaultTier(id)}</li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                          </dd>
                        </div>
                      ) : null}
                      <div className="agency-pkg-wizard__pricing-row">
                        <dt>Discounted hours</dt>
                        <dd>
                          {discountPreview.hoursAfter == null ? (
                            "—"
                          ) : (
                            <>
                              <span className="agency-pkg-wizard__discount-was">
                                {fmtHoursTotal(discountPreview.catalogHours)} h
                              </span>
                              <span className="agency-pkg-wizard__discount-arrow" aria-hidden>
                                →
                              </span>
                              <strong>{fmtHoursTotal(discountPreview.hoursAfter)} h</strong>
                              {wizardTierDiscount.hourPct > 0 ? (
                                <span className="agency-pkg-wizard__pricing-basic-tag">
                                  −{wizardTierDiscount.hourPct}%
                                </span>
                              ) : null}
                            </>
                          )}
                        </dd>
                      </div>

                      <div className="agency-pkg-wizard__pricing-row agency-pkg-wizard__pricing-row--group">
                        <dt>Resource hours</dt>
                        <dd>
                          {discountPreview.resourceHours == null
                            ? "—"
                            : `${fmtHoursTotal(discountPreview.resourceHours)} h`}
                        </dd>
                      </div>
                      <div className="agency-pkg-wizard__pricing-row agency-pkg-wizard__pricing-row--sub">
                        <dt>
                          Account mgmt
                          <span>({ACCOUNT_MGMT_HOURS_ADDON_RATE * 100}%)</span>
                        </dt>
                        <dd>
                          {discountPreview.accountMgmtAddonHours == null
                            ? "—"
                            : `+${fmtHoursTotal(discountPreview.accountMgmtAddonHours)} h`}
                        </dd>
                      </div>
                      <div className="agency-pkg-wizard__pricing-row agency-pkg-wizard__pricing-row--sub">
                        <dt>
                          Continuous improvement
                          <span>({CONTINUOUS_IMPROVEMENT_HOURS_ADDON_RATE * 100}%)</span>
                        </dt>
                        <dd>
                          {discountPreview.continuousImprovementAddonHours == null
                            ? "—"
                            : `+${fmtHoursTotal(discountPreview.continuousImprovementAddonHours)} h`}
                        </dd>
                      </div>
                      <div className="agency-pkg-wizard__pricing-row">
                        <dt>Billable hours</dt>
                        <dd>
                          <strong>
                            {discountPreview.billableHours == null
                              ? "—"
                              : `${fmtHoursTotal(discountPreview.billableHours)} h`}
                          </strong>
                        </dd>
                      </div>
                      <div className="agency-pkg-wizard__pricing-row">
                        <dt>Hourly rate</dt>
                        <dd>
                          {discountPreview.hourlyRate == null
                            ? "—"
                            : `${fmtUsd(discountPreview.hourlyRate)} / h`}
                        </dd>
                      </div>
                      <div className="agency-pkg-wizard__pricing-row agency-pkg-wizard__pricing-row--emphasis">
                        <dt>Expected effort</dt>
                        <dd>
                          <strong>
                            {discountPreview.expectedEffortBase == null
                              ? "—"
                              : fmtUsd(discountPreview.expectedEffortBase)}
                          </strong>
                        </dd>
                      </div>

                      <div className="agency-pkg-wizard__pricing-row agency-pkg-wizard__pricing-row--scores">
                        <dt>Presets</dt>
                        <dd>
                          <span>
                            Scope {discountPreview.scopeRisk} · Coord {discountPreview.internalCoordination} ·
                            Revision {discountPreview.clientRevisionRisk} · Strategic{" "}
                            {discountPreview.strategicValueScore}
                          </span>
                        </dd>
                      </div>

                      <div className="agency-pkg-wizard__pricing-row">
                        <dt>
                          Risk multiplier
                          <span>
                            (sum{" "}
                            {discountPreview.scopeRisk +
                              discountPreview.internalCoordination +
                              discountPreview.clientRevisionRisk}
                            )
                          </span>
                        </dt>
                        <dd>
                          {discountPreview.riskMultiplier == null
                            ? "—"
                            : `× ${discountPreview.riskMultiplier}`}
                        </dd>
                      </div>
                      <div className="agency-pkg-wizard__pricing-row">
                        <dt>Risk mitigated</dt>
                        <dd>
                          {discountPreview.riskMitigatedBase == null
                            ? "—"
                            : fmtUsd(discountPreview.riskMitigatedBase)}
                        </dd>
                      </div>
                      <div className="agency-pkg-wizard__pricing-row">
                        <dt>Strategic multiplier</dt>
                        <dd>
                          {discountPreview.strategicMultiplier == null
                            ? "—"
                            : `× ${discountPreview.strategicMultiplier}`}
                        </dd>
                      </div>
                      <div className="agency-pkg-wizard__pricing-row agency-pkg-wizard__pricing-row--total">
                        <dt>Package sell</dt>
                        <dd>
                          <strong>
                            {discountPreview.packageModeledSell == null
                              ? "—"
                              : fmtUsd(discountPreview.packageModeledSell)}
                          </strong>
                        </dd>
                      </div>
                    </dl>
                  </div>
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
                    Next: tier
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
                    Change template
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
                    Next: solution components
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

      {labelPrompt ? (
        <div
          className="agency-pkg-label-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) cancelLabelPrompt();
          }}
        >
          <div
            className="agency-pkg-label-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="agency-pkg-label-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="agency-pkg-label-modal__header">
              <div className="agency-pkg-label-modal__head-copy">
                <p className="agency-pkg-label-modal__eyebrow">Solution component</p>
                <h3 id="agency-pkg-label-title" className="agency-pkg-label-modal__title">
                  Client Facing Label
                </h3>
                <p className="agency-pkg-label-modal__sub">
                  {labelPrompt.solutionName}
                  {labelPrompt.tierName.trim() && labelPrompt.tierName !== labelPrompt.solutionName
                    ? ` · ${labelPrompt.tierName}`
                    : ""}
                </p>
              </div>
              <button
                type="button"
                className="agency-pkg-label-modal__close"
                aria-label="Close"
                onClick={cancelLabelPrompt}
              >
                ×
              </button>
            </header>
            <div className="agency-pkg-label-modal__body">
              <label className="agency-pkg-label-modal__field">
                <span className="agency-pkg-label-modal__field-label">How this should appear to the client</span>
                <input
                  className="agency-pkg-label-modal__input"
                  value={labelPrompt.draft}
                  onChange={(e) => setLabelPrompt((prev) => (prev ? { ...prev, draft: e.target.value } : prev))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      confirmLabelPrompt();
                    }
                  }}
                  autoFocus
                  placeholder={labelPrompt.solutionName || "Client facing label"}
                />
              </label>
              <p className="agency-pkg-label-modal__hint">
                Defaults to the solution name. Change it if you want a different client-facing title for this
                package component.
              </p>
            </div>
            <footer className="agency-pkg-label-modal__footer">
              <button
                type="button"
                className="agency-pkg-wizard__btn agency-pkg-wizard__btn--secondary"
                onClick={cancelLabelPrompt}
              >
                Cancel
              </button>
              <button
                type="button"
                className="agency-pkg-wizard__btn agency-pkg-wizard__btn--primary"
                onClick={confirmLabelPrompt}
              >
                {labelPrompt.mode === "add" ? "Add to package" : "Save label"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </>
  );
}
