import type { RoadmapCard, RoadmapPhase, RoadmapScenario } from "../../lib/roadmapModel";
import { sortedPhasesForScenario } from "../../lib/roadmapModel";

type Props = {
  scenarios: RoadmapScenario[];
  phases: RoadmapPhase[];
  cards: RoadmapCard[];
  onUpdateScenarioTitle: (scenarioId: string, title: string) => void;
  onUpdatePhaseTitle: (phaseId: string, title: string) => void;
  onAddScenario: () => void;
  onDuplicateScenario: (scenarioId: string) => void;
  onDeleteScenario: (scenarioId: string) => void;
  onAddPhase: (scenarioId: string) => void;
  onDeletePhase: (phaseId: string) => void;
};

export function ProposalScenariosPanel({
  scenarios,
  phases,
  cards,
  onUpdateScenarioTitle,
  onUpdatePhaseTitle,
  onAddScenario,
  onDuplicateScenario,
  onDeleteScenario,
  onAddPhase,
  onDeletePhase,
}: Props) {
  return (
    <div className="proposal-step-panel">
      <header className="proposal-step-panel__head">
        <h2 className="proposal-step-panel__title">Scenarios &amp; Phases</h2>
        <p className="proposal-step-panel__lead">
          Add as many what-if scenarios as you need, name each one, and define the phases inside it (for example Phase 1
          discovery, Phase 2 build). You can still adjust phases later in Organize.
        </p>
      </header>

      <p className="proposal-scenarios-summary" aria-live="polite">
        <strong>{scenarios.length}</strong> scenario{scenarios.length === 1 ? "" : "s"} ·{" "}
        <strong>{phases.length}</strong> phase{phases.length === 1 ? "" : "s"} total
      </p>

      <ul className="proposal-scenario-list">
        {scenarios.map((s, i) => {
          const scenarioPhases = sortedPhasesForScenario(phases, s.id);
          const itemCount = cards.filter((c) => c.scenarioId === s.id).length;
          return (
            <li key={s.id} className="proposal-scenario-card">
              <div className="proposal-scenario-card__header">
                <div className="proposal-scenario-card__main">
                  <span className="proposal-scenario-card__index">Scenario {i + 1}</span>
                  <input
                    className="roadmap-input proposal-scenario-card__title"
                    value={s.title}
                    onChange={(e) => onUpdateScenarioTitle(s.id, e.target.value)}
                    placeholder="e.g. Scenario 1"
                    aria-label={`Scenario ${i + 1} name`}
                  />
                  <p className="proposal-scenario-card__meta">
                    {scenarioPhases.length} phase{scenarioPhases.length === 1 ? "" : "s"}
                    {itemCount > 0 ? (
                      <>
                        {" "}
                        · {itemCount} line item{itemCount === 1 ? "" : "s"} added
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="proposal-scenario-card__actions">
                  <button
                    type="button"
                    className="roadmap-btn roadmap-btn--sm roadmap-btn--ghost"
                    onClick={() => onDuplicateScenario(s.id)}
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    className="roadmap-btn roadmap-btn--sm roadmap-btn--ghost"
                    disabled={scenarios.length <= 1}
                    onClick={() => onDeleteScenario(s.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="proposal-scenario-phases">
                <p className="proposal-scenario-phases__label">Phases In This Scenario</p>
                <ul className="proposal-scenario-phases__list">
                  {scenarioPhases.map((ph, phIdx) => {
                    const phaseItemCount = cards.filter((c) => c.phaseId === ph.id).length;
                    return (
                      <li key={ph.id} className="proposal-scenario-phase-row">
                        <span className="proposal-scenario-phase-row__num">{phIdx + 1}</span>
                        <input
                          className="roadmap-input proposal-scenario-phase-row__title"
                          value={ph.title}
                          onChange={(e) => onUpdatePhaseTitle(ph.id, e.target.value)}
                          placeholder={`Phase ${phIdx + 1}`}
                          aria-label={`${s.title || "Scenario"} phase ${phIdx + 1} name`}
                        />
                        {phaseItemCount > 0 ? (
                          <span className="proposal-scenario-phase-row__count" title="Line items in this phase">
                            {phaseItemCount} item{phaseItemCount === 1 ? "" : "s"}
                          </span>
                        ) : (
                          <span className="proposal-scenario-phase-row__count proposal-scenario-phase-row__count--empty">
                            Empty
                          </span>
                        )}
                        <button
                          type="button"
                          className="roadmap-btn roadmap-btn--sm roadmap-btn--ghost proposal-scenario-phase-row__delete"
                          disabled={scenarioPhases.length <= 1}
                          onClick={() => onDeletePhase(ph.id)}
                          aria-label={`Delete ${ph.title || "phase"}`}
                          title={scenarioPhases.length <= 1 ? "Each scenario needs at least one phase" : "Delete phase"}
                        >
                          Remove
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <button
                  type="button"
                  className="roadmap-btn roadmap-btn--sm roadmap-btn--ghost proposal-scenario-phases__add"
                  onClick={() => onAddPhase(s.id)}
                >
                  + Add phase
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <button type="button" className="roadmap-btn roadmap-btn--ghost proposal-scenario-list__add" onClick={onAddScenario}>
        + Add scenario
      </button>
    </div>
  );
}
