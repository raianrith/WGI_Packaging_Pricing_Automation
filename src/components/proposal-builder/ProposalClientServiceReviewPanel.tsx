import { useMemo, useState, type ReactNode } from "react";
import type { PackageSolutionTier, SolutionTier, TaskRow } from "../../types";
import {
  sortedPhasesForScenario,
  type RoadmapCard,
  type RoadmapPhase,
  type RoadmapScenario,
} from "../../lib/roadmapModel";
import {
  addProposalExtraTask,
  cardSupportsTaskReview,
  formatProposalHoursValue,
  formatProposalUsdValue,
  hideProposalTask,
  proposalLineCompareMetrics,
  reorderProposalTasks,
  resolveProposalCardTasks,
  setProposalTaskClientLabel,
  setProposalTaskHours,
  type ProposalCardTasksCtx,
} from "../../lib/proposalCardTasks";
import { SortableTableRowTr, TaskSortableList } from "../TaskTableSortable";
import { proposalStepDef } from "./ProposalBuilderSteps";

type Props = {
  scenarios: RoadmapScenario[];
  phases: RoadmapPhase[];
  cards: RoadmapCard[];
  tasks: TaskRow[];
  packageTiers: PackageSolutionTier[];
  tiers?: SolutionTier[];
  solutions?: Array<{ solution_id: string; solution_name: string }>;
  effectivePriceForCard: (card: RoadmapCard) => string;
  onPatchCard: (key: string, next: RoadmapCard) => void;
};

function phaseTitle(phases: RoadmapPhase[], phaseId: string) {
  return phases.find((p) => p.id === phaseId)?.title.trim() || "Phase";
}

function MetricCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "muted" | "changed" | "current";
}) {
  return (
    <div
      className={`proposal-csr-metrics__cell${tone ? ` proposal-csr-metrics__cell--${tone}` : ""}`}
    >
      <span className="proposal-csr-metrics__label">{label}</span>
      <strong className="proposal-csr-metrics__value">{value}</strong>
    </div>
  );
}

function CsrCard({
  card,
  phases,
  ctx,
  expanded,
  onToggle,
  effectivePriceForCard,
  onPatchCard,
  tone,
  isAddon,
  parentHeadline,
  addonCount,
}: {
  card: RoadmapCard;
  phases: RoadmapPhase[];
  ctx: ProposalCardTasksCtx;
  expanded: boolean;
  onToggle: () => void;
  effectivePriceForCard: (card: RoadmapCard) => string;
  onPatchCard: (key: string, next: RoadmapCard) => void;
  tone: "package" | "solution";
  isAddon?: boolean;
  parentHeadline?: string | null;
  addonCount?: number;
}) {
  const taskRows = resolveProposalCardTasks(card, ctx);
  const metrics = proposalLineCompareMetrics(card, ctx, effectivePriceForCard(card));
  const changed = metrics.hoursChanged || metrics.priceChanged;
  const kindClass = isAddon ? "addon" : tone;
  const kindLabel = isAddon
    ? "Add-on"
    : tone === "package"
      ? "Package"
      : card.kind === "custom_tier"
        ? "Custom"
        : "Solution";
  const metaBits = [
    isAddon && parentHeadline ? `Add-on of ${parentHeadline.trim() || "parent solution"}` : null,
    phaseTitle(phases, card.phaseId),
    `${taskRows.length} task${taskRows.length === 1 ? "" : "s"}`,
    !isAddon && addonCount && addonCount > 0
      ? `${addonCount} add-on${addonCount === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean);

  return (
    <article
      className={`proposal-csr-card proposal-csr-card--${kindClass}${expanded ? " is-expanded" : ""}${
        changed ? " is-changed" : ""
      }`}
    >
      <button
        type="button"
        className="proposal-csr-card__head"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span className="proposal-csr-card__mark" aria-hidden>
          <span className="proposal-csr-card__chevron">{expanded ? "▾" : "▸"}</span>
        </span>
        <span className="proposal-csr-card__main">
          <span className="proposal-csr-card__title-row">
            <span className={`proposal-csr-card__kind proposal-csr-card__kind--${kindClass}`}>
              {kindLabel}
            </span>
            <span className="proposal-csr-card__title">{card.headline.trim() || "Untitled"}</span>
            {changed ? <span className="proposal-csr-card__changed-pill">Updated</span> : null}
          </span>
          <span className="proposal-csr-card__meta">{metaBits.join(" · ")}</span>
          <div className="proposal-csr-metrics" aria-label="Hours and price comparison">
            <MetricCell
              label="Original hours"
              value={formatProposalHoursValue(metrics.originalHours)}
              tone="muted"
            />
            <MetricCell
              label="Original price"
              value={formatProposalUsdValue(metrics.originalPriceUsd)}
              tone="muted"
            />
            <MetricCell
              label="Current hours"
              value={formatProposalHoursValue(metrics.currentHours)}
              tone={metrics.hoursChanged ? "changed" : "current"}
            />
            <MetricCell
              label="Current price"
              value={
                metrics.currentPriceUsd != null
                  ? formatProposalUsdValue(metrics.currentPriceUsd)
                  : effectivePriceForCard(card).trim() || "—"
              }
              tone={metrics.priceChanged ? "changed" : "current"}
            />
          </div>
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
                  <th scope="col" className="proposal-csr-table__col--move">
                    <span className="visually-hidden">Reorder</span>
                  </th>
                  <th scope="col">Solution Name</th>
                  <th scope="col">Solution Tier Name</th>
                  <th scope="col">Client Facing Label</th>
                  <th scope="col">Task</th>
                  <th scope="col" className="proposal-csr-table__col--hours">
                    Original
                  </th>
                  <th scope="col" className="proposal-csr-table__col--hours">
                    Hours
                  </th>
                  <th scope="col" className="proposal-csr-table__col--actions">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <TaskSortableList
                itemIds={taskRows.map((r) => r.id)}
                onReorder={(nextIds) =>
                  onPatchCard(
                    card.key,
                    reorderProposalTasks(
                      card,
                      ctx,
                      nextIds.map((id) => String(id))
                    )
                  )
                }
              >
                <tbody>
                  {taskRows.map((row) => {
                    const rowChanged =
                      !row.isExtra &&
                      row.catalogHours != null &&
                      row.hours != null &&
                      Math.abs(row.hours - row.catalogHours) >= 0.005;
                    return (
                      <SortableTableRowTr
                        key={row.id}
                        id={row.id}
                        className={rowChanged ? "is-changed" : undefined}
                        renderCells={(dragHandle) => [
                          <td key="move" className="proposal-csr-table__col--move">
                            <div className="proposal-csr-table__move">{dragHandle}</div>
                          </td>,
                          <td key="sol">
                            <span className="proposal-csr-table__meta-text">
                              {row.solutionName?.trim() || "—"}
                            </span>
                          </td>,
                          <td key="tier">
                            <span className="proposal-csr-table__meta-text">
                              {row.solutionTierName?.trim() || "—"}
                            </span>
                          </td>,
                          <td key="label">
                            {row.componentLabel?.trim() ? (
                              <span className="proposal-csr-table__solution-label">
                                {row.componentLabel.trim()}
                              </span>
                            ) : (
                              <span className="proposal-csr-table__solution-label proposal-csr-table__solution-label--empty">
                                —
                              </span>
                            )}
                          </td>,
                          <td key="task">
                            {row.isExtra ? (
                              <input
                                className="roadmap-input proposal-csr-table__name-input"
                                value={row.name}
                                onChange={(e) =>
                                  onPatchCard(
                                    card.key,
                                    setProposalTaskClientLabel(card, ctx, row.id, e.target.value)
                                  )
                                }
                                aria-label="Proposal task name"
                              />
                            ) : (
                              <span className="proposal-csr-table__task-name">{row.catalogName}</span>
                            )}
                          </td>,
                          <td
                            key="original"
                            className="proposal-csr-table__col--hours proposal-csr-table__original"
                          >
                            {row.isExtra ? "—" : formatProposalHoursValue(row.catalogHours)}
                          </td>,
                          <td key="hours" className="proposal-csr-table__col--hours">
                            <input
                              type="number"
                              min={0}
                              step={0.25}
                              className={`roadmap-input proposal-csr-table__hours${
                                rowChanged ? " is-changed" : ""
                              }`}
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
                                onPatchCard(card.key, setProposalTaskHours(card, ctx, row.id, hours));
                              }}
                              aria-label={`Hours for ${row.name}`}
                            />
                          </td>,
                          <td key="actions" className="proposal-csr-table__col--actions">
                            <button
                              type="button"
                              className="roadmap-btn roadmap-btn--sm roadmap-btn--ghost"
                              onClick={() =>
                                onPatchCard(card.key, hideProposalTask(card, ctx, row.id))
                              }
                            >
                              {row.isExtra ? "Remove" : "Delete"}
                            </button>
                          </td>,
                        ]}
                      />
                    );
                  })}
                </tbody>
              </TaskSortableList>
            </table>
          )}

          <div className="proposal-csr-card__footer">
            <button
              type="button"
              className="roadmap-btn roadmap-btn--sm roadmap-btn--ghost"
              onClick={() => onPatchCard(card.key, addProposalExtraTask(card, ctx))}
            >
              + Add task
            </button>
            {card.taskLayout ? (
              <span className="proposal-csr-card__note">Proposal-only edits · catalog unchanged</span>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function Section({
  title,
  hint,
  count,
  extraCount,
  tone,
  children,
}: {
  title: string;
  hint: string;
  count: number;
  extraCount?: string;
  tone: "package" | "solution";
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section className={`proposal-csr-section proposal-csr-section--${tone}`} aria-label={title}>
      <header className="proposal-csr-section__head">
        <div className="proposal-csr-section__intro">
          <span className={`proposal-csr-section__icon proposal-csr-section__icon--${tone}`} aria-hidden>
            {tone === "package" ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M3 8.5 12 4l9 4.5v7L12 20l-9-4.5v-7Z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
                <path d="M12 12v8M3.5 9 12 13.5 20.5 9" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-9Z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
                <path d="M8 9.5h8M8 13h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            )}
          </span>
          <div>
            <h3 className="proposal-csr-section__title">{title}</h3>
            <p className="proposal-csr-section__hint">{hint}</p>
          </div>
        </div>
        <span className={`proposal-csr-section__count proposal-csr-section__count--${tone}`}>
          {count} item{count === 1 ? "" : "s"}
          {extraCount ? ` · ${extraCount}` : ""}
        </span>
      </header>
      <ul className="proposal-csr__list">{children}</ul>
    </section>
  );
}

export function ProposalClientServiceReviewPanel({
  scenarios,
  phases,
  cards,
  tasks,
  packageTiers,
  tiers,
  solutions,
  effectivePriceForCard,
  onPatchCard,
}: Props) {
  const stepMeta = proposalStepDef("client_service");
  const ctx: ProposalCardTasksCtx = useMemo(
    () => ({ tasks, packageTiers, tiers, solutions }),
    [tasks, packageTiers, tiers, solutions]
  );
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

  const packageCards = useMemo(
    () => scenarioCards.filter((c) => c.kind === "package"),
    [scenarioCards]
  );
  const solutionCards = useMemo(
    () => scenarioCards.filter((c) => c.kind === "tier" || c.kind === "custom_tier"),
    [scenarioCards]
  );
  const solutionGroups = useMemo(() => {
    const keySet = new Set(solutionCards.map((c) => c.key));
    const addonsByParent = new Map<string, RoadmapCard[]>();
    for (const c of solutionCards) {
      if (!c.addonOfCardKey || !keySet.has(c.addonOfCardKey)) continue;
      const list = addonsByParent.get(c.addonOfCardKey) ?? [];
      list.push(c);
      addonsByParent.set(c.addonOfCardKey, list);
    }
    const parents = solutionCards.filter((c) => !c.addonOfCardKey || !keySet.has(c.addonOfCardKey));
    return parents.map((card) => ({
      card,
      addons: addonsByParent.get(card.key) ?? [],
    }));
  }, [solutionCards]);
  const nestedAddonCount = useMemo(
    () => solutionGroups.reduce((n, g) => n + g.addons.length, 0),
    [solutionGroups]
  );

  const proposalTotals = useMemo(() => {
    const included = scenarioCards.filter((c) => c.scope === "included");
    const lines = included.length > 0 ? included : scenarioCards;
    let originalHours = 0;
    let currentHours = 0;
    let originalPrice = 0;
    let currentPrice = 0;
    let origHCount = 0;
    let curHCount = 0;
    let origPCount = 0;
    let curPCount = 0;

    for (const card of lines) {
      const m = proposalLineCompareMetrics(card, ctx, effectivePriceForCard(card));
      if (m.originalHours != null) {
        originalHours += m.originalHours;
        origHCount += 1;
      }
      if (m.currentHours != null) {
        currentHours += m.currentHours;
        curHCount += 1;
      }
      if (m.originalPriceUsd != null) {
        originalPrice += m.originalPriceUsd;
        origPCount += 1;
      }
      if (m.currentPriceUsd != null) {
        currentPrice += m.currentPriceUsd;
        curPCount += 1;
      }
    }

    const hoursChanged = Math.abs(currentHours - originalHours) >= 0.005;
    const priceChanged = Math.round(currentPrice) !== Math.round(originalPrice);
    const priceDelta = currentPrice - originalPrice;

    return {
      lineCount: lines.length,
      usedIncludedOnly: included.length > 0,
      originalHours: origHCount > 0 ? originalHours : null,
      currentHours: curHCount > 0 ? currentHours : null,
      originalPrice: origPCount > 0 ? originalPrice : null,
      currentPrice: curPCount > 0 ? currentPrice : null,
      hoursChanged,
      priceChanged,
      priceDelta: origPCount > 0 && curPCount > 0 ? priceDelta : null,
    };
  }, [scenarioCards, ctx, effectivePriceForCard]);

  const toggleExpanded = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderCard = (
    card: RoadmapCard,
    tone: "package" | "solution",
    extra?: { isAddon?: boolean; parentHeadline?: string | null; addonCount?: number }
  ) => (
    <CsrCard
      card={card}
      phases={phases}
      ctx={ctx}
      expanded={expandedKeys.has(card.key)}
      onToggle={() => toggleExpanded(card.key)}
      effectivePriceForCard={effectivePriceForCard}
      onPatchCard={onPatchCard}
      tone={tone}
      isAddon={extra?.isAddon}
      parentHeadline={extra?.parentHeadline}
      addonCount={extra?.addonCount}
    />
  );

  return (
    <div className="proposal-step-panel proposal-csr">
      <header className="proposal-step-panel__head proposal-csr__head">
        <p className="proposal-step-panel__eyebrow">Step {stepMeta.number}</p>
        <h2 className="proposal-step-panel__title">{stepMeta.label}</h2>
        <p className="proposal-step-panel__lead">
          Review packages and solutions separately. Change task hours to update the proposal price —
          original catalog values stay visible for comparison.
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

      {scenarioCards.length > 0 ? (
        <div
          className={`proposal-csr-totals${
            proposalTotals.priceChanged || proposalTotals.hoursChanged ? " is-changed" : ""
          }`}
          aria-label="Overall proposal comparison"
        >
          <div className="proposal-csr-totals__intro">
            <p className="proposal-csr-totals__eyebrow">Overall proposal</p>
            <h3 className="proposal-csr-totals__title">
              {proposalTotals.usedIncludedOnly ? "Included total" : "Scenario total"}
            </h3>
            <p className="proposal-csr-totals__hint">
              {proposalTotals.lineCount} included line
              {proposalTotals.lineCount === 1 ? "" : "s"}
              {proposalTotals.priceChanged && proposalTotals.priceDelta != null
                ? ` · ${proposalTotals.priceDelta > 0 ? "+" : ""}${formatProposalUsdValue(
                    proposalTotals.priceDelta
                  )} after task edits`
                : " · same as original until you edit tasks"}
            </p>
          </div>
          <div className="proposal-csr-totals__grid">
            <MetricCell
              label="Original hours"
              value={formatProposalHoursValue(proposalTotals.originalHours)}
              tone="muted"
            />
            <MetricCell
              label="Original price"
              value={formatProposalUsdValue(proposalTotals.originalPrice)}
              tone="muted"
            />
            <MetricCell
              label="Current hours"
              value={formatProposalHoursValue(proposalTotals.currentHours)}
              tone={proposalTotals.hoursChanged ? "changed" : "current"}
            />
            <MetricCell
              label="Current price"
              value={formatProposalUsdValue(proposalTotals.currentPrice)}
              tone={proposalTotals.priceChanged ? "changed" : "current"}
            />
          </div>
        </div>
      ) : null}

      {scenarioCards.length === 0 ? (
        <p className="proposal-csr__empty">
          No solutions or packages in this scenario yet. Add them in earlier steps, then come back to
          refine tasks.
        </p>
      ) : (
        <div className="proposal-csr__sections">
          <Section
            title="Packages"
            hint="Bundled offerings — edit hours and see price update"
            count={packageCards.length}
            tone="package"
          >
            {packageCards.map((card) => (
              <li key={card.key}>{renderCard(card, "package")}</li>
            ))}
          </Section>
          <Section
            title="Solutions"
            hint="Solution tiers with add-ons nested underneath"
            count={solutionGroups.length}
            extraCount={
              nestedAddonCount > 0
                ? `${nestedAddonCount} add-on${nestedAddonCount === 1 ? "" : "s"}`
                : undefined
            }
            tone="solution"
          >
            {solutionGroups.map(({ card, addons }) => (
              <li key={card.key} className="proposal-csr-group">
                {renderCard(card, "solution", { addonCount: addons.length })}
                {addons.length > 0 ? (
                  <ul className="proposal-csr-group__nested">
                    {addons.map((addon) => (
                      <li key={addon.key}>
                        {renderCard(addon, "solution", {
                          isAddon: true,
                          parentHeadline: card.headline,
                        })}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </Section>
        </div>
      )}
    </div>
  );
}
