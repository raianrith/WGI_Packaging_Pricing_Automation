import { useCallback, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type {
  Package,
  PackageBuilderPackageType,
  PackageBuilderSlotTemplate,
  Solution,
  SolutionTier,
  SolutionTierPricing,
  TaskRow,
} from "../../types";
import type { CatalogTierTableRow } from "../CatalogTierTable";
import {
  tryParseRoadmapHours,
  tryParseUsdRough,
  type RoadmapPhase,
  type RoadmapPlaybookComponent,
  type RoadmapScenario,
} from "../../lib/roadmapModel";
import type { ProposalOfferingDates } from "../../lib/proposalDates";
import { proposalStepDef } from "./ProposalBuilderSteps";
import { ProposalCatalogTargetBar } from "./ProposalCatalogTargetBar";
import { ProposalPackageTemplatePicker } from "./ProposalPackageTemplatePicker";
import { ProposalOfferingDatesModal } from "./ProposalOfferingDatesModal";
import { ProposalCatalogListSearch } from "./ProposalCatalogLineRow";
import type { ProposalAddedLine } from "./ProposalAddedItemsPanel";

export type PlaybookPackageDraft = {
  name: string;
  notes: string;
  components: RoadmapPlaybookComponent[];
  dates: ProposalOfferingDates;
};

type Stage = "packages" | "solutions" | "confirm";

const STAGES: Array<{ id: Stage; label: string }> = [
  { id: "packages", label: "Add packages" },
  { id: "solutions", label: "Add solutions" },
  { id: "confirm", label: "Confirm bundle" },
];

const SOLUTION_LIST_LIMIT = 40;

type Props = {
  packageTypes: PackageBuilderPackageType[];
  slots: PackageBuilderSlotTemplate[];
  packages: Package[];
  solutions: Solution[];
  tiers: SolutionTier[];
  tasks: TaskRow[];
  pricing: SolutionTierPricing[];
  solutionRows: CatalogTierTableRow[];
  scenarios: RoadmapScenario[];
  phases: RoadmapPhase[];
  targetScenarioId: string;
  targetPhaseId: string;
  onTargetScenarioChange: (id: string) => void;
  onTargetPhaseChange: (id: string) => void;
  targetScenarioTitle: string;
  targetPhaseTitle: string;
  proposalStartDate: string;
  proposalEndDate: string;
  canAdd: boolean;
  catalogReloading?: boolean;
  onReloadCatalog?: () => Promise<void>;
  formatUsd: (n: number | null | undefined) => string;
  /** Fills hours/price from the current catalog (packages built mid-flow appear after reload). */
  resolveComponent: (c: RoadmapPlaybookComponent) => RoadmapPlaybookComponent;
  onAddPlaybook: (draft: PlaybookPackageDraft) => void;
  addedPlaybooks: ProposalAddedLine[];
  onEditAdded?: (key: string) => void;
  onRemoveAdded: (key: string) => void;
};

function sumComponents(components: RoadmapPlaybookComponent[]): { hours: number; price: number } {
  let hours = 0;
  let price = 0;
  for (const c of components) {
    hours += tryParseRoadmapHours(c.hours) ?? 0;
    price += tryParseUsdRough(c.price) ?? 0;
  }
  return { hours, price };
}

function newComponentKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return `pb-${c.randomUUID()}`;
  return `pb-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatHours(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return `${rounded} h`;
}

export function ProposalPlaybookPackagePanel({
  packageTypes,
  slots,
  packages,
  solutions,
  tiers,
  tasks,
  pricing,
  solutionRows,
  scenarios,
  phases,
  targetScenarioId,
  targetPhaseId,
  onTargetScenarioChange,
  onTargetPhaseChange,
  targetScenarioTitle,
  targetPhaseTitle,
  proposalStartDate,
  proposalEndDate,
  canAdd,
  catalogReloading,
  onReloadCatalog,
  formatUsd,
  resolveComponent,
  onAddPlaybook,
  addedPlaybooks,
  onEditAdded,
  onRemoveAdded,
}: Props) {
  const stepMeta = proposalStepDef("packages");
  const nameId = useId();
  const nameHintId = useId();
  const notesId = useId();
  const searchId = useId();
  const modalTitleId = useId();

  const [modalOpen, setModalOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("packages");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [notes, setNotes] = useState("");
  const [staged, setStaged] = useState<RoadmapPlaybookComponent[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [solutionSearch, setSolutionSearch] = useState("");
  const [datesOpen, setDatesOpen] = useState(false);
  const [justAdded, setJustAdded] = useState<string | null>(null);

  const components = useMemo(() => staged.map(resolveComponent), [staged, resolveComponent]);
  const packageComps = useMemo(() => components.filter((c) => c.kind === "package"), [components]);
  const solutionComps = useMemo(() => components.filter((c) => c.kind === "tier"), [components]);
  const totals = useMemo(() => sumComponents(components), [components]);
  const addedTierIds = useMemo(() => new Set(solutionComps.map((c) => c.refId)), [solutionComps]);

  const showPicker = pickerOpen || packageComps.length === 0;

  const filteredSolutions = useMemo(() => {
    const q = solutionSearch.trim().toLowerCase();
    const rows = q
      ? solutionRows.filter((r) =>
          [r.tierName, r.solutionName, r.categoryRaw, r.tacticRaw, r.tagsRaw]
            .join(" ")
            .toLowerCase()
            .includes(q)
        )
      : solutionRows;
    return rows.slice(0, SOLUTION_LIST_LIMIT);
  }, [solutionRows, solutionSearch]);

  const handlePackageBuilt = useCallback((pkg: Package) => {
    setStaged((prev) => [
      ...prev,
      {
        key: newComponentKey(),
        kind: "package",
        refId: pkg.package_id,
        headline: pkg.package_name?.trim() || pkg.package_id,
        hours: "",
        price: "",
      },
    ]);
    setPickerOpen(false);
  }, []);

  const addSolution = (row: CatalogTierTableRow) => {
    if (addedTierIds.has(row.tierId)) return;
    setStaged((prev) => [
      ...prev,
      {
        key: newComponentKey(),
        kind: "tier",
        refId: row.tierId,
        headline: row.tierName.trim() || row.tierId,
        hours: row.hoursDisplay,
        price: row.priceDisplay,
      },
    ]);
  };

  const removeComponent = (key: string) => {
    setStaged((prev) => prev.filter((c) => c.key !== key));
  };

  const reset = () => {
    setStage("packages");
    setName("");
    setNameTouched(false);
    setNotes("");
    setStaged([]);
    setPickerOpen(false);
    setSolutionSearch("");
  };

  const trimmedName = name.trim();
  const named = trimmedName.length > 0;
  const nameError = nameTouched && !named;
  const hasDraft = named || staged.length > 0;
  const canConfirm = canAdd && named && components.length > 0;
  const openModal = () => {
    setJustAdded(null);
    setModalOpen(true);
  };

  const discardDraft = () => {
    if (staged.length > 0 && !window.confirm("Discard this playbook package draft?")) return;
    reset();
    setModalOpen(false);
  };

  const confirmDates = (dates: ProposalOfferingDates) => {
    if (!canConfirm) return;
    onAddPlaybook({
      name: trimmedName,
      notes: notes.trim(),
      components,
      dates,
    });
    setDatesOpen(false);
    setModalOpen(false);
    setJustAdded(trimmedName);
    reset();
  };

  const stageIndex = STAGES.findIndex((s) => s.id === stage);

  const renderComponentRow = (c: RoadmapPlaybookComponent) => (
    <li key={c.key} className="proposal-playbook__item">
      <span className={`proposal-playbook__item-kind proposal-playbook__item-kind--${c.kind}`}>
        {c.kind === "package" ? "Package" : "Solution"}
      </span>
      <span className="proposal-playbook__item-name">{c.headline}</span>
      <span className="proposal-playbook__item-metric">{c.hours || "—"}</span>
      <span className="proposal-playbook__item-metric proposal-playbook__item-metric--price">
        {c.price || "—"}
      </span>
      <button
        type="button"
        className="proposal-playbook__item-remove"
        onClick={() => removeComponent(c.key)}
        aria-label={`Remove ${c.headline}`}
      >
        Remove
      </button>
    </li>
  );

  const renderFooterActions = () => {
    if (stage === "packages") {
      return (
        <button
          type="button"
          className="roadmap-btn roadmap-btn--primary"
          onClick={() => setStage("solutions")}
          disabled={!named}
        >
          {packageComps.length === 0 ? "Skip to solutions →" : "Next: Add solutions →"}
        </button>
      );
    }
    if (stage === "solutions") {
      return (
        <>
          <button
            type="button"
            className="roadmap-btn roadmap-btn--ghost"
            onClick={() => setStage("packages")}
          >
            ← Back
          </button>
          <button
            type="button"
            className="roadmap-btn roadmap-btn--primary"
            onClick={() => setStage("confirm")}
            disabled={components.length === 0 || !named}
          >
            Next: Review bundle →
          </button>
        </>
      );
    }
    return (
      <>
        <button
          type="button"
          className="roadmap-btn roadmap-btn--ghost"
          onClick={() => setStage("solutions")}
        >
          ← Back
        </button>
        <button
          type="button"
          className="roadmap-btn roadmap-btn--primary"
          onClick={() => setDatesOpen(true)}
          disabled={!canConfirm}
        >
          Confirm &amp; add playbook package
        </button>
      </>
    );
  };

  const modal = (
    <div
      className="proposal-playbook-modal-backdrop"
      role="presentation"
      onClick={() => setModalOpen(false)}
    >
      <div
        className="proposal-playbook-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={modalTitleId}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="proposal-playbook-modal__head">
          <div className="proposal-playbook-modal__head-copy">
            <p className="proposal-playbook-modal__eyebrow">Playbook package</p>
            <h2 id={modalTitleId} className="proposal-playbook-modal__title">
              Build New Playbook Package
            </h2>
            <p className="proposal-playbook-modal__target">
              Adding to <strong>{targetScenarioTitle}</strong> → <strong>{targetPhaseTitle}</strong>
            </p>
          </div>
          <button
            type="button"
            className="proposal-playbook-modal__close"
            onClick={() => setModalOpen(false)}
            aria-label="Close (draft is kept)"
            title="Close — your draft is kept"
          >
            ×
          </button>
        </header>

        <div className="proposal-playbook-modal__body">
          <div className="proposal-playbook__builder-head">
            <div
              className={`proposal-playbook__name${nameError ? " is-invalid" : ""}${named ? " is-filled" : ""}`}
            >
              <label className="proposal-playbook__name-label" htmlFor={nameId}>
                Name your playbook package
                <span className="proposal-playbook__required">Required</span>
              </label>
              <input
                id={nameId}
                className="roadmap-input proposal-playbook__name-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setNameTouched(true)}
                placeholder="e.g. Growth Playbook"
                required
                aria-required="true"
                aria-invalid={nameError}
                aria-describedby={nameHintId}
                autoFocus={!named}
              />
              <p
                id={nameHintId}
                className="proposal-playbook__name-hint"
                role={nameError ? "alert" : undefined}
              >
                {nameError
                  ? "A playbook package name is required before you can add packages or solutions."
                  : named
                    ? "This name appears on the proposal line."
                    : "Start here — packages and solutions unlock once the playbook has a name."}
              </p>
            </div>
          </div>

          <div className="proposal-playbook__summary">
            <ol className="proposal-playbook__stages" aria-label="Playbook steps">
              {STAGES.map((s, i) => {
                const locked =
                  (s.id !== "packages" && !named) || (s.id === "confirm" && components.length === 0);
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={`proposal-playbook__stage${s.id === stage ? " is-active" : ""}${i < stageIndex ? " is-done" : ""}`}
                      onClick={() => setStage(s.id)}
                      disabled={locked}
                      aria-current={s.id === stage ? "step" : undefined}
                    >
                      <span className="proposal-playbook__stage-num">{i + 1}</span>
                      {s.label}
                    </button>
                  </li>
                );
              })}
            </ol>
            <dl className="proposal-playbook__totals" aria-live="polite">
              <div className="proposal-playbook__total">
                <dt className="proposal-playbook__total-label">Packages</dt>
                <dd className="proposal-playbook__total-value">{packageComps.length}</dd>
              </div>
              <div className="proposal-playbook__total">
                <dt className="proposal-playbook__total-label">Solutions</dt>
                <dd className="proposal-playbook__total-value">{solutionComps.length}</dd>
              </div>
              <div className="proposal-playbook__total">
                <dt className="proposal-playbook__total-label">Hours</dt>
                <dd className="proposal-playbook__total-value">{formatHours(totals.hours)}</dd>
              </div>
              <div className="proposal-playbook__total proposal-playbook__total--price">
                <dt className="proposal-playbook__total-label">Price</dt>
                <dd className="proposal-playbook__total-value">{formatUsd(totals.price)}</dd>
              </div>
            </dl>
          </div>

          {stage === "packages" ? (
            <div className="proposal-playbook__stage-body">
              <h3 className="proposal-playbook__section-title">
                Packages in this playbook
                <span className="proposal-playbook__count">{packageComps.length}</span>
              </h3>
              {packageComps.length > 0 ? (
                <ul className="proposal-playbook__list">{packageComps.map(renderComponentRow)}</ul>
              ) : (
                <p className="proposal-playbook__empty">
                  {named
                    ? "No packages yet. Pick a template below and build it just like in Package Builder."
                    : "Name your playbook package above to unlock the templates below."}
                </p>
              )}

              {packageTypes.length === 0 ? (
                <p className="proposal-playbook__empty">
                  No custom packages are enabled for playbooks. An admin can allow them in Admin →
                  Playbook Packages. You can still add solutions.
                </p>
              ) : showPicker ? (
                <>
                  <ProposalPackageTemplatePicker
                    packageTypes={packageTypes}
                    slots={slots}
                    packages={packages}
                    solutions={solutions}
                    tiers={tiers}
                    tasks={tasks}
                    pricing={pricing}
                    canBuild={canAdd && named}
                    catalogReloading={catalogReloading}
                    onReloadCatalog={onReloadCatalog}
                    onPackageBuilt={handlePackageBuilt}
                    prompt="Add a package"
                    hint="Build a package from a template, then it joins this playbook."
                    buildLabel="Build & add to playbook"
                    wizardTitle="Build package for playbook"
                  />
                  {packageComps.length > 0 ? (
                    <div className="proposal-playbook__actions">
                      <button
                        type="button"
                        className="roadmap-btn roadmap-btn--ghost"
                        onClick={() => setPickerOpen(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="proposal-playbook__prompt">
                  <p className="proposal-playbook__prompt-title">Add another package to this playbook?</p>
                  <div className="proposal-playbook__prompt-actions">
                    <button
                      type="button"
                      className="roadmap-btn roadmap-btn--ghost"
                      onClick={() => setPickerOpen(true)}
                      disabled={!named}
                    >
                      Yes, add another
                    </button>
                    <button
                      type="button"
                      className="roadmap-btn roadmap-btn--primary"
                      onClick={() => setStage("solutions")}
                      disabled={!named}
                    >
                      No, add solutions →
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {stage === "solutions" ? (
            <div className="proposal-playbook__stage-body">
              <h3 className="proposal-playbook__section-title">
                Solutions in this playbook
                <span className="proposal-playbook__count">{solutionComps.length}</span>
              </h3>
              {solutionComps.length > 0 ? (
                <ul className="proposal-playbook__list">{solutionComps.map(renderComponentRow)}</ul>
              ) : (
                <p className="proposal-playbook__empty">No solutions yet. Search and add them below.</p>
              )}

              <ProposalCatalogListSearch
                id={searchId}
                value={solutionSearch}
                onChange={setSolutionSearch}
                placeholder="Search solutions…"
                label="Search solutions"
              />
              {solutionRows.length === 0 ? (
                <p className="proposal-playbook__empty">
                  No solutions are enabled for playbooks. An admin can allow them in Admin → Playbook
                  Packages.
                </p>
              ) : filteredSolutions.length === 0 ? (
                <p className="proposal-playbook__empty">No solutions match your search.</p>
              ) : (
                <ul className="proposal-playbook__catalog">
                  {filteredSolutions.map((r) => {
                    const added = addedTierIds.has(r.tierId);
                    return (
                      <li key={r.tierId} className="proposal-playbook__catalog-row">
                        <span className="proposal-playbook__catalog-main">
                          <span className="proposal-playbook__catalog-name">{r.tierName}</span>
                          <span className="proposal-playbook__catalog-sub">
                            {[r.solutionName, r.categoryRaw].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                        <span className="proposal-playbook__item-metric">{r.hoursDisplay || "—"}</span>
                        <span className="proposal-playbook__item-metric proposal-playbook__item-metric--price">
                          {r.priceDisplay || "—"}
                        </span>
                        <button
                          type="button"
                          className={`proposal-playbook__catalog-add${added ? " is-added" : ""}`}
                          onClick={() => addSolution(r)}
                          disabled={added || !named}
                        >
                          {added ? "Added" : "Add"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {solutionRows.length > SOLUTION_LIST_LIMIT && !solutionSearch.trim() ? (
                <p className="proposal-playbook__hint">
                  Showing the first {SOLUTION_LIST_LIMIT} solutions — search to find more.
                </p>
              ) : null}
            </div>
          ) : null}

          {stage === "confirm" ? (
            <div className="proposal-playbook__stage-body">
              <h3 className="proposal-playbook__section-title">Confirm playbook bundle</h3>
              <div className="proposal-playbook__table" role="table" aria-label="Playbook components">
                <div className="proposal-playbook__table-row proposal-playbook__table-row--head" role="row">
                  <span role="columnheader">Type</span>
                  <span role="columnheader">Item</span>
                  <span role="columnheader">Hours</span>
                  <span role="columnheader">Price</span>
                </div>
                {components.map((c) => (
                  <div key={c.key} className="proposal-playbook__table-row" role="row">
                    <span role="cell">
                      <span className={`proposal-playbook__item-kind proposal-playbook__item-kind--${c.kind}`}>
                        {c.kind === "package" ? "Package" : "Solution"}
                      </span>
                    </span>
                    <span role="cell" className="proposal-playbook__table-name">
                      {c.headline}
                    </span>
                    <span role="cell">{c.hours || "—"}</span>
                    <span role="cell">{c.price || "—"}</span>
                  </div>
                ))}
                <div className="proposal-playbook__table-row proposal-playbook__table-row--total" role="row">
                  <span role="cell" />
                  <span role="cell">Bundle total</span>
                  <span role="cell">{formatHours(totals.hours)}</span>
                  <span role="cell">{formatUsd(totals.price)}</span>
                </div>
              </div>

              <label className="proposal-playbook__field" htmlFor={notesId}>
                <span className="proposal-playbook__label">Notes (optional)</span>
                <textarea
                  id={notesId}
                  className="roadmap-input proposal-playbook__textarea"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="What this playbook delivers for the client"
                />
              </label>

              <div className="proposal-playbook__final">
                <p className="proposal-playbook__final-summary">
                  <strong>{trimmedName || "Untitled playbook"}</strong> · {formatHours(totals.hours)} ·{" "}
                  {formatUsd(totals.price)}
                </p>
                {!trimmedName ? (
                  <p className="proposal-playbook__warn" role="alert">
                    Name the playbook package to continue.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <footer className="proposal-playbook-modal__footer">
          <button type="button" className="proposal-playbook-modal__discard" onClick={discardDraft}>
            Discard draft
          </button>
          <div className="proposal-playbook-modal__footer-actions">{renderFooterActions()}</div>
        </footer>
      </div>
    </div>
  );

  return (
    <div className="proposal-step-panel proposal-catalog proposal-playbook">
      <header className="proposal-step-panel__head">
        <p className="proposal-step-panel__eyebrow">Step {stepMeta.number} · Playbook package</p>
        <h2 className="proposal-step-panel__title">Build New Playbook Package</h2>
        <p className="proposal-step-panel__lead">
          Bundle built packages and solutions into one playbook. Hours and pricing roll up into a single
          line on the proposal.
        </p>
      </header>

      <ProposalCatalogTargetBar
        scenarios={scenarios}
        phases={phases}
        targetScenarioId={targetScenarioId}
        targetPhaseId={targetPhaseId}
        onTargetScenarioChange={onTargetScenarioChange}
        onTargetPhaseChange={onTargetPhaseChange}
        targetScenarioTitle={targetScenarioTitle}
        targetPhaseTitle={targetPhaseTitle}
        canAdd={canAdd}
      />

      {justAdded ? (
        <aside className="proposal-playbook__success" aria-live="polite">
          <p className="proposal-playbook__success-text">
            <strong>{justAdded}</strong> was added to {targetScenarioTitle} · {targetPhaseTitle}.
          </p>
          <button
            type="button"
            className="roadmap-btn roadmap-btn--ghost"
            onClick={() => setJustAdded(null)}
          >
            Dismiss
          </button>
        </aside>
      ) : null}

      <section className="proposal-playbook__launch" aria-label="Start a playbook package">
        <span className="proposal-playbook__launch-icon" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" width="24" height="24">
            <rect x="3.5" y="3.5" width="7" height="7" rx="1.75" stroke="currentColor" strokeWidth="1.75" />
            <rect x="13.5" y="3.5" width="7" height="7" rx="1.75" stroke="currentColor" strokeWidth="1.75" />
            <rect x="3.5" y="13.5" width="7" height="7" rx="1.75" stroke="currentColor" strokeWidth="1.75" />
            <path d="M17 14v6M14 17h6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        </span>
        <div className="proposal-playbook__launch-copy">
          {hasDraft ? (
            <>
              <p className="proposal-playbook__launch-title">
                Draft in progress: {trimmedName || "Untitled playbook"}
              </p>
              <p className="proposal-playbook__launch-desc">
                {packageComps.length} package{packageComps.length === 1 ? "" : "s"} ·{" "}
                {solutionComps.length} solution{solutionComps.length === 1 ? "" : "s"} ·{" "}
                {formatHours(totals.hours)} · {formatUsd(totals.price)}
              </p>
            </>
          ) : (
            <>
              <p className="proposal-playbook__launch-title">Create a playbook package</p>
              <p className="proposal-playbook__launch-desc">
                Name it, build packages from templates, add solutions, then confirm the bundle hours and
                pricing — all in one guided form.
              </p>
            </>
          )}
        </div>
        <button
          type="button"
          className="roadmap-btn roadmap-btn--primary proposal-playbook__launch-btn"
          onClick={openModal}
          disabled={!canAdd}
        >
          {hasDraft ? "Continue draft" : "Build playbook package"}
        </button>
      </section>

      {addedPlaybooks.length > 0 ? (
        <section className="proposal-playbook__existing" aria-label="Playbook packages in this scenario">
          <h3 className="proposal-playbook__section-title">
            Playbook packages in {targetScenarioTitle}
            <span className="proposal-playbook__count">{addedPlaybooks.length}</span>
          </h3>
          <ul className="proposal-playbook__list">
            {addedPlaybooks.map((line) => (
              <li key={line.key} className="proposal-playbook__item proposal-playbook__item--existing">
                <span className="proposal-playbook__item-kind proposal-playbook__item-kind--playbook">
                  Playbook
                </span>
                <span className="proposal-playbook__item-name">{line.headline}</span>
                <span className="proposal-playbook__item-metric">{line.phaseTitle}</span>
                <span className="proposal-playbook__item-metric proposal-playbook__item-metric--price">
                  {line.priceDisplay}
                </span>
                <span className="proposal-playbook__item-actions">
                  {onEditAdded ? (
                    <button
                      type="button"
                      className="proposal-playbook__item-remove"
                      onClick={() => onEditAdded(line.key)}
                    >
                      Edit
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="proposal-playbook__item-remove"
                    onClick={() => onRemoveAdded(line.key)}
                  >
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {modalOpen ? createPortal(modal, document.body) : null}

      <ProposalOfferingDatesModal
        open={datesOpen}
        title="Playbook dates"
        subtitle="Set when this playbook package runs in the proposal timeline."
        itemLabel={trimmedName}
        proposalStartDate={proposalStartDate}
        proposalEndDate={proposalEndDate}
        onCancel={() => setDatesOpen(false)}
        onConfirm={confirmDates}
      />
    </div>
  );
}
