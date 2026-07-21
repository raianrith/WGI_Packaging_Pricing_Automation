import { useMemo, useState } from "react";
import type { PackageSolutionTier, TaskRow } from "../../types";
import {
  sortedPhasesForScenario,
  type RoadmapCard,
  type RoadmapPhase,
  type RoadmapScenario,
} from "../../lib/roadmapModel";
import {
  addProposalExtraTask,
  cardSupportsTaskReview,
  formatProposalTaskHoursTotal,
  hideProposalTask,
  renameProposalExtraTask,
  resolveProposalCardTasks,
  setProposalTaskHours,
  type ProposalCardTasksCtx,
} from "../../lib/proposalCardTasks";
import { proposalStepDef } from "./ProposalBuilderSteps";

type Props = {
  scenarios: RoadmapScenario[];
  phases: RoadmapPhase[];
  cards: RoadmapCard[];
  tasks: TaskRow[];
  packageTiers: PackageSolutionTier[];
  onPatchCard: (key: string, next: RoadmapCard) => void;
};

function kindLabel(kind: RoadmapCard["kind"]): string {
  if (kind === "package") return "Package";
  if (kind === "tier") return "Solution tier";
  if (kind === "custom_tier") return "Custom tier";
  return kind;
}

export function ProposalClientServiceReviewPanel({
  scenarios,
  phases,
  cards,
  tasks,
  packageTiers,
  onPatchCard,
}: Props) {
  const stepMeta = proposalStepDef("client_service");
  const ctx: ProposalCardTasksCtx = useMemo(() => ({ tasks, packageTiers }), [tasks, packageTiers]);
  const [viewScenarioId, setViewScenarioId] = useState(scenarios[0]?.id ?? "");
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());

  const activeScenarioId =
    scenarios.some((s) => s.id === viewScenarioId) ? viewScenarioId : scenarios[0]?.id ?? "";

  const scenarioCards = useMemo(() => {
    const phaseOrder = sortedPhasesForScenario(phases, activeScenarioId);
    const phaseRank = new Map(phaseOrder.map((p, i) => [p.id, i]));
    return cards
      .filter((c) => c.scenarioId === activeScenarioId && cardSupportsTaskReview(c))
      .sort((a, b) => {
        const pa = phaseRank.get(a.phaseId) ?? 999;
        const pb = phaseRank.get(b.phaseId) ?? 999;
        if (pa !== pb) return pa - pb;
        return a.headline.localeCompare(b.headline, undefined, { sensitivity: "base" });
      });
  }, [cards, phases, activeScenarioId]);

  const phaseTitle = (phaseId: string) =>
    phases.find((p) => p.id === phaseId)?.title.trim() || "Phase";

  const toggleExpanded = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const updateCard = (_card: RoadmapCard, next: RoadmapCard) => {
    onPatchCard(_card.key, next);
  };

  return (
    <div className="proposal-step-panel proposal-csr">
      <header className="proposal-step-panel__head">
        <p className="proposal-step-panel__eyebrow">Step {stepMeta.number}</p>
        <h2 className="proposal-step-panel__title">{stepMeta.label}</h2>
        <p className="proposal-step-panel__lead">
          Review every task on solutions and packages in this proposal. Change hours, remove tasks, or
          add proposal-only tasks — catalog solutions stay unchanged.
        </p>
      </header>

      {scenarios.length > 1 ? (
        <div className="proposal-csr__tabs" role="tablist" aria-label="Scenarios">
          {scenarios.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={activeScenarioId === s.id}
              className={`proposal-csr__tab${activeScenarioId === s.id ? " is-active" : ""}`}
              onClick={() => setViewScenarioId(s.id)}
            >
              {s.title.trim() || `Scenario ${i + 1}`}
            </button>
          ))}
        </div>
      ) : null}

      {scenarioCards.length === 0 ? (
        <p className="proposal-csr__empty">
          No solutions or packages in this scenario yet. Add them in earlier steps, then come back to
          refine tasks.
        </p>
      ) : (
        <ul className="proposal-csr__list">
          {scenarioCards.map((card) => {
            const expanded = expandedKeys.has(card.key);
            const taskRows = resolveProposalCardTasks(card, ctx);
            const hoursTotal = formatProposalTaskHoursTotal(taskRows);
            return (
              <li key={card.key} className={`proposal-csr-card${expanded ? " is-expanded" : ""}`}>
                <button
                  type="button"
                  className="proposal-csr-card__head"
                  aria-expanded={expanded}
                  onClick={() => toggleExpanded(card.key)}
                >
                  <span className="proposal-csr-card__chevron" aria-hidden>
                    {expanded ? "▾" : "▸"}
                  </span>
                  <span className="proposal-csr-card__main">
                    <span className="proposal-csr-card__title">{card.headline.trim() || "Untitled"}</span>
                    <span className="proposal-csr-card__meta">
                      {kindLabel(card.kind)} · {phaseTitle(card.phaseId)} · {taskRows.length} task
                      {taskRows.length === 1 ? "" : "s"} · {hoursTotal}
                    </span>
                  </span>
                </button>

                {expanded ? (
                  <div className="proposal-csr-card__body">
                    {taskRows.length === 0 ? (
                      <p className="proposal-csr-card__none">No tasks on this line yet.</p>
                    ) : (
                      <table className="proposal-csr-table">
                        <thead>
                          <tr>
                            <th scope="col">Task</th>
                            <th scope="col" className="proposal-csr-table__col--hours">
                              Hours
                            </th>
                            <th scope="col" className="proposal-csr-table__col--actions">
                              <span className="visually-hidden">Actions</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {taskRows.map((row) => (
                            <tr key={row.id}>
                              <td>
                                {row.isExtra ? (
                                  <input
                                    className="roadmap-input proposal-csr-table__name-input"
                                    value={row.name}
                                    onChange={(e) =>
                                      updateCard(
                                        card,
                                        renameProposalExtraTask(card, ctx, row.id, e.target.value)
                                      )
                                    }
                                    aria-label="Proposal task name"
                                  />
                                ) : (
                                  <div className="proposal-csr-table__name">
                                    <span>{row.name}</span>
                                    {row.source === "package" ? (
                                      <span className="proposal-csr-table__badge">Package</span>
                                    ) : null}
                                  </div>
                                )}
                              </td>
                              <td className="proposal-csr-table__col--hours">
                                <input
                                  type="number"
                                  min={0}
                                  step={0.25}
                                  className="roadmap-input proposal-csr-table__hours"
                                  value={row.hours ?? ""}
                                  placeholder={row.catalogHours != null ? String(row.catalogHours) : "0"}
                                  onChange={(e) => {
                                    const raw = e.target.value.trim();
                                    const hours =
                                      raw === ""
                                        ? null
                                        : Number.isFinite(Number(raw))
                                          ? Number(raw)
                                          : null;
                                    updateCard(card, setProposalTaskHours(card, ctx, row.id, hours));
                                  }}
                                  aria-label={`Hours for ${row.name}`}
                                />
                              </td>
                              <td className="proposal-csr-table__col--actions">
                                <button
                                  type="button"
                                  className="roadmap-btn roadmap-btn--sm roadmap-btn--ghost"
                                  onClick={() => updateCard(card, hideProposalTask(card, ctx, row.id))}
                                >
                                  {row.isExtra ? "Remove" : "Delete"}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    <div className="proposal-csr-card__footer">
                      <button
                        type="button"
                        className="roadmap-btn roadmap-btn--sm roadmap-btn--ghost"
                        onClick={() => updateCard(card, addProposalExtraTask(card, ctx))}
                      >
                        + Add task
                      </button>
                      {card.taskLayout ? (
                        <span className="proposal-csr-card__note">Proposal-only edits · catalog unchanged</span>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
