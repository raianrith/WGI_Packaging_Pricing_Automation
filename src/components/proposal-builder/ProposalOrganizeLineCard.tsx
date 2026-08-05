import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CSSProperties } from "react";
import type { RoadmapCard, RoadmapLineScope, RoadmapPhase } from "../../lib/roadmapModel";
import { effectiveHoursStr, effectivePriceStr } from "../../lib/roadmapModel";
import { normalizeIsoDateInput } from "../../lib/proposalDates";
import { isTravelVariableTierRefId, isVariableTierRefId, variableTierAppliedToLabel } from "../../lib/proposalVariableTiers";

type CatalogCtxLike = Parameters<typeof effectivePriceStr>[1];

const SCOPES: { id: RoadmapLineScope; label: string }[] = [
  { id: "included", label: "Included" },
  { id: "optional", label: "Optional" },
  { id: "deferred", label: "Deferred" },
];

function kindShort(kind: RoadmapCard["kind"]): string {
  switch (kind) {
    case "tier":
      return "Tier";
    case "custom_tier":
      return "Custom";
    case "package":
      return "Package";
    default:
      return "Item";
  }
}

type Props = {
  card: RoadmapCard;
  scenarioCards: RoadmapCard[];
  ctx: CatalogCtxLike;
  phaseChoices: RoadmapPhase[];
  computeScratchSellPrice: (c: RoadmapCard, ctx: CatalogCtxLike) => string;
  onPatch: (key: string, patch: Partial<RoadmapCard>) => void;
  onRemove: (key: string) => void;
  onDetails: (card: RoadmapCard) => void;
  onEditPricing: (card: RoadmapCard) => void;
};

export function ProposalOrganizeLineCard({
  card,
  scenarioCards,
  ctx,
  phaseChoices,
  computeScratchSellPrice,
  onPatch,
  onRemove,
  onDetails,
  onEditPricing,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.key,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging ? { zIndex: 2, position: "relative" } : {}),
  };

  const hours = effectiveHoursStr(card);
  const price = effectivePriceStr(card, ctx, computeScratchSellPrice);
  const hasProposalOverride = Boolean(card.hoursOverride?.trim() || card.priceOverride?.trim());
  const appliedToLabel = isVariableTierRefId(card.refId)
    ? variableTierAppliedToLabel(card, scenarioCards)
    : null;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`proposal-organize-line proposal-organize-line--${card.scope}${isDragging ? " proposal-organize-line--dragging" : ""}`}
    >
      <div className="proposal-organize-line__reorder">
        <button
          type="button"
          className="proposal-organize-line__drag-handle admin-task-drag-handle"
          aria-label="Drag to reorder"
          title="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <span className="admin-task-drag-handle__grip" aria-hidden>
            ⠿
          </span>
        </button>
      </div>

      <div className="proposal-organize-line__accent" aria-hidden />

      <div className="proposal-organize-line__body">
        <div className="proposal-organize-line__header">
          <div className="proposal-organize-line__scope" role="group" aria-label="Line scope">
            {SCOPES.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`proposal-organize-line__scope-btn${card.scope === s.id ? " is-active" : ""}`}
                aria-pressed={card.scope === s.id}
                onClick={() => onPatch(card.key, { scope: s.id })}
              >
                {s.label}
              </button>
            ))}
          </div>

          <span className={`proposal-organize-line__kind proposal-organize-line__kind--${card.kind}`}>
            {kindShort(card.kind)}
          </span>

          <label className="proposal-organize-line__title-wrap">
            <span className="visually-hidden">
              Rename {kindShort(card.kind).toLowerCase()} label
            </span>
            <input
              type="text"
              className="proposal-organize-line__title-input"
              value={card.headline}
              placeholder="Untitled"
              title="Click to rename"
              onChange={(e) => onPatch(card.key, { headline: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          </label>
          {appliedToLabel && !isTravelVariableTierRefId(card.refId) ? (
            <p className="proposal-organize-line__applied">
              Applied to{" "}
              <strong>{appliedToLabel}</strong>
            </p>
          ) : null}

          <div className="proposal-organize-line__metrics">
            <span className="proposal-organize-line__metric">
              <span className="proposal-organize-line__metric-label">Hours</span>
              <span className="proposal-organize-line__metric-value">
                {hours ? `${hours}${/h/i.test(hours) ? "" : " h"}` : "—"}
              </span>
            </span>
            <span className="proposal-organize-line__metric proposal-organize-line__metric--price">
              <span className="proposal-organize-line__metric-label">Price</span>
              <span className="proposal-organize-line__metric-value">{price || "—"}</span>
            </span>
            {hasProposalOverride ? (
              <span className="proposal-organize-line__override-badge" title="Proposal hours or price differ from solutions">
                Custom
              </span>
            ) : null}
          </div>
        </div>

        <div className="proposal-organize-line__footer">
          <label className="proposal-organize-line__phase">
            <span className="proposal-organize-line__phase-label">Phase</span>
            <select
              className="roadmap-input roadmap-select roadmap-select--sm"
              value={card.phaseId}
              onChange={(e) => onPatch(card.key, { phaseId: e.target.value })}
              aria-label="Phase for this line"
            >
              {phaseChoices.map((ph) => (
                <option key={ph.id} value={ph.id}>
                  {ph.title.trim() || "Phase"}
                </option>
              ))}
            </select>
          </label>

          <div className="proposal-organize-line__dates" role="group" aria-label="Solution schedule">
            <label className="proposal-organize-line__date">
              <span className="proposal-organize-line__phase-label">Start</span>
              <input
                type="date"
                className="roadmap-input proposal-organize-line__date-input"
                value={normalizeIsoDateInput(card.startDate)}
                onChange={(e) =>
                  onPatch(card.key, { startDate: normalizeIsoDateInput(e.target.value) || null })
                }
                aria-label="Solution start date"
              />
            </label>
            <label className="proposal-organize-line__date">
              <span className="proposal-organize-line__phase-label">End</span>
              <input
                type="date"
                className="roadmap-input proposal-organize-line__date-input"
                value={normalizeIsoDateInput(card.endDate)}
                onChange={(e) =>
                  onPatch(card.key, { endDate: normalizeIsoDateInput(e.target.value) || null })
                }
                aria-label="Solution end date"
              />
            </label>
          </div>

          <div className="proposal-organize-line__actions">
            <button
              type="button"
              className="proposal-organize-line__action proposal-organize-line__action--primary"
              onClick={() => onEditPricing(card)}
            >
              Edit Hours &amp; Pricing
            </button>
            <button
              type="button"
              className="proposal-organize-line__action"
              onClick={() => onDetails(card)}
            >
              Details
            </button>
            <button
              type="button"
              className="proposal-organize-line__action proposal-organize-line__action--danger"
              onClick={() => onRemove(card.key)}
            >
              Remove
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}
