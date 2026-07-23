import { useMemo, useState, type ReactNode } from "react";
import { PROPOSAL_DURATION_LABEL } from "../../branding";
import { formatProposalDurationLabel } from "../../lib/roadmapProposalSnapshot";
import type { RoadmapProposalRow } from "../../types";

export type ProposalSavedLibraryVariant = "saved" | "awaiting_ops" | "client_ready";

type Props = {
  proposals: RoadmapProposalRow[];
  loading: boolean;
  activeProposalId: string | null;
  deletingProposalId: string | null;
  reviewingProposalId?: string | null;
  onRefresh: () => void;
  onOpen: (row: RoadmapProposalRow) => void;
  onDelete: (row: RoadmapProposalRow) => void;
  onReviewedByOpsChange?: (row: RoadmapProposalRow, reviewed: boolean) => void;
  onMoveToSaved?: (row: RoadmapProposalRow) => void;
  variant?: ProposalSavedLibraryVariant;
};

function clientKey(row: RoadmapProposalRow): string {
  return row.client_label.trim() || "Unlabeled client";
}

function parseBudgetDisplay(raw: string | null | undefined): string {
  const t = raw?.trim();
  if (!t) return "—";
  const k = t.match(/^(\d+(?:\.\d+)?)\s*k$/i);
  if (k) {
    const n = Number(k[1]) * 1000;
    if (Number.isFinite(n)) {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
    }
  }
  const cleaned = t.replace(/[$,\s]/g, "");
  const n = Number(cleaned);
  if (Number.isFinite(n) && n >= 0) {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
  }
  return t;
}

function formatCreator(row: RoadmapProposalRow): string {
  const email = row.created_by_email?.trim();
  if (email) {
    const namePart = email.split("@")[0] ?? email;
    return namePart.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return "Unknown";
}

function formatCreatedDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function lineCount(row: RoadmapProposalRow): number {
  const state = row.proposal_state;
  if (!state || typeof state !== "object") return 0;
  const cards = (state as { cards?: unknown }).cards;
  return Array.isArray(cards) ? cards.length : 0;
}

function clientInitials(client: string): string {
  const words = client.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0] ?? ""}${words[1]![0] ?? ""}`.toUpperCase();
}

const VARIANT_COPY: Record<
  ProposalSavedLibraryVariant,
  {
    ariaLabel: string;
    eyebrow: string;
    title: string;
    lead: string;
    emptyTitle: string;
    emptyBody: ReactNode;
    allListTitle: string;
    countLabel: string;
  }
> = {
  saved: {
    ariaLabel: "Saved proposals",
    eyebrow: "Proposal Library",
    title: "Saved Proposals",
    lead: "Filter by client or browse everything. Open any proposal to pick up where you left off.",
    emptyTitle: "No Proposals Yet",
    emptyBody: (
      <>
        Switch to the <strong>Create New Proposal</strong> tab, build your roadmap, then save from Review.
      </>
    ),
    allListTitle: "All Saved Proposals",
    countLabel: "saved",
  },
  awaiting_ops: {
    ariaLabel: "Proposals awaiting Ops Review",
    eyebrow: "Ops Queue",
    title: "Proposals Awaiting Ops Review",
    lead: "Proposals submitted from Preview Proposal. Open one to continue in Ops Review.",
    emptyTitle: "Nothing Awaiting Ops Review",
    emptyBody: (
      <>
        When a strategist clicks <strong>Submit for Ops Review</strong>, the proposal will appear here.
      </>
    ),
    allListTitle: "All Awaiting Ops Review",
    countLabel: "awaiting",
  },
  client_ready: {
    ariaLabel: "Client Ready proposals",
    eyebrow: "Client Ready",
    title: "Client Ready Proposals",
    lead: "Proposals marked Reviewed by Ops. Open one to finish the Client Ready Proposal step.",
    emptyTitle: "No Client Ready Proposals Yet",
    emptyBody: (
      <>
        Turn on <strong>Reviewed by Ops</strong> in the Ops queue to move a proposal here.
      </>
    ),
    allListTitle: "All Client Ready Proposals",
    countLabel: "ready",
  },
};

export function ProposalSavedProposalsPanel({
  proposals,
  loading,
  activeProposalId,
  deletingProposalId,
  reviewingProposalId = null,
  onRefresh,
  onOpen,
  onDelete,
  onReviewedByOpsChange,
  onMoveToSaved,
  variant = "saved",
}: Props) {
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const copy = VARIANT_COPY[variant];
  const showReviewedToggle = variant === "awaiting_ops" || variant === "client_ready";
  const reviewedByOpsOn = variant === "client_ready";
  const showMoveToSaved = showReviewedToggle && onMoveToSaved != null;

  const clientEntries = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of proposals) {
      const key = clientKey(row);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [proposals]);

  const visibleProposals = useMemo(() => {
    const sorted = [...proposals].sort(
      (a, b) => new Date(b.updated_at ?? b.created_at ?? 0).getTime() - new Date(a.updated_at ?? a.created_at ?? 0).getTime()
    );
    if (selectedClient == null) return sorted;
    return sorted.filter((row) => clientKey(row) === selectedClient);
  }, [proposals, selectedClient]);

  const listTitle = selectedClient == null ? copy.allListTitle : selectedClient;

  return (
    <section className="proposal-saved" aria-label={copy.ariaLabel}>
      <header className="proposal-saved__hero">
        <div className="proposal-saved__hero-glow" aria-hidden />
        <div className="proposal-saved__hero-inner">
          <div className="proposal-saved__hero-copy">
            <p className="proposal-saved__eyebrow">{copy.eyebrow}</p>
            <h2 className="proposal-saved__title">{copy.title}</h2>
            <p className="proposal-saved__lead">{copy.lead}</p>
            {proposals.length > 0 ? (
              <div className="proposal-saved__hero-stats">
                <span className="proposal-saved__hero-stat">
                  <strong>{clientEntries.length}</strong> client{clientEntries.length === 1 ? "" : "s"}
                </span>
                <span className="proposal-saved__hero-stat">
                  <strong>{proposals.length}</strong> {copy.countLabel}
                </span>
              </div>
            ) : null}
          </div>
          <div className="proposal-saved__head-actions">
            <button
              type="button"
              className="roadmap-btn roadmap-btn--ghost proposal-saved__refresh-btn"
              onClick={onRefresh}
              disabled={loading}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
      </header>

      {loading && proposals.length === 0 ? (
        <p className="proposal-saved__empty roadmap-muted">Loading proposals…</p>
      ) : proposals.length === 0 ? (
        <div className="proposal-saved__empty-state">
          <p className="proposal-saved__empty-title">{copy.emptyTitle}</p>
          <p className="roadmap-muted">{copy.emptyBody}</p>
        </div>
      ) : (
        <div className="proposal-saved__layout">
          <aside className="proposal-saved__sidebar" aria-label="Clients">
            <p className="proposal-saved__sidebar-label">Clients</p>
            <ul className="proposal-saved__client-list">
              <li>
                <button
                  type="button"
                  className={`proposal-saved__client-btn${selectedClient == null ? " is-active" : ""}`}
                  onClick={() => setSelectedClient(null)}
                >
                  <span className="proposal-saved__client-icon proposal-saved__client-icon--all" aria-hidden>
                    ∞
                  </span>
                  <span className="proposal-saved__client-name">All Proposals</span>
                  <span className="proposal-saved__client-count">{proposals.length}</span>
                </button>
              </li>
              {clientEntries.map(([client, count]) => (
                <li key={client}>
                  <button
                    type="button"
                    className={`proposal-saved__client-btn${selectedClient === client ? " is-active" : ""}`}
                    onClick={() => setSelectedClient(client)}
                  >
                    <span className="proposal-saved__client-avatar" aria-hidden>
                      {clientInitials(client)}
                    </span>
                    <span className="proposal-saved__client-name">{client}</span>
                    <span className="proposal-saved__client-count">{count}</span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <div className="proposal-saved__main">
            <header className="proposal-saved__main-head">
              <div>
                <h3 className="proposal-saved__main-title">{listTitle}</h3>
                <p className="proposal-saved__main-sub">Sorted By Most Recently Updated</p>
              </div>
              <span className="proposal-saved__main-count">
                {visibleProposals.length} proposal{visibleProposals.length === 1 ? "" : "s"}
              </span>
            </header>

            {visibleProposals.length === 0 ? (
              <p className="proposal-saved__empty roadmap-muted">No proposals for this client.</p>
            ) : (
              <ul className="proposal-saved__proposal-list">
                {visibleProposals.map((row) => {
                  const isActive = activeProposalId === row.id;
                  const isDeleting = deletingProposalId === row.id;
                  const items = lineCount(row);
                  const budget = parseBudgetDisplay(row.client_budget);
                  return (
                    <li
                      key={row.id}
                      className={`proposal-saved-card${isActive ? " proposal-saved-card--active" : ""}`}
                    >
                      <div className="proposal-saved-card__accent" aria-hidden />
                      <div className="proposal-saved-card__inner">
                        <button type="button" className="proposal-saved-card__open" onClick={() => onOpen(row)}>
                          <div className="proposal-saved-card__top">
                            <div className="proposal-saved-card__title-block">
                              <strong className="proposal-saved-card__title">{row.roadmap_title}</strong>
                              {selectedClient == null ? (
                                <span className="proposal-saved-card__client-tag">{clientKey(row)}</span>
                              ) : null}
                            </div>
                            <span className="proposal-saved-card__cta">
                              Open
                              <span className="proposal-saved-card__cta-arrow" aria-hidden>
                                →
                              </span>
                            </span>
                          </div>

                          <div className="proposal-saved-card__chips">
                            <span
                              className={`proposal-saved-chip${budget !== "—" ? " proposal-saved-chip--highlight" : ""}`}
                            >
                              <span className="proposal-saved-chip__label">Budget</span>
                              <span className="proposal-saved-chip__value">{budget}</span>
                            </span>
                            <span className="proposal-saved-chip">
                              <span className="proposal-saved-chip__label">{PROPOSAL_DURATION_LABEL}</span>
                              <span className="proposal-saved-chip__value">{formatProposalDurationLabel(row.horizon)}</span>
                            </span>
                            <span className="proposal-saved-chip">
                              <span className="proposal-saved-chip__label">Creator</span>
                              <span className="proposal-saved-chip__value">{formatCreator(row)}</span>
                            </span>
                            <span className="proposal-saved-chip">
                              <span className="proposal-saved-chip__label">Created</span>
                              <span className="proposal-saved-chip__value">{formatCreatedDate(row.created_at)}</span>
                            </span>
                          </div>
                        </button>

                        <footer className="proposal-saved-card__foot">
                          <span className="proposal-saved-card__footnote">
                            {items} line item{items === 1 ? "" : "s"}
                            {row.updated_at && row.updated_at !== row.created_at
                              ? ` · Updated ${formatCreatedDate(row.updated_at)}`
                              : ""}
                          </span>
                          <div className="proposal-saved-card__foot-actions">
                            {showMoveToSaved ? (
                              <button
                                type="button"
                                className="proposal-saved-card__move-saved"
                                onClick={() => onMoveToSaved(row)}
                                disabled={reviewingProposalId === row.id || isDeleting}
                              >
                                {reviewingProposalId === row.id ? "Moving…" : "Move To Saved Proposals"}
                              </button>
                            ) : null}
                            {showReviewedToggle && onReviewedByOpsChange ? (
                              <label
                                className={`proposal-saved-card__ops-toggle${
                                  reviewedByOpsOn ? " is-on" : ""
                                }`}
                              >
                                <span className="proposal-saved-card__ops-toggle-label">Reviewed by Ops</span>
                                <button
                                  type="button"
                                  role="switch"
                                  className="proposal-saved-card__ops-switch"
                                  aria-checked={reviewedByOpsOn}
                                  disabled={reviewingProposalId === row.id || isDeleting}
                                  onClick={() => onReviewedByOpsChange(row, !reviewedByOpsOn)}
                                >
                                  <span className="proposal-saved-card__ops-switch-thumb" aria-hidden />
                                </button>
                              </label>
                            ) : null}
                            <button
                              type="button"
                              className="proposal-saved-card__delete"
                              onClick={() => onDelete(row)}
                              disabled={isDeleting}
                              aria-label={`Delete ${row.roadmap_title}`}
                            >
                              {isDeleting ? "Deleting…" : "Delete"}
                            </button>
                          </div>
                        </footer>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
