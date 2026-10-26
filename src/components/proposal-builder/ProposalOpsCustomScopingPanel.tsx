import { useMemo, useState, type ReactNode } from "react";
import {
  customScopingDeliverableLabel,
  customScopingSummaryLines,
  type CustomScopingRequest,
  type CustomScopingState,
} from "../../lib/customScopingRequest";
import {
  effectiveHoursStr,
  effectivePriceStr,
  type CatalogCtxLike,
  type RoadmapCard,
} from "../../lib/roadmapModel";
import {
  formatProposalHoursValue,
  formatProposalUsdValue,
  newProposalExtraTaskId,
} from "../../lib/proposalCardTasks";
import { proposalStepDef } from "./ProposalBuilderSteps";

export type OpsScopingFulfillMethod = "existing" | "package" | "custom";

const METHODS: { id: OpsScopingFulfillMethod; label: string; hint: string }[] = [
  { id: "existing", label: "Existing solution", hint: "Pick a catalog tier" },
  { id: "package", label: "Build package", hint: "Template or re-use" },
  { id: "custom", label: "Custom solution", hint: "Tasks, hours, price" },
];

type LinkedLine = {
  key: string;
  headline: string;
  kindLabel: string;
  hours: string;
  price: string;
};

type Props = {
  state: CustomScopingState;
  cards: RoadmapCard[];
  ctx: CatalogCtxLike | null;
  computeScratchSellPrice: (c: RoadmapCard, ctx: CatalogCtxLike | null) => string;
  budget: number | null;
  usedUsd: number;
  scenarioTitle?: string;
  formatUsd: (n: number | null | undefined) => string;
  activeRequestId: string | null;
  activeMethod: OpsScopingFulfillMethod | null;
  onSelectMethod: (requestId: string, method: OpsScopingFulfillMethod | null) => void;
  onSkip: (requestId: string) => void;
  onUnskip: (requestId: string) => void;
  onRemoveLinked: (key: string) => void;
  targetBar: ReactNode;
  workbench: ReactNode;
};

function OpsBudgetStrip({
  budget,
  usedUsd,
  pendingUsd,
  scenarioTitle,
  formatUsd,
}: {
  budget: number | null;
  usedUsd: number;
  pendingUsd?: number | null;
  scenarioTitle?: string;
  formatUsd: (n: number | null | undefined) => string;
}) {
  const hasBudget = budget != null && budget > 0;
  const remaining = hasBudget ? budget - usedUsd : null;
  const afterUsed = pendingUsd != null && pendingUsd > 0 ? usedUsd + pendingUsd : usedUsd;
  const afterRemaining = hasBudget ? budget - afterUsed : null;
  const pct = hasBudget ? Math.min(100, Math.round((usedUsd / budget) * 100)) : null;
  const afterPct = hasBudget ? Math.min(100, Math.round((afterUsed / budget) * 100)) : null;
  const usedLabel = scenarioTitle?.trim() ? `Used · ${scenarioTitle.trim()}` : "Used";

  return (
    <section className="proposal-ops-budget" aria-label="Proposal budget">
      <dl className="proposal-ops-budget__kpis">
        <div>
          <dt>Budget</dt>
          <dd>{hasBudget ? formatUsd(budget) : "—"}</dd>
        </div>
        <div>
          <dt>{usedLabel}</dt>
          <dd>{formatUsd(usedUsd)}</dd>
        </div>
        <div className={remaining != null && remaining < 0 ? "is-over" : undefined}>
          <dt>Remaining</dt>
          <dd>
            {remaining == null
              ? "—"
              : remaining < 0
                ? `Over ${formatUsd(Math.abs(remaining))}`
                : formatUsd(remaining)}
          </dd>
        </div>
        {pendingUsd != null && pendingUsd > 0 ? (
          <div className={afterRemaining != null && afterRemaining < 0 ? "is-over" : undefined}>
            <dt>After this line</dt>
            <dd>
              {afterRemaining == null
                ? formatUsd(afterUsed)
                : afterRemaining < 0
                  ? `Over ${formatUsd(Math.abs(afterRemaining))}`
                  : formatUsd(afterRemaining)}
            </dd>
          </div>
        ) : null}
      </dl>
      {hasBudget ? (
        <div className="proposal-ops-budget__meter" aria-hidden>
          <span className="proposal-ops-budget__fill" style={{ width: `${pct ?? 0}%` }} />
          {afterPct != null && afterPct > (pct ?? 0) ? (
            <span className="proposal-ops-budget__fill is-pending" style={{ width: `${afterPct}%` }} />
          ) : null}
        </div>
      ) : (
        <p className="proposal-ops-budget__hint">No client budget on this proposal. Used is included scope so far.</p>
      )}
    </section>
  );
}

function kindLabel(card: RoadmapCard): string {
  if (card.addonOfCardKey) return "Add-on";
  switch (card.kind) {
    case "package":
      return "Package";
    case "playbook":
      return "Playbook";
    case "custom_tier":
      return "Custom";
    case "tier":
      return "Solution";
    default:
      return "Item";
  }
}

function requestStatus(
  request: CustomScopingRequest,
  linkedCount: number
): "open" | "fulfilled" | "skipped" {
  if (linkedCount > 0) return "fulfilled";
  if (request.skipped) return "skipped";
  return "open";
}

export function ProposalOpsCustomScopingPanel({
  state,
  cards,
  ctx,
  computeScratchSellPrice,
  budget,
  usedUsd,
  scenarioTitle,
  formatUsd,
  activeRequestId,
  activeMethod,
  onSelectMethod,
  onSkip,
  onUnskip,
  onRemoveLinked,
  targetBar,
  workbench,
}: Props) {
  const stepMeta = proposalStepDef("ops_scoping");
  const requests = state.requests;
  const [expandedId, setExpandedId] = useState<string | null>(
    () => requests[0]?.id ?? null
  );

  const linkedByRequest = useMemo(() => {
    const map = new Map<string, LinkedLine[]>();
    for (const card of cards) {
      const id = card.customScopingRequestId;
      if (!id) continue;
      const line: LinkedLine = {
        key: card.key,
        headline: card.headline.trim() || "Untitled",
        kindLabel: kindLabel(card),
        hours: effectiveHoursStr(card) || "—",
        price: effectivePriceStr(card, ctx, computeScratchSellPrice) || "—",
      };
      const list = map.get(id) ?? [];
      list.push(line);
      map.set(id, list);
    }
    return map;
  }, [cards, ctx, computeScratchSellPrice]);

  return (
    <div className="proposal-step-panel proposal-ops-scoping">
      <header className="proposal-step-panel__head">
        <h2 className="proposal-step-panel__title">{stepMeta.label}</h2>
        <p className="proposal-step-panel__lead">
          Review each custom scoping request, then add matching catalog solutions, a package, or a
          custom solution built from tasks and hours.
        </p>
      </header>

      <OpsBudgetStrip
        budget={budget}
        usedUsd={usedUsd}
        scenarioTitle={scenarioTitle}
        formatUsd={formatUsd}
      />

      {!state.required || requests.length === 0 ? (
        <p className="proposal-ops-scoping__empty">
          No custom scoping requests on this proposal. Continue to Ops Review.
        </p>
      ) : (
        <ul className="proposal-ops-scoping__list">
          {requests.map((request) => {
            const linked = linkedByRequest.get(request.id) ?? [];
            const status = requestStatus(request, linked.length);
            const open = expandedId === request.id;
            const fulfilling = activeRequestId === request.id && activeMethod != null;
            return (
              <li key={request.id}>
                <article
                  className={`proposal-ops-scoping-card${open ? " is-open" : ""}${
                    fulfilling ? " is-fulfilling" : ""
                  } proposal-ops-scoping-card--${status}`}
                >
                  <header className="proposal-ops-scoping-card__head">
                    <button
                      type="button"
                      className="proposal-ops-scoping-card__toggle"
                      aria-expanded={open}
                      onClick={() => setExpandedId(open ? null : request.id)}
                    >
                      <span className="proposal-ops-scoping-card__mark" aria-hidden>
                        {open ? "▾" : "▸"}
                      </span>
                      <span className="proposal-ops-scoping-card__identity">
                        <span className="proposal-ops-scoping-card__title-row">
                          <strong className="proposal-ops-scoping-card__name">{request.name}</strong>
                          <span className="proposal-ops-scoping-card__type">
                            {customScopingDeliverableLabel(request)}
                          </span>
                        </span>
                        {!open ? (
                          <span className="proposal-ops-scoping-card__preview">
                            {request.overviewAndGoal}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    <span className={`proposal-ops-scoping-card__status is-${status}`}>
                      {status === "fulfilled"
                        ? `Fulfilled · ${linked.length}`
                        : status === "skipped"
                          ? "Skipped"
                          : "Open"}
                    </span>
                  </header>

                  {open ? (
                    <div className="proposal-ops-scoping-card__body">
                      <dl className="proposal-ops-scoping-card__details">
                        {customScopingSummaryLines(request).map((row) => (
                          <div key={row.label} className="proposal-ops-scoping-card__detail">
                            <dt>{row.label}</dt>
                            <dd>{row.value}</dd>
                          </div>
                        ))}
                      </dl>

                      {linked.length > 0 ? (
                        <div className="proposal-ops-scoping-card__linked">
                          <h4 className="proposal-ops-scoping-card__linked-title">Added for this request</h4>
                          <ul>
                            {linked.map((line) => (
                              <li key={line.key}>
                                <span className="proposal-ops-scoping-card__linked-kind">
                                  {line.kindLabel}
                                </span>
                                <strong>{line.headline}</strong>
                                <span className="proposal-ops-scoping-card__linked-metrics">
                                  {line.hours} · {line.price}
                                </span>
                                <button
                                  type="button"
                                  className="proposal-ops-scoping-card__linked-remove"
                                  onClick={() => onRemoveLinked(line.key)}
                                >
                                  Remove
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      <div className="proposal-ops-scoping-card__actions">
                        {METHODS.map((method) => (
                          <button
                            key={method.id}
                            type="button"
                            className={`proposal-ops-scoping-card__method${
                              fulfilling && activeMethod === method.id ? " is-active" : ""
                            }`}
                            onClick={() => {
                              if (status === "skipped") onUnskip(request.id);
                              onSelectMethod(
                                request.id,
                                fulfilling && activeMethod === method.id ? null : method.id
                              );
                              setExpandedId(request.id);
                            }}
                          >
                            <strong>{method.label}</strong>
                            <span>{method.hint}</span>
                          </button>
                        ))}
                        {status === "skipped" ? (
                          <button
                            type="button"
                            className="roadmap-btn roadmap-btn--ghost roadmap-btn--sm"
                            onClick={() => onUnskip(request.id)}
                          >
                            Reopen
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="roadmap-btn roadmap-btn--ghost roadmap-btn--sm"
                            onClick={() => onSkip(request.id)}
                          >
                            Skip
                          </button>
                        )}
                      </div>

                      {fulfilling ? (
                        <div className="proposal-ops-scoping-card__workbench">
                          <p className="proposal-ops-scoping-card__workbench-lead">
                            Adding to this request · pick the scenario and phase, then add scope.
                          </p>
                          {targetBar}
                          {workbench}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

type DraftTask = { id: string; name: string; hours: string };

function emptyDraftTask(): DraftTask {
  return { id: newProposalExtraTaskId(), name: "", hours: "" };
}

type CustomFormProps = {
  request: CustomScopingRequest;
  canAdd: boolean;
  defaultBlendRate: number;
  budget: number | null;
  usedUsd: number;
  scenarioTitle?: string;
  formatUsd: (n: number | null | undefined) => string;
  onAdd: (input: {
    headline: string;
    description: string;
    hours: number;
    blendRate: number;
    priceOverrideUsd: number | null;
    extras: { id: string; name: string; hours: number }[];
  }) => void;
};

export function ProposalOpsCustomSolutionForm({
  request,
  canAdd,
  defaultBlendRate,
  budget,
  usedUsd,
  scenarioTitle,
  formatUsd,
  onAdd,
}: CustomFormProps) {
  const [headline, setHeadline] = useState(request.name.trim() || "Custom solution");
  const [tasks, setTasks] = useState<DraftTask[]>([emptyDraftTask()]);
  const [blendRate, setBlendRate] = useState(String(defaultBlendRate));
  const [priceOverride, setPriceOverride] = useState("");
  const [error, setError] = useState("");

  const parsedTasks = tasks
    .map((t) => ({
      id: t.id,
      name: t.name.trim(),
      hours: Number(String(t.hours).trim().replace(/h/i, "")),
    }))
    .filter((t) => t.name && Number.isFinite(t.hours) && t.hours > 0);
  const hoursTotal = parsedTasks.reduce((sum, t) => sum + t.hours, 0);
  const rate = Number(blendRate);
  const calculated = Number.isFinite(rate) && rate >= 0 && hoursTotal > 0 ? Math.round(hoursTotal * rate) : null;
  const overrideN = Number(String(priceOverride).replace(/[$,\s]/g, ""));
  const sell = Number.isFinite(overrideN) && overrideN > 0 ? overrideN : calculated;

  function addTaskRow() {
    setTasks((prev) => [...prev, emptyDraftTask()]);
  }

  function patchTask(id: string, patch: Partial<DraftTask>) {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function removeTask(id: string) {
    setTasks((prev) => (prev.length <= 1 ? [emptyDraftTask()] : prev.filter((t) => t.id !== id)));
  }

  function submit() {
    setError("");
    if (!headline.trim()) {
      setError("Name this custom solution.");
      return;
    }
    if (parsedTasks.length === 0) {
      setError("Add at least one task with hours.");
      return;
    }
    if (!Number.isFinite(rate) || rate < 0) {
      setError("Enter a blended hourly rate.");
      return;
    }
    onAdd({
      headline: headline.trim(),
      description: request.overviewAndGoal
        ? `Custom scoped from “${request.name}”. ${request.overviewAndGoal}`
        : `Custom scoped from “${request.name}”.`,
      hours: hoursTotal,
      blendRate: rate,
      priceOverrideUsd: Number.isFinite(overrideN) && overrideN > 0 ? overrideN : null,
      extras: parsedTasks,
    });
    setTasks([emptyDraftTask()]);
    setPriceOverride("");
  }

  return (
    <form
      className="proposal-ops-custom"
      onSubmit={(e) => {
        e.preventDefault();
        if (canAdd) submit();
      }}
    >
      <OpsBudgetStrip
        budget={budget}
        usedUsd={usedUsd}
        pendingUsd={sell}
        scenarioTitle={scenarioTitle}
        formatUsd={formatUsd}
      />
      {request.budget.trim() ? (
        <p className="proposal-ops-custom__request-budget">
          Request noted budget: <strong>{request.budget.trim()}</strong>
        </p>
      ) : null}

      <label className="proposal-ops-custom__field">
        <span>Solution name</span>
        <input
          className="roadmap-input"
          value={headline}
          onChange={(e) => setHeadline(e.target.value)}
        />
      </label>

      <div className="proposal-ops-custom__tasks">
        <div className="proposal-ops-custom__tasks-head">
          <h4>Tasks &amp; hours</h4>
          <button type="button" className="roadmap-btn roadmap-btn--ghost roadmap-btn--sm" onClick={addTaskRow}>
            + Task
          </button>
        </div>
        <ul>
          {tasks.map((task, i) => (
            <li key={task.id}>
              <input
                className="roadmap-input"
                placeholder={`Task ${i + 1}`}
                value={task.name}
                onChange={(e) => patchTask(task.id, { name: e.target.value })}
                aria-label={`Task ${i + 1} name`}
              />
              <input
                className="roadmap-input"
                inputMode="decimal"
                placeholder="Hours"
                value={task.hours}
                onChange={(e) => patchTask(task.id, { hours: e.target.value })}
                aria-label={`Task ${i + 1} hours`}
              />
              <button type="button" className="proposal-ops-custom__remove" onClick={() => removeTask(task.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="proposal-ops-custom__pricing">
        <label className="proposal-ops-custom__field">
          <span>Blended rate ($/h)</span>
          <input
            className="roadmap-input"
            inputMode="decimal"
            value={blendRate}
            onChange={(e) => setBlendRate(e.target.value)}
          />
        </label>
        <label className="proposal-ops-custom__field">
          <span>Price override</span>
          <input
            className="roadmap-input"
            inputMode="decimal"
            placeholder="Leave blank to use calculated"
            value={priceOverride}
            onChange={(e) => setPriceOverride(e.target.value)}
          />
        </label>
        <dl className="proposal-ops-custom__totals">
          <div>
            <dt>Hours</dt>
            <dd>{hoursTotal > 0 ? formatProposalHoursValue(hoursTotal) : "—"}</dd>
          </div>
          <div>
            <dt>Calculated</dt>
            <dd>{calculated != null ? formatUsd(calculated) : "—"}</dd>
          </div>
          <div>
            <dt>Sell</dt>
            <dd>{sell != null ? formatProposalUsdValue(sell) : "—"}</dd>
          </div>
        </dl>
      </div>

      {error ? (
        <p className="proposal-ops-custom__error" role="alert">
          {error}
        </p>
      ) : null}

      <button type="submit" className="roadmap-btn roadmap-btn--primary" disabled={!canAdd}>
        Add custom solution
      </button>
    </form>
  );
}
