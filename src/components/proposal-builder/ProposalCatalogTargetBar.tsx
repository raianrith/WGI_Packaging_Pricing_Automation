import { useMemo } from "react";
import type { RoadmapPhase, RoadmapScenario } from "../../lib/roadmapModel";
import { sortedPhasesForScenario } from "../../lib/roadmapModel";

type Props = {
  scenarios: RoadmapScenario[];
  phases: RoadmapPhase[];
  targetScenarioId: string;
  targetPhaseId: string;
  onTargetScenarioChange: (id: string) => void;
  onTargetPhaseChange: (id: string) => void;
  targetScenarioTitle: string;
  targetPhaseTitle: string;
  canAdd: boolean;
};

export function ProposalCatalogTargetBar({
  scenarios,
  phases,
  targetScenarioId,
  targetPhaseId,
  onTargetScenarioChange,
  onTargetPhaseChange,
  targetScenarioTitle,
  targetPhaseTitle,
  canAdd,
}: Props) {
  const targetPhases = useMemo(
    () => sortedPhasesForScenario(phases, targetScenarioId),
    [phases, targetScenarioId]
  );

  return (
    <section
      className={`proposal-catalog-target${canAdd ? " proposal-catalog-target--ready" : " proposal-catalog-target--blocked"}`}
      aria-label="Choose where new items are added"
    >
      <div className="proposal-catalog-target__row">
        <div className="proposal-catalog-target__summary">
          <div className="proposal-catalog-target__hero-badge" aria-hidden>
            +
          </div>
          <div className="proposal-catalog-target__hero-copy">
            <p className="proposal-catalog-target__eyebrow">Adding To</p>
            {canAdd ? (
              <p className="proposal-catalog-target__live" aria-live="polite">
                <span className="proposal-catalog-target__live-scenario">{targetScenarioTitle}</span>
                <span className="proposal-catalog-target__live-arrow" aria-hidden>
                  →
                </span>
                <span className="proposal-catalog-target__live-phase">{targetPhaseTitle}</span>
              </p>
            ) : (
              <p className="proposal-catalog-target__blocked-msg">
                Add a phase in <strong>Scenarios &amp; Phases</strong> first.
              </p>
            )}
          </div>
        </div>

        <div className="proposal-catalog-target__pickers">
          <div className="proposal-catalog-target__picker">
            <span className="proposal-catalog-target__picker-label">Scenario</span>
            <div className="proposal-catalog-target__pills" role="list">
              {scenarios.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="listitem"
                  className={`proposal-catalog-target__pill${targetScenarioId === s.id ? " is-active" : ""}`}
                  onClick={() => onTargetScenarioChange(s.id)}
                >
                  {s.title.trim() || "Untitled"}
                </button>
              ))}
            </div>
          </div>
          <div className="proposal-catalog-target__picker">
            <span className="proposal-catalog-target__picker-label">Phase</span>
            <div className="proposal-catalog-target__pills" role="list">
              {targetPhases.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="listitem"
                  className={`proposal-catalog-target__pill${targetPhaseId === p.id ? " is-active" : ""}`}
                  onClick={() => onTargetPhaseChange(p.id)}
                  disabled={!canAdd && targetPhases.length === 0}
                >
                  {p.title.trim() || "Phase"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
