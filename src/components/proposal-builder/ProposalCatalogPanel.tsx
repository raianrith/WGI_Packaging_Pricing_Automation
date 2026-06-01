import { useId, useMemo, useState } from "react";
import type { Package, SolutionTier } from "../../types";
import type { CatalogTierTableRow } from "../CatalogTierTable";
import type { RoadmapPhase, RoadmapScenario } from "../../lib/roadmapModel";
import { sortedPhasesForScenario } from "../../lib/roadmapModel";
import { ProposalAddedItemsPanel, type ProposalAddedLine } from "./ProposalAddedItemsPanel";
import type { ScenarioCopySource } from "./ProposalCopyScenarioOfferings";
import {
  ProposalScenarioBudgetBars,
  type ScenarioBudgetBarRow,
} from "./ProposalScenarioBudgetBars";
import {
  ProposalCatalogLineRow,
  ProposalCatalogLinesPanel,
  ProposalCatalogListSearch,
} from "./ProposalCatalogLineRow";

const UNSET = "Not classified";
/** Sentinel: skip this drill-down level and show all tiers at the current scope. */
export const BROWSE_SHOW_ALL = "__show_all__";

type CatalogCtxLike = {
  packages: Package[];
  tiers: SolutionTier[];
};

type Props = {
  catalogTierTableRows: CatalogTierTableRow[];
  ctx: CatalogCtxLike;
  scenarios: RoadmapScenario[];
  phases: RoadmapPhase[];
  targetScenarioId: string;
  targetPhaseId: string;
  onTargetScenarioChange: (id: string) => void;
  onTargetPhaseChange: (id: string) => void;
  targetScenarioTitle: string;
  targetPhaseTitle: string;
  filteredPackages: Package[];
  packagePreview: (p: Package) => { hours: string; price: string };
  onAddPackage: (p: Package) => void;
  onAddTier: (t: SolutionTier) => void;
  onAddScratchTier: () => void;
  canAdd: boolean;
  catalogReloading?: boolean;
  onReloadCatalog?: () => void;
  budget: number | null;
  scenarioBudgetBars: ScenarioBudgetBarRow[];
  formatUsd: (n: number | null | undefined) => string;
  addedLines: ProposalAddedLine[];
  onRemoveAdded: (key: string) => void;
  addedTierRefIds: Set<string>;
  addedPackageRefIds: Set<string>;
  copyFromScenarios?: ScenarioCopySource[];
  onCopyFromScenario?: (sourceScenarioId: string) => void;
};

function normLabel(raw: string): string {
  const t = raw.trim();
  return t || UNSET;
}

function compareLabels(a: string, b: string): number {
  if (a === UNSET && b !== UNSET) return 1;
  if (b === UNSET && a !== UNSET) return -1;
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function countGroups(rows: CatalogTierTableRow[], field: (r: CatalogTierTableRow) => string): { label: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = normLabel(field(r));
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => compareLabels(a.label, b.label));
}

function BrowseCard({
  label,
  count,
  sub,
  onClick,
  variant = "default",
}: {
  label: string;
  count: number;
  sub?: string;
  onClick: () => void;
  variant?: "default" | "show-all";
}) {
  return (
    <button
      type="button"
      className={`proposal-browse-card${variant === "show-all" ? " proposal-browse-card--show-all" : ""}`}
      onClick={onClick}
    >
      <span className="proposal-browse-card__label">{label}</span>
      {sub ? <span className="proposal-browse-card__sub">{sub}</span> : null}
      <span className="proposal-browse-card__count">
        {count} tier{count === 1 ? "" : "s"}
      </span>
    </button>
  );
}

function crumbLabel(value: string | null): string {
  if (value === BROWSE_SHOW_ALL) return "Show All";
  return value ?? "";
}

function phaseContextLabel(phase: string | null): string {
  if (!phase || phase === BROWSE_SHOW_ALL) return "catalog";
  return `${phase} phase`;
}

function SolutionTierBrowsePath({
  browsePhase,
  browseCategory,
  browseTactic,
  browseLevel,
  onReset,
  onBackToPhases,
  onBackToCategories,
  onBackToTracks,
}: {
  browsePhase: string | null;
  browseCategory: string | null;
  browseTactic: string | null;
  browseLevel: "phase" | "category" | "tactic" | "tiers";
  onReset: () => void;
  onBackToPhases: () => void;
  onBackToCategories: () => void;
  onBackToTracks: () => void;
}) {
  if (browsePhase === null) {
    return (
      <nav className="proposal-catalog-crumb" aria-label="Solution tier browse path">
        <span className="proposal-catalog-crumb__current">Phase</span>
      </nav>
    );
  }

  const phaseName = crumbLabel(browsePhase);
  const categoryName = browseCategory !== null ? crumbLabel(browseCategory) : null;
  const tacticName = browseTactic !== null ? crumbLabel(browseTactic) : null;

  return (
    <nav className="proposal-catalog-crumb" aria-label="Solution tier browse path">
      <button type="button" className="proposal-catalog-crumb__link" onClick={onReset}>
        Phase
      </button>
      <span className="proposal-catalog-crumb__sep" aria-hidden>
        :
      </span>
      <button
        type="button"
        className="proposal-catalog-crumb__link"
        onClick={() => {
          if (browseLevel === "category") onBackToPhases();
          else onBackToCategories();
        }}
      >
        {phaseName}
      </button>

      {browseLevel === "category" ? (
        <span className="proposal-catalog-crumb__current"> / Category</span>
      ) : null}

      {categoryName !== null && browseLevel !== "category" ? (
        <>
          <button type="button" className="proposal-catalog-crumb__link" onClick={onBackToCategories}>
            {" "}
            / Category
          </button>
          <span className="proposal-catalog-crumb__sep" aria-hidden>
            :
          </span>
          <button type="button" className="proposal-catalog-crumb__link" onClick={onBackToCategories}>
            {categoryName}
          </button>
        </>
      ) : null}

      {browseLevel === "tiers" && browseCategory === null ? (
        <span className="proposal-catalog-crumb__current"> / All tiers</span>
      ) : null}

      {browseLevel === "tactic" ? (
        <span className="proposal-catalog-crumb__current"> / Track</span>
      ) : null}

      {tacticName !== null && browseLevel === "tiers" ? (
        <>
          <button type="button" className="proposal-catalog-crumb__link" onClick={onBackToTracks}>
            {" "}
            / Track
          </button>
          <span className="proposal-catalog-crumb__sep" aria-hidden>
            :
          </span>
          <button type="button" className="proposal-catalog-crumb__link" onClick={onBackToTracks}>
            {tacticName}
          </button>
        </>
      ) : null}
    </nav>
  );
}

export function ProposalCatalogPanel({
  catalogTierTableRows,
  ctx,
  scenarios,
  phases,
  targetScenarioId,
  targetPhaseId,
  onTargetScenarioChange,
  onTargetPhaseChange,
  targetScenarioTitle,
  targetPhaseTitle,
  filteredPackages,
  packagePreview,
  onAddPackage,
  onAddTier,
  onAddScratchTier,
  canAdd,
  catalogReloading,
  onReloadCatalog,
  budget,
  scenarioBudgetBars,
  formatUsd,
  addedLines,
  onRemoveAdded,
  addedTierRefIds,
  addedPackageRefIds,
  copyFromScenarios,
  onCopyFromScenario,
}: Props) {
  const searchId = useId();
  const [catalogMode, setCatalogMode] = useState<"playbook" | "packages">("playbook");
  const [browsePhase, setBrowsePhase] = useState<string | null>(null);
  const [browseCategory, setBrowseCategory] = useState<string | null>(null);
  const [browseTactic, setBrowseTactic] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [justAddedId, setJustAddedId] = useState<string | null>(null);

  const targetPhases = useMemo(
    () => sortedPhasesForScenario(phases, targetScenarioId),
    [phases, targetScenarioId]
  );

  const tierById = useMemo(() => {
    const m = new Map<string, SolutionTier>();
    for (const t of ctx.tiers) m.set(t.solution_tier_id, t);
    return m;
  }, [ctx.tiers]);

  const rowsForPhase = useMemo(() => {
    if (browsePhase === null || browsePhase === BROWSE_SHOW_ALL) return catalogTierTableRows;
    return catalogTierTableRows.filter((r) => normLabel(r.phaseRaw) === browsePhase);
  }, [catalogTierTableRows, browsePhase]);

  const rowsForCategory = useMemo(() => {
    if (browseCategory === null || browseCategory === BROWSE_SHOW_ALL) return rowsForPhase;
    return rowsForPhase.filter((r) => normLabel(r.categoryRaw) === browseCategory);
  }, [rowsForPhase, browseCategory]);

  const rowsForTactic = useMemo(() => {
    if (browseTactic === null || browseTactic === BROWSE_SHOW_ALL) return rowsForCategory;
    return rowsForCategory.filter((r) => normLabel(r.tacticRaw) === browseTactic);
  }, [rowsForCategory, browseTactic]);

  const browseLevel = useMemo(() => {
    if (browsePhase === BROWSE_SHOW_ALL || browseCategory === BROWSE_SHOW_ALL || browseTactic === BROWSE_SHOW_ALL) {
      return "tiers" as const;
    }
    if (browseTactic !== null) return "tiers" as const;
    if (browseCategory !== null) return "tactic" as const;
    if (browsePhase !== null) return "category" as const;
    return "phase" as const;
  }, [browsePhase, browseCategory, browseTactic]);

  const stepPrompt = useMemo(() => {
    if (browseLevel === "phase") return "Pick A Phase";
    if (browseLevel === "category") return "Pick A Category";
    if (browseLevel === "tactic") return "Pick A Track";
    if (browsePhase === BROWSE_SHOW_ALL) return "All Tiers";
    if (browseCategory === BROWSE_SHOW_ALL) return `All Tiers In ${phaseContextLabel(browsePhase)}`;
    if (browseTactic === BROWSE_SHOW_ALL) {
      return `All Tiers In ${crumbLabel(browseCategory)}, ${phaseContextLabel(browsePhase)}`;
    }
    return `Add tiers — ${crumbLabel(browseTactic)}`;
  }, [browseLevel, browsePhase, browseCategory, browseTactic]);

  const searchLower = search.trim().toLowerCase();
  const tierRows = useMemo(() => {
    let rows = rowsForTactic;
    if (!searchLower) return rows;
    return rows.filter((r) => {
      const blob = `${r.tierName} ${r.solutionName} ${r.tierId} ${r.phaseRaw} ${r.categoryRaw} ${r.tacticRaw}`.toLowerCase();
      return blob.includes(searchLower);
    });
  }, [rowsForTactic, searchLower]);

  const phaseGroups = useMemo(() => countGroups(catalogTierTableRows, (r) => r.phaseRaw), [catalogTierTableRows]);
  const categoryGroups = useMemo(() => countGroups(rowsForPhase, (r) => r.categoryRaw), [rowsForPhase]);
  const tacticGroups = useMemo(() => countGroups(rowsForCategory, (r) => r.tacticRaw), [rowsForCategory]);

  const resetBrowse = () => {
    setBrowsePhase(null);
    setBrowseCategory(null);
    setBrowseTactic(null);
    setSearch("");
  };

  const goPlaybook = () => {
    setCatalogMode("playbook");
    resetBrowse();
  };

  const handleAddTier = (tierId: string) => {
    const tier = tierById.get(tierId);
    if (!tier || !canAdd) return;
    onAddTier(tier);
    setJustAddedId(`tier:${tierId}`);
    window.setTimeout(() => setJustAddedId((id) => (id === `tier:${tierId}` ? null : id)), 1600);
  };

  const handleAddPackage = (packageId: string) => {
    const pkg = ctx.packages.find((p) => p.package_id === packageId);
    if (!pkg || !canAdd) return;
    onAddPackage(pkg);
    setJustAddedId(`pkg:${packageId}`);
    window.setTimeout(() => setJustAddedId((id) => (id === `pkg:${packageId}` ? null : id)), 1600);
  };

  return (
    <div className="proposal-step-panel proposal-catalog">
      <header className="proposal-step-panel__head">
        <p className="proposal-step-panel__eyebrow">Step 3</p>
        <h2 className="proposal-step-panel__title">Add Offerings</h2>
        <p className="proposal-step-panel__lead">
          Choose where items land, then add <strong>Solution Tiers</strong> (phase → category → track) or switch to{" "}
          <strong>Packages</strong> to add full agency packages. Use <strong>Show All</strong> to skip a drill-down level.
        </p>
      </header>

      <section
        className={`proposal-catalog-target${canAdd ? " proposal-catalog-target--ready" : " proposal-catalog-target--blocked"}`}
        aria-label="Choose where new items are added"
      >
        <div className="proposal-catalog-target__row">
          <div className="proposal-catalog-target__summary">
            <div className="proposal-catalog-target__hero-badge" aria-hidden>
              +
            </div>
            <div className="proposal-catalog-target__hero-copy">
              <p className="proposal-catalog-target__eyebrow">Adding To</p>
              {canAdd ? (
                <p className="proposal-catalog-target__live" aria-live="polite">
                  <span className="proposal-catalog-target__live-scenario">{targetScenarioTitle}</span>
                  <span className="proposal-catalog-target__live-arrow" aria-hidden>
                    →
                  </span>
                  <span className="proposal-catalog-target__live-phase">{targetPhaseTitle}</span>
                </p>
              ) : (
                <p className="proposal-catalog-target__blocked-msg">
                  Add a phase in <strong>Scenarios &amp; Phases</strong> first.
                </p>
              )}
            </div>
          </div>

          <div className="proposal-catalog-target__pickers">
          <div className="proposal-catalog-target__picker">
            <span className="proposal-catalog-target__picker-label">Scenario</span>
            <div className="proposal-catalog-target__pills" role="list">
              {scenarios.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="listitem"
                  className={`proposal-catalog-target__pill${targetScenarioId === s.id ? " is-active" : ""}`}
                  onClick={() => onTargetScenarioChange(s.id)}
                >
                  {s.title.trim() || "Untitled"}
                </button>
              ))}
            </div>
          </div>
          <div className="proposal-catalog-target__picker">
            <span className="proposal-catalog-target__picker-label">Phase</span>
            <div className="proposal-catalog-target__pills" role="list">
              {targetPhases.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="listitem"
                  className={`proposal-catalog-target__pill${targetPhaseId === p.id ? " is-active" : ""}`}
                  onClick={() => onTargetPhaseChange(p.id)}
                  disabled={!canAdd && targetPhases.length === 0}
                >
                  {p.title.trim() || "Phase"}
                </button>
              ))}
            </div>
          </div>
        </div>
        </div>
      </section>

      <div className="proposal-catalog-dashboard">
        <ProposalScenarioBudgetBars budget={budget} scenarios={scenarioBudgetBars} formatUsd={formatUsd} />
        <ProposalAddedItemsPanel
          scenarioTitle={targetScenarioTitle}
          targetPhaseTitle={targetPhaseTitle}
          lines={addedLines}
          onRemove={onRemoveAdded}
          copyFromScenarios={copyFromScenarios}
          onCopyFromScenario={onCopyFromScenario}
        />
      </div>

      <div className="proposal-catalog-source">
        <nav className="proposal-catalog-source-tabs" aria-label="Catalog source">
          <div
            className="proposal-catalog-source-tabs__track"
            role="tablist"
          >
            <div
              className={`proposal-catalog-source-tabs__slider${catalogMode === "packages" ? " proposal-catalog-source-tabs__slider--right" : ""}`}
              aria-hidden
            />
            <button
              type="button"
              role="tab"
              aria-selected={catalogMode === "playbook"}
              className={`proposal-catalog-source-tabs__tab${catalogMode === "playbook" ? " is-active" : ""}`}
              onClick={goPlaybook}
            >
              Solution Tiers
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={catalogMode === "packages"}
              className={`proposal-catalog-source-tabs__tab${catalogMode === "packages" ? " is-active" : ""}`}
              onClick={() => {
                setCatalogMode("packages");
                resetBrowse();
              }}
            >
              Packages
              <span className="proposal-catalog-source-tabs__count">{ctx.packages.length}</span>
            </button>
          </div>
          {onReloadCatalog ? (
            <button
              type="button"
              className="proposal-catalog-mode-link"
              onClick={onReloadCatalog}
              disabled={catalogReloading}
            >
              {catalogReloading ? "Refreshing…" : "Refresh catalog"}
            </button>
          ) : null}
        </nav>
      </div>

      <div className="proposal-catalog-browse__head">
        {catalogMode === "playbook" ? (
          <SolutionTierBrowsePath
            browsePhase={browsePhase}
            browseCategory={browseCategory}
            browseTactic={browseTactic}
            browseLevel={browseLevel}
            onReset={resetBrowse}
            onBackToPhases={() => {
              setBrowsePhase(null);
              setBrowseCategory(null);
              setBrowseTactic(null);
              setSearch("");
            }}
            onBackToCategories={() => {
              setBrowseCategory(null);
              setBrowseTactic(null);
              setSearch("");
            }}
            onBackToTracks={() => {
              setBrowseTactic(null);
              setSearch("");
            }}
          />
        ) : null}
      </div>

      {catalogMode === "packages" ? (
        <div className="proposal-catalog-offerings">
          <p className="proposal-catalog-step-prompt">Pick A Package</p>
          <p className="proposal-catalog-offerings__hint">
            Bundled solution tiers · adding to <strong>{targetScenarioTitle}</strong> ·{" "}
            <strong>{targetPhaseTitle}</strong>
          </p>
          <ProposalCatalogListSearch
            id={searchId}
            value={search}
            onChange={setSearch}
            placeholder="Search packages…"
            label="Search packages"
          />
          <ProposalCatalogLinesPanel
            count={
              filteredPackages.filter(
                (p) => !searchLower || p.package_name.toLowerCase().includes(searchLower)
              ).length
            }
            isEmpty={
              ctx.packages.length === 0 ||
              filteredPackages.filter((p) => !searchLower || p.package_name.toLowerCase().includes(searchLower))
                .length === 0
            }
            emptyTitle={ctx.packages.length === 0 ? "No packages yet" : "No matches"}
            emptyText={
              ctx.packages.length === 0
                ? "Create packages in Admin, then refresh the catalog."
                : "Try a different search term."
            }
          >
            {filteredPackages
              .filter((p) => !searchLower || p.package_name.toLowerCase().includes(searchLower))
              .map((p) => {
                const row = packagePreview(p);
                const onProposal = addedPackageRefIds.has(p.package_id);
                const justAdded = justAddedId === `pkg:${p.package_id}`;
                return (
                  <ProposalCatalogLineRow
                    key={p.package_id}
                    kind="package"
                    title={p.package_name}
                    detail="Linked solution tiers bundle"
                    hours={row.hours}
                    price={row.price}
                    onProposal={onProposal}
                    justAdded={justAdded}
                    canAdd={canAdd}
                    onAdd={() => handleAddPackage(p.package_id)}
                  />
                );
              })}
          </ProposalCatalogLinesPanel>
        </div>
      ) : (
        <>
          <p className="proposal-catalog-step-prompt">{stepPrompt}</p>

          {browseLevel === "phase" ? (
            <div className="proposal-catalog-browse-grid" role="list" aria-label="Phases">
              <BrowseCard
                label="Show All"
                count={catalogTierTableRows.length}
                sub="All Tiers"
                variant="show-all"
                onClick={() => {
                  setBrowsePhase(BROWSE_SHOW_ALL);
                  setBrowseCategory(null);
                  setBrowseTactic(null);
                  setSearch("");
                }}
              />
              {phaseGroups.map(({ label, count }) => (
                <BrowseCard
                  key={label}
                  label={label}
                  count={count}
                  sub="Then pick a category"
                  onClick={() => {
                    setBrowsePhase(label);
                    setBrowseCategory(null);
                    setBrowseTactic(null);
                  }}
                />
              ))}
            </div>
          ) : null}

          {browseLevel === "category" ? (
            <div className="proposal-catalog-browse-grid" role="list" aria-label="Categories">
              <BrowseCard
                label="Show All"
                count={rowsForPhase.length}
                sub={`All Tiers In ${phaseContextLabel(browsePhase)}`}
                variant="show-all"
                onClick={() => {
                  setBrowseCategory(BROWSE_SHOW_ALL);
                  setBrowseTactic(null);
                  setSearch("");
                }}
              />
              {categoryGroups.map(({ label, count }) => (
                <BrowseCard
                  key={label}
                  label={label}
                  count={count}
                  sub="Then pick a track"
                  onClick={() => {
                    setBrowseCategory(label);
                    setBrowseTactic(null);
                  }}
                />
              ))}
            </div>
          ) : null}

          {browseLevel === "tactic" ? (
            <div className="proposal-catalog-browse-grid" role="list" aria-label="Tracks">
              <BrowseCard
                label="Show All"
                count={rowsForCategory.length}
                sub={`All Tiers In ${crumbLabel(browseCategory)}, ${phaseContextLabel(browsePhase)}`}
                variant="show-all"
                onClick={() => {
                  setBrowseTactic(BROWSE_SHOW_ALL);
                  setSearch("");
                }}
              />
              {tacticGroups.map(({ label, count }) => (
                <BrowseCard
                  key={label}
                  label={label}
                  count={count}
                  sub="View tiers to add"
                  onClick={() => {
                    setBrowseTactic(label);
                    setSearch("");
                  }}
                />
              ))}
            </div>
          ) : null}

          {browseLevel === "tiers" ? (
            <div className="proposal-catalog-offerings">
              <ProposalCatalogListSearch
                id={searchId}
                value={search}
                onChange={setSearch}
                placeholder="Search tiers or solutions…"
                label="Search solution tiers"
              />
              <ProposalCatalogLinesPanel
                count={tierRows.length}
                isEmpty={tierRows.length === 0}
                emptyTitle="No tiers match"
                emptyText="Try search or go back and pick another track."
              >
                {tierRows.map((r) => {
                  const onProposal = addedTierRefIds.has(r.tierId);
                  const justAdded = justAddedId === `tier:${r.tierId}`;
                  const taxonomy =
                    [r.phaseRaw, r.categoryRaw, r.tacticRaw].filter((x) => x.trim()).join(" · ") ||
                    r.solutionName;
                  return (
                    <ProposalCatalogLineRow
                      key={r.tierId}
                      kind="tier"
                      title={r.tierName}
                      detail={taxonomy}
                      hours={r.hoursDisplay}
                      price={r.priceDisplay}
                      onProposal={onProposal}
                      justAdded={justAdded}
                      canAdd={canAdd}
                      onAdd={() => handleAddTier(r.tierId)}
                    />
                  );
                })}
              </ProposalCatalogLinesPanel>
              <footer className="proposal-catalog-tiers__footer">
                <button
                  type="button"
                  className="roadmap-btn roadmap-btn--ghost roadmap-btn--sm"
                  disabled={!canAdd}
                  onClick={onAddScratchTier}
                >
                  + Custom one-off tier
                </button>
              </footer>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
