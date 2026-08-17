import { useMemo, useState } from "react";
import type { RoadmapCardKind } from "../../lib/roadmapModel";
import type { ModuleAddOnGroup } from "../../lib/buildCatalogDirectoryRows";
import {
  ProposalCopyScenarioOfferings,
  type ScenarioCopySource,
} from "./ProposalCopyScenarioOfferings";
import { ProposalAddOnsModal } from "./ProposalAddOnsModal";

export type ProposalAddedLine = {
  key: string;
  refId?: string;
  headline: string;
  phaseTitle: string;
  priceDisplay: string;
  scope: "included" | "optional" | "deferred";
  isTargetPhase: boolean;
  kind: RoadmapCardKind;
  /** Variable tier: linked tier name or travel hours summary */
  appliedToLabel?: string | null;
  isAddon?: boolean;
  canAddAddOns?: boolean;
  addons?: ProposalAddedLine[];
};

type Props = {
  scenarioTitle: string;
  targetPhaseTitle: string;
  lines: ProposalAddedLine[];
  onRemove: (key: string) => void;
  copyFromScenarios?: ScenarioCopySource[];
  onCopyFromScenario?: (sourceScenarioId: string) => void;
  addonGroups?: ModuleAddOnGroup[];
  onAddAddOns?: (parentKey: string, tierIds: string[]) => void;
};

function isTierKind(kind: RoadmapCardKind): boolean {
  return kind === "tier" || kind === "custom_tier";
}

function isPackageKind(kind: RoadmapCardKind): boolean {
  return kind === "package";
}

function kindShortLabel(line: ProposalAddedLine): string {
  if (line.isAddon) return "Add-on";
  switch (line.kind) {
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

function attachedAddonRefIds(line: ProposalAddedLine): Set<string> {
  const ids = new Set<string>();
  for (const a of line.addons ?? []) {
    if (a.refId) ids.add(a.refId);
  }
  return ids;
}

function remainingAddOnGroups(line: ProposalAddedLine, groups: ModuleAddOnGroup[]): ModuleAddOnGroup[] {
  const attached = attachedAddonRefIds(line);
  return groups
    .map((g) => ({
      ...g,
      tiers: g.tiers.filter((t) => !attached.has(t.tierId)),
    }))
    .filter((g) => g.tiers.length > 0);
}

function remainingAddOnCount(line: ProposalAddedLine, groups: ModuleAddOnGroup[]): number {
  return remainingAddOnGroups(line, groups).reduce((n, g) => n + g.tiers.length, 0);
}

function AddedLineRow({
  line,
  nested,
  canOfferMoreAddOns,
  onRemove,
  onAddAddOns,
}: {
  line: ProposalAddedLine;
  nested?: boolean;
  canOfferMoreAddOns: boolean;
  onRemove: (key: string) => void;
  onAddAddOns?: (parentKey: string) => void;
}) {
  const kindClass = line.isAddon ? "addon" : line.kind;
  return (
    <div
      className={`proposal-added-line${line.isTargetPhase && !nested ? " proposal-added-line--here" : ""}${
        nested ? " proposal-added-line--addon" : ""
      }`}
    >
      <div className="proposal-added-line__main">
        <span className={`proposal-added-line__kind proposal-added-line__kind--${kindClass}`}>
          {kindShortLabel(line)}
        </span>
        <div className="proposal-added-line__text">
          <strong className="proposal-added-line__title">{line.headline.trim() || "(untitled)"}</strong>
          {line.appliedToLabel ? (
            <span className="proposal-added-line__applied">
              Applied to <strong>{line.appliedToLabel}</strong>
            </span>
          ) : null}
          <span className="proposal-added-line__meta">
            {line.phaseTitle} · {line.priceDisplay} · {scopeLabel(line.scope)}
            {!nested && line.addons && line.addons.length > 0
              ? ` · ${line.addons.length} add-on${line.addons.length === 1 ? "" : "s"}`
              : ""}
          </span>
          {canOfferMoreAddOns && onAddAddOns ? (
            <button
              type="button"
              className="proposal-added-line__add-more"
              onClick={() => onAddAddOns(line.key)}
            >
              {line.addons && line.addons.length > 0 ? "Add more add-ons" : "Add add-ons"}
            </button>
          ) : null}
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
    </div>
  );
}

export function ProposalAddedItemsPanel({
  scenarioTitle,
  targetPhaseTitle,
  lines,
  onRemove,
  copyFromScenarios,
  onCopyFromScenario,
  addonGroups = [],
  onAddAddOns,
}: Props) {
  const [filter, setFilter] = useState<"all" | "tiers" | "packages">("all");
  const [addOnsParentKey, setAddOnsParentKey] = useState<string | null>(null);
  const [addOnsSelectedIds, setAddOnsSelectedIds] = useState<Set<string>>(() => new Set());

  const addonCount = useMemo(
    () => lines.reduce((n, l) => n + (l.addons?.length ?? 0), 0),
    [lines]
  );
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

  const addOnsParent = addOnsParentKey ? lines.find((l) => l.key === addOnsParentKey) ?? null : null;
  const addOnsModalGroups = addOnsParent ? remainingAddOnGroups(addOnsParent, addonGroups) : [];

  const openAddOns = (parentKey: string) => {
    setAddOnsParentKey(parentKey);
    setAddOnsSelectedIds(new Set());
  };

  const cancelAddOns = () => {
    setAddOnsParentKey(null);
    setAddOnsSelectedIds(new Set());
  };

  const toggleAddOnTier = (tierId: string) => {
    setAddOnsSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(tierId)) next.delete(tierId);
      else next.add(tierId);
      return next;
    });
  };

  const confirmAddOns = () => {
    if (!addOnsParentKey || addOnsSelectedIds.size === 0 || !onAddAddOns) return;
    onAddAddOns(addOnsParentKey, [...addOnsSelectedIds]);
    cancelAddOns();
  };

  return (
    <section className="proposal-added-card" aria-label="Added solutions">
      <header className="proposal-added-card__head">
        <div>
          <p className="proposal-added-card__eyebrow">Your Additions</p>
          <h3 className="proposal-added-card__title">Solutions on {scenarioTitle}</h3>
        </div>
        <div className="proposal-added-card__counts" aria-live="polite">
          <span className="proposal-added-card__count proposal-added-card__count--tiers">
            <strong>{tierLines.length}</strong> tier{tierLines.length === 1 ? "" : "s"}
          </span>
          {addonCount > 0 ? (
            <span className="proposal-added-card__count">
              <strong>{addonCount}</strong> add-on{addonCount === 1 ? "" : "s"}
            </span>
          ) : null}
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

      {copyFromScenarios && onCopyFromScenario ? (
        <ProposalCopyScenarioOfferings
          targetScenarioTitle={scenarioTitle}
          sources={copyFromScenarios}
          onCopy={onCopyFromScenario}
        />
      ) : null}

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
            {visibleLines.map((line) => {
              const canOfferMoreAddOns =
                Boolean(line.canAddAddOns && onAddAddOns && remainingAddOnCount(line, addonGroups) > 0);
              return (
                <li key={line.key} className="proposal-added-group">
                  <AddedLineRow
                    line={line}
                    canOfferMoreAddOns={canOfferMoreAddOns}
                    onRemove={onRemove}
                    onAddAddOns={openAddOns}
                  />
                  {line.addons && line.addons.length > 0 ? (
                    <ul className="proposal-added-group__nested">
                      {line.addons.map((addon) => (
                        <li key={addon.key}>
                          <AddedLineRow
                            line={addon}
                            nested
                            canOfferMoreAddOns={false}
                            onRemove={onRemove}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="proposal-added-card__empty">
          No solutions yet. Use <strong>Solution Tiers</strong> or switch to <strong>Packages</strong> below, then click{" "}
          <strong>Add</strong>.
        </p>
      )}

      <ProposalAddOnsModal
        open={addOnsParent != null}
        variant="append"
        solutionName={addOnsParent?.headline ?? ""}
        tierName=""
        groups={addOnsModalGroups}
        selectedTierIds={addOnsSelectedIds}
        onToggleTier={toggleAddOnTier}
        onCancel={cancelAddOns}
        onContinue={confirmAddOns}
      />
    </section>
  );
}
