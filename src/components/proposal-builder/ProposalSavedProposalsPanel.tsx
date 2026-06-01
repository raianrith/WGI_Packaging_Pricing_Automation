import { useMemo, useState } from "react";
import type { RoadmapProposalRow } from "../../types";

type Props = {
  proposals: RoadmapProposalRow[];
  loading: boolean;
  activeProposalId: string | null;
  deletingProposalId: string | null;
  onRefresh: () => void;
  onOpen: (row: RoadmapProposalRow) => void;
  onDelete: (row: RoadmapProposalRow) => void;
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

function formatHorizonLabel(horizon: string | null | undefined): string {
  if (!horizon || horizon === "custom") return "Custom";
  if (horizon === "3" || horizon === "4" || horizon === "6" || horizon === "12") return `${horizon} months`;
  return horizon;
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

export function ProposalSavedProposalsPanel({
  proposals,
  loading,
  activeProposalId,
  deletingProposalId,
  onRefresh,
  onOpen,
  onDelete,
}: Props) {
  const [selectedClient, setSelectedClient] = useState<string | null>(null);

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

  const listTitle = selectedClient == null ? "All Saved Proposals" : selectedClient;

  return (
    <section className="proposal-saved" aria-label="Saved proposals">
      <header className="proposal-saved__hero">
        <div className="proposal-saved__hero-glow" aria-hidden />
        <div className="proposal-saved__hero-inner">
          <div className="proposal-saved__hero-copy">
            <p className="proposal-saved__eyebrow">Proposal Library</p>
            <h2 className="proposal-saved__title">Saved Proposals</h2>
            <p className="proposal-saved__lead">
              Filter by client or browse everything. Open any proposal to pick up where you left off.
            </p>
            {proposals.length > 0 ? (
              <div className="proposal-saved__hero-stats">
                <span className="proposal-saved__hero-stat">
                  <strong>{clientEntries.length}</strong> client{clientEntries.length === 1 ? "" : "s"}
                </span>
                <span className="proposal-saved__hero-stat">
                  <strong>{proposals.length}</strong> saved
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
        <p className="proposal-saved__empty roadmap-muted">Loading saved proposals…</p>
      ) : proposals.length === 0 ? (
        <div className="proposal-saved__empty-state">
          <p className="proposal-saved__empty-title">No Proposals Yet</p>
          <p className="roadmap-muted">
            Switch to the <strong>Create New Proposal</strong> tab, build your roadmap, then save from Review.
          </p>
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
                              <span className="proposal-saved-chip__label">Time Period</span>
                              <span className="proposal-saved-chip__value">{formatHorizonLabel(row.horizon)}</span>
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
                          <button
                            type="button"
                            className="proposal-saved-card__delete"
                            onClick={() => onDelete(row)}
                            disabled={isDeleting}
                            aria-label={`Delete ${row.roadmap_title}`}
                          >
                            {isDeleting ? "Deleting…" : "Delete"}
                          </button>
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
