import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  ACCOUNT_MGMT_HOURS_ADDON_RATE,
  cloneTierPricingMathConfig,
  computeTierPricing,
  DEFAULT_TIER_PRICING_MATH_CONFIG,
  normalizeTierPricingMathConfig,
  saveTierPricingMathConfigToStorage,
  type TierPricingMathConfig,
} from "../lib/tierPricingMath";
import { STRATEGIC_VALUE_SCORE_NAMES } from "../lib/tierPricingMath";
import { TierPricingMathConfigEditorFields } from "./TierPricingMathConfigEditorFields";

function fmtUsd(n: number): string {
  const x = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.round(x));
}

function fmtUsdMaybeDecimals(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  const rounded = Math.round(n * 100) / 100;
  const hasFrac = Math.abs(rounded % 1) > 1e-9;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: hasFrac ? 2 : 0,
  }).format(rounded);
}

/** First row where S ≤ sumMax after sorting; explains which band the preview hit. */
function matchedRiskBandSentence(S: number, config: TierPricingMathConfig): string {
  const bands = [...config.riskBands].sort((a, b) => a.sumMax - b.sumMax);
  if (bands.length === 0) {
    return "No risk rows are configured; the multiplier stays at 1.";
  }
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    if (S <= b.sumMax) {
      const lo = i === 0 ? 0 : bands[i - 1].sumMax + 1;
      const hi = b.sumMax;
      if (lo >= hi) {
        return `Rows are checked in order of increasing “Sum max”. The first row where S is at most ${hi} applies (here S = ${S}).`;
      }
      return `Rows are checked in order of increasing “Sum max”. The first row where S is at most ${hi} applies — that is the band where S runs from ${lo} through ${hi} (your S is ${S}).`;
    }
  }
  const last = bands[bands.length - 1];
  return `S is above every cap; the last row is used (multiplier ${last.multiplier}).`;
}

type Props = {
  config: TierPricingMathConfig;
  onApply: (next: TierPricingMathConfig) => void;
  panel: CSSProperties;
  h2: CSSProperties;
  muted: CSSProperties;
  formGrid: CSSProperties;
  lbl: CSSProperties;
  input: CSSProperties;
  textarea: CSSProperties;
  btn: CSSProperties;
  btnPrimary: CSSProperties;
  setOpErr: (s: string | null) => void;
  setOpOk: (s: string | null) => void;
  /** When set, shows a control to rewrite every `solution_tier_pricing` row from stored hours/scores + current math. */
  onRecalculateAllSavedPricing?: () => void | Promise<void>;
  savedPricingRowCount?: number;
  recalculateAllSavedPricingBusy?: boolean;
};

export function PricingCalculatorPanel({
  config,
  onApply,
  panel,
  h2,
  muted,
  formGrid,
  lbl,
  input,
  textarea,
  btn,
  btnPrimary,
  setOpErr,
  setOpOk,
  onRecalculateAllSavedPricing,
  savedPricingRowCount = 0,
  recalculateAllSavedPricingBusy = false,
}: Props) {
  const [draft, setDraft] = useState<TierPricingMathConfig>(() => cloneTierPricingMathConfig(config));

  useEffect(() => {
    setDraft(cloneTierPricingMathConfig(config));
  }, [config]);

  const math = useMemo(() => normalizeTierPricingMathConfig(draft), [draft]);

  const preview = useMemo(
    () =>
      computeTierPricing(
        {
          hours: {
            client: 5,
            copy: 3,
            design: 2,
            web: 0,
            video: 0,
            data: 0,
            paidMedia: 0,
            hubspot: 0,
            other: 0,
          },
          scopeRisk: 1,
          internalCoordination: 1,
          clientRevisionRisk: 1,
          strategicValueScore: 1,
        },
        math
      ),
    [math]
  );

  const riskMatchSentence = useMemo(() => matchedRiskBandSentence(preview.riskScoreSum, math), [preview.riskScoreSum, math]);
  const rawSell = preview.riskMitigatedBase * preview.strategicMultiplier;
  const strategicName =
    STRATEGIC_VALUE_SCORE_NAMES[preview.strategicValueScore] ?? STRATEGIC_VALUE_SCORE_NAMES[0];

  const applySave = useCallback(() => {
    setOpErr(null);
    setOpOk(null);
    const next = normalizeTierPricingMathConfig(draft);
    saveTierPricingMathConfigToStorage(next);
    onApply(next);
    setOpOk(
      "Pricing calculator settings saved. Solutions Builder and bulk import previews now use these values." +
        (onRecalculateAllSavedPricing
          ? " Use “Update all saved pricing rows” below if Supabase should match this math too."
          : "")
    );
  }, [draft, onApply, onRecalculateAllSavedPricing, setOpErr, setOpOk]);

  const restoreDefaults = useCallback(() => {
    setOpErr(null);
    setOpOk(null);
    const next = normalizeTierPricingMathConfig(null);
    saveTierPricingMathConfigToStorage(next);
    onApply(next);
    setDraft(cloneTierPricingMathConfig(next));
    setOpOk("Restored default spreadsheet math and saved.");
  }, [onApply, setOpErr, setOpOk]);

  return (
    <section className="admin-panel admin-panel--editor" style={panel}>
      <h2 style={h2}>Pricing calculator</h2>
      <p className="admin-intro" style={muted}>
        These parameters drive <strong>live sell-price math</strong> in Solutions Builder (pricing sections) and in{" "}
        <strong>Bulk Import</strong> when derived pricing fields are filled in. Values are stored in this browser (
        <code>localStorage</code>) so each machine can keep its own test profile; align numbers before importing if
        your team needs one source of truth.
      </p>

      <div className="admin-pricing-calculator-summary">
        <p style={{ margin: 0 }}>
          <strong>Big picture.</strong> Resource hours get an automatic <strong>{ACCOUNT_MGMT_HOURS_ADDON_RATE * 100}%</strong>{" "}
          account-management add-on (billable hours), then you turn that into a labor dollar amount, grow it for{" "}
          <em>combined delivery risk</em>, grow it again for <em>strategic value</em>, then round the result{" "}
          <strong>up</strong> to the next multiple of your sell step (for example the next $100).
        </p>
        <div className="admin-pricing-calculator-pipeline" aria-hidden>
          <span className="admin-pricing-calculator-pipeline__box">resource hr</span>
          <span className="admin-pricing-calculator-pipeline__arrow">→</span>
          <span className="admin-pricing-calculator-pipeline__box">+ acct mgmt</span>
          <span className="admin-pricing-calculator-pipeline__arrow">→</span>
          <span className="admin-pricing-calculator-pipeline__box">× rate</span>
          <span className="admin-pricing-calculator-pipeline__arrow">→</span>
          <span className="admin-pricing-calculator-pipeline__box">× risk</span>
          <span className="admin-pricing-calculator-pipeline__arrow">→</span>
          <span className="admin-pricing-calculator-pipeline__box">× strategic</span>
          <span className="admin-pricing-calculator-pipeline__arrow">→</span>
          <span className="admin-pricing-calculator-pipeline__box">round up</span>
          <span className="admin-pricing-calculator-pipeline__arrow">→</span>
          <span className="admin-pricing-calculator-pipeline__box">sell price</span>
        </div>
      </div>

      <h3 style={{ ...h2, fontSize: "1rem", marginTop: "1.25rem" }}>Live example (follows your edits)</h3>
      <p style={{ ...muted, marginTop: 4, maxWidth: "68ch" }}>
        Sample tier: <strong>{preview.totalHours}</strong> resource hours (5 client + 3 copy + 2 design) →{" "}
        <strong>{preview.hoursForExpectedEffort.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>{" "}
        billable (includes {ACCOUNT_MGMT_HOURS_ADDON_RATE * 100}% account mgmt). Each risk score <strong>1</strong> (so{" "}
        <strong>S = 3</strong>), strategic score <strong>1</strong> <span>({STRATEGIC_VALUE_SCORE_NAMES[1]}).</span> The
        numbered steps use the same math as the app.
      </p>
      <div className="admin-pricing-calculator-walkthrough">
        <h4>Step by step with these numbers</h4>
        <ol>
          <li>
            <strong>1 — Expected effort</strong>
            <div>
              Add all hour buckets for <strong>resource hours</strong>. Account management is{" "}
              <strong>{ACCOUNT_MGMT_HOURS_ADDON_RATE * 100}%</strong> of that total (automatic), then multiply{" "}
              <strong>billable hours</strong> by <strong>${math.hourlyRate}</strong> per hour.
            </div>
            <div className="admin-pricing-details__formula">
              {preview.totalHours} +{" "}
              {preview.accountMgmtAddonHours.toLocaleString(undefined, {
                maximumFractionDigits: 2,
                minimumFractionDigits: 0,
              })}{" "}
              ({ACCOUNT_MGMT_HOURS_ADDON_RATE * 100}%) ={" "}
              {preview.hoursForExpectedEffort.toLocaleString(undefined, { maximumFractionDigits: 2 })} billable hr
            </div>
            <div className="admin-pricing-details__formula">
              {preview.hoursForExpectedEffort.toLocaleString(undefined, { maximumFractionDigits: 2 })} hr × $
              {math.hourlyRate}/hr = {fmtUsd(preview.expectedEffortBase)}
            </div>
          </li>
          <li>
            <strong>2 — Risk multiplier</strong>
            <div>
              <strong>S</strong> is scope risk + internal coordination + client revision (each clamped 0–2). Here:{" "}
              {preview.scopeRisk} + {preview.internalCoordination} + {preview.clientRevisionRisk} ={" "}
              <strong>{preview.riskScoreSum}</strong>. {riskMatchSentence}
            </div>
            <div className="admin-pricing-details__formula">
              {fmtUsd(preview.expectedEffortBase)} × {preview.riskMultiplier} = {fmtUsd(preview.riskMitigatedBase)}
            </div>
          </li>
          <li>
            <strong>3 — Strategic multiplier</strong>
            <div>
              Strategic value is a separate 0–2 score (Support / Revenue / Growth). It does <strong>not</strong> add into{" "}
              S; it applies after risk. Score <strong>{preview.strategicValueScore}</strong> ({strategicName}) uses
              multiplier <strong>{preview.strategicMultiplier}×</strong>.
            </div>
            <div className="admin-pricing-details__formula">
              {fmtUsd(preview.riskMitigatedBase)} × {preview.strategicMultiplier} = {fmtUsdMaybeDecimals(rawSell)}{" "}
              (before rounding)
            </div>
          </li>
          <li>
            <strong>4 — Sell price (rounded up)</strong>
            <div>
              The app rounds <em>up</em> to the next {fmtUsd(math.sellCeilingStep)} boundary (your “Sell round-up
              step”). Anything at or below zero becomes $0.
            </div>
            <div className="admin-pricing-details__formula">
              CEILING({fmtUsdMaybeDecimals(rawSell)}, {math.sellCeilingStep}) ={" "}
              <strong>{fmtUsd(preview.sellPrice)}</strong>
            </div>
          </li>
        </ol>
      </div>

      <TierPricingMathConfigEditorFields
        draft={draft}
        setDraft={setDraft}
        mathNormalized={math}
        formGrid={formGrid}
        lbl={lbl}
        input={input}
        muted={muted}
        h2={h2}
        firstSectionMarginTop="1.35rem"
      />

      <details style={{ marginTop: "1rem" }}>
        <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: "0.85rem" }}>
          Compact trace (same numbers as above)
        </summary>
        <textarea
          style={{
            ...textarea,
            marginTop: 8,
            maxWidth: 560,
            fontFamily: "ui-monospace, monospace",
            fontSize: "0.82rem",
          }}
          readOnly
          rows={9}
          value={[
            `Resource hours: ${preview.totalHours}`,
            `Account mgmt (+${ACCOUNT_MGMT_HOURS_ADDON_RATE * 100}%): ${preview.accountMgmtAddonHours.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
            `Billable hours: ${preview.hoursForExpectedEffort.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
            `Expected effort: ${fmtUsd(preview.expectedEffortBase)}`,
            `S = ${preview.riskScoreSum} → risk ×${preview.riskMultiplier}`,
            `Risk mitigated: ${fmtUsd(preview.riskMitigatedBase)}`,
            `Strategic (${preview.strategicValueScore}): ×${preview.strategicMultiplier}`,
            `Raw sell: ${fmtUsdMaybeDecimals(rawSell)}`,
            `Sell (rounded up): ${fmtUsd(preview.sellPrice)}`,
          ].join("\n")}
        />
      </details>

      <div className="admin-actions-row" style={{ marginTop: "1.1rem" }}>
        <button type="button" className="admin-btn-primary" style={btnPrimary} onClick={applySave}>
          Save &amp; apply
        </button>
        <button type="button" style={btn} onClick={restoreDefaults}>
          Restore defaults
        </button>
      </div>

      {onRecalculateAllSavedPricing ? (
        <div
          className="admin-pricing-calculator-db-sync"
          style={{
            marginTop: "1.25rem",
            padding: "0.85rem 1rem",
            borderRadius: 10,
            border: "1px solid rgba(226, 220, 211, 0.95)",
            background: "rgba(255, 255, 255, 0.55)",
            maxWidth: "min(68ch, 100%)",
          }}
        >
          <h3 style={{ ...h2, fontSize: "0.95rem", margin: "0 0 0.35rem" }}>Supabase: saved tier pricing</h3>
          <p style={{ ...muted, margin: "0 0 0.75rem", maxWidth: "62ch" }}>
            Each row’s <strong>hour buckets</strong> and <strong>risk / strategic scores</strong> stay as stored. Derived
            columns (<code style={{ fontSize: "0.85em" }}>total_hours</code> roll-up, expected effort, multipliers,{" "}
            <code style={{ fontSize: "0.85em" }}>sell_price</code>, <code style={{ fontSize: "0.85em" }}>percent_change</code>
            ) are recomputed with the <strong>current workspace math</strong> (this browser) and written back for every
            tier that differs. Use after changing rate, risk bands, rounding step, or deploying a new pricing formula.
          </p>
          <div className="admin-actions-row" style={{ marginTop: 0 }}>
            <button
              type="button"
              className="admin-btn-primary"
              style={btnPrimary}
              disabled={recalculateAllSavedPricingBusy || savedPricingRowCount === 0}
              onClick={() => void onRecalculateAllSavedPricing()}
            >
              {recalculateAllSavedPricingBusy ? "Updating…" : "Update all saved pricing rows"}
            </button>
            <span style={{ ...muted, fontSize: "0.82rem", alignSelf: "center" }}>
              {savedPricingRowCount} row{savedPricingRowCount === 1 ? "" : "s"} loaded
            </span>
          </div>
        </div>
      ) : null}

      <details style={{ marginTop: "1.25rem" }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Reference: default spreadsheet values</summary>
        <pre
          style={{
            ...muted,
            marginTop: 8,
            padding: "0.75rem 0.85rem",
            background: "rgba(13, 92, 77, 0.06)",
            borderRadius: 8,
            fontSize: "0.78rem",
            overflow: "auto",
            maxWidth: "min(100%, 40rem)",
          }}
        >
          {JSON.stringify(DEFAULT_TIER_PRICING_MATH_CONFIG, null, 2)}
        </pre>
      </details>
    </section>
  );
}
