import {
  useCallback,
  useEffect,
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
  computeTierPricing,
  scoreToString,
  clampScore012,
  TIER_PRICING_HOURLY_RATE,
} from "../lib/tierPricingMath";
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

function AdminFieldCaption({ children }: { children: ReactNode }) {
  return <span className="admin-field-caption">{children}</span>;
}

const SCORE012: { value: string; label: string }[] = [
  { value: "0", label: "0" },
  { value: "1", label: "1" },
  { value: "2", label: "2" },
];

const STRATEGIC_OPTIONS: { value: string; label: string }[] = [
  { value: "0", label: "0 — Support" },
  { value: "1", label: "1 — Revenue" },
  { value: "2", label: "2 — Growth" },
];

function PricingCalcDetails() {
  return (
    <details className="admin-pricing-details">
      <summary>How pricing is calculated</summary>
      <div className="admin-pricing-details__body">
        <p className="admin-pricing-details__lead">
          Numbers below mirror the spreadsheet logic: effort from hours, then risk, then strategic uplift, then
          rounding to the nearest hundred dollars up.
        </p>

        <h4 className="admin-pricing-details__subtitle">Fields vs math</h4>
        <p>
          The large <strong>Scope</strong> text box under <em>Tier &amp; scope</em> is documentation only — what is
          included, boundaries, assumptions. It is <strong>not</strong> used in the formula. What <em>does</em> feed
          pricing is the separate <strong>Scope risk</strong> score (0–2) in the sell section, together with{" "}
          <strong>Internal coordination</strong> and <strong>Client revision risk</strong>.
        </p>

        <h4 className="admin-pricing-details__subtitle">What the three risk scores mean</h4>
        <ul className="admin-pricing-details__list">
          <li>
            <strong>Scope risk (0–2)</strong> — How heavy or ambiguous the delivery boundary feels: unknowns,
            breadth of work, dependency on things outside your control, or scope-creep exposure. Higher scores mean
            more buffer in the multiplier chain (same spreadsheet bands as “scope” in the risk sum).
          </li>
          <li>
            <strong>Internal coordination (0–2)</strong> — How much orchestration you expect inside your team:
            handoffs, parallel tracks, seats, tooling, or stakeholders to align before the client sees output. The
            form tooltip describes this as seats and orchestration; 0 is lightest, 2 is heaviest.
          </li>
          <li>
            <strong>Client revision risk (0–2)</strong> — How likely the client is to iterate, rework, or expand
            feedback cycles after delivery milestones.
          </li>
        </ul>
        <p>
          Each score is clamped to 0, 1, or 2. They are <strong>added</strong> (not averaged). That sum drives the
          risk multiplier in the table below.
        </p>

        <h4 className="admin-pricing-details__subtitle">Step 1 — Effort (hours)</h4>
        <p>
          <strong>Total hours</strong> is the sum of all nine hour buckets (client, copy, design, web, video, data,
          paid media, HubSpot, other).
        </p>
        <p className="admin-pricing-details__formula">
          Expected effort = total hours × ${TIER_PRICING_HOURLY_RATE}/hr
        </p>

        <h4 className="admin-pricing-details__subtitle">Step 2 — Risk multiplier</h4>
        <p>
          Let <strong>S</strong> = scope risk + internal coordination + client revision (each 0–2, so{" "}
          <strong>S</strong> is 0–6).
        </p>
        <table className="admin-pricing-details__table">
          <caption>Risk sum → multiplier</caption>
          <thead>
            <tr>
              <th scope="col">Sum of three scores (S)</th>
              <th scope="col">Risk multiplier</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>0</td>
              <td>1.0</td>
            </tr>
            <tr>
              <td>1–2</td>
              <td>1.1</td>
            </tr>
            <tr>
              <td>3–4</td>
              <td>1.2</td>
            </tr>
            <tr>
              <td>5–6</td>
              <td>1.3</td>
            </tr>
          </tbody>
        </table>
        <p className="admin-pricing-details__formula">
          Risk mitigated = expected effort × risk multiplier
        </p>

        <h4 className="admin-pricing-details__subtitle">Step 3 — Strategic multiplier</h4>
        <p>
          <strong>Strategic value</strong> is a second 0–2 score (Support / Revenue / Growth in the dropdown). It does
          not add to <strong>S</strong>; it applies after risk.
        </p>
        <table className="admin-pricing-details__table">
          <caption>Strategic score → multiplier</caption>
          <thead>
            <tr>
              <th scope="col">Strategic value</th>
              <th scope="col">Multiplier</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>0</td>
              <td>1.0</td>
            </tr>
            <tr>
              <td>1</td>
              <td>1.1</td>
            </tr>
            <tr>
              <td>2</td>
              <td>1.2</td>
            </tr>
          </tbody>
        </table>

        <h4 className="admin-pricing-details__subtitle">Step 4 — Sell price</h4>
        <p className="admin-pricing-details__formula">
          Raw sell = risk mitigated × strategic multiplier
        </p>
        <p>
          <strong>Sell price</strong> is <code>CEILING(raw sell, 100)</code>: round <em>up</em> to the nearest $100.
          If the raw amount is zero or invalid, the shown sell rounds to 0.
        </p>
      </div>
    </details>
  );
}

type Props = {
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
};

export function PricingPanel({
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
}: Props) {
  const [tierPick, setTierPick] = useState("");
  const [solutionLabel, setSolutionLabel] = useState("");
  const [tierLabel, setTierLabel] = useState("");
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
      computeTierPricing({
        hours: hourBreakdown,
        scopeRisk: Number(scopeRisk),
        internalCoordination: Number(internalCoord),
        clientRevisionRisk: Number(clientRev),
        strategicValueScore: Number(stratScore),
      }),
    [hourBreakdown, scopeRisk, internalCoord, clientRev, stratScore]
  );

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
      setSolutionLabel("");
      setTierLabel("");
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
    setSolutionLabel(r.solution_label ?? "");
    setTierLabel(r.tier ?? "");
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
    subTab,
    updateAutoLoadTierId,
    pricing,
    editingTierId,
    loadRow,
    startNew,
    tierScopeSet,
  ]);

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
    return {
      solution_tier_id: tierPick.trim(),
      solution_label: solutionLabel.trim() || null,
      tier: tierLabel.trim() || null,
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
        {subTab === "create" ? (
          <>
            Add or replace a row — saves upsert on <code style={{ fontSize: "0.85em" }}>solution_tier_id</code>.
            Dollar amounts in the last section update automatically; open <em>How pricing is calculated</em> when you
            need the rules.
          </>
        ) : updateAutoLoadTierId ? (
          <>
            The tier selected in <strong>Tasks &amp; pricing (pick tier)</strong> above is loaded here automatically.
            Still upsert on <code style={{ fontSize: "0.85em" }}>solution_tier_id</code>. Open{" "}
            <em>How pricing is calculated</em> for the sell formula.
          </>
        ) : (
          <>
            Load a row from the table to edit, or pick a tier below — upsert on{" "}
            <code style={{ fontSize: "0.85em" }}>solution_tier_id</code>. Dollar amounts in the last section update
            automatically; open <em>How pricing is calculated</em> when you need the rules.
          </>
        )}
      </p>

      {subTab === "update" && (
        <>
          <div className="admin-table-scroll">
          <table className="admin-data-table" style={{ ...tbl, marginTop: 8 }}>
            <thead>
              <tr>
                <th style={th}>Tier id</th>
                <th style={th}>Label</th>
                <th style={th}>Sell</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {sortedPricing.map((r) => (
                <tr key={r.solution_tier_id}>
                  <td style={td}>{r.solution_tier_id}</td>
                  <td style={td}>{r.solution_label ?? "—"}</td>
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
              Editing <code style={{ fontSize: "0.9em" }}>{editingTierId}</code>
            </h3>
          ) : null}

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
          <label style={lbl}>
            <AdminFieldCaption>Solution label</AdminFieldCaption>
            <input
              style={input}
              value={solutionLabel}
              onChange={(e) => setSolutionLabel(e.target.value)}
              placeholder="e.g. Customer Interviews (Up to 5)"
            />
          </label>
          <label style={lbl}>
            <AdminFieldCaption>Tier label</AdminFieldCaption>
            <input
              style={input}
              value={tierLabel}
              onChange={(e) => setTierLabel(e.target.value)}
              placeholder="Basic, Standard…"
            />
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
              ["Client services", hCs, setHCs],
              ["Copy", hCp, setHCp],
              ["Design", hDs, setHDs],
              ["Web dev", hWd, setHWd],
              ["Video", hVi, setHVi],
              ["Data", hDa, setHDa],
              ["Paid media", hPm, setHPm],
              ["HubSpot", hHb, setHHb],
              ["Other", hOt, setHOt],
            ] as const
          ).map(([lab, val, set]) => (
            <label key={lab} style={lbl}>
              <AdminFieldCaption>{lab}</AdminFieldCaption>
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
            <AdminFieldCaption>Total hours</AdminFieldCaption>
            <input
              className="admin-pricing-readonly"
              style={readonlyInput}
              readOnly
              tabIndex={-1}
              value={
                Number.isFinite(derived.totalHours)
                  ? derived.totalHours.toLocaleString(undefined, {
                      maximumFractionDigits: 2,
                      minimumFractionDigits: 0,
                    })
                  : "0"
              }
            />
          </label>
        </div>
      </div>

      <div className="admin-pricing-section">
        <h3 className="admin-pricing-section__title">Sell calculation</h3>
        <PricingCalcDetails />
        <div className="admin-form-stack" style={formGrid}>
          <label style={lbl}>
            <AdminFieldCaption>Expected effort</AdminFieldCaption>
            <input
              className="admin-pricing-readonly"
              style={readonlyInput}
              readOnly
              tabIndex={-1}
              value={`$${Math.round(derived.expectedEffortBase).toLocaleString()}`}
            />
          </label>
          <label style={lbl}>
            <AdminFieldCaption>Scope risk</AdminFieldCaption>
            <select
              style={input}
              value={scopeRisk}
              onChange={(e) => setScopeRisk(e.target.value)}
              title="Execution predictability (0 = lowest risk)"
            >
              {SCORE012.map((o) => (
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
              title="Seats & orchestration (0 = lightest)"
            >
              {SCORE012.map((o) => (
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
              title="Rework / iteration likelihood (0 = lowest)"
            >
              {SCORE012.map((o) => (
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
            <select style={input} value={stratScore} onChange={(e) => setStratScore(e.target.value)}>
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
            <AdminFieldCaption>Sell price</AdminFieldCaption>
            <input
              className="admin-pricing-readonly"
              style={readonlyInput}
              readOnly
              tabIndex={-1}
              value={`$${Math.round(derived.sellPrice).toLocaleString()}`}
            />
          </label>
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
        <button type="button" className="admin-btn-primary" style={btnPrimary} onClick={() => void save()}>
          Save pricing
        </button>
        <button type="button" style={btn} onClick={() => startNew()}>
          {subTab === "update" && editingTierId ? "Cancel edit" : "Clear form"}
        </button>
      </div>
        </>
      ) : null}
      </div>
    </section>
  );
}
