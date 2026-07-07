import { useMemo, useState } from "react";

export type ScenarioCopySource = {
  id: string;
  title: string;
  offeringCount: number;
};

type Props = {
  targetScenarioTitle: string;
  sources: ScenarioCopySource[];
  onCopy: (sourceScenarioId: string) => void;
};

export function ProposalCopyScenarioOfferings({ targetScenarioTitle, sources, onCopy }: Props) {
  const [selectedId, setSelectedId] = useState("");

  const withOfferings = useMemo(() => sources.filter((s) => s.offeringCount > 0), [sources]);
  const selected = withOfferings.find((s) => s.id === selectedId) ?? null;

  if (sources.length === 0) return null;

  return (
    <div className="proposal-added-card__copy" aria-labelledby="proposal-copy-scenario-title">
      <p id="proposal-copy-scenario-title" className="proposal-added-card__copy-label">
        Copy from another scenario
      </p>
      {withOfferings.length === 0 ? (
        <p className="proposal-added-card__copy-hint">Add solutions to another scenario first, then copy them here.</p>
      ) : (
        <div className="proposal-added-card__copy-row">
          <select
            className="roadmap-input proposal-added-card__copy-select"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            aria-label="Scenario to copy solutions from"
          >
            <option value="">Select scenario…</option>
            {withOfferings.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title.trim() || "Untitled"} ({s.offeringCount} item{s.offeringCount === 1 ? "" : "s"})
              </option>
            ))}
          </select>
          <button
            type="button"
            className="roadmap-btn roadmap-btn--secondary proposal-added-card__copy-btn"
            disabled={!selected}
            onClick={() => {
              if (!selected) return;
              onCopy(selected.id);
            }}
          >
            Copy
          </button>
        </div>
      )}
      {selected ? (
        <p className="proposal-added-card__copy-preview" aria-live="polite">
          Copies <strong>{selected.offeringCount}</strong> item{selected.offeringCount === 1 ? "" : "s"} into{" "}
          <strong>{targetScenarioTitle.trim() || "this scenario"}</strong>. Matching phases are kept; duplicates are
          skipped.
        </p>
      ) : null}
    </div>
  );
}
