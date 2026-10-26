import {
  customScopingDeliverableLabel,
  parseCustomScopingState,
  type CustomScopingRequest,
} from "./customScopingRequest";
import {
  parseProposalSnapshot,
  proposalReviewStatus,
  type ProposalReviewStatus,
  type RoadmapProposalSnapshot,
} from "./roadmapProposalSnapshot";
import { displayProposalTitle } from "./roadmapNameFormat";
import { effectiveHoursStr, type RoadmapCard } from "./roadmapModel";
import type { RoadmapProposalRow } from "../types";

export type CatalogRequestStatus = "open" | "fulfilled" | "skipped";

export type CatalogCustomScopingRequestRow = {
  id: string;
  request: CustomScopingRequest;
  proposalId: string;
  clientLabel: string;
  roadmapTitle: string;
  reviewStatus: ProposalReviewStatus;
  updatedAt: string;
  linkedCount: number;
  status: CatalogRequestStatus;
};

export type CatalogCustomSolutionRow = {
  id: string;
  card: RoadmapCard;
  headline: string;
  hours: string;
  price: string;
  taskCount: number;
  proposalId: string;
  clientLabel: string;
  roadmapTitle: string;
  reviewStatus: ProposalReviewStatus;
  updatedAt: string;
  requestId: string | null;
  requestName: string | null;
  requestType: string | null;
};

export type CatalogCustomScopingIndex = {
  requests: CatalogCustomScopingRequestRow[];
  solutions: CatalogCustomSolutionRow[];
};

function reviewLabel(status: ProposalReviewStatus): string {
  if (status === "awaiting_ops_review") return "Ops Review";
  if (status === "client_ready") return "Client Ready";
  return "Draft";
}

export function catalogProposalStatusLabel(status: ProposalReviewStatus): string {
  return reviewLabel(status);
}

const SHORT_DELIVERABLE: Record<string, string> = {
  Video: "Video",
  "Paid Ads": "Paid Ads",
  Design: "Design",
  Content: "Content",
  "Web / Development": "Web",
  "Email / Marketing Automation": "Email",
  "Strategy / Consulting": "Strategy",
  Other: "Other",
};

export function catalogDeliverableShortLabel(full: string): string {
  return SHORT_DELIVERABLE[full] ?? full;
}

export function removeCustomRequestFromSnapshot(
  snap: RoadmapProposalSnapshot,
  requestId: string
): RoadmapProposalSnapshot {
  const requests = (snap.customScoping?.requests ?? []).filter((r) => r.id !== requestId);
  return {
    ...snap,
    cards: snap.cards.map((c) =>
      c.customScopingRequestId === requestId ? { ...c, customScopingRequestId: null } : c
    ),
    customScoping:
      requests.length > 0
        ? { required: snap.customScoping?.required ?? true, requests }
        : undefined,
  };
}

export function removeCustomSolutionFromSnapshot(
  snap: RoadmapProposalSnapshot,
  cardKey: string
): RoadmapProposalSnapshot {
  return {
    ...snap,
    cards: snap.cards.filter((c) => c.key !== cardKey && c.addonOfCardKey !== cardKey),
  };
}

function cardSell(card: RoadmapCard): string {
  const override = card.priceOverride?.trim();
  if (override) return override;
  return card.price?.trim() || "—";
}

function extraTaskCount(card: RoadmapCard): number {
  const extras = card.taskLayout?.extras?.length ?? 0;
  const attached = card.scratchAttachedTaskIds?.length ?? 0;
  return extras + attached;
}

export function collectCatalogCustomScoping(rows: RoadmapProposalRow[]): CatalogCustomScopingIndex {
  const requests: CatalogCustomScopingRequestRow[] = [];
  const solutions: CatalogCustomSolutionRow[] = [];

  for (const row of rows) {
    const snap = parseProposalSnapshot(row);
    const custom = snap?.customScoping ?? parseCustomScopingState(
      row.proposal_state && typeof row.proposal_state === "object"
        ? (row.proposal_state as { customScoping?: unknown }).customScoping
        : null
    );
    const cards = snap?.cards ?? [];
    const clientLabel = (snap?.clientLabel ?? row.client_label).trim() || "Unlabeled client";
    const roadmapTitle = displayProposalTitle(snap?.roadmapTitle ?? row.roadmap_title);
    const reviewStatus = proposalReviewStatus(row);
    const updatedAt = row.updated_at ?? row.created_at ?? "";
    const requestById = new Map(custom.requests.map((r) => [r.id, r]));

    for (const request of custom.requests) {
      const linkedCount = cards.filter((c) => c.customScopingRequestId === request.id).length;
      const status: CatalogRequestStatus =
        linkedCount > 0 ? "fulfilled" : request.skipped ? "skipped" : "open";
      requests.push({
        id: `${row.id}:${request.id}`,
        request,
        proposalId: row.id,
        clientLabel,
        roadmapTitle,
        reviewStatus,
        updatedAt: request.updatedAt || updatedAt,
        linkedCount,
        status,
      });
    }

    for (const card of cards) {
      if (card.kind !== "custom_tier") continue;
      const req = card.customScopingRequestId
        ? requestById.get(card.customScopingRequestId) ?? null
        : null;
      solutions.push({
        id: `${row.id}:${card.key}`,
        card,
        headline: card.headline.trim() || "Untitled custom solution",
        hours: effectiveHoursStr(card) || "—",
        price: cardSell(card),
        taskCount: extraTaskCount(card),
        proposalId: row.id,
        clientLabel,
        roadmapTitle,
        reviewStatus,
        updatedAt,
        requestId: req?.id ?? card.customScopingRequestId ?? null,
        requestName: req?.name ?? null,
        requestType: req ? customScopingDeliverableLabel(req) : null,
      });
    }
  }

  requests.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  solutions.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  return { requests, solutions };
}

export function catalogCustomScopingSearchBlob(
  row: CatalogCustomScopingRequestRow | CatalogCustomSolutionRow
): string {
  if ("request" in row) {
    return [
      row.request.name,
      customScopingDeliverableLabel(row.request),
      row.request.overviewAndGoal,
      row.clientLabel,
      row.roadmapTitle,
      row.status,
    ]
      .join(" ")
      .toLowerCase();
  }
  return [
    row.headline,
    row.clientLabel,
    row.roadmapTitle,
    row.requestName ?? "",
    row.requestType ?? "",
    row.hours,
    row.price,
  ]
    .join(" ")
    .toLowerCase();
}

