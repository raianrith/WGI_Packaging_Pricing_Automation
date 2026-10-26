import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DndContext,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { RoadmapCard, RoadmapPhase, RoadmapScenario } from "../../lib/roadmapModel";
import { budgetVsScenarioStatus, cardHoursForScenarioRollup, cardPriceUsdForRollup, sortedPhasesForScenario } from "../../lib/roadmapModel";
import { computeProposalAccountMgmtRollup } from "../../lib/proposalAccountMgmt";
import type { CustomScopingState } from "../../lib/customScopingRequest";
import { ProposalCustomScopingSummary } from "./ProposalCustomScopingSummary";
import { ProposalOrganizeAccountMgmtCard } from "./ProposalOrganizeAccountMgmtCard";
import { ProposalOrganizeLineCard } from "./ProposalOrganizeLineCard";
import type { ScenarioBudgetBarRow } from "./ProposalScenarioBudgetBars";
import { ProposalScenarioBudgetBars } from "./ProposalScenarioBudgetBars";
import { proposalStepDef } from "./ProposalBuilderSteps";

type CatalogCtxLike = Parameters<typeof cardPriceUsdForRollup>[1];

function PhaseDroppable({
  id,
  empty,
  children,
}: {
  id: string;
  empty: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `phase:${id}` });
  return (
    <div
      ref={setNodeRef}
      className={`proposal-organize-phase__drop${empty ? " is-empty" : ""}${isOver ? " is-over" : ""}`}
    >
      {children}
    </div>
  );
}

type ScenarioRollup = {
  count: number;
  includedCount: number;
  hoursSum: number | null;
  hoursCount: number;
  priceSubtotal: number;
  optionalPriceSubtotal: number;
  optionalParsedCount: number;
};

type Props = {
  scenarios: RoadmapScenario[];
  phases: RoadmapPhase[];
  cards: RoadmapCard[];
  ctx: CatalogCtxLike;
  scenarioRollups: ScenarioRollup[];
  budget: number | null;
  formatUsd: (n: number | null | undefined) => string;
  formatHoursShort: (n: number) => string;
  computeScratchSellPrice: (c: RoadmapCard, ctx: CatalogCtxLike) => string;
  initialScenarioId: string;
  onPatchCard: (key: string, patch: Partial<RoadmapCard>) => void;
  onRemoveCard: (key: string) => void;
  onReorderPhaseCards: (scenarioId: string, phaseId: string, orderedKeys: string[]) => void;
  onMoveCard?: (key: string, toPhaseId: string, orderedKeys: string[]) => void;
  onOpenDetails: (c: RoadmapCard) => void;
  onEditStructure: () => void;
  onClearScenarioItems: (scenarioId: string) => void;
  onUpdateScenarioNarrative: (scenarioId: string, narrative: string) => void;
  customScoping?: CustomScopingState | null;
  proposalStartDate?: string;
  proposalEndDate?: string;
};

export function ProposalOrganizePanel({
  scenarios,
  phases,
  cards,
  ctx,
  scenarioRollups,
  budget,
  formatUsd,
  formatHoursShort,
  computeScratchSellPrice,
  initialScenarioId,
  onPatchCard,
  onRemoveCard,
  onReorderPhaseCards,
  onMoveCard,
  onOpenDetails,
  onEditStructure,
  onClearScenarioItems,
  onUpdateScenarioNarrative,
  customScoping = null,
  proposalStartDate = "",
  proposalEndDate = "",
}: Props) {
  const stepMeta = proposalStepDef("board");
  const [viewScenarioId, setViewScenarioId] = useState(initialScenarioId);

  useEffect(() => {
    if (scenarios.some((s) => s.id === viewScenarioId)) return;
    setViewScenarioId(scenarios[0]?.id ?? "");
  }, [scenarios, viewScenarioId]);

  useEffect(() => {
    if (scenarios.some((s) => s.id === initialScenarioId)) {
      setViewScenarioId(initialScenarioId);
    }
  }, [initialScenarioId, scenarios]);

  const scenarioIdx = scenarios.findIndex((s) => s.id === viewScenarioId);
  const scenario = scenarios[scenarioIdx];
  const scenarioPhases = useMemo(
    () => (scenario ? sortedPhasesForScenario(phases, scenario.id) : []),
    [phases, scenario]
  );
  const rollup = scenarioRollups[scenarioIdx] ?? {
    count: 0,
    includedCount: 0,
    hoursSum: null,
    hoursCount: 0,
    priceSubtotal: 0,
    optionalPriceSubtotal: 0,
    optionalParsedCount: 0,
  };

  const budgetBars: ScenarioBudgetBarRow[] = useMemo(
    () =>
      scenarios.map((s, i) => ({
        scenarioId: s.id,
        title: s.title,
        includedSubtotal: scenarioRollups[i]?.priceSubtotal ?? 0,
        isActive: s.id === viewScenarioId,
      })),
    [scenarios, scenarioRollups, viewScenarioId]
  );

  const accountMgmtRollup = useMemo(
    () => computeProposalAccountMgmtRollup(cards, ctx),
    [cards, ctx]
  );

  const sub = rollup.priceSubtotal;
  const budgetStat = budget != null && budget > 0 ? budgetVsScenarioStatus(sub, budget) : null;

  if (!scenario) {
    return (
      <div className="proposal-step-panel">
        <p className="roadmap-muted">Add a scenario in Scenarios &amp; phases first.</p>
      </div>
    );
  }

  const scenCards = cards.filter((c) => c.scenarioId === scenario.id);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  function phaseIdOf(id: string): string | null {
    if (id.startsWith("phase:")) return id.slice("phase:".length);
    return scenCards.find((c) => c.key === id)?.phaseId ?? null;
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeKey = String(active.id);
    const fromPhase = phaseIdOf(activeKey);
    const toPhase = phaseIdOf(String(over.id));
    if (!fromPhase || !toPhase) return;
    const fromKeys = scenCards.filter((c) => c.phaseId === fromPhase).map((c) => c.key);
    if (fromPhase === toPhase) {
      const oldIndex = fromKeys.indexOf(activeKey);
      const newIndex = fromKeys.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;
      onReorderPhaseCards(scenario.id, fromPhase, arrayMove(fromKeys, oldIndex, newIndex));
      return;
    }
    const destKeys = scenCards.filter((c) => c.phaseId === toPhase).map((c) => c.key);
    const overKey = String(over.id);
    const insertAt = overKey.startsWith("phase:")
      ? destKeys.length
      : Math.max(0, destKeys.indexOf(overKey));
    const nextDest = [...destKeys.slice(0, insertAt), activeKey, ...destKeys.slice(insertAt)];
    if (onMoveCard) onMoveCard(activeKey, toPhase, nextDest);
    else onReorderPhaseCards(scenario.id, toPhase, nextDest);
  }

  return (
    <div className="proposal-step-panel proposal-organize">
      <header className="proposal-organize__hero">
        <div className="proposal-organize__hero-text">
          <h2 className="proposal-step-panel__title">{stepMeta.label}</h2>
        </div>
      </header>

      <ProposalCustomScopingSummary state={customScoping} compact />

      <div className="proposal-organize__toolbar">
        <div className="proposal-organize__tabs" role="tablist" aria-label="Scenarios">
          {scenarios.map((s, i) => {
            const count = cards.filter((c) => c.scenarioId === s.id).length;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={viewScenarioId === s.id}
                className={`proposal-organize__tab${viewScenarioId === s.id ? " is-active" : ""}`}
                onClick={() => setViewScenarioId(s.id)}
              >
                <span className="proposal-organize__tab-label">{s.title.trim() || `Scenario ${i + 1}`}</span>
                <span className="proposal-organize__tab-count">{count}</span>
              </button>
            );
          })}
        </div>
        <div className="proposal-organize__toolbar-actions">
          <button type="button" className="roadmap-btn roadmap-btn--ghost roadmap-btn--sm" onClick={onEditStructure}>
            Edit Scenarios &amp; Phases
          </button>
          {scenCards.length > 0 ? (
            <button
              type="button"
              className="roadmap-btn roadmap-btn--ghost roadmap-btn--sm proposal-organize__clear"
              onClick={() => {
                const ok = window.confirm(`Remove all ${scenCards.length} items from "${scenario.title.trim() || "this scenario"}"?`);
                if (ok) onClearScenarioItems(scenario.id);
              }}
            >
              Clear scenario
            </button>
          ) : null}
        </div>
      </div>

      <section className="proposal-organize__summary" aria-label="Scenario budget and totals">
      <div className="proposal-organize__insights">
        <div className="proposal-organize__insights-budget">
          <ProposalScenarioBudgetBars
            budget={budget}
            scenarios={
              scenarios.length > 1
                ? budgetBars
                : [{ scenarioId: scenario.id, title: scenario.title, includedSubtotal: sub, isActive: true }]
            }
            formatUsd={formatUsd}
          />
        </div>
        <dl className="proposal-organize__insights-kpis">
          <div className="proposal-organize__stat-card">
            <dt className="proposal-organize__stat-label">Included</dt>
            <dd className="proposal-organize__stat-value">{formatUsd(sub)}</dd>
          </div>
          <div className="proposal-organize__stat-card">
            <dt className="proposal-organize__stat-label">Optional</dt>
            <dd className="proposal-organize__stat-value">
              {rollup.optionalParsedCount > 0 ? formatUsd(rollup.optionalPriceSubtotal) : "—"}
            </dd>
          </div>
          <div className="proposal-organize__stat-card">
            <dt className="proposal-organize__stat-label">Hours</dt>
            <dd className="proposal-organize__stat-value">
              {rollup.hoursSum != null && rollup.hoursCount > 0 ? `~${formatHoursShort(rollup.hoursSum)}` : "—"}
            </dd>
          </div>
          {budgetStat === "over" ? (
            <div className="proposal-organize__stat-card proposal-organize__stat-card--flag proposal-organize__stat-card--over">
              <dt className="proposal-organize__stat-label">Budget</dt>
              <dd className="proposal-organize__stat-value">Over</dd>
            </div>
          ) : budgetStat === "in_range" ? (
            <div className="proposal-organize__stat-card proposal-organize__stat-card--flag proposal-organize__stat-card--range">
              <dt className="proposal-organize__stat-label">Budget</dt>
              <dd className="proposal-organize__stat-value">Near limit</dd>
            </div>
          ) : budget != null && budget > 0 ? (
            <div className="proposal-organize__stat-card">
              <dt className="proposal-organize__stat-label">Remaining</dt>
              <dd className="proposal-organize__stat-value">{formatUsd(Math.max(0, budget - sub))}</dd>
            </div>
          ) : null}
        </dl>
      </div>

      {accountMgmtRollup.includedLineCount > 0 ? (
        <details className="proposal-organize__ops">
          <summary>
            <span>Internal hours</span>
            <span className="proposal-organize__ops-sum">
              AM {formatHoursShort(accountMgmtRollup.accountMgmtHours)} h
              {" · "}
              CI {formatHoursShort(accountMgmtRollup.continuousImprovementHours)} h
            </span>
          </summary>
          <ProposalOrganizeAccountMgmtCard
            accountMgmtHours={accountMgmtRollup.accountMgmtHours}
            continuousImprovementHours={accountMgmtRollup.continuousImprovementHours}
            resourceHours={accountMgmtRollup.resourceHours}
            flexBudgetUsd={accountMgmtRollup.flexBudgetUsd}
            hourlyRate={accountMgmtRollup.hourlyRate}
            formatHoursShort={formatHoursShort}
          />
        </details>
      ) : null}

      <details className="proposal-organize__narrative">
        <summary>Client-facing narrative</summary>
        <textarea
          className="roadmap-input"
          rows={2}
          value={scenario.narrative}
          placeholder="Why this scenario is structured this way…"
          onChange={(e) => onUpdateScenarioNarrative(scenario.id, e.target.value)}
        />
      </details>
      </section>

      {scenCards.length === 0 ? (
        <p className="proposal-organize__empty roadmap-muted">
          No items in this scenario yet. Go to <strong>Add scope</strong> to add solutions or packages.
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
        <div className="proposal-organize__phases">
          {scenarioPhases.map((phase) => {
            const phaseCards = scenCards.filter((c) => c.phaseId === phase.id);
            let phPrice = 0;
            let phHours = 0;
            let phHn = 0;
            for (const c of phaseCards.filter((x) => x.scope === "included")) {
              const pu = cardPriceUsdForRollup(c, ctx, computeScratchSellPrice);
              if (pu != null) phPrice += pu;
              const hh = cardHoursForScenarioRollup(c, ctx);
              if (hh != null) {
                phHours += hh;
                phHn += 1;
              }
            }
            return (
              <section
                key={phase.id}
                className={`proposal-organize-phase${phaseCards.length === 0 ? " proposal-organize-phase--empty" : ""}`}
              >
                <header className="proposal-organize-phase__head">
                  <h3 className="proposal-organize-phase__title">{phase.title.trim() || "Phase"}</h3>
                  <span className="proposal-organize-phase__rollup">
                    {phaseCards.length} item{phaseCards.length === 1 ? "" : "s"}
                    {phPrice > 0 ? ` · ${formatUsd(phPrice)} included` : ""}
                    {phHn > 0 ? ` · ~${formatHoursShort(phHours)} h` : ""}
                  </span>
                </header>
                <PhaseDroppable id={phase.id} empty={phaseCards.length === 0}>
                {phaseCards.length === 0 ? (
                  <p className="proposal-organize-phase__empty roadmap-muted">Drop items here</p>
                ) : (
                  <>
                    <div className="proposal-organize-phase__cols" aria-hidden>
                      <span />
                      <span>Item</span>
                      <span>Hours</span>
                      <span>Price</span>
                      <span>Scope</span>
                      <span />
                    </div>
                    <ul className="proposal-organize-phase__list">
                      <SortableContext
                        items={phaseCards.map((c) => c.key)}
                        strategy={verticalListSortingStrategy}
                      >
                        {phaseCards.map((c) => (
                          <ProposalOrganizeLineCard
                            key={c.key}
                            card={c}
                            scenarioCards={scenCards}
                            ctx={ctx}
                            computeScratchSellPrice={computeScratchSellPrice}
                            proposalStartDate={proposalStartDate}
                            proposalEndDate={proposalEndDate}
                            onPatch={onPatchCard}
                            onRemove={onRemoveCard}
                            onDetails={onOpenDetails}
                          />
                        ))}
                      </SortableContext>
                    </ul>
                  </>
                )}
                </PhaseDroppable>
              </section>
            );
          })}
        </div>
        </DndContext>
      )}
    </div>
  );
}
