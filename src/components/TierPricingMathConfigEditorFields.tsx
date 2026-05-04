import { useMemo, type CSSProperties, type Dispatch, type SetStateAction } from "react";
import {
  sortedRiskBandRanges,
  STRATEGIC_VALUE_SCORE_HINTS,
  STRATEGIC_VALUE_SCORE_NAMES,
  type TierPricingMathConfig,
  type TierPricingRiskBand,
} from "../lib/tierPricingMath";

export type TierPricingMathEditorFieldStyles = {
  formGrid: CSSProperties;
  lbl: CSSProperties;
  input: CSSProperties;
  muted: CSSProperties;
  h2: CSSProperties;
};

type Props = TierPricingMathEditorFieldStyles & {
  draft: TierPricingMathConfig;
  setDraft: Dispatch<SetStateAction<TierPricingMathConfig>>;
  /** `normalizeTierPricingMathConfig(draft)` from parent — drives the “S ranges” preview table. */
  mathNormalized: TierPricingMathConfig;
  /** Extra top margin on the first section heading (full calculator vs embedded). */
  firstSectionMarginTop?: string;
};

export function TierPricingMathConfigEditorFields({
  draft,
  setDraft,
  mathNormalized,
  formGrid,
  lbl,
  input,
  muted,
  h2,
  firstSectionMarginTop = "1.35rem",
}: Props) {
  const updateBand = (i: number, patch: Partial<TierPricingRiskBand>) => {
    setDraft((d) => {
      const riskBands = d.riskBands.map((b, j) => (j === i ? { ...b, ...patch } : b));
      return { ...d, riskBands };
    });
  };

  const riskRangeRows = useMemo(() => sortedRiskBandRanges(mathNormalized), [mathNormalized]);

  return (
    <>
      <h3 style={{ ...h2, fontSize: "1rem", marginTop: firstSectionMarginTop }}>Your parameters</h3>
      <div style={{ ...formGrid, marginTop: "0.65rem" }}>
        <label style={{ ...lbl, maxWidth: 320 }}>
          <span className="admin-field-caption">Hourly rate ($)</span>
          <input
            style={input}
            type="number"
            min={1}
            step={1}
            value={draft.hourlyRate}
            onChange={(e) =>
              setDraft((d) => ({ ...d, hourlyRate: Number(e.target.value) || d.hourlyRate }))
            }
          />
        </label>
      </div>

      <h3 style={{ ...h2, fontSize: "1rem", marginTop: "1.35rem" }}>Risk bands</h3>
      <p style={{ ...muted, marginTop: 4, maxWidth: "68ch" }}>
        Each row is a <strong>ceiling</strong> on <strong>S</strong> (the sum of the three risk scores). After save, rows
        are sorted by “Sum max” from smallest to largest. The engine walks that list and uses the{" "}
        <strong>first</strong> row where <strong>S ≤ Sum max</strong>.
      </p>
      <div className="admin-table-scroll" style={{ marginTop: 8 }}>
        <table className="admin-data-table" style={{ width: "100%", maxWidth: 520 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "0.45rem 0.5rem" }}>Sum max (S ≤ this)</th>
              <th style={{ textAlign: "left", padding: "0.45rem 0.5rem" }}>Risk multiplier</th>
            </tr>
          </thead>
          <tbody>
            {draft.riskBands.map((b, i) => (
              <tr key={i}>
                <td style={{ padding: "0.35rem 0.5rem" }}>
                  <input
                    style={input}
                    type="number"
                    step={1}
                    value={b.sumMax}
                    onChange={(e) => updateBand(i, { sumMax: Number(e.target.value) })}
                  />
                </td>
                <td style={{ padding: "0.35rem 0.5rem" }}>
                  <input
                    style={input}
                    type="number"
                    min={0.01}
                    step={0.05}
                    value={b.multiplier}
                    onChange={(e) => updateBand(i, { multiplier: Number(e.target.value) })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ ...muted, marginTop: "0.65rem", maxWidth: "68ch", fontSize: "0.78rem" }}>
        <strong>How this maps to S after sorting:</strong>
      </p>
      <div className="admin-table-scroll" style={{ marginTop: 4 }}>
        <table className="admin-pricing-details__table" style={{ maxWidth: 420 }}>
          <caption style={{ captionSide: "top", textAlign: "left", paddingBottom: "0.35rem" }}>
            Inclusive risk-sum ranges
          </caption>
          <thead>
            <tr>
              <th scope="col">If S is in this range</th>
              <th scope="col">Multiplier</th>
            </tr>
          </thead>
          <tbody>
            {riskRangeRows.map((row) => (
              <tr key={`${row.sRange}-${row.multiplier}`}>
                <td>{row.sRange}</td>
                <td>{row.multiplier}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 style={{ ...h2, fontSize: "1rem", marginTop: "1.35rem" }}>Strategic value multipliers</h3>
      <p style={{ ...muted, marginTop: 4, maxWidth: "68ch" }}>
        Same meanings as tier <strong>Strategic value</strong> (hover a caption for the short definition).
      </p>
      <div style={{ ...formGrid, marginTop: 8 }}>
        {([0, 1, 2] as const).map((idx) => (
          <label key={idx} style={lbl} title={STRATEGIC_VALUE_SCORE_HINTS[idx]}>
            <span className="admin-field-caption">
              Score {idx} — {STRATEGIC_VALUE_SCORE_NAMES[idx]}
            </span>
            <input
              style={input}
              type="number"
              min={0.01}
              step={0.05}
              value={draft.strategicMultipliers[idx]}
              onChange={(e) => {
                const v = Number(e.target.value);
                setDraft((d) => {
                  const next = [...d.strategicMultipliers] as [number, number, number];
                  next[idx] = Number.isFinite(v) ? v : next[idx];
                  return { ...d, strategicMultipliers: next };
                });
              }}
            />
          </label>
        ))}
      </div>
    </>
  );
}
