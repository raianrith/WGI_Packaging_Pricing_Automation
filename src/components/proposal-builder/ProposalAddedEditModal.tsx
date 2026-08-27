import { useEffect, useMemo, useState } from "react";
import type { RoadmapCard, RoadmapLineScope, RoadmapPhase } from "../../lib/roadmapModel";
import { normalizeIsoDateInput } from "../../lib/proposalDates";
import {
  computePaidAdsOptimizationUsd,
  isPaidAdsVariableTierRefId,
  isTravelVariableTierRefId,
  paidAdsOptimizationFormulaLabel,
} from "../../lib/proposalVariableTiers";

const SCOPES: { id: RoadmapLineScope; label: string }[] = [
  { id: "included", label: "Included" },
  { id: "optional", label: "Optional" },
  { id: "deferred", label: "Deferred" },
];

export type ProposalAddedEditPatch = Partial<
  Pick<
    RoadmapCard,
    | "headline"
    | "scope"
    | "phaseId"
    | "startDate"
    | "endDate"
    | "variableTravelHours"
    | "variablePaidAdsSpendUsd"
  >
>;

type Props = {
  card: RoadmapCard;
  phaseChoices: RoadmapPhase[];
  formatUsd: (n: number | null | undefined) => string;
  /** Vault package tiers currently linked to this package card. */
  packageComponents?: Array<{ id: string; name: string }>;
  onEditPackageComponents?: () => void;
  onClose: () => void;
  onSave: (key: string, patch: ProposalAddedEditPatch) => void;
};

export function ProposalAddedEditModal({
  card,
  phaseChoices,
  formatUsd,
  packageComponents,
  onEditPackageComponents,
  onClose,
  onSave,
}: Props) {
  const [headline, setHeadline] = useState(card.headline);
  const [scope, setScope] = useState<RoadmapLineScope>(card.scope);
  const [phaseId, setPhaseId] = useState(card.phaseId);
  const [startDate, setStartDate] = useState(normalizeIsoDateInput(card.startDate));
  const [endDate, setEndDate] = useState(normalizeIsoDateInput(card.endDate));
  const [travelHours, setTravelHours] = useState(
    card.variableTravelHours != null && Number.isFinite(card.variableTravelHours)
      ? String(card.variableTravelHours)
      : ""
  );
  const [paidAdsSpend, setPaidAdsSpend] = useState(
    card.variablePaidAdsSpendUsd != null && Number.isFinite(card.variablePaidAdsSpendUsd)
      ? String(card.variablePaidAdsSpendUsd)
      : ""
  );

  const isTravel = isTravelVariableTierRefId(card.refId);
  const isPaidAds = isPaidAdsVariableTierRefId(card.refId);

  useEffect(() => {
    setHeadline(card.headline);
    setScope(card.scope);
    setPhaseId(card.phaseId);
    setStartDate(normalizeIsoDateInput(card.startDate));
    setEndDate(normalizeIsoDateInput(card.endDate));
    setTravelHours(
      card.variableTravelHours != null && Number.isFinite(card.variableTravelHours)
        ? String(card.variableTravelHours)
        : ""
    );
    setPaidAdsSpend(
      card.variablePaidAdsSpendUsd != null && Number.isFinite(card.variablePaidAdsSpendUsd)
        ? String(card.variablePaidAdsSpendUsd)
        : ""
    );
  }, [card]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const paidAdsPreview = useMemo(() => {
    if (!isPaidAds) return null;
    const spend = Number(String(paidAdsSpend).trim().replace(/[$,\s]/g, ""));
    if (!Number.isFinite(spend) || spend <= 0) return null;
    const sell = computePaidAdsOptimizationUsd(spend);
    if (sell == null) return null;
    return { spend, sell, formula: paidAdsOptimizationFormulaLabel(spend) };
  }, [isPaidAds, paidAdsSpend]);

  const canSave = headline.trim().length > 0 && Boolean(phaseId);

  const handleSave = () => {
    if (!canSave) return;
    const patch: ProposalAddedEditPatch = {
      headline: headline.trim(),
      scope,
      phaseId,
      startDate: normalizeIsoDateInput(startDate) || null,
      endDate: normalizeIsoDateInput(endDate) || null,
    };
    if (isTravel) {
      const h = Number(travelHours.trim());
      patch.variableTravelHours = Number.isFinite(h) && h > 0 ? h : null;
    }
    if (isPaidAds) {
      const spend = Number(String(paidAdsSpend).trim().replace(/[$,\s]/g, ""));
      patch.variablePaidAdsSpendUsd = Number.isFinite(spend) && spend > 0 ? spend : null;
    }
    onSave(card.key, patch);
  };

  return (
    <div className="roadmap-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="roadmap-modal proposal-added-edit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="proposal-added-edit-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="proposal-added-edit-modal__head">
          <div>
            <p className="proposal-added-edit-modal__eyebrow">
              {card.kind === "package" ? "Edit package" : "Edit solution"}
            </p>
            <h2 id="proposal-added-edit-title" className="proposal-added-edit-modal__title">
              {card.headline.trim() || "Untitled"}
            </h2>
          </div>
          <button
            type="button"
            className="proposal-added-edit-modal__close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="proposal-added-edit-modal__body">
          <label className="roadmap-field">
            <span className="roadmap-field__cap">Display name</span>
            <input
              className="roadmap-input"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              autoFocus
            />
          </label>

          <div className="proposal-added-edit-modal__row">
            <label className="roadmap-field">
              <span className="roadmap-field__cap">Scope</span>
              <select
                className="roadmap-input roadmap-select"
                value={scope}
                onChange={(e) => setScope(e.target.value as RoadmapLineScope)}
              >
                {SCOPES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="roadmap-field">
              <span className="roadmap-field__cap">Phase</span>
              <select
                className="roadmap-input roadmap-select"
                value={phaseId}
                onChange={(e) => setPhaseId(e.target.value)}
              >
                {phaseChoices.map((ph) => (
                  <option key={ph.id} value={ph.id}>
                    {ph.title.trim() || "Phase"}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="proposal-added-edit-modal__row">
            <label className="roadmap-field">
              <span className="roadmap-field__cap">Start date</span>
              <input
                type="date"
                className="roadmap-input"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label className="roadmap-field">
              <span className="roadmap-field__cap">End date</span>
              <input
                type="date"
                className="roadmap-input"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
          </div>

          {card.kind === "package" ? (
            <div className="proposal-added-edit-modal__components">
              <div className="proposal-added-edit-modal__components-head">
                <span className="roadmap-field__cap">Package components</span>
                {onEditPackageComponents ? (
                  <button
                    type="button"
                    className="roadmap-btn roadmap-btn--ghost roadmap-btn--sm"
                    onClick={onEditPackageComponents}
                  >
                    Edit components
                  </button>
                ) : null}
              </div>
              {packageComponents && packageComponents.length > 0 ? (
                <ul className="proposal-added-edit-modal__components-list">
                  {packageComponents.map((c) => (
                    <li key={c.id}>
                      <span className="proposal-added-edit-modal__components-id">{c.id}</span>
                      <span>{c.name}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="proposal-added-edit-modal__hint">No solutions linked to this package yet.</p>
              )}
              {onEditPackageComponents ? (
                <p className="proposal-added-edit-modal__hint">
                  Edit components to add or remove solutions in this package. Hours and price update after you
                  save.
                </p>
              ) : null}
            </div>
          ) : null}

          {isTravel ? (
            <label className="roadmap-field">
              <span className="roadmap-field__cap">Travel hours</span>
              <input
                type="number"
                min={0.25}
                step={0.25}
                className="roadmap-input"
                value={travelHours}
                onChange={(e) => setTravelHours(e.target.value)}
              />
            </label>
          ) : null}

          {isPaidAds ? (
            <div className="proposal-added-edit-modal__paid-ads">
              <label className="roadmap-field">
                <span className="roadmap-field__cap">Monthly paid ads spend</span>
                <input
                  type="number"
                  min={1}
                  step={100}
                  className="roadmap-input"
                  value={paidAdsSpend}
                  onChange={(e) => setPaidAdsSpend(e.target.value)}
                />
              </label>
              <p className="proposal-added-edit-modal__hint" role="status">
                {paidAdsPreview
                  ? `Estimated sell ${formatUsd(paidAdsPreview.sell)}${
                      paidAdsPreview.formula ? ` · ${paidAdsPreview.formula}` : ""
                    }`
                  : "Enter spend to preview sell price"}
              </p>
            </div>
          ) : null}
        </div>

        <footer className="roadmap-modal__actions">
          <button type="button" className="roadmap-btn roadmap-btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="roadmap-btn roadmap-btn--primary"
            disabled={!canSave}
            onClick={handleSave}
          >
            Save changes
          </button>
        </footer>
      </div>
    </div>
  );
}
