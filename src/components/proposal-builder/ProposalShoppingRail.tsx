import { sortedPhasesForScenario, type RoadmapPhase, type RoadmapScenario } from "../../lib/roadmapModel";

/** Short picker/list label. Titles already look like `Phase 1 — Diagnose`. */
export function compactPhaseLabel(title: string, index: number): string {
  const t = title.replace(/\s+/g, " ").trim();
  if (!t) return `Phase ${index + 1}`;
  const m = t.match(/^phase\s+(\d+)\s*[—–:-]\s*(.+)$/i);
  if (m) {
    const rest = m[2]!.trim().replace(/\s*\(Track\s+(\d+):[^)]*\)/i, " · Track $1");
    return `${m[1]} · ${rest}`;
  }
  return t;
}

export type ShoppingRailPhase = {
  id: string;
  title: string;
  totalUsd: number;
  lines: { key: string; headline: string; priceUsd: number | null }[];
};

type Props = {
  clientLabel: string;
  dateLabel: string;
  includedTotal: number;
  budget: number | null;
  formatUsd: (n: number | null | undefined) => string;
  phases: ShoppingRailPhase[];
  scenarios: RoadmapScenario[];
  allPhases: RoadmapPhase[];
  targetScenarioId: string;
  targetPhaseId: string;
  onTargetScenarioChange: (id: string) => void;
  onTargetPhaseChange: (id: string) => void;
  onNext: () => void;
  nextLabel?: string;
};

export function ProposalShoppingRail({
  clientLabel,
  dateLabel,
  includedTotal,
  budget,
  formatUsd,
  phases,
  scenarios,
  allPhases,
  targetScenarioId,
  targetPhaseId,
  onTargetScenarioChange,
  onTargetPhaseChange,
  onNext,
  nextLabel = "Next: Organize",
}: Props) {
  const scenarioPhases = sortedPhasesForScenario(allPhases, targetScenarioId);
  const filledPhases = phases.filter((phase) => phase.lines.length > 0);
  const pct =
    budget != null && budget > 0 ? Math.min(100, Math.round((includedTotal / budget) * 100)) : null;

  return (
    <aside className="proposal-shop-rail" aria-label="Proposal running total">
      <header className="proposal-shop-rail__head">
        <p className="proposal-shop-rail__kicker">Proposal</p>
        <strong className="proposal-shop-rail__total">{formatUsd(includedTotal)}</strong>
        {budget != null && budget > 0 ? (
          <div className="proposal-shop-rail__budget">
            <div className="proposal-shop-rail__meter" aria-hidden>
              <span style={{ width: `${pct ?? 0}%` }} />
            </div>
            <p className="proposal-shop-rail__budget-label">
              {pct ?? 0}% of {formatUsd(budget)}
            </p>
          </div>
        ) : (
          <p className="proposal-shop-rail__budget-label">
            {clientLabel.trim() || "Draft"}
            {dateLabel && dateLabel !== "—" ? ` · ${dateLabel}` : ""}
          </p>
        )}
      </header>

      <label className="proposal-shop-rail__target">
        <span>Adding to</span>
        {scenarios.length > 1 ? (
          <select
            className="roadmap-input"
            value={targetScenarioId}
            onChange={(e) => onTargetScenarioChange(e.target.value)}
          >
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title.trim() || "Scenario"}
              </option>
            ))}
          </select>
        ) : null}
        <select
          className="roadmap-input"
          value={targetPhaseId}
          onChange={(e) => onTargetPhaseChange(e.target.value)}
          disabled={scenarioPhases.length === 0}
          title={scenarioPhases.find((p) => p.id === targetPhaseId)?.title.trim() || "Phase"}
        >
          {scenarioPhases.length === 0 ? (
            <option value="">Add a phase in Setup</option>
          ) : (
            scenarioPhases.map((p, i) => (
              <option key={p.id} value={p.id} title={p.title.trim()}>
                {compactPhaseLabel(p.title, i)}
              </option>
            ))
          )}
        </select>
      </label>

      <ul className="proposal-shop-rail__phases">
        {filledPhases.length === 0 ? (
          <li className="proposal-shop-rail__empty">Nothing added yet.</li>
        ) : (
          filledPhases.map((phase) => {
            const idx = scenarioPhases.findIndex((p) => p.id === phase.id);
            return (
            <li key={phase.id} className="proposal-shop-rail__phase">
              <div className="proposal-shop-rail__phase-head">
                <span title={phase.title.trim()}>
                  {compactPhaseLabel(phase.title, idx >= 0 ? idx : 0)}
                </span>
                <strong>{formatUsd(phase.totalUsd)}</strong>
              </div>
              <ul>
                {phase.lines.map((line) => (
                  <li key={line.key} className="proposal-shop-rail__line">
                    <span>{line.headline.trim() || "Untitled"}</span>
                    <span>{line.priceUsd != null ? formatUsd(line.priceUsd) : "—"}</span>
                  </li>
                ))}
              </ul>
            </li>
            );
          })
        )}
      </ul>

      <button type="button" className="roadmap-btn roadmap-btn--primary proposal-shop-rail__next" onClick={onNext}>
        {nextLabel}
      </button>
    </aside>
  );
}
