import { useEffect, useMemo, useState } from "react";
import type { RoadmapCard, RoadmapPhase, RoadmapScenario, ReorderCardDirection } from "../../lib/roadmapModel";
import { budgetVsScenarioStatus, cardHoursForScenarioRollup, cardPriceUsdForRollup, sortedPhasesForScenario } from "../../lib/roadmapModel";
import { ProposalOrganizeLineCard } from "./ProposalOrganizeLineCard";
import { ProposalOrganizePricingModal } from "./ProposalOrganizePricingModal";
import type { ScenarioBudgetBarRow } from "./ProposalScenarioBudgetBars";
import { ProposalScenarioBudgetBars } from "./ProposalScenarioBudgetBars";

type CatalogCtxLike = Parameters<typeof cardPriceUsdForRollup>[1];

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
  onReorderCard: (key: string, direction: ReorderCardDirection) => void;
  onOpenDetails: (c: RoadmapCard) => void;
  onEditStructure: () => void;
  onClearScenarioItems: (scenarioId: string) => void;
  onUpdateScenarioNarrative: (scenarioId: string, narrative: string) => void;
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
  onReorderCard,
  onOpenDetails,
  onEditStructure,
  onClearScenarioItems,
  onUpdateScenarioNarrative,
}: Props) {
  const [viewScenarioId, setViewScenarioId] = useState(initialScenarioId);
  const [pricingCardKey, setPricingCardKey] = useState<string | null>(null);
  const pricingCard = pricingCardKey ? cards.find((c) => c.key === pricingCardKey) ?? null : null;

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

  return (
    <div className="proposal-step-panel proposal-organize">
      <header className="proposal-organize__hero">
        <div className="proposal-organize__hero-text">
          <p className="proposal-step-panel__eyebrow">Step 4</p>
          <h2 className="proposal-step-panel__title">Organize &amp; Reorder Offerings</h2>
          <p className="proposal-step-panel__lead">
            Tune scope per line, reorder offerings within each phase, move items between phases, and set{" "}
            <strong>proposal hours &amp; pricing</strong> when the catalog numbers are not what you want on the final
            proposal.
          </p>
        </div>
      </header>

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
              className="roadmap-btn roadmap-btn--ghost roadmap-btn--sm"
              onClick={() => {
                const ok = window.confirm(`Remove all ${scenCards.length} items from "${scenario.title.trim() || "this scenario"}"?`);
                if (ok) onClearScenarioItems(scenario.id);
              }}
            >
              Clear Scenario
            </button>
          ) : null}
        </div>
      </div>

      <section className="proposal-organize__insights" aria-label="Scenario budget and totals">
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
        <div className="proposal-organize__insights-kpis">
          <div className="proposal-organize__stat-card">
            <span className="proposal-organize__stat-label">Included</span>
            <strong className="proposal-organize__stat-value">{formatUsd(sub)}</strong>
          </div>
          <div className="proposal-organize__stat-card">
            <span className="proposal-organize__stat-label">Optional</span>
            <strong className="proposal-organize__stat-value">
              {rollup.optionalParsedCount > 0 ? formatUsd(rollup.optionalPriceSubtotal) : "—"}
            </strong>
          </div>
          <div className="proposal-organize__stat-card">
            <span className="proposal-organize__stat-label">Hours (Included)</span>
            <strong className="proposal-organize__stat-value">
              {rollup.hoursSum != null && rollup.hoursCount > 0 ? `~${formatHoursShort(rollup.hoursSum)}` : "—"}
            </strong>
          </div>
          {budgetStat === "over" ? (
            <div className="proposal-organize__stat-card proposal-organize__stat-card--flag proposal-organize__stat-card--over">
              <span className="proposal-organize__stat-label">Budget</span>
              <strong className="proposal-organize__stat-value">Over</strong>
            </div>
          ) : budgetStat === "in_range" ? (
            <div className="proposal-organize__stat-card proposal-organize__stat-card--flag proposal-organize__stat-card--range">
              <span className="proposal-organize__stat-label">Budget</span>
              <strong className="proposal-organize__stat-value">Near Limit</strong>
            </div>
          ) : budget != null && budget > 0 ? (
            <div className="proposal-organize__stat-card">
              <span className="proposal-organize__stat-label">Remaining</span>
              <strong className="proposal-organize__stat-value">{formatUsd(Math.max(0, budget - sub))}</strong>
            </div>
          ) : null}
        </div>
      </section>

      <details className="proposal-organize__narrative">
        <summary>Approach / Narrative For Export</summary>
        <textarea
          className="roadmap-input"
          rows={2}
          value={scenario.narrative}
          placeholder="Why this scenario is structured this way…"
          onChange={(e) => onUpdateScenarioNarrative(scenario.id, e.target.value)}
        />
      </details>

      {scenCards.length === 0 ? (
        <p className="proposal-organize__empty roadmap-muted">
          No items in this scenario yet. Go to <strong>Add Offerings</strong> to build the catalog lines first.
        </p>
      ) : (
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
              <section key={phase.id} className="proposal-organize-phase">
                <header className="proposal-organize-phase__head">
                  <h3 className="proposal-organize-phase__title">{phase.title.trim() || "Phase"}</h3>
                  <span className="proposal-organize-phase__rollup">
                    {phaseCards.length} item{phaseCards.length === 1 ? "" : "s"}
                    {phPrice > 0 ? ` · ${formatUsd(phPrice)} included` : ""}
                    {phHn > 0 ? ` · ~${formatHoursShort(phHours)} h` : ""}
                  </span>
                </header>
                {phaseCards.length === 0 ? (
                  <p className="proposal-organize-phase__empty roadmap-muted">Nothing in this phase.</p>
                ) : (
                  <ul className="proposal-organize-phase__list">
                    {phaseCards.map((c, phaseIndex) => (
                      <ProposalOrganizeLineCard
                        key={c.key}
                        card={c}
                        scenarioCards={scenCards}
                        ctx={ctx}
                        phaseChoices={scenarioPhases}
                        computeScratchSellPrice={computeScratchSellPrice}
                        canMoveUp={phaseIndex > 0}
                        canMoveDown={phaseIndex < phaseCards.length - 1}
                        onPatch={onPatchCard}
                        onRemove={onRemoveCard}
                        onReorder={onReorderCard}
                        onDetails={onOpenDetails}
                        onEditPricing={(card) => setPricingCardKey(card.key)}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      {pricingCard ? (
        <ProposalOrganizePricingModal
          card={pricingCard}
          ctx={ctx}
          computeScratchSellPrice={computeScratchSellPrice}
          formatHoursShort={formatHoursShort}
          onClose={() => setPricingCardKey(null)}
          onSave={(key, patch) => onPatchCard(key, patch)}
        />
      ) : null}
    </div>
  );
}
