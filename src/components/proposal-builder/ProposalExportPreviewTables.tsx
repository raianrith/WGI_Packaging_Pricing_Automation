import {
  cardHoursForScenarioRollup,
  cardPriceUsdForRollup,
  effectivePriceStr,
  sortedPhasesForScenario,
  type CatalogCtxLike,
  type RoadmapCard,
  type RoadmapPhase,
  type RoadmapScenario,
} from "../../lib/roadmapModel";
import { computeProposalAccountMgmtRollup } from "../../lib/proposalAccountMgmt";
import { proposalDateRangeLabel } from "../../lib/proposalDates";
import {
  isTravelVariableTierRefId,
  variableTierAppliedToLabel,
} from "../../lib/proposalVariableTiers";
import { ProposalOrganizeAccountMgmtCard } from "./ProposalOrganizeAccountMgmtCard";

function descPreview(text: string, max = 140): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

type Props = {
  scenarios: RoadmapScenario[];
  phases: RoadmapPhase[];
  cards: RoadmapCard[];
  ctx: CatalogCtxLike | null;
  computeScratchSellPrice: (c: RoadmapCard, ctx: CatalogCtxLike | null) => string;
  formatUsd: (n: number | null | undefined) => string;
  formatHoursShort: (n: number) => string;
  /** Optional aria label for the wrap. */
  ariaLabel?: string;
};

function renderRow(
  c: RoadmapCard,
  scenCards: RoadmapCard[],
  ctx: CatalogCtxLike | null,
  computeScratchSellPrice: Props["computeScratchSellPrice"]
) {
  const appliedToLabel = variableTierAppliedToLabel(c, scenCards);
  return (
    <tr key={c.key}>
      <td className="roadmap-export-table__col roadmap-export-table__col--deliverable">
        <div className="roadmap-export-table__deliverable">
          <div className="roadmap-export-table__deliverable-head">
            <strong className="roadmap-export-table__name">
              {c.headline.trim() || "(untitled)"}
            </strong>
            <span className={`roadmap-export-table__scope roadmap-export-table__scope--${c.scope}`}>
              {c.scope}
            </span>
          </div>
          {appliedToLabel && !isTravelVariableTierRefId(c.refId) ? (
            <span className="roadmap-export-table__applied">
              Applied to <strong>{appliedToLabel}</strong>
            </span>
          ) : null}
          {c.description.trim() && c.kind !== "tier" && c.kind !== "custom_tier" ? (
            <p className="roadmap-export-table__desc">{descPreview(c.description)}</p>
          ) : null}
        </div>
      </td>
      <td className="roadmap-export-table__col roadmap-export-table__col--dates">
        {proposalDateRangeLabel(c.startDate, c.endDate)}
      </td>
      <td className="roadmap-export-table__col roadmap-export-table__col--num">
        {effectivePriceStr(c, ctx, computeScratchSellPrice) || "—"}
      </td>
    </tr>
  );
}

function TableHead() {
  return (
    <thead>
      <tr>
        <th>Deliverable</th>
        <th>Dates</th>
        <th>Price</th>
      </tr>
    </thead>
  );
}

/** Same export preview tables as Strategist Review (by scenario/phase). */
export function ProposalExportPreviewTables({
  scenarios,
  phases,
  cards,
  ctx,
  computeScratchSellPrice,
  formatUsd,
  formatHoursShort,
  ariaLabel = "Proposal export tables",
}: Props) {
  const accountMgmt = computeProposalAccountMgmtRollup(cards, ctx);

  return (
    <div className="roadmap-export-table-wrap" aria-label={ariaLabel}>
      {accountMgmt.includedLineCount > 0 ? (
        <ProposalOrganizeAccountMgmtCard
          accountMgmtHours={accountMgmt.accountMgmtHours}
          continuousImprovementHours={accountMgmt.continuousImprovementHours}
          resourceHours={accountMgmt.resourceHours}
          formatHoursShort={formatHoursShort}
        />
      ) : null}
      {scenarios.map((scenario) => {
        const scenCards = cards.filter((c) => c.scenarioId === scenario.id);
        const phaseOrder = sortedPhasesForScenario(phases, scenario.id);
        let includedGrand = 0;
        for (const c of scenCards) {
          if (c.scope !== "included") continue;
          const p = cardPriceUsdForRollup(c, ctx, computeScratchSellPrice);
          if (p != null) includedGrand += p;
        }
        return (
          <section key={scenario.id} className="roadmap-export-table">
            <header className="roadmap-export-table__head">
              <h3 className="roadmap-export-table__title">{scenario.title}</h3>
              <span className="roadmap-export-table__sum">{formatUsd(includedGrand)} included</span>
            </header>
            {scenCards.length === 0 ? (
              <p className="roadmap-export-table__empty">Nothing added yet.</p>
            ) : (
              <>
                {phaseOrder.map((phase) => {
                  const rows = scenCards.filter((c) => c.phaseId === phase.id && c.scope === "included");
                  if (rows.length === 0) return null;
                  let ps = 0;
                  let ph = 0;
                  let phn = 0;
                  for (const c of rows) {
                    const pu = cardPriceUsdForRollup(c, ctx, computeScratchSellPrice);
                    if (pu != null) ps += pu;
                    const hh = cardHoursForScenarioRollup(c, ctx);
                    if (hh != null) {
                      ph += hh;
                      phn += 1;
                    }
                  }
                  return (
                    <div key={phase.id} className="roadmap-export-phase">
                      <h4 className="roadmap-export-phase__title">
                        {phase.title.trim() || "Phase"}{" "}
                        <span className="roadmap-export-phase__sub">
                          {formatUsd(ps)}
                          {phn > 0 ? ` · ~${formatHoursShort(ph)} h` : ""}
                        </span>
                      </h4>
                      <table>
                        <TableHead />
                        <tbody>
                          {rows.map((c) => renderRow(c, scenCards, ctx, computeScratchSellPrice))}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
                {(() => {
                  const opt = scenCards.filter((c) => c.scope === "optional");
                  if (!opt.length) return null;
                  return (
                    <div className="roadmap-export-phase roadmap-export-phase--optional">
                      <h4 className="roadmap-export-phase__title">Optional Add-Ons</h4>
                      <table>
                        <TableHead />
                        <tbody>
                          {opt.map((c) => renderRow(c, scenCards, ctx, computeScratchSellPrice))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
                {(() => {
                  const def = scenCards.filter((c) => c.scope === "deferred");
                  if (!def.length) return null;
                  return (
                    <div className="roadmap-export-phase roadmap-export-phase--deferred">
                      <h4 className="roadmap-export-phase__title">Deferred (Not In Core)</h4>
                      <table>
                        <TableHead />
                        <tbody>
                          {def.map((c) => renderRow(c, scenCards, ctx, computeScratchSellPrice))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
