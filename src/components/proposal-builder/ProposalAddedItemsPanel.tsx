import { useMemo, useState } from "react";
import type { RoadmapCardKind } from "../../lib/roadmapModel";

export type ProposalAddedLine = {
  key: string;
  headline: string;
  phaseTitle: string;
  priceDisplay: string;
  scope: "included" | "optional" | "deferred";
  isTargetPhase: boolean;
  kind: RoadmapCardKind;
};

type Props = {
  scenarioTitle: string;
  targetPhaseTitle: string;
  lines: ProposalAddedLine[];
  onRemove: (key: string) => void;
};

function isTierKind(kind: RoadmapCardKind): boolean {
  return kind === "tier" || kind === "custom_tier";
}

function isPackageKind(kind: RoadmapCardKind): boolean {
  return kind === "package";
}

function kindShortLabel(kind: RoadmapCardKind): string {
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

function scopeLabel(scope: ProposalAddedLine["scope"]): string {
  if (scope === "optional") return "Optional";
  if (scope === "deferred") return "Deferred";
  return "Included";
}

function AddedLineRow({ line, onRemove }: { line: ProposalAddedLine; onRemove: (key: string) => void }) {
  return (
    <li className={`proposal-added-line${line.isTargetPhase ? " proposal-added-line--here" : ""}`}>
      <div className="proposal-added-line__main">
        <span className={`proposal-added-line__kind proposal-added-line__kind--${line.kind}`}>
          {kindShortLabel(line.kind)}
        </span>
        <div className="proposal-added-line__text">
          <strong className="proposal-added-line__title">{line.headline.trim() || "(untitled)"}</strong>
          <span className="proposal-added-line__meta">
            {line.phaseTitle} · {line.priceDisplay} · {scopeLabel(line.scope)}
          </span>
        </div>
      </div>
      <button
        type="button"
        className="proposal-added-line__remove"
        onClick={() => onRemove(line.key)}
        aria-label={`Remove ${line.headline}`}
      >
        ×
      </button>
    </li>
  );
}

export function ProposalAddedItemsPanel({ scenarioTitle, targetPhaseTitle, lines, onRemove }: Props) {
  const [filter, setFilter] = useState<"all" | "tiers" | "packages">("all");

  const tierLines = useMemo(() => lines.filter((l) => isTierKind(l.kind)), [lines]);
  const packageLines = useMemo(() => lines.filter((l) => isPackageKind(l.kind)), [lines]);
  const otherLines = useMemo(
    () => lines.filter((l) => !isTierKind(l.kind) && !isPackageKind(l.kind)),
    [lines]
  );
  const visibleLines = useMemo(() => {
    if (filter === "tiers") return tierLines;
    if (filter === "packages") return packageLines;
    return lines;
  }, [filter, tierLines, packageLines, lines]);
  const inTargetPhaseOfferings = lines.filter((l) => l.isTargetPhase);

  return (
    <section className="proposal-added-card" aria-label="Added offerings">
      <header className="proposal-added-card__head">
        <div>
          <p className="proposal-added-card__eyebrow">Your Additions</p>
          <h3 className="proposal-added-card__title">Offerings on {scenarioTitle}</h3>
        </div>
        <div className="proposal-added-card__counts" aria-live="polite">
          <span className="proposal-added-card__count proposal-added-card__count--tiers">
            <strong>{tierLines.length}</strong> tier{tierLines.length === 1 ? "" : "s"}
          </span>
          {packageLines.length > 0 ? (
            <span className="proposal-added-card__count proposal-added-card__count--packages">
              <strong>{packageLines.length}</strong> package{packageLines.length === 1 ? "" : "s"}
            </span>
          ) : null}
          {otherLines.length > 0 ? (
            <span className="proposal-added-card__count">
              <strong>{otherLines.length}</strong> other
            </span>
          ) : null}
        </div>
      </header>

      {lines.length > 0 ? (
        <>
          <div className="proposal-added-card__filters" role="tablist" aria-label="Filter additions">
            <button
              type="button"
              role="tab"
              aria-selected={filter === "all"}
              className={`proposal-added-card__filter${filter === "all" ? " is-active" : ""}`}
              onClick={() => setFilter("all")}
            >
              All ({lines.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === "tiers"}
              className={`proposal-added-card__filter${filter === "tiers" ? " is-active" : ""}`}
              onClick={() => setFilter("tiers")}
            >
              Tiers ({tierLines.length})
            </button>
            {packageLines.length > 0 ? (
              <button
                type="button"
                role="tab"
                aria-selected={filter === "packages"}
                className={`proposal-added-card__filter${filter === "packages" ? " is-active" : ""}`}
                onClick={() => setFilter("packages")}
              >
                Packages ({packageLines.length})
              </button>
            ) : null}
          </div>
          {inTargetPhaseOfferings.length > 0 ? (
            <p className="proposal-added-card__phase-note">
              <strong>{inTargetPhaseOfferings.length}</strong> in <strong>{targetPhaseTitle}</strong> (current add
              target)
            </p>
          ) : null}
          <ul className="proposal-added-card__list">
            {visibleLines.map((line) => (
              <AddedLineRow key={line.key} line={line} onRemove={onRemove} />
            ))}
          </ul>
        </>
      ) : (
        <p className="proposal-added-card__empty">
          No offerings yet. Use <strong>Solution Tiers</strong> or switch to <strong>Packages</strong> below, then click{" "}
          <strong>Add</strong>.
        </p>
      )}
    </section>
  );
}
