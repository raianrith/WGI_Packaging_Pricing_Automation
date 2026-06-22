import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { insertAuditLog } from "../lib/audit";
import { getSupabase } from "../lib/supabase";
import { percentChangeFromSellAndOld } from "../lib/pricingPercentChange";
import {
  ACCOUNT_MGMT_HOURS_ADDON_RATE,
  CONTINUOUS_IMPROVEMENT_HOURS_ADDON_RATE,
  totalResourceHourAddonRate,
  CLIENT_REVISION_RISK_SCORE_HINTS,
  INTERNAL_COORDINATION_SCORE_HINTS,
  SCOPE_RISK_SCORE_HINTS,
  computeTierPricing,
  scoreToString,
  clampScore012,
  riskScore012Options,
  riskScore012SelectTitle,
  strategicValueScoreSelectTitle,
  strategicValueScoreUiLabel,
  type RiskStrategicScore,
  type TierPricingMathConfig,
} from "../lib/tierPricingMath";
import { PKG_AGGREGATE_SYNTHETIC_TIER_ID } from "../lib/packageAggregatePricing";
import { pricingHourGroupLabel } from "../lib/pricingHourGroups";
import type { PricingHourGroupKey, SolutionTier, SolutionTierPricing } from "../types";

function rowJson(row: object): Record<string, unknown> {
  return JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
}

function nStr(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "";
  return String(v);
}

function parseNum(s: string): number | null {
  const t = s.trim();
  if (t === "" || t.toLowerCase() === "n/a") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Package sell / hour discount fields: 0–100, non-finite → 0 */
function parsePct0to100(raw: string | null | undefined): number {
  const n = Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(100, n);
}

function AdminFieldCaption({ children }: { children: ReactNode }) {
  return <span className="admin-field-caption">{children}</span>;
}

const SCOPE_RISK_OPTIONS = riskScore012Options(SCOPE_RISK_SCORE_HINTS);
const INTERNAL_COORDINATION_OPTIONS = riskScore012Options(INTERNAL_COORDINATION_SCORE_HINTS);
const CLIENT_REVISION_RISK_OPTIONS = riskScore012Options(CLIENT_REVISION_RISK_SCORE_HINTS);

const STRATEGIC_OPTIONS: { value: string; label: string }[] = ([0, 1, 2] as const).map((s) => ({
  value: String(s),
  label: strategicValueScoreUiLabel(s),
}));

function formatMultCell(n: number): string {
  return Number.isInteger(n) && n === Math.floor(n) ? n.toFixed(1) : String(n);
}

function fmtDerivedHours(n: number): string {
  return Number.isFinite(n)
    ? n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 0 })
    : "0";
}

function riskBandTableRows(config: TierPricingMathConfig): { label: string; mult: string }[] {
  const bands = [...config.riskBands].sort((a, b) => a.sumMax - b.sumMax);
  return bands.map((b, i) => {
    const lo = i === 0 ? 0 : bands[i - 1].sumMax + 1;
    const hi = b.sumMax;
    const label = lo >= hi ? String(hi) : `${lo}–${hi}`;
    return { label, mult: formatMultCell(b.multiplier) };
  });
}

/** Compact reference under Sell calculation — tables + formulas only. */
function PricingSellCalcCompact({ mathConfig }: { mathConfig: TierPricingMathConfig }) {
  const riskRows = riskBandTableRows(mathConfig);
  const stratRows = ([0, 1, 2] as const).map((score: RiskStrategicScore) => ({
    v: strategicValueScoreUiLabel(score),
    m: formatMultCell(mathConfig.strategicMultipliers[score]),
  }));
  return (
    <div className="admin-pricing-sell-calc">
      <p className="admin-pricing-sell-calc__hint">
        To change hourly rate, risk bands, or strategic multipliers, use <strong>Admin → Pricing calculator</strong>{" "}
        (this browser).
      </p>
      <p className="admin-pricing-details__formula admin-pricing-sell-calc__formula">
        {`Expected effort = resource hours × (1 + ${ACCOUNT_MGMT_HOURS_ADDON_RATE * 100}% + ${CONTINUOUS_IMPROVEMENT_HOURS_ADDON_RATE * 100}%) × $${mathConfig.hourlyRate}/hr`}
      </p>
      <table className="admin-pricing-details__table admin-pricing-sell-calc__table">
        <caption>Risk sum ranges → multiplier</caption>
        <thead>
          <tr>
            <th scope="col">Sum of three scores (S)</th>
            <th scope="col">Risk multiplier</th>
          </tr>
        </thead>
        <tbody>
          {riskRows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td>{row.mult}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="admin-pricing-details__formula admin-pricing-sell-calc__formula">
        Risk mitigated = expected effort × risk multiplier
      </p>
      <table className="admin-pricing-details__table admin-pricing-sell-calc__table">
        <caption>Strategic value → multiplier</caption>
        <thead>
          <tr>
            <th scope="col">Strategic value</th>
            <th scope="col">Multiplier</th>
          </tr>
        </thead>
        <tbody>
          {stratRows.map((row, idx) => (
            <tr key={idx}>
              <td className="admin-pricing-sell-calc__strat-cell">{row.v}</td>
              <td>{row.m}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="admin-pricing-details__formula admin-pricing-sell-calc__formula">
        Raw sell = risk mitigated × strategic multiplier
      </p>
      <p className="admin-pricing-details__formula admin-pricing-sell-calc__formula">
        Sell price = CEILING(raw sell, ${mathConfig.sellCeilingStep})
      </p>
    </div>
  );
}

type Props = {
  tierPricingMathConfig: TierPricingMathConfig;
  /** Create new row vs browse table + edit loaded row */
  subTab: "create" | "update";
  tiers: SolutionTier[];
  pricing: SolutionTierPricing[];
  panelStyle: CSSProperties;
  formGrid: CSSProperties;
  lbl: CSSProperties;
  input: CSSProperties;
  textarea: CSSProperties;
  btn: CSSProperties;
  btnPrimary: CSSProperties;
  btnSm: CSSProperties;
  tbl: CSSProperties;
  th: CSSProperties;
  td: CSSProperties;
  h2: CSSProperties;
  muted: CSSProperties;
  onSaved: () => Promise<void>;
  setOpErr: (s: string | null) => void;
  setOpOk: (s: string | null) => void;
  logAudit: (
    client: SupabaseClient,
    p: Parameters<typeof insertAuditLog>[1]
  ) => Promise<void>;
  /** When set, tier dropdown and the update-mode table only include these tier ids. */
  tierIdsInScope?: string[] | null;
  /** In create mode, pre-fill and lock the tier selector to this id (must exist in `tiers`). */
  createLockedTierId?: string | null;
  /**
   * Update mode: when the parent has already selected a solution tier, pass its id to load
   * that row into the form automatically (or open an empty form to add a first-time row).
   */
  updateAutoLoadTierId?: string | null;
  /** When true, hour buckets follow `taskHourRollup` (from tasks + implementer map) and are read-only. */
  taskDrivenHours?: boolean;
  /** Per pricing group: summed task times for the tier; required when `taskDrivenHours`. */
  taskHourRollup?: Record<PricingHourGroupKey, number> | null;
  /** Default writes to `solution_tier_pricing`. Non-vault modes push drafts back to the parent instead. */
  persistTarget?: "vault" | "package" | "draft";
  /** When `persistTarget` is `package`, seed the form from this merged row (vault + existing package overrides). */
  packagePricingSeed?: SolutionTierPricing | null;
  /** When `persistTarget` is `package`, receive the live merged pricing row (including derived sell). */
  onPackagePricingDraft?: (row: SolutionTierPricing) => void;
  /** When `persistTarget` is `draft`, receive the live draft pricing row for a parent wizard save. */
  onDraftPricingDraft?: (row: SolutionTierPricing) => void;
  /** Package aggregate: hour discount % beside hour groups in Hours. */
  packageHourDiscountPct?: string | null;
  onPackageHourDiscountPctChange?: (value: string) => void;
  /** Package aggregate: sell discount % after modeled sell price. */
  packageSellDiscountPct?: string | null;
  onPackageSellDiscountPctChange?: (value: string) => void;
  /** When true, package hour discount is read-only and sell discount is hidden (fixed tier rules). */
  packageDiscountsReadOnly?: boolean;
};

export function PricingPanel({
  tierPricingMathConfig,
  subTab,
  tiers,
  pricing,
  panelStyle,
  formGrid,
  lbl,
  input,
  textarea,
  btn,
  btnPrimary,
  btnSm,
  tbl,
  th,
  td,
  h2,
  muted,
  onSaved,
  setOpErr,
  setOpOk,
  logAudit,
  tierIdsInScope = null,
  createLockedTierId = null,
  updateAutoLoadTierId = null,
  taskDrivenHours = false,
  taskHourRollup = null,
  persistTarget = "vault",
  packagePricingSeed = null,
  onPackagePricingDraft,
  onDraftPricingDraft,
  packageHourDiscountPct = null,
  onPackageHourDiscountPctChange,
  packageSellDiscountPct = null,
  onPackageSellDiscountPctChange,
  packageDiscountsReadOnly = false,
}: Props) {
  const [tierPick, setTierPick] = useState("");
  const [scope, setScope] = useState("");
  const [hCs, setHCs] = useState("");
  const [hCp, setHCp] = useState("");
  const [hDs, setHDs] = useState("");
  const [hWd, setHWd] = useState("");
  const [hVi, setHVi] = useState("");
  const [hDa, setHDa] = useState("");
  const [hPm, setHPm] = useState("");
  const [hHb, setHHb] = useState("");
  const [hOt, setHOt] = useState("");
  /** Risk / strategic scores 0–2 (select values). */
  const [scopeRisk, setScopeRisk] = useState("0");
  const [internalCoord, setInternalCoord] = useState("0");
  const [clientRev, setClientRev] = useState("0");
  const [stratScore, setStratScore] = useState("0");
  const [oldPrice, setOldPrice] = useState("");
  const [reqCustom, setReqCustom] = useState(false);
  const [taxable, setTaxable] = useState(false);
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");
  const [editingTierId, setEditingTierId] = useState<string | null>(null);

  const hourBreakdown = useMemo(
    () => ({
      client: parseNum(hCs) ?? 0,
      copy: parseNum(hCp) ?? 0,
      design: parseNum(hDs) ?? 0,
      web: parseNum(hWd) ?? 0,
      video: parseNum(hVi) ?? 0,
      data: parseNum(hDa) ?? 0,
      paidMedia: parseNum(hPm) ?? 0,
      hubspot: parseNum(hHb) ?? 0,
      other: parseNum(hOt) ?? 0,
    }),
    [hCs, hCp, hDs, hWd, hVi, hDa, hPm, hHb, hOt]
  );

  const derived = useMemo(
    () =>
      computeTierPricing(
        {
          hours: hourBreakdown,
          scopeRisk: Number(scopeRisk),
          internalCoordination: Number(internalCoord),
          clientRevisionRisk: Number(clientRev),
          strategicValueScore: Number(stratScore),
        },
        tierPricingMathConfig
      ),
    [hourBreakdown, scopeRisk, internalCoord, clientRev, stratScore, tierPricingMathConfig]
  );

  const parsedPackageSellDiscountPct = useMemo(
    () => parsePct0to100(packageSellDiscountPct),
    [packageSellDiscountPct]
  );

  const netSellAfterPackageDiscount = useMemo(() => {
    if (persistTarget !== "package") return derived.sellPrice;
    return derived.sellPrice * (1 - parsedPackageSellDiscountPct / 100);
  }, [persistTarget, derived.sellPrice, parsedPackageSellDiscountPct]);

  const percentFromOld = useMemo(
    () => percentChangeFromSellAndOld(derived.sellPrice, oldPrice),
    [derived.sellPrice, oldPrice]
  );

  const tierScopeSet = useMemo(
    () =>
      tierIdsInScope && tierIdsInScope.length > 0 ? new Set(tierIdsInScope) : null,
    [tierIdsInScope]
  );

  const tiersScoped = useMemo(
    () =>
      tierScopeSet ? tiers.filter((t) => tierScopeSet.has(t.solution_tier_id)) : tiers,
    [tiers, tierScopeSet]
  );

  const pricingScoped = useMemo(
    () =>
      tierScopeSet
        ? pricing.filter((p) => tierScopeSet.has(p.solution_tier_id))
        : pricing,
    [pricing, tierScopeSet]
  );

  const startNew = useCallback(
    (opts?: { lockEditTier: string }) => {
      if (opts?.lockEditTier) {
        setEditingTierId(opts.lockEditTier);
        setTierPick(opts.lockEditTier);
      } else {
        setEditingTierId(null);
        if (subTab === "create") {
          setTierPick(createLockedTierId ?? "");
        } else {
          setTierPick("");
        }
      }
      setScope("");
      setHCs("");
      setHCp("");
      setHDs("");
      setHWd("");
      setHVi("");
      setHDa("");
      setHPm("");
      setHHb("");
      setHOt("");
      setScopeRisk("0");
      setInternalCoord("0");
      setClientRev("0");
      setStratScore("0");
      setOldPrice("");
      setReqCustom(false);
      setTaxable(false);
      setNotes("");
      setTags("");
    },
    [createLockedTierId, subTab]
  );

  const loadRow = useCallback(
    (r: SolutionTierPricing) => {
    setEditingTierId(r.solution_tier_id);
    setTierPick(r.solution_tier_id);
    setScope(r.scope ?? "");
    if (!taskDrivenHours) {
      setHCs(nStr(r.hours_client_services));
      setHCp(nStr(r.hours_copy));
      setHDs(nStr(r.hours_design));
      setHWd(nStr(r.hours_web_dev));
      setHVi(nStr(r.hours_video));
      setHDa(nStr(r.hours_data));
      setHPm(nStr(r.hours_paid_media));
      setHHb(nStr(r.hours_hubspot));
      setHOt(nStr(r.hours_other));
    }
    setScopeRisk(scoreToString(clampScore012(r.scope_risk)));
    setInternalCoord(scoreToString(clampScore012(r.internal_coordination)));
    setClientRev(scoreToString(clampScore012(r.client_revision_risk)));
    setStratScore(scoreToString(clampScore012(r.strategic_value_score)));
    setOldPrice(nStr(r.old_price));
    setReqCustom(Boolean(r.requires_customization));
    setTaxable(Boolean(r.taxable));
    setNotes(r.notes ?? "");
    setTags(r.tags ?? "");
  },
    [taskDrivenHours]
  );

  const prevSyncTierRef = useRef<string | null>(null);
  const startedEmptyForAutoTierRef = useRef(false);

  useEffect(() => {
    if (subTab === "create") {
      startNew();
    }
  }, [subTab, startNew]);

  useEffect(() => {
    if (persistTarget === "package") {
      return;
    }
    if (subTab !== "update" || !updateAutoLoadTierId?.trim()) {
      if (subTab === "update") {
        prevSyncTierRef.current = null;
        startedEmptyForAutoTierRef.current = false;
      }
      return;
    }
    const tid = updateAutoLoadTierId.trim();
    if (tierScopeSet && !tierScopeSet.has(tid)) {
      return;
    }

    const focusChanged = prevSyncTierRef.current !== tid;
    if (focusChanged) {
      prevSyncTierRef.current = tid;
      startedEmptyForAutoTierRef.current = false;
    }

    const row = pricing.find((p) => p.solution_tier_id === tid) ?? null;

    if (row) {
      const shouldLoad =
        focusChanged ||
        !editingTierId ||
        (editingTierId === tid && startedEmptyForAutoTierRef.current);
      if (shouldLoad) {
        loadRow(row);
        startedEmptyForAutoTierRef.current = false;
      }
    } else {
      if (focusChanged || !editingTierId) {
        startNew({ lockEditTier: tid });
        startedEmptyForAutoTierRef.current = true;
      }
    }
  }, [
    persistTarget,
    subTab,
    updateAutoLoadTierId,
    pricing,
    editingTierId,
    loadRow,
    startNew,
    tierScopeSet,
  ]);

  useLayoutEffect(() => {
    if (persistTarget !== "package" || !packagePricingSeed) return;
    loadRow(packagePricingSeed);
  }, [persistTarget, packagePricingSeed, loadRow]);

  const externalDraftRow = useMemo(() => {
    if (persistTarget === "vault" || !tierPick.trim()) return null;
    const d = derived;
    const pc = percentChangeFromSellAndOld(d.sellPrice, oldPrice);
    const tierRow = tiersScoped.find((t) => t.solution_tier_id === tierPick.trim()) ?? null;
    return {
      solution_tier_id: tierPick.trim(),
      solution_label: tierRow?.solution_tier_name ?? null,
      tier: tierRow?.solution_tier_name ?? null,
      scope: scope.trim() || null,
      hours_client_services: parseNum(hCs) ?? 0,
      hours_copy: parseNum(hCp) ?? 0,
      hours_design: parseNum(hDs) ?? 0,
      hours_web_dev: parseNum(hWd) ?? 0,
      hours_video: parseNum(hVi) ?? 0,
      hours_data: parseNum(hDa) ?? 0,
      hours_paid_media: parseNum(hPm) ?? 0,
      hours_hubspot: parseNum(hHb) ?? 0,
      hours_other: parseNum(hOt) ?? 0,
      total_hours: d.totalHours,
      expected_effort_base_price: d.expectedEffortBase,
      scope_risk: d.scopeRisk,
      internal_coordination: d.internalCoordination,
      client_revision_risk: d.clientRevisionRisk,
      risk_multiplier: d.riskMultiplier,
      risk_mitigated_base_price: d.riskMitigatedBase,
      strategic_value_score: d.strategicValueScore,
      strategic_value_multiplier: d.strategicMultiplier,
      sell_price: d.sellPrice,
      standalone_sell_price: null,
      old_price: parseNum(oldPrice),
      percent_change: pc.forDb,
      requires_customization: reqCustom,
      taxable,
      notes: notes.trim() || null,
      tags: tags.trim() || null,
    } as SolutionTierPricing;
  }, [
    persistTarget,
    tierPick,
    scope,
    hCs,
    hCp,
    hDs,
    hWd,
    hVi,
    hDa,
    hPm,
    hHb,
    hOt,
    derived,
    oldPrice,
    reqCustom,
    taxable,
    notes,
    tags,
    tiersScoped,
  ]);

  useEffect(() => {
    if (!externalDraftRow) return;
    if (persistTarget === "package") {
      onPackagePricingDraft?.(externalDraftRow);
      return;
    }
    if (persistTarget === "draft") {
      onDraftPricingDraft?.(externalDraftRow);
    }
  }, [persistTarget, externalDraftRow, onPackagePricingDraft, onDraftPricingDraft]);

  useEffect(() => {
    if (!taskDrivenHours || !taskHourRollup) {
      return;
    }
    setHCs(nStr(taskHourRollup.client_services));
    setHCp(nStr(taskHourRollup.copy));
    setHDs(nStr(taskHourRollup.design));
    setHWd(nStr(taskHourRollup.web_dev));
    setHVi(nStr(taskHourRollup.video));
    setHDa(nStr(taskHourRollup.data));
    setHPm(nStr(taskHourRollup.paid_media));
    setHHb(nStr(taskHourRollup.hubspot));
    setHOt(nStr(taskHourRollup.other));
  }, [taskDrivenHours, taskHourRollup]);

  const buildPayload = (): Record<string, unknown> => {
    const d = derived;
    const pc = percentChangeFromSellAndOld(d.sellPrice, oldPrice);
    const tierRow = tiersScoped.find((t) => t.solution_tier_id === tierPick.trim()) ?? null;
    return {
      solution_tier_id: tierPick.trim(),
      // Keep legacy columns populated from the selected tier, not manual duplicate inputs.
      solution_label: tierRow?.solution_tier_name ?? null,
      tier: tierRow?.solution_tier_name ?? null,
      scope: scope.trim() || null,
      hours_client_services: parseNum(hCs) ?? 0,
      hours_copy: parseNum(hCp) ?? 0,
      hours_design: parseNum(hDs) ?? 0,
      hours_web_dev: parseNum(hWd) ?? 0,
      hours_video: parseNum(hVi) ?? 0,
      hours_data: parseNum(hDa) ?? 0,
      hours_paid_media: parseNum(hPm) ?? 0,
      hours_hubspot: parseNum(hHb) ?? 0,
      hours_other: parseNum(hOt) ?? 0,
      total_hours: d.totalHours,
      expected_effort_base_price: d.expectedEffortBase,
      scope_risk: d.scopeRisk,
      internal_coordination: d.internalCoordination,
      client_revision_risk: d.clientRevisionRisk,
      risk_multiplier: d.riskMultiplier,
      risk_mitigated_base_price: d.riskMitigatedBase,
      strategic_value_score: d.strategicValueScore,
      strategic_value_multiplier: d.strategicMultiplier,
      sell_price: d.sellPrice,
      standalone_sell_price: null,
      old_price: parseNum(oldPrice),
      percent_change: pc.forDb,
      requires_customization: reqCustom,
      taxable,
      notes: notes.trim() || null,
      tags: tags.trim() || null,
    };
  };

  const save = async () => {
    if (persistTarget === "package") {
      return;
    }
    const client = getSupabase();
    if (!client) return;
    setOpErr(null);
    setOpOk(null);
    if (subTab === "update" && !editingTierId) {
      setOpErr("On Update, click Edit on a row in the table first, then save.");
      return;
    }
    const id = tierPick.trim();
    if (!id) {
      setOpErr("Choose a solution tier.");
      return;
    }
    if (!tiersScoped.some((t) => t.solution_tier_id === id)) {
      setOpErr("Tier id must match an existing solution tier.");
      return;
    }
    const payload = buildPayload();
    const prev = pricing.find((p) => p.solution_tier_id === id) ?? null;
    const { error } = await client
      .from("solution_tier_pricing")
      .upsert(payload, { onConflict: "solution_tier_id" });
    if (error) {
      setOpErr(error.message);
      return;
    }
    const after = { ...prev, ...payload } as SolutionTierPricing;
    await logAudit(client, {
      entityType: "solution_tier_pricing",
      entityId: id,
      action: prev ? "update" : "insert",
      before: prev ? rowJson(prev) : null,
      after: rowJson(after),
    });
    setOpOk("Pricing saved.");
    startNew();
    await onSaved();
  };

  const remove = async (r: SolutionTierPricing) => {
    if (persistTarget === "package") return;
    const client = getSupabase();
    if (!client) return;
    setOpErr(null);
    setOpOk(null);
    const { error } = await client
      .from("solution_tier_pricing")
      .delete()
      .eq("solution_tier_id", r.solution_tier_id);
    if (error) {
      setOpErr(error.message);
      return;
    }
    await logAudit(client, {
      entityType: "solution_tier_pricing",
      entityId: r.solution_tier_id,
      action: "delete",
      before: rowJson(r),
      after: null,
    });
    setOpOk("Pricing row deleted.");
    if (editingTierId === r.solution_tier_id) startNew();
    await onSaved();
  };

  const sortedPricing = [...pricingScoped].sort((a, b) =>
    a.solution_tier_id.localeCompare(b.solution_tier_id, undefined, { numeric: true })
  );

  const showForm = subTab === "create" || (subTab === "update" && Boolean(editingTierId));
  const tierSelectLocked =
    (subTab === "update" && Boolean(editingTierId)) ||
    (subTab === "create" && Boolean(createLockedTierId));

  const readonlyInput = { ...input, cursor: "default" as const };

  return (
    <section className="admin-panel admin-panel--editor" style={panelStyle}>
      <div className="admin-editor-layout admin-editor-layout--wide admin-pricing-layout">
      <h2 style={h2}>Tier pricing</h2>
      <p className="admin-intro admin-intro--tight" style={muted}>
        {persistTarget === "package" ? (
          <>
            Same math as <strong>Solutions Builder → pricing</strong>. Hour buckets are combined from all tiers in this
            package after the <strong>hour discount %</strong> you set in Package Builder; multipliers and overrides are
            stored on the <strong>packages</strong> row as <code style={{ fontSize: "0.85em" }}>package_pricing_overrides</code>{" "}
            (vault <code style={{ fontSize: "0.85em" }}>solution_tier_pricing</code> is not modified here).
          </>
        ) : persistTarget === "draft" ? (
          <>
            Same pricing form as <strong>new tiers on existing solutions</strong>. This draft is saved together with the
            new solution when you click the final create button below.
          </>
        ) : subTab === "create" ? (
          <>
            Add or replace a row — upsert on <code style={{ fontSize: "0.85em" }}>solution_tier_id</code>. Sell
            amounts in the last section follow the tables there.
          </>
        ) : updateAutoLoadTierId ? (
          <>
            The tier selected in <strong>Tasks &amp; pricing</strong> above is loaded here. Upsert on{" "}
            <code style={{ fontSize: "0.85em" }}>solution_tier_id</code>.
          </>
        ) : (
          <>
            Load a row from the table or pick a tier — upsert on{" "}
            <code style={{ fontSize: "0.85em" }}>solution_tier_id</code>.
          </>
        )}
      </p>

      {subTab === "update" && persistTarget === "vault" && (
        <>
          <div className="admin-table-scroll">
          <table className="admin-data-table" style={{ ...tbl, marginTop: 8 }}>
            <thead>
              <tr>
                <th style={th}>Tier id</th>
                <th style={th}>Tier name</th>
                <th style={th}>Sell</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {sortedPricing.map((r) => (
                <tr key={r.solution_tier_id}>
                  <td style={td}>{r.solution_tier_id}</td>
                  <td style={td}>
                    {tiersScoped.find((t) => t.solution_tier_id === r.solution_tier_id)?.solution_tier_name ?? "—"}
                  </td>
                  <td style={td}>
                    {r.sell_price != null ? `$${Number(r.sell_price).toLocaleString()}` : "—"}
                  </td>
                  <td style={td}>
                    <button type="button" style={btnSm} onClick={() => loadRow(r)}>
                      Edit
                    </button>{" "}
                    <button type="button" style={btnSm} onClick={() => void remove(r)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {sortedPricing.length === 0 && (
            <p className="admin-hint" style={{ ...muted, marginTop: 12 }}>
              No pricing rows yet. Use Create new to add one, or add tiers first.
            </p>
          )}
          {!editingTierId && !updateAutoLoadTierId ? (
            <p className="admin-hint" style={{ ...muted, marginTop: "1rem" }}>
              Select <strong>Edit</strong> on a row to load it into the form below.
            </p>
          ) : null}
        </>
      )}

      {showForm ? (
        <>
          {subTab === "update" && editingTierId ? (
            <h3 className="admin-editing-heading">
              {editingTierId === PKG_AGGREGATE_SYNTHETIC_TIER_ID ? (
                <>Package aggregate pricing</>
              ) : (
                <>
                  Editing <code style={{ fontSize: "0.9em" }}>{editingTierId}</code>
                </>
              )}
            </h3>
          ) : null}

      {persistTarget === "package" && editingTierId ? (
        <div className="admin-pricing-section">
          <h3 className="admin-pricing-section__title">Scope (package aggregate)</h3>
          <p className="admin-intro admin-intro--tight" style={{ ...muted, marginTop: 0 }}>
            Stored on the package as sparse pricing overrides (scope, notes, scores, etc.).
          </p>
          <div className="admin-form-stack" style={formGrid}>
            <label style={{ ...lbl, gridColumn: "1 / -1" }}>
              <AdminFieldCaption>Scope</AdminFieldCaption>
              <textarea
                style={textarea}
                rows={3}
                value={scope}
                onChange={(e) => setScope(e.target.value)}
              />
            </label>
          </div>
        </div>
      ) : (
        (subTab === "create" || !editingTierId) && (
          <div className="admin-pricing-section">
            <h3 className="admin-pricing-section__title">Tier &amp; scope</h3>
            <div className="admin-form-stack" style={formGrid}>
              <label style={lbl}>
                <AdminFieldCaption>Solution tier</AdminFieldCaption>
                <select
                  style={input}
                  value={tierPick}
                  disabled={tierSelectLocked}
                  onChange={(e) => setTierPick(e.target.value)}
                >
                  <option value="">Select tier…</option>
                  {tiersScoped.map((t) => (
                    <option key={t.solution_tier_id} value={t.solution_tier_id}>
                      {t.solution_tier_id} — {t.solution_tier_name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                <AdminFieldCaption>Scope</AdminFieldCaption>
                <textarea
                  style={textarea}
                  rows={3}
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                />
              </label>
            </div>
          </div>
        )
      )}

      <div className="admin-pricing-section">
        <h3 className="admin-pricing-section__title">Hours</h3>
        {taskDrivenHours ? (
          <p className="admin-hint" style={{ ...muted, marginTop: 0, marginBottom: 10, maxWidth: "58ch" }}>
            These fields update from <strong>task time</strong> and <strong>implementer</strong> in <strong>Tasks</strong>{" "}
            above, using mappings in <strong>Admin → Implementer-Pricing Mapping</strong>. Edit tasks to change the split; use{" "}
            <strong>Save pricing</strong> to persist the rolled-up hours to this tier.
          </p>
        ) : null}
        <div className="admin-form-stack" style={formGrid}>
          {(
            [
              ["client_services", hCs, setHCs],
              ["copy", hCp, setHCp],
              ["design", hDs, setHDs],
              ["web_dev", hWd, setHWd],
              ["video", hVi, setHVi],
              ["data", hDa, setHDa],
              ["paid_media", hPm, setHPm],
              ["hubspot", hHb, setHHb],
              ["other", hOt, setHOt],
            ] as const satisfies ReadonlyArray<readonly [PricingHourGroupKey, string, (v: string) => void]>
          ).map(([k, val, set]) => (
            <label key={k} style={lbl}>
              <AdminFieldCaption>{pricingHourGroupLabel(k)}</AdminFieldCaption>
              <input
                style={taskDrivenHours ? { ...input, ...readonlyInput } : input}
                className={taskDrivenHours ? "admin-pricing-readonly" : undefined}
                value={val}
                readOnly={Boolean(taskDrivenHours)}
                tabIndex={taskDrivenHours ? -1 : 0}
                onChange={taskDrivenHours ? undefined : (e) => set(e.target.value)}
              />
            </label>
          ))}
          <label style={lbl}>
            <AdminFieldCaption>Total resource hours</AdminFieldCaption>
            <input
              className="admin-pricing-readonly"
              style={readonlyInput}
              readOnly
              tabIndex={-1}
              value={fmtDerivedHours(derived.totalHours)}
            />
          </label>
          <label style={lbl}>
            <AdminFieldCaption>Account mgmt add-on ({ACCOUNT_MGMT_HOURS_ADDON_RATE * 100}%)</AdminFieldCaption>
            <input
              className="admin-pricing-readonly"
              style={readonlyInput}
              readOnly
              tabIndex={-1}
              title="Automatic: this percent of total resource hours, before hourly rate."
              value={fmtDerivedHours(derived.accountMgmtAddonHours)}
            />
          </label>
          <label style={lbl}>
            <AdminFieldCaption>
              Continuous improvement add-on ({CONTINUOUS_IMPROVEMENT_HOURS_ADDON_RATE * 100}%)
            </AdminFieldCaption>
            <input
              className="admin-pricing-readonly"
              style={readonlyInput}
              readOnly
              tabIndex={-1}
              title="Automatic: this percent of total resource hours, before hourly rate."
              value={fmtDerivedHours(derived.continuousImprovementAddonHours)}
            />
          </label>
          <label style={lbl}>
            <AdminFieldCaption>
              Billable hours (resource + {totalResourceHourAddonRate() * 100}% add-ons)
            </AdminFieldCaption>
            <input
              className="admin-pricing-readonly"
              style={readonlyInput}
              readOnly
              tabIndex={-1}
              value={fmtDerivedHours(derived.hoursForExpectedEffort)}
            />
          </label>
          {persistTarget === "package" && (onPackageHourDiscountPctChange || packageDiscountsReadOnly) ? (
            <label
              style={{ ...lbl, gridColumn: "1 / -1" }}
              className="admin-pricing-package-discount-field"
            >
              <AdminFieldCaption>Hour discount %</AdminFieldCaption>
              <input
                style={packageDiscountsReadOnly ? readonlyInput : input}
                className={packageDiscountsReadOnly ? "admin-pricing-readonly" : undefined}
                readOnly={packageDiscountsReadOnly}
                tabIndex={packageDiscountsReadOnly ? -1 : undefined}
                inputMode="decimal"
                value={packageHourDiscountPct ?? ""}
                onChange={
                  packageDiscountsReadOnly
                    ? undefined
                    : (e) => onPackageHourDiscountPctChange?.(e.target.value)
                }
                title={
                  packageDiscountsReadOnly
                    ? "Fixed by package tier (Basic 20%, Standard 25%, Advanced 30%)."
                    : "Applied evenly across all hour groups before expected effort pricing (package-level)."
                }
              />
            </label>
          ) : null}
        </div>
      </div>

      <div className="admin-pricing-section">
        <h3 className="admin-pricing-section__title">Sell calculation</h3>
        <PricingSellCalcCompact mathConfig={tierPricingMathConfig} />
        <div className="admin-form-stack" style={formGrid}>
          <label style={lbl}>
            <AdminFieldCaption>Expected effort</AdminFieldCaption>
            <input
              className="admin-pricing-readonly"
              style={readonlyInput}
              readOnly
              tabIndex={-1}
              title="Billable hours (resource + account mgmt + continuous improvement add-ons) × hourly rate."
              value={`$${Math.round(derived.expectedEffortBase).toLocaleString()}`}
            />
          </label>
          <label style={lbl}>
            <AdminFieldCaption>Scope risk</AdminFieldCaption>
            <select
              style={input}
              value={scopeRisk}
              onChange={(e) => setScopeRisk(e.target.value)}
              title={riskScore012SelectTitle(SCOPE_RISK_SCORE_HINTS)}
            >
              {SCOPE_RISK_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label style={lbl}>
            <AdminFieldCaption>Internal coordination</AdminFieldCaption>
            <select
              style={input}
              value={internalCoord}
              onChange={(e) => setInternalCoord(e.target.value)}
              title={riskScore012SelectTitle(INTERNAL_COORDINATION_SCORE_HINTS)}
            >
              {INTERNAL_COORDINATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label style={lbl}>
            <AdminFieldCaption>Client revision risk</AdminFieldCaption>
            <select
              style={input}
              value={clientRev}
              onChange={(e) => setClientRev(e.target.value)}
              title={riskScore012SelectTitle(CLIENT_REVISION_RISK_SCORE_HINTS)}
            >
              {CLIENT_REVISION_RISK_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label style={lbl}>
            <AdminFieldCaption>Risk multiplier</AdminFieldCaption>
            <input
              className="admin-pricing-readonly"
              style={readonlyInput}
              readOnly
              tabIndex={-1}
              value={`${derived.riskMultiplier} (scores sum ${derived.riskScoreSum})`}
            />
          </label>
          <label style={lbl}>
            <AdminFieldCaption>Risk mitigated</AdminFieldCaption>
            <input
              className="admin-pricing-readonly"
              style={readonlyInput}
              readOnly
              tabIndex={-1}
              value={`$${Math.round(derived.riskMitigatedBase).toLocaleString()}`}
            />
          </label>
          <label style={lbl}>
            <AdminFieldCaption>Strategic value</AdminFieldCaption>
            <select
              style={input}
              value={stratScore}
              title={strategicValueScoreSelectTitle()}
              onChange={(e) => setStratScore(e.target.value)}
            >
              {STRATEGIC_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label style={lbl}>
            <AdminFieldCaption>Strategic multiplier</AdminFieldCaption>
            <input
              className="admin-pricing-readonly"
              style={readonlyInput}
              readOnly
              tabIndex={-1}
              value={String(derived.strategicMultiplier)}
            />
          </label>
          <label style={lbl}>
            <AdminFieldCaption>
              {persistTarget === "package" && onPackageSellDiscountPctChange ? (
                <>
                  Modeled sell <span style={{ fontWeight: 500 }}>(before package discount)</span>
                </>
              ) : (
                "Sell price"
              )}
            </AdminFieldCaption>
            <input
              className="admin-pricing-readonly"
              style={readonlyInput}
              readOnly
              tabIndex={-1}
              title={
                persistTarget === "package" && onPackageSellDiscountPctChange
                  ? "Ceiling from the risk + strategic multipliers. Package sell discount % is applied separately (see below)."
                  : undefined
              }
              value={`$${Math.round(derived.sellPrice).toLocaleString()}`}
            />
          </label>
          {persistTarget === "package" && onPackageSellDiscountPctChange && !packageDiscountsReadOnly ? (
            <label
              style={{ ...lbl, gridColumn: "1 / -1" }}
              className="admin-pricing-package-discount-field admin-pricing-package-discount-field--net"
            >
              <AdminFieldCaption>
                Net sell <span style={{ fontWeight: 500 }}>(after package discount)</span>
              </AdminFieldCaption>
              <input
                className="admin-pricing-readonly"
                style={{ ...readonlyInput, fontWeight: 700, fontSize: "1.05em" }}
                readOnly
                tabIndex={-1}
                title="Modeled sell × (1 − sell price discount % ÷ 100). Updates as you type the discount."
                value={`$${Math.round(netSellAfterPackageDiscount).toLocaleString()}`}
              />
            </label>
          ) : null}
          {persistTarget === "package" && onPackageSellDiscountPctChange && !packageDiscountsReadOnly ? (
            <label style={{ ...lbl, gridColumn: "1 / -1" }} className="admin-pricing-package-discount-field">
              <AdminFieldCaption>Sell price discount %</AdminFieldCaption>
              <input
                style={input}
                inputMode="decimal"
                value={packageSellDiscountPct ?? ""}
                onChange={(e) => onPackageSellDiscountPctChange(e.target.value)}
                title="Applied after modeled sell price (package-level). Lower the net sell dollar amount above."
              />
            </label>
          ) : null}
        </div>
      </div>

      <div className="admin-pricing-section admin-pricing-section--extras">
        <div className="admin-form-stack" style={formGrid}>
          <label style={lbl}>
            <AdminFieldCaption>Old price</AdminFieldCaption>
            <input style={input} value={oldPrice} onChange={(e) => setOldPrice(e.target.value)} />
          </label>
          <label style={lbl}>
            <AdminFieldCaption>Percent change</AdminFieldCaption>
            <input
              className="admin-pricing-readonly"
              style={readonlyInput}
              readOnly
              tabIndex={-1}
              value={percentFromOld.display}
            />
          </label>
          <label style={{ ...lbl, flexDirection: "row", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={reqCustom} onChange={(e) => setReqCustom(e.target.checked)} />
            Requires customization
          </label>
          <label style={{ ...lbl, flexDirection: "row", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={taxable} onChange={(e) => setTaxable(e.target.checked)} />
            Taxable
          </label>
          <label style={{ ...lbl, gridColumn: "1 / -1" }}>
            <AdminFieldCaption>Notes</AdminFieldCaption>
            <textarea style={textarea} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <label style={{ ...lbl, gridColumn: "1 / -1" }}>
            <AdminFieldCaption>Tags</AdminFieldCaption>
            <input style={input} value={tags} onChange={(e) => setTags(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="admin-actions-row" style={{ marginTop: 14 }}>
        {persistTarget === "package" ? (
          <p className="admin-hint" style={{ ...muted, margin: 0, maxWidth: "56ch" }}>
            Pricing is included when you save the package (no separate pricing save to the vault).
          </p>
        ) : persistTarget === "draft" ? (
          <p className="admin-hint" style={{ ...muted, margin: 0, maxWidth: "56ch" }}>
            Pricing is included when you create the solution (no separate pricing save to the vault).
          </p>
        ) : (
          <>
            <button type="button" className="admin-btn-primary" style={btnPrimary} onClick={() => void save()}>
              Save pricing
            </button>
            <button type="button" style={btn} onClick={() => startNew()}>
              {subTab === "update" && editingTierId ? "Cancel edit" : "Clear form"}
            </button>
          </>
        )}
      </div>
        </>
      ) : null}
      </div>
    </section>
  );
}
