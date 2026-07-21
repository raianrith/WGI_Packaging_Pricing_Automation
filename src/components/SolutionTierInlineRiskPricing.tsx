import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SolutionTierPricing } from "../types";
import type { AuditAction, EntityType } from "../lib/audit";
import { percentChangeFromSellAndOld } from "../lib/pricingPercentChange";
import {
  buildSolutionTierPricingMathUpdate,
  hourBreakdownFromPricingRow,
} from "../lib/recomputeStoredTierPricing";
import {
  CLIENT_REVISION_RISK_SCORE_HINTS,
  INTERNAL_COORDINATION_SCORE_HINTS,
  SCOPE_RISK_SCORE_HINTS,
  clampScore012,
  computeTierPricing,
  riskScore012Options,
  riskScore012SelectTitle,
  strategicValueScoreSelectTitle,
  strategicValueScoreUiLabel,
  type RiskStrategicScore,
  type TierPricingMathConfig,
} from "../lib/tierPricingMath";
import { friendlyMutationMessage } from "../lib/supabaseErrors";

type LogAudit = (
  client: SupabaseClient,
  p: {
    entityType: EntityType;
    entityId: string;
    action: AuditAction;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  }
) => Promise<void>;

type Props = {
  tierId: string;
  tierName: string;
  pricingRow: SolutionTierPricing | null;
  mathConfig: TierPricingMathConfig;
  client: SupabaseClient | null;
  logAudit: LogAudit;
  onSaved: () => Promise<void>;
  onError: (msg: string) => void;
  onOk: (msg: string) => void;
  onClose: () => void;
};

const SCOPE_OPTIONS = riskScore012Options(SCOPE_RISK_SCORE_HINTS);
const INTERNAL_OPTIONS = riskScore012Options(INTERNAL_COORDINATION_SCORE_HINTS);
const CLIENT_OPTIONS = riskScore012Options(CLIENT_REVISION_RISK_SCORE_HINTS);
const STRATEGIC_OPTIONS = ([0, 1, 2] as const).map((s) => ({
  value: String(s),
  label: strategicValueScoreUiLabel(s),
}));

function formatUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(n));
}

export function SolutionTierInlineRiskPricing({
  tierId,
  tierName,
  pricingRow,
  mathConfig,
  client,
  logAudit,
  onSaved,
  onError,
  onOk,
  onClose,
}: Props) {
  const [scopeRisk, setScopeRisk] = useState<RiskStrategicScore>(0);
  const [internalCoord, setInternalCoord] = useState<RiskStrategicScore>(0);
  const [clientRev, setClientRev] = useState<RiskStrategicScore>(0);
  const [stratScore, setStratScore] = useState<RiskStrategicScore>(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setScopeRisk(clampScore012(pricingRow?.scope_risk));
    setInternalCoord(clampScore012(pricingRow?.internal_coordination));
    setClientRev(clampScore012(pricingRow?.client_revision_risk));
    setStratScore(clampScore012(pricingRow?.strategic_value_score));
  }, [pricingRow, tierId]);

  const derived = useMemo(() => {
    if (!pricingRow) return null;
    return computeTierPricing(
      {
        hours: hourBreakdownFromPricingRow(pricingRow),
        scopeRisk,
        internalCoordination: internalCoord,
        clientRevisionRisk: clientRev,
        strategicValueScore: stratScore,
      },
      mathConfig
    );
  }, [pricingRow, scopeRisk, internalCoord, clientRev, stratScore, mathConfig]);

  const dirty = useMemo(() => {
    if (!pricingRow || !derived) return false;
    return (
      clampScore012(pricingRow.scope_risk) !== scopeRisk ||
      clampScore012(pricingRow.internal_coordination) !== internalCoord ||
      clampScore012(pricingRow.client_revision_risk) !== clientRev ||
      clampScore012(pricingRow.strategic_value_score) !== stratScore
    );
  }, [pricingRow, scopeRisk, internalCoord, clientRev, stratScore, derived]);

  const confirm = async () => {
    if (!client || !pricingRow || !derived) return;
    setSaving(true);
    onError("");
    try {
      const nextRow: SolutionTierPricing = {
        ...pricingRow,
        scope_risk: scopeRisk,
        internal_coordination: internalCoord,
        client_revision_risk: clientRev,
        strategic_value_score: stratScore,
      };
      const mathUpdate = buildSolutionTierPricingMathUpdate(nextRow, mathConfig);
      const oldStr =
        pricingRow.old_price != null && Number.isFinite(pricingRow.old_price) && pricingRow.old_price > 0
          ? String(pricingRow.old_price)
          : "";
      const pc = percentChangeFromSellAndOld(mathUpdate.sell_price, oldStr);
      const payload = {
        ...mathUpdate,
        percent_change: pc.forDb,
      };
      const { error } = await client
        .from("solution_tier_pricing")
        .upsert(payload, { onConflict: "solution_tier_id" });
      if (error) throw error;
      await logAudit(client, {
        action: "update",
        entityType: "solution_tier_pricing",
        entityId: tierId,
        before: {
          scope_risk: pricingRow.scope_risk,
          internal_coordination: pricingRow.internal_coordination,
          client_revision_risk: pricingRow.client_revision_risk,
          strategic_value_score: pricingRow.strategic_value_score,
          sell_price: pricingRow.sell_price,
        },
        after: {
          scope_risk: payload.scope_risk,
          internal_coordination: payload.internal_coordination,
          client_revision_risk: payload.client_revision_risk,
          strategic_value_score: payload.strategic_value_score,
          sell_price: payload.sell_price,
        },
      });
      await onSaved();
      onOk(`Updated pricing for ${tierName}: sell ${formatUsd(payload.sell_price)}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not update pricing.";
      onError(friendlyMutationMessage(msg));
    } finally {
      setSaving(false);
    }
  };

  if (!pricingRow) {
    return (
      <div className="admin-sb-inline-pricing admin-sb-inline-pricing--empty">
        <div className="admin-sb-inline-pricing__head">
          <p className="admin-sb-inline-pricing__title">Risk &amp; strategic pricing</p>
          <button type="button" className="admin-sb-inline-pricing__close" onClick={onClose} aria-label="Close pricing">
            ×
          </button>
        </div>
        <p className="admin-sb-inline-pricing__empty">
          No pricing row yet for this tier. Open <strong>Update</strong> to set hours first, then you can adjust
          risk and strategic scores here.
        </p>
      </div>
    );
  }

  return (
    <div className="admin-sb-inline-pricing">
      <div className="admin-sb-inline-pricing__head">
        <div>
          <p className="admin-sb-inline-pricing__title">Risk &amp; strategic pricing</p>
          <p className="admin-sb-inline-pricing__subtitle">{tierName}</p>
        </div>
        <button type="button" className="admin-sb-inline-pricing__close" onClick={onClose} aria-label="Close pricing">
          ×
        </button>
      </div>
      <div className="admin-sb-inline-pricing__grid">
        <label className="admin-sb-inline-pricing__field">
          <span className="admin-sb-inline-pricing__label">Scope risk</span>
          <select
            className="admin-sb-inline-pricing__select"
            title={riskScore012SelectTitle(SCOPE_RISK_SCORE_HINTS)}
            value={String(scopeRisk)}
            onChange={(e) => setScopeRisk(clampScore012(Number(e.target.value)))}
          >
            {SCOPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-sb-inline-pricing__field">
          <span className="admin-sb-inline-pricing__label">Internal coordination</span>
          <select
            className="admin-sb-inline-pricing__select"
            title={riskScore012SelectTitle(INTERNAL_COORDINATION_SCORE_HINTS)}
            value={String(internalCoord)}
            onChange={(e) => setInternalCoord(clampScore012(Number(e.target.value)))}
          >
            {INTERNAL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-sb-inline-pricing__field">
          <span className="admin-sb-inline-pricing__label">Client revision risk</span>
          <select
            className="admin-sb-inline-pricing__select"
            title={riskScore012SelectTitle(CLIENT_REVISION_RISK_SCORE_HINTS)}
            value={String(clientRev)}
            onChange={(e) => setClientRev(clampScore012(Number(e.target.value)))}
          >
            {CLIENT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-sb-inline-pricing__field">
          <span className="admin-sb-inline-pricing__label">Strategic value</span>
          <select
            className="admin-sb-inline-pricing__select"
            title={strategicValueScoreSelectTitle()}
            value={String(stratScore)}
            onChange={(e) => setStratScore(clampScore012(Number(e.target.value)))}
          >
            {STRATEGIC_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="admin-sb-inline-pricing__summary" aria-live="polite">
        <div className="admin-sb-inline-pricing__stat">
          <span className="admin-sb-inline-pricing__stat-label">Expected effort</span>
          <strong>{formatUsd(derived?.expectedEffortBase)}</strong>
        </div>
        <div className="admin-sb-inline-pricing__stat">
          <span className="admin-sb-inline-pricing__stat-label">Risk multiplier</span>
          <strong>
            {derived
              ? `${derived.riskMultiplier} (scores sum ${derived.scopeRisk + derived.internalCoordination + derived.clientRevisionRisk})`
              : "—"}
          </strong>
        </div>
        <div className="admin-sb-inline-pricing__stat">
          <span className="admin-sb-inline-pricing__stat-label">Risk mitigated</span>
          <strong>{formatUsd(derived?.riskMitigatedBase)}</strong>
        </div>
        <div className="admin-sb-inline-pricing__stat">
          <span className="admin-sb-inline-pricing__stat-label">Strategic multiplier</span>
          <strong>{derived?.strategicMultiplier ?? "—"}</strong>
        </div>
        <div className="admin-sb-inline-pricing__stat admin-sb-inline-pricing__stat--sell">
          <span className="admin-sb-inline-pricing__stat-label">Sell price</span>
          <strong>{formatUsd(derived?.sellPrice)}</strong>
        </div>
      </div>

      <div className="admin-sb-inline-pricing__actions">
        <button
          type="button"
          className="admin-btn-primary"
          disabled={!dirty || saving || !client}
          onClick={() => void confirm()}
        >
          {saving ? "Saving…" : "Confirm"}
        </button>
        {!dirty ? (
          <span className="admin-sb-inline-pricing__hint">Change a score to update sell price, then confirm.</span>
        ) : (
          <span className="admin-sb-inline-pricing__hint admin-sb-inline-pricing__hint--dirty">
            Unsaved score changes — sell price preview updates live.
          </span>
        )}
      </div>
    </div>
  );
}
