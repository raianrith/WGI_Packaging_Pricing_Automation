import { useMemo, useState } from "react";
import type { ModuleAddOnGroup } from "../../lib/buildCatalogDirectoryRows";

type Props = {
  open: boolean;
  variant?: "initial" | "append";
  solutionName: string;
  tierName: string;
  groups: ModuleAddOnGroup[];
  selectedTierIds: ReadonlySet<string>;
  onToggleTier: (tierId: string) => void;
  onCancel: () => void;
  onContinue: () => void;
};

export function ProposalAddOnsModal({
  open,
  variant = "initial",
  solutionName,
  tierName,
  groups,
  selectedTierIds,
  onToggleTier,
  onCancel,
  onContinue,
}: Props) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const filteredGroups = useMemo(() => {
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        tiers: g.tiers.filter((t) => {
          const blob = `${g.name} ${t.tierName} ${t.priceDisplay} ${t.hoursDisplay}`.toLowerCase();
          return blob.includes(q);
        }),
      }))
      .filter((g) => g.tiers.length > 0);
  }, [groups, q]);

  const selectedCount = selectedTierIds.size;
  const selectedLabels = useMemo(() => {
    const labels: string[] = [];
    for (const g of groups) {
      for (const t of g.tiers) {
        if (selectedTierIds.has(t.tierId)) labels.push(t.tierName || g.name);
      }
    }
    return labels;
  }, [groups, selectedTierIds]);

  if (!open) return null;

  return (
    <div
      className="agency-pkg-label-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="agency-pkg-label-modal proposal-addons-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="proposal-addons-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="agency-pkg-label-modal__header">
          <div className="agency-pkg-label-modal__head-copy">
            <p className="agency-pkg-label-modal__eyebrow">Add-ons</p>
            <h3 id="proposal-addons-title" className="agency-pkg-label-modal__title">
              {variant === "append" ? "Add more add-ons?" : "Add any add-ons?"}
            </h3>
            <p className="agency-pkg-label-modal__sub">
              {solutionName}
              {tierName.trim() && tierName.trim() !== solutionName ? ` · ${tierName}` : ""}
            </p>
          </div>
          <button
            type="button"
            className="agency-pkg-label-modal__close"
            aria-label="Close"
            onClick={onCancel}
          >
            ×
          </button>
        </header>

        <div className="agency-pkg-label-modal__body proposal-addons-modal__body">
          <p className="agency-pkg-label-modal__hint proposal-addons-modal__lead">
            {variant === "append"
              ? "Pick any number of Solution Module tiers (Copy, Design, Dev, Video) to attach to this solution."
              : "Optional. Pick any number of Solution Module tiers (Copy, Design, Dev, Video) to add with this solution."}
          </p>
          <label className="agency-pkg-label-modal__field">
            <span className="agency-pkg-label-modal__field-label">Search modules</span>
            <input
              className="agency-pkg-label-modal__input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Copy, Design, Video, Small…"
              autoComplete="off"
            />
          </label>

          {selectedCount > 0 ? (
            <p className="proposal-addons-modal__selected">
              <strong>{selectedCount}</strong> selected
              {selectedLabels.length > 0 ? `: ${selectedLabels.join(", ")}` : ""}
            </p>
          ) : (
            <p className="proposal-addons-modal__selected proposal-addons-modal__selected--empty">
              {variant === "append"
                ? "None selected."
                : "None selected — you can continue without add-ons."}
            </p>
          )}

          <div className="proposal-addons-modal__groups">
            {filteredGroups.length === 0 ? (
              <p className="proposal-addons-modal__empty">
                {groups.length === 0
                  ? "All available add-ons are already on this solution."
                  : "No solution module tiers match."}
              </p>
            ) : (
              filteredGroups.map((g) => (
                <section key={g.solutionId} className="proposal-addons-group">
                  <h4 className="proposal-addons-group__title">
                    {g.name}
                    <span className="proposal-addons-group__count">
                      {g.tiers.length} {g.tiers.length === 1 ? "tier" : "tiers"}
                    </span>
                  </h4>
                  <ul className="proposal-addons-group__list">
                    {g.tiers.map((t) => {
                      const on = selectedTierIds.has(t.tierId);
                      return (
                        <li key={t.tierId}>
                          <button
                            type="button"
                            className={`proposal-addons-tier${on ? " is-selected" : ""}`}
                            onClick={() => onToggleTier(t.tierId)}
                            aria-pressed={on}
                          >
                            <span className="proposal-addons-tier__copy">
                              <span className="proposal-addons-tier__name">{t.tierName}</span>
                              <span className="proposal-addons-tier__meta">
                                {t.hoursDisplay && t.hoursDisplay !== "—" ? `${t.hoursDisplay} h` : "—"}
                                {" · "}
                                {t.priceDisplay || "—"}
                              </span>
                            </span>
                            <span className="proposal-addons-tier__action">{on ? "Added" : "Add"}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))
            )}
          </div>
        </div>

        <footer className="agency-pkg-label-modal__footer">
          <button type="button" className="roadmap-btn roadmap-btn--ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="roadmap-btn roadmap-btn--primary"
            onClick={onContinue}
            disabled={variant === "append" && selectedCount === 0}
          >
            {variant === "append"
              ? selectedCount > 0
                ? `Add ${selectedCount} add-on${selectedCount === 1 ? "" : "s"}`
                : "Add add-ons"
              : selectedCount > 0
                ? `Continue with ${selectedCount} add-on${selectedCount === 1 ? "" : "s"}`
                : "Continue without add-ons"}
          </button>
        </footer>
      </div>
    </div>
  );
}
