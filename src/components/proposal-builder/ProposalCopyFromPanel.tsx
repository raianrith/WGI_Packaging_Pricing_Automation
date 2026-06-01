import { useMemo, useState } from "react";
import type { RoadmapProposalRow } from "../../types";
import { proposalStructureCounts } from "../../lib/roadmapProposalSnapshot";

type Props = {
  proposals: RoadmapProposalRow[];
  loading: boolean;
  activeProposalId: string | null;
  onCopy: (row: RoadmapProposalRow) => void;
};

function proposalLabel(row: RoadmapProposalRow): string {
  const client = row.client_label.trim() || "Unlabeled client";
  const title = row.roadmap_title.trim() || "Untitled proposal";
  return `${client} — ${title}`;
}

export function ProposalCopyFromPanel({ proposals, loading, activeProposalId, onCopy }: Props) {
  const copyable = useMemo(
    () =>
      proposals
        .filter((row) => proposalStructureCounts(row) != null)
        .sort(
          (a, b) =>
            new Date(b.updated_at ?? b.created_at ?? 0).getTime() -
            new Date(a.updated_at ?? a.created_at ?? 0).getTime()
        ),
    [proposals]
  );

  const [selectedId, setSelectedId] = useState<string>("");

  const selected = copyable.find((r) => r.id === selectedId) ?? null;
  const selectedCounts = selected ? proposalStructureCounts(selected) : null;

  const handleCopy = () => {
    if (!selected) return;
    onCopy(selected);
  };

  return (
    <section className="proposal-copy-from" aria-labelledby="proposal-copy-from-title">
      <div className="proposal-copy-from__head">
        <h3 id="proposal-copy-from-title" className="proposal-copy-from__title">
          Copy From Saved Proposal
        </h3>
        <p className="proposal-copy-from__lead">
          Import scenarios, phases, and catalog offerings from a saved proposal into this draft. Setup fields
          (client, budget, roadmap name) on step 1 are not changed.
        </p>
      </div>

      {loading ? (
        <p className="proposal-copy-from__hint">Loading saved proposals…</p>
      ) : copyable.length === 0 ? (
        <p className="proposal-copy-from__hint">
          No saved proposals with structure yet. Save a proposal first, then you can copy it here.
        </p>
      ) : (
        <div className="proposal-copy-from__controls">
          <label className="proposal-copy-from__field">
            <span className="proposal-copy-from__label">Saved proposal</span>
            <select
              className="roadmap-input proposal-copy-from__select"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              aria-label="Choose a saved proposal to copy"
            >
              <option value="">Select a proposal…</option>
              {copyable.map((row) => (
                <option key={row.id} value={row.id}>
                  {proposalLabel(row)}
                  {row.id === activeProposalId ? " (current)" : ""}
                </option>
              ))}
            </select>
          </label>

          {selectedCounts ? (
            <p className="proposal-copy-from__preview" aria-live="polite">
              Includes <strong>{selectedCounts.scenarios}</strong> scenario
              {selectedCounts.scenarios === 1 ? "" : "s"}, <strong>{selectedCounts.phases}</strong> phase
              {selectedCounts.phases === 1 ? "" : "s"}, and <strong>{selectedCounts.cards}</strong> line item
              {selectedCounts.cards === 1 ? "" : "s"}.
            </p>
          ) : null}

          <button
            type="button"
            className="roadmap-btn roadmap-btn--primary proposal-copy-from__btn"
            disabled={!selected}
            onClick={handleCopy}
          >
            Copy structure into this draft
          </button>
        </div>
      )}
    </section>
  );
}
