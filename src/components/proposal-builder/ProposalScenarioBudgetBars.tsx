import { budgetVsScenarioStatus } from "../../lib/roadmapModel";

export type ScenarioBudgetBarRow = {
  scenarioId: string;
  title: string;
  includedSubtotal: number;
  isActive?: boolean;
};

type Props = {
  budget: number | null;
  scenarios: ScenarioBudgetBarRow[];
  formatUsd: (n: number | null | undefined) => string;
};

export function ProposalScenarioBudgetBars({ budget, scenarios, formatUsd }: Props) {
  if (budget == null || !(budget > 0)) {
    return (
      <section className="proposal-budget-card proposal-budget-card--empty" aria-label="Budget comparison">
        <p className="proposal-budget-card__hint">
          Set a <strong>client budget</strong> in Setup to track spend as you add tiers.
        </p>
      </section>
    );
  }

  return (
    <section className="proposal-budget-card" aria-label="Budget vs included scope by scenario">
      <header className="proposal-budget-card__hero">
        <div>
          <p className="proposal-budget-card__eyebrow">Budget Progress</p>
          <p className="proposal-budget-card__tagline">Included Scope Vs Client Budget</p>
        </div>
        <p className="proposal-budget-card__total">
          <span className="proposal-budget-card__total-label">Budget</span>
          <strong>{formatUsd(budget)}</strong>
        </p>
      </header>
      <ul className="proposal-budget-card__list">
        {scenarios.map((row) => {
          const sub = row.includedSubtotal;
          const remaining = budget - sub;
          const barPct = Math.min(100, (sub / budget) * 100);
          const budgetStat = budgetVsScenarioStatus(sub, budget);
          const pctLabel = `${Math.round(barPct)}%`;
          return (
            <li
              key={row.scenarioId}
              className={`proposal-budget-card__item proposal-budget-card__item--${budgetStat}${
                row.isActive ? " proposal-budget-card__item--active" : ""
              }`}
            >
              <div className="proposal-budget-card__item-head">
                <span className="proposal-budget-card__scenario">{row.title.trim() || "Scenario"}</span>
                <span className="proposal-budget-card__pct" aria-hidden>
                  {pctLabel}
                </span>
              </div>
              <div className="proposal-budget-card__meter-wrap">
                <div
                  className={`proposal-budget-card__meter proposal-budget-card__meter--${budgetStat}`}
                  role="progressbar"
                  aria-valuenow={Math.round(barPct)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${row.title}: ${formatUsd(sub)} of ${formatUsd(budget)} included`}
                >
                  <div className="proposal-budget-card__fill" style={{ width: `${barPct}%` }} />
                </div>
                <span className="proposal-budget-card__spent">{formatUsd(sub)}</span>
              </div>
              <div className="proposal-budget-card__item-foot">
                {budgetStat === "over" ? (
                  <span className="proposal-budget-card__status proposal-budget-card__status--over">
                    Over by {formatUsd(Math.abs(remaining))}
                  </span>
                ) : budgetStat === "in_range" ? (
                  <span className="proposal-budget-card__status proposal-budget-card__status--range">
                    Within range
                  </span>
                ) : (
                  <span className="proposal-budget-card__status proposal-budget-card__status--under">
                    {formatUsd(Math.max(0, remaining))} remaining
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
