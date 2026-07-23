import { useMemo, useState } from "react";
import {
  cardPriceUsdForRollup,
  type CatalogCtxLike,
  type RoadmapCard,
  type RoadmapPhase,
  type RoadmapScenario,
} from "../../lib/roadmapModel";
import type { ProposalCardTasksCtx } from "../../lib/proposalCardTasks";
import {
  buildImplementerWeekLoad,
  buildProposalScheduleBars,
} from "../../lib/proposalScheduleCharts";
import { proposalStepDef } from "./ProposalBuilderSteps";
import { ProposalExportPreviewTables } from "./ProposalExportPreviewTables";

type PdfKind = "client" | "ops";

type Props = {
  roadmapTitle: string;
  clientLabel: string;
  dateRangeLabel: string;
  scenarios: RoadmapScenario[];
  phases: RoadmapPhase[];
  cards: RoadmapCard[];
  ctx: CatalogCtxLike | null;
  tasksCtx: ProposalCardTasksCtx | null;
  computeScratchSellPrice: (c: RoadmapCard, ctx: CatalogCtxLike | null) => string;
  formatUsd: (n: number | null | undefined) => string;
  formatHoursShort: (n: number) => string;
  pdfGenerating: PdfKind | null;
  onClientDownload: () => void;
  onOpsDownload: () => void;
  onReviewedByOps?: () => void;
  reviewedByOpsBusy?: boolean;
};

function ProposalGanttChart({
  bars,
}: {
  bars: ReturnType<typeof buildProposalScheduleBars>;
}) {
  if (bars.length === 0) {
    return (
      <p className="proposal-client-ready-chart__empty">
        Add start and end dates on deliverables to see the schedule Gantt.
      </p>
    );
  }

  const minMs = Math.min(...bars.map((b) => b.startMs));
  const maxMs = Math.max(...bars.map((b) => b.endMs));
  const span = Math.max(maxMs - minMs, 24 * 60 * 60 * 1000);

  return (
    <div className="proposal-gantt" role="img" aria-label="Deliverable schedule Gantt chart">
      <div className="proposal-gantt__rows">
        {bars.map((bar) => {
          const left = ((bar.startMs - minMs) / span) * 100;
          const width = Math.max(((bar.endMs - bar.startMs) / span) * 100, 1.2);
          return (
            <div key={bar.key} className="proposal-gantt__row">
              <div className="proposal-gantt__label">
                <strong>{bar.label}</strong>
                <span>
                  {bar.scenarioTitle} · {bar.phaseTitle}
                </span>
              </div>
              <div className="proposal-gantt__track">
                <div
                  className="proposal-gantt__bar"
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={`${bar.startLabel} – ${bar.endLabel}`}
                >
                  <span className="proposal-gantt__bar-text">
                    {bar.startLabel} – {bar.endLabel}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatLoadHours(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function ProposalImplementerLoadChart({
  weeks,
  implementers,
}: {
  weeks: ReturnType<typeof buildImplementerWeekLoad>["weeks"];
  implementers: string[];
}) {
  if (weeks.length === 0 || implementers.length === 0) {
    return (
      <p className="proposal-client-ready-chart__empty">
        Add dates on deliverables (and task implementers) to see staffing load by week.
      </p>
    );
  }

  const totalsByImplementer = implementers.map((name) => {
    let total = 0;
    let peakWeek = weeks[0]!;
    let peakHours = 0;
    for (const week of weeks) {
      const hrs = week.byImplementer[name] ?? 0;
      total += hrs;
      if (hrs > peakHours) {
        peakHours = hrs;
        peakWeek = week;
      }
    }
    return { name, total, peakWeek, peakHours };
  });

  const maxCell = Math.max(
    0.01,
    ...weeks.flatMap((w) => implementers.map((name) => w.byImplementer[name] ?? 0))
  );

  const weekTotals = weeks.map((w) =>
    implementers.reduce((sum, name) => sum + (w.byImplementer[name] ?? 0), 0)
  );
  const grandTotal = weekTotals.reduce((a, b) => a + b, 0);

  return (
    <div className="proposal-impl-matrix">
      <ul className="proposal-impl-matrix__summary" aria-label="Implementer totals">
        {totalsByImplementer.map((row) => (
          <li key={row.name} className="proposal-impl-matrix__summary-card">
            <strong className="proposal-impl-matrix__summary-name">{row.name}</strong>
            <span className="proposal-impl-matrix__summary-total">
              {formatLoadHours(row.total)} h total
            </span>
            <span className="proposal-impl-matrix__summary-peak">
              Busiest: {row.peakWeek.weekShortLabel}
              {row.peakHours > 0 ? ` · ${formatLoadHours(row.peakHours)} h` : ""}
            </span>
          </li>
        ))}
      </ul>

      <div className="proposal-impl-matrix__table-wrap">
        <table className="proposal-impl-matrix__table">
          <thead>
            <tr>
              <th scope="col" className="proposal-impl-matrix__sticky">
                Implementer
              </th>
              {weeks.map((week) => (
                <th key={week.weekStartMs} scope="col" title={week.weekLabel}>
                  {week.weekShortLabel}
                </th>
              ))}
              <th scope="col" className="proposal-impl-matrix__total-col">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {totalsByImplementer.map((row) => (
              <tr key={row.name}>
                <th scope="row" className="proposal-impl-matrix__sticky">
                  {row.name}
                </th>
                {weeks.map((week) => {
                  const hrs = week.byImplementer[row.name] ?? 0;
                  const intensity = hrs <= 0 ? 0 : Math.min(1, hrs / maxCell);
                  return (
                    <td
                      key={week.weekStartMs}
                      className={`proposal-impl-matrix__cell${hrs > 0 ? " has-hours" : ""}`}
                      style={
                        hrs > 0
                          ? {
                              background: `rgba(13, 92, 77, ${0.08 + intensity * 0.42})`,
                            }
                          : undefined
                      }
                      title={
                        hrs > 0
                          ? `${row.name} · ${week.weekLabel} · ${formatLoadHours(hrs)} h`
                          : undefined
                      }
                    >
                      {hrs > 0 ? formatLoadHours(hrs) : "—"}
                    </td>
                  );
                })}
                <td className="proposal-impl-matrix__total-col">
                  <strong>{formatLoadHours(row.total)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="proposal-impl-matrix__sticky">
                All roles
              </th>
              {weekTotals.map((total, i) => (
                <td key={weeks[i]!.weekStartMs} className="proposal-impl-matrix__total-col">
                  {formatLoadHours(total)}
                </td>
              ))}
              <td className="proposal-impl-matrix__total-col">
                <strong>{formatLoadHours(grandTotal)}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="proposal-impl-matrix__note">
        Darker cells = more hours that week. Hours come from each deliverable’s tasks, spread evenly
        across that deliverable’s start–end dates.
      </p>
    </div>
  );
}

export function ProposalClientReadyPanel({
  roadmapTitle,
  clientLabel,
  dateRangeLabel,
  scenarios,
  phases,
  cards,
  ctx,
  tasksCtx,
  computeScratchSellPrice,
  formatUsd,
  formatHoursShort,
  pdfGenerating,
  onClientDownload,
  onOpsDownload,
  onReviewedByOps,
  reviewedByOpsBusy = false,
}: Props) {
  const stepMeta = proposalStepDef("client_ready");
  const [viewScenarioId, setViewScenarioId] = useState(scenarios[0]?.id ?? "");
  const activeScenarioId =
    scenarios.some((s) => s.id === viewScenarioId) ? viewScenarioId : scenarios[0]?.id ?? "";

  const chartScenarios = useMemo(
    () =>
      scenarios.length <= 1
        ? scenarios
        : scenarios.filter((s) => s.id === activeScenarioId),
    [scenarios, activeScenarioId]
  );

  const chartCards = useMemo(
    () =>
      scenarios.length <= 1
        ? cards
        : cards.filter((c) => c.scenarioId === activeScenarioId),
    [cards, scenarios.length, activeScenarioId]
  );

  const includedGrand = useMemo(() => {
    const scopeCards =
      scenarios.length <= 1
        ? cards.filter((c) => c.scope === "included")
        : cards.filter((c) => c.scenarioId === activeScenarioId && c.scope === "included");
    let sum = 0;
    for (const c of scopeCards) {
      const p = cardPriceUsdForRollup(c, ctx, computeScratchSellPrice);
      if (p != null) sum += p;
    }
    return sum;
  }, [cards, scenarios.length, activeScenarioId, ctx, computeScratchSellPrice]);

  const ganttBars = useMemo(
    () => buildProposalScheduleBars(chartCards, chartScenarios, phases),
    [chartCards, chartScenarios, phases]
  );

  const implementerLoad = useMemo(() => {
    if (!tasksCtx) return { weeks: [], implementers: [] as string[] };
    return buildImplementerWeekLoad(chartCards, chartScenarios, tasksCtx);
  }, [chartCards, chartScenarios, tasksCtx]);

  return (
    <div className="proposal-step-panel proposal-client-ready">
      <header className="proposal-client-ready__hero">
        <div className="proposal-client-ready__hero-copy">
          <p className="proposal-step-panel__eyebrow">Step {stepMeta.number}</p>
          <h2 className="proposal-step-panel__title proposal-client-ready__title">
            {stepMeta.label}
          </h2>
          <ul className="proposal-client-ready__meta" aria-label="Proposal details">
            <li>{roadmapTitle.trim() || "Untitled proposal"}</li>
            {clientLabel.trim() ? <li>{clientLabel.trim()}</li> : null}
            {dateRangeLabel !== "—" ? <li>{dateRangeLabel}</li> : null}
          </ul>
          <p className="proposal-client-ready__lead">
            Final client table, downloads, schedule, and staffing view — ready to share.
          </p>
        </div>
        <aside className="proposal-client-ready__hero-aside" aria-label="Totals and downloads">
          <div className="proposal-client-ready__aside-card">
            <div className="proposal-client-ready__total">
              <span className="proposal-client-ready__total-label">
                {scenarios.length > 1 ? "Scenario included" : "Included total"}
              </span>
              <strong className="proposal-client-ready__total-value">
                {formatUsd(includedGrand)}
              </strong>
            </div>
            <div className="proposal-client-ready__downloads" role="group" aria-label="PDF downloads">
              <button
                type="button"
                className="proposal-client-ready__dl proposal-client-ready__dl--client"
                disabled={pdfGenerating != null || !ctx}
                onClick={onClientDownload}
              >
                <span className="proposal-client-ready__dl-icon" aria-hidden>
                  ↓
                </span>
                <span className="proposal-client-ready__dl-copy">
                  <span className="proposal-client-ready__dl-kicker">Share with client</span>
                  <span className="proposal-client-ready__dl-label">
                    {pdfGenerating === "client" ? "Generating…" : "Client Facing PDF Download"}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="proposal-client-ready__dl proposal-client-ready__dl--ops"
                disabled={pdfGenerating != null || !ctx || !tasksCtx}
                onClick={onOpsDownload}
              >
                <span className="proposal-client-ready__dl-icon" aria-hidden>
                  ↓
                </span>
                <span className="proposal-client-ready__dl-copy">
                  <span className="proposal-client-ready__dl-kicker">Internal ops</span>
                  <span className="proposal-client-ready__dl-label">
                    {pdfGenerating === "ops" ? "Generating…" : "Ops PDF Download"}
                  </span>
                </span>
              </button>
            </div>
            {onReviewedByOps ? (
              <button
                type="button"
                className="proposal-client-ready__reviewed"
                disabled={reviewedByOpsBusy || pdfGenerating != null}
                onClick={onReviewedByOps}
              >
                {reviewedByOpsBusy ? "Marking…" : "Reviewed by Ops"}
              </button>
            ) : null}
          </div>
        </aside>
      </header>

      {scenarios.length > 1 ? (
        <div className="proposal-csr__tabs" role="tablist" aria-label="Scenarios for charts">
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

      <section className="roadmap-panel roadmap-panel--export proposal-client-ready__export">
        <div className="roadmap-export__head">
          <h2 className="roadmap-export__title">Export Preview</h2>
        </div>
        <ProposalExportPreviewTables
          scenarios={scenarios}
          phases={phases}
          cards={cards}
          ctx={ctx}
          computeScratchSellPrice={computeScratchSellPrice}
          formatUsd={formatUsd}
          formatHoursShort={formatHoursShort}
          ariaLabel="Client ready proposal tables"
        />
      </section>

      <section className="proposal-client-ready-chart" aria-labelledby="proposal-gantt-title">
        <header className="proposal-client-ready-chart__head">
          <h3 id="proposal-gantt-title" className="proposal-client-ready-chart__title">
            Schedule Gantt
          </h3>
          <p className="proposal-client-ready-chart__hint">
            Included deliverables plotted by start and end date
            {scenarios.length > 1 ? " for the selected scenario" : ""}.
          </p>
        </header>
        <ProposalGanttChart bars={ganttBars} />
      </section>

      <section className="proposal-client-ready-chart" aria-labelledby="proposal-impl-title">
        <header className="proposal-client-ready-chart__head">
          <h3 id="proposal-impl-title" className="proposal-client-ready-chart__title">
            Staffing load by week
          </h3>
          <p className="proposal-client-ready-chart__hint">
            Read across a row to see one role’s hours each week. Totals and busiest week are above
            the grid.
          </p>
        </header>
        <ProposalImplementerLoadChart
          weeks={implementerLoad.weeks}
          implementers={implementerLoad.implementers}
        />
      </section>
    </div>
  );
}
