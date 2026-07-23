import type { RoadmapCard, RoadmapPhase, RoadmapScenario } from "../../lib/roadmapModel";
import { sortedPhasesForScenario } from "../../lib/roadmapModel";
import type { ProposalKind } from "../../lib/proposalKindPresets";

type Props = {
  proposalKind: ProposalKind;
  onProposalKindChange: (kind: ProposalKind) => void;
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
  proposalKind,
  onProposalKindChange,
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
  const sectionWord = "section";
  const sectionWordPlural = "sections";

  return (
    <div className="proposal-step-panel">
      <header className="proposal-step-panel__head">
        <h2 className="proposal-step-panel__title">Scenarios &amp; Phases</h2>
        <p className="proposal-step-panel__lead">
          Choose Program or Project proposal to load the right starting structure, then rename scenarios and sections as
          needed. You can still adjust them later in Organize.
        </p>
      </header>

      <div
        className="proposal-kind-toggle"
        role="group"
        aria-label="Proposal type"
      >
        <button
          type="button"
          className={`proposal-kind-toggle__btn${proposalKind === "program" ? " is-active" : ""}`}
          aria-pressed={proposalKind === "program"}
          onClick={() => onProposalKindChange("program")}
        >
          Program proposal
        </button>
        <button
          type="button"
          className={`proposal-kind-toggle__btn${proposalKind === "project" ? " is-active" : ""}`}
          aria-pressed={proposalKind === "project"}
          onClick={() => onProposalKindChange("project")}
        >
          Project proposal
        </button>
      </div>

      <p className="proposal-scenarios-summary" aria-live="polite">
        <strong>{scenarios.length}</strong> proposal scenario{scenarios.length === 1 ? "" : "s"} ·{" "}
        <strong>{phases.length}</strong> {phases.length === 1 ? sectionWord : sectionWordPlural} total
      </p>

      <ul className="proposal-scenario-list">
        {scenarios.map((s, i) => {
          const scenarioPhases = sortedPhasesForScenario(phases, s.id);
          const itemCount = cards.filter((c) => c.scenarioId === s.id).length;
          return (
            <li key={s.id} className="proposal-scenario-card">
              <div className="proposal-scenario-card__header">
                <div className="proposal-scenario-card__main">
                  <span className="proposal-scenario-card__index">Proposal scenario {i + 1}</span>
                  <input
                    className="roadmap-input proposal-scenario-card__title"
                    value={s.title}
                    onChange={(e) => onUpdateScenarioTitle(s.id, e.target.value)}
                    placeholder="e.g. Proposal Scenario 1"
                    aria-label={`Proposal scenario ${i + 1} name`}
                  />
                  <p className="proposal-scenario-card__meta">
                    {scenarioPhases.length} {scenarioPhases.length === 1 ? sectionWord : sectionWordPlural}
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
                <p className="proposal-scenario-phases__label">Sections in this proposal scenario</p>
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
                          placeholder={
                            proposalKind === "project" ? `Section ${phIdx + 1}` : `Phase ${phIdx + 1}`
                          }
                          aria-label={`${s.title || "Scenario"} section ${phIdx + 1} name`}
                        />
                        {phaseItemCount > 0 ? (
                          <span className="proposal-scenario-phase-row__count" title="Line items in this section">
                            {phaseItemCount} item{phaseItemCount === 1 ? "" : "s"}
                          </span>
                        ) : proposalKind === "program" ? (
                          <span className="proposal-scenario-phase-row__count proposal-scenario-phase-row__count--empty">
                            Empty
                          </span>
                        ) : null}
                        <button
                          type="button"
                          className={`roadmap-btn roadmap-btn--sm roadmap-btn--ghost proposal-scenario-phase-row__delete${
                            proposalKind === "project" ? " proposal-scenario-phase-row__delete--icon" : ""
                          }`}
                          disabled={scenarioPhases.length <= 1}
                          onClick={() => onDeletePhase(ph.id)}
                          aria-label={`Delete ${ph.title || "section"}`}
                          title={
                            scenarioPhases.length <= 1
                              ? "Each scenario needs at least one section"
                              : "Delete section"
                          }
                        >
                          {proposalKind === "project" ? "×" : "Remove"}
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
                  + Add section
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <button type="button" className="roadmap-btn roadmap-btn--ghost proposal-scenario-list__add" onClick={onAddScenario}>
        + Add proposal scenario
      </button>
    </div>
  );
}
