import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState, type CSSProperties } from "react";
import type { RoadmapCard, RoadmapLineScope } from "../../lib/roadmapModel";
import { effectiveHoursStr, effectivePriceStr } from "../../lib/roadmapModel";
import { normalizeIsoDateInput } from "../../lib/proposalDates";
import {
  isTravelVariableTierRefId,
  isVariableTierRefId,
  variableTierAppliedToLabel,
} from "../../lib/proposalVariableTiers";
import { EntityLink } from "../EntityLink";
import { hrefForRoadmapCard } from "../../lib/entityLinks";

type CatalogCtxLike = Parameters<typeof effectivePriceStr>[1];

const SCOPES: { id: RoadmapLineScope; label: string }[] = [
  { id: "included", label: "Included" },
  { id: "optional", label: "Optional" },
  { id: "deferred", label: "Deferred" },
];

function kindShort(card: RoadmapCard): string {
  if (card.addonOfCardKey) return "Add-on";
  switch (card.kind) {
    case "tier":
      return "Tier";
    case "custom_tier":
      return "Custom";
    case "package":
      return "Package";
    case "playbook":
      return "Playbook";
    default:
      return "Item";
  }
}

type Props = {
  card: RoadmapCard;
  scenarioCards: RoadmapCard[];
  ctx: (CatalogCtxLike & { tiers?: Array<{ solution_tier_id: string; solution_id: string }> }) | null;
  computeScratchSellPrice: (c: RoadmapCard, ctx: CatalogCtxLike) => string;
  proposalStartDate: string;
  proposalEndDate: string;
  onPatch: (key: string, patch: Partial<RoadmapCard>) => void;
  onRemove: (key: string) => void;
  onDetails: (card: RoadmapCard) => void;
};

export function ProposalOrganizeLineCard({
  card,
  scenarioCards,
  ctx,
  computeScratchSellPrice,
  proposalStartDate,
  proposalEndDate,
  onPatch,
  onRemove,
  onDetails,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.key,
  });
  const [datesOpen, setDatesOpen] = useState(false);

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging ? { zIndex: 2, position: "relative" } : {}),
  };

  const hours = effectiveHoursStr(card);
  const price = effectivePriceStr(card, ctx, computeScratchSellPrice);
  const catalogHref = hrefForRoadmapCard(card, ctx?.tiers);
  const appliedToLabel = isVariableTierRefId(card.refId)
    ? variableTierAppliedToLabel(card, scenarioCards)
    : null;
  const addonParentHeadline = card.addonOfCardKey
    ? scenarioCards.find((c) => c.key === card.addonOfCardKey)?.headline.trim() || "parent solution"
    : null;

  const cardStart = normalizeIsoDateInput(card.startDate);
  const cardEnd = normalizeIsoDateInput(card.endDate);
  const proposalStart = normalizeIsoDateInput(proposalStartDate);
  const proposalEnd = normalizeIsoDateInput(proposalEndDate);
  const usesProposalDates =
    (!cardStart && !cardEnd) ||
    !proposalStart ||
    (cardStart === proposalStart && cardEnd === proposalEnd);
  const showDates = datesOpen || !usesProposalDates;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`proposal-organize-line proposal-organize-line--dense proposal-organize-line--${card.scope}${
        card.addonOfCardKey ? " proposal-organize-line--addon" : ""
      }${isDragging ? " proposal-organize-line--dragging" : ""}`}
    >
      <button
        type="button"
        className="proposal-organize-line__drag-handle admin-task-drag-handle"
        aria-label="Drag to another phase"
        title="Drag to reorder or move between phases"
        {...attributes}
        {...listeners}
      >
        <span className="admin-task-drag-handle__grip" aria-hidden>
          ⠿
        </span>
      </button>

      <label className="proposal-organize-line__title-wrap">
        <span className="visually-hidden">Rename {kindShort(card).toLowerCase()} label</span>
        <span className={`proposal-organize-line__kind proposal-organize-line__kind--${card.addonOfCardKey ? "addon" : card.kind}`}>
          {kindShort(card)}
        </span>
        <input
          type="text"
          className="proposal-organize-line__title-input"
          value={card.headline}
          placeholder="Untitled"
          onChange={(e) => onPatch(card.key, { headline: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
        <span className="proposal-organize-line__pencil" aria-hidden>
          ✎
        </span>
        {catalogHref ? (
          <EntityLink
            to={catalogHref}
            className="proposal-organize-line__catalog-link"
            title={card.kind === "package" ? "Open package overview" : "Open solution overview"}
          >
            View
          </EntityLink>
        ) : null}
      </label>

      <span className="proposal-organize-line__metric-value proposal-organize-line__hours">
        {hours ? `${hours}${/h/i.test(hours) ? "" : " h"}` : "—"}
      </span>
      <span className="proposal-organize-line__metric-value proposal-organize-line__price">
        {price || "—"}
      </span>

      <select
        className="roadmap-input roadmap-select roadmap-select--sm"
        value={card.scope}
        onChange={(e) => onPatch(card.key, { scope: e.target.value as RoadmapLineScope })}
        aria-label="Line scope"
      >
        {SCOPES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>

      <div className="proposal-organize-line__actions">
        <button
          type="button"
          className="proposal-organize-line__action"
          onClick={() => setDatesOpen((open) => !open)}
        >
          {showDates ? "Hide dates" : "Dates"}
        </button>
        <button type="button" className="proposal-organize-line__action" onClick={() => onDetails(card)}>
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

      {showDates ? (
        <span className="proposal-organize-line__dates">
          <input
            type="date"
            className="roadmap-input proposal-organize-line__date-input"
            value={cardStart}
            onChange={(e) =>
              onPatch(card.key, { startDate: normalizeIsoDateInput(e.target.value) || null })
            }
            aria-label="Solution start date"
          />
          <input
            type="date"
            className="roadmap-input proposal-organize-line__date-input"
            value={cardEnd}
            onChange={(e) =>
              onPatch(card.key, { endDate: normalizeIsoDateInput(e.target.value) || null })
            }
            aria-label="Solution end date"
          />
        </span>
      ) : null}

      {addonParentHeadline || (appliedToLabel && !isTravelVariableTierRefId(card.refId)) ? (
        <p className="proposal-organize-line__applied proposal-organize-line__applied--dense">
          {addonParentHeadline ? (
            <>
              Add-on of <strong>{addonParentHeadline}</strong>
            </>
          ) : (
            <>
              Applied to <strong>{appliedToLabel}</strong>
            </>
          )}
        </p>
      ) : null}
    </li>
  );
}
