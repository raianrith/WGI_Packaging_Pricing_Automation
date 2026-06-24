import { useMemo, type CSSProperties } from "react";
import type { CatalogTierTableRow } from "./CatalogTierTable";
import {
  filterCatalogTierRows,
  taxonomyDisplayLabel,
  type PlaybookFilterValue,
} from "./CatalogPlaybookBrowser";
import { compareTierPhaseLabels } from "../lib/tierTaxonomy";
import { compareTierCategoryLabels } from "../lib/tierCategories";
import {
  buildGuidedBrowseOptions,
  filterPackageTypesByGuidedPath,
  filterPresetPackagesByGuidedPath,
  guidedOptionMeta,
  guidedOptionStatSlots,
  type GuidedBrowseOption,
} from "../lib/packageBuilderTypeTaxonomy";
import { slotsForPackageType } from "../lib/packageBuilderSlots";
import type { Package, PackageBuilderPackageType, PackageBuilderSlotTemplate } from "../types";

export type GuidedSelection = {
  phase: PlaybookFilterValue | null;
  category: PlaybookFilterValue | null;
  tactic: PlaybookFilterValue | null;
};

type GuidedOption = GuidedBrowseOption;

function compareLabels(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

const STEPS = [
  {
    key: "phase" as const,
    n: 1,
    title: "Phase",
    hint: "Where does this work sit in the client journey?",
    icon: "◈",
    theme: "phase",
  },
  {
    key: "category" as const,
    n: 2,
    title: "Category",
    hint: "What kind of solution is it?",
    icon: "◇",
    theme: "category",
  },
  {
    key: "tactic" as const,
    n: 3,
    title: "Tactic",
    hint: "How do we deliver it?",
    icon: "◎",
    theme: "tactic",
  },
  {
    key: "tiers" as const,
    n: 4,
    title: "Tiers",
    hint: "Vault tiers, preset packages, and configurable packages on this path",
    icon: "★",
    theme: "tiers",
  },
] as const;

type StepTheme = (typeof STEPS)[number]["theme"];

type Props = {
  allRows: CatalogTierTableRow[];
  packageTypes: PackageBuilderPackageType[];
  presetPackages: Package[];
  packageBuilderSlots: PackageBuilderSlotTemplate[];
  selection: GuidedSelection;
  onSelectionChange: (next: GuidedSelection) => void;
  onOpenTier: (solutionId: string, tierId: string) => void;
  onOpenPackageType: (packageTypeId: string) => void;
  onOpenPresetPackage: (packageId: string) => void;
};

function OptionGrid({
  options,
  stepLabel,
  stepHint,
  stepTheme,
  stepIcon,
  onSelect,
}: {
  options: GuidedOption[];
  stepLabel: string;
  stepHint: string;
  stepTheme: StepTheme;
  stepIcon: string;
  onSelect: (value: PlaybookFilterValue) => void;
}) {
  if (options.length === 0) {
    return (
      <div className="agency-home-guide__empty" role="status">
        <p className="agency-home-guide__empty-title">No options at this step</p>
        <p className="agency-home-guide__empty-text">
          Nothing in the vault matches your earlier choices. Go back and try a different path.
        </p>
      </div>
    );
  }

  return (
    <div className={`agency-home-guide__picker agency-home-guide__picker--${stepTheme}`}>
      <div className="agency-home-guide__picker-head">
        <span className="agency-home-guide__picker-badge" aria-hidden>
          {stepIcon}
        </span>
        <div>
          <h3 className="agency-home-guide__picker-title">{stepLabel}</h3>
          <p className="agency-home-guide__picker-hint">{stepHint}</p>
        </div>
      </div>
      <div className="agency-home-guide__options" role="listbox" aria-label={stepLabel}>
        {options.map((opt, i) => {
          const statSlots = guidedOptionStatSlots(opt);
          return (
          <button
            key={String(opt.value)}
            type="button"
            role="option"
            className={`agency-home-guide__option agency-home-guide__option--${stepTheme}`}
            style={{ "--guide-stagger": i } as CSSProperties}
            aria-label={`${opt.label}. ${guidedOptionMeta(opt)}`}
            onClick={() => onSelect(opt.value)}
          >
            <span className="agency-home-guide__option-glow" aria-hidden />
            <span className="agency-home-guide__option-accent" aria-hidden />
            <span className="agency-home-guide__option-top">
              <span className="agency-home-guide__option-icon" aria-hidden>
                {stepIcon}
              </span>
              <span className="agency-home-guide__option-label">{opt.label}</span>
              <span className="agency-home-guide__option-arrow" aria-hidden>
                →
              </span>
            </span>
            <span className="agency-home-guide__option-stats" aria-hidden>
              {statSlots.map((slot) => (
                <span
                  key={slot.key}
                  className={`agency-home-guide__option-stat agency-home-guide__option-stat--${slot.tone}${
                    slot.visible ? "" : " agency-home-guide__option-stat--placeholder"
                  }`}
                >
                  {slot.label}
                </span>
              ))}
            </span>
          </button>
          );
        })}
      </div>
    </div>
  );
}

export function GuidedTierBrowser({
  allRows,
  packageTypes,
  presetPackages,
  packageBuilderSlots,
  selection,
  onSelectionChange,
  onOpenTier,
  onOpenPackageType,
  onOpenPresetPackage,
}: Props) {
  const { phase, category, tactic } = selection;

  const rowsAfterPhase = useMemo(() => {
    if (phase === null) return allRows;
    return filterCatalogTierRows(allRows, phase, null, null, "");
  }, [allRows, phase]);

  const rowsAfterCategory = useMemo(() => {
    if (phase === null || category === null) return rowsAfterPhase;
    return filterCatalogTierRows(allRows, phase, category, null, "");
  }, [allRows, phase, category, rowsAfterPhase]);

  const phaseOptions = useMemo(
    () =>
      buildGuidedBrowseOptions(
        allRows,
        packageTypes,
        presetPackages,
        (r) => r.phaseRaw,
        true,
        compareTierPhaseLabels,
        null,
        null,
        "phase"
      ),
    [allRows, packageTypes, presetPackages]
  );
  const categoryOptions = useMemo(
    () =>
      buildGuidedBrowseOptions(
        rowsAfterPhase,
        packageTypes,
        presetPackages,
        (r) => r.categoryRaw,
        true,
        compareTierCategoryLabels,
        phase,
        null,
        "category"
      ),
    [rowsAfterPhase, packageTypes, presetPackages, phase]
  );
  const tacticOptions = useMemo(
    () =>
      buildGuidedBrowseOptions(
        rowsAfterCategory,
        packageTypes,
        presetPackages,
        (r) => r.tacticRaw,
        true,
        compareLabels,
        phase,
        category,
        "tactic"
      ),
    [rowsAfterCategory, packageTypes, presetPackages, phase, category]
  );

  const matchedTiers = useMemo(() => {
    if (phase === null || category === null || tactic === null) return [];
    return filterCatalogTierRows(allRows, phase, category, tactic, "").sort((a, b) =>
      a.tierName.localeCompare(b.tierName, undefined, { sensitivity: "base" })
    );
  }, [allRows, phase, category, tactic]);

  const matchedPackageTypes = useMemo(() => {
    if (phase === null || category === null || tactic === null) return [];
    return filterPackageTypesByGuidedPath(packageTypes, phase, category, tactic).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
  }, [packageTypes, phase, category, tactic]);

  const matchedPresetPackages = useMemo(() => {
    if (phase === null || category === null || tactic === null) return [];
    return filterPresetPackagesByGuidedPath(presetPackages, phase, category, tactic).sort((a, b) =>
      a.package_name.localeCompare(b.package_name, undefined, { sensitivity: "base" })
    );
  }, [presetPackages, phase, category, tactic]);

  const activeStep =
    phase === null ? 1 : category === null ? 2 : tactic === null ? 3 : 4;

  const resetFrom = (step: 1 | 2 | 3) => {
    if (step === 1) onSelectionChange({ phase: null, category: null, tactic: null });
    if (step === 2) onSelectionChange({ phase, category: null, tactic: null });
    if (step === 3) onSelectionChange({ phase, category, tactic: null });
  };

  const pathSegments =
    phase !== null
      ? [
          { label: taxonomyDisplayLabel(phase), step: 1 as const },
          ...(category !== null
            ? [{ label: taxonomyDisplayLabel(category), step: 2 as const }]
            : []),
          ...(tactic !== null
            ? [{ label: taxonomyDisplayLabel(tactic), step: 3 as const }]
            : []),
        ]
      : [];

  return (
    <div className="agency-home-guide__browser">
      <div className="agency-home-guide__rail" aria-label="Guided steps">
        <div className="agency-home-guide__rail-track" aria-hidden>
          {STEPS.map((step, i) => {
            const done = step.n < activeStep;
            const active = step.n === activeStep;
            return (
              <div
                key={`track-${step.key}`}
                className={`agency-home-guide__rail-track-step agency-home-guide__rail-track-step--${step.theme}`}
              >
                <span
                  className={
                    `agency-home-guide__rail-num` +
                    (done ? " agency-home-guide__rail-num--done" : "") +
                    (active ? " agency-home-guide__rail-num--active" : "")
                  }
                >
                  {done ? "✓" : step.icon}
                </span>
                {i < STEPS.length - 1 ? (
                  <span
                    className={
                      "agency-home-guide__rail-line" +
                      (done ? " agency-home-guide__rail-line--done" : "")
                    }
                  />
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="agency-home-guide__rail-steps">
          {STEPS.map((step) => {
            const done = step.n < activeStep;
            const active = step.n === activeStep;
            return (
              <div
                key={step.key}
                className={
                  `agency-home-guide__rail-step agency-home-guide__rail-step--${step.theme}` +
                  (done ? " agency-home-guide__rail-step--done" : "") +
                  (active ? " agency-home-guide__rail-step--active" : "")
                }
              >
                <span className="agency-home-guide__rail-text">
                  <span className="agency-home-guide__rail-title">{step.title}</span>
                  <span className="agency-home-guide__rail-hint">{step.hint}</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {pathSegments.length > 0 ? (
        <nav className="agency-home-guide__path" aria-label="Your selections">
          <span className="agency-home-guide__path-label">Your path</span>
          {pathSegments.map((seg, i) => (
            <span key={`${seg.step}-${seg.label}`} className="agency-home-guide__path-seg">
              {i > 0 ? (
                <span className="agency-home-guide__path-chev" aria-hidden>
                  ›
                </span>
              ) : null}
              <button
                type="button"
                className="agency-home-guide__path-chip"
                onClick={() => resetFrom(seg.step)}
              >
                {seg.label}
              </button>
            </span>
          ))}
          {tactic === null ? (
            <span className="agency-home-guide__path-next">
              <span className="agency-home-guide__path-pulse" aria-hidden />
              Pick next
            </span>
          ) : (
            <span className="agency-home-guide__path-done">Path complete</span>
          )}
          <button
            type="button"
            className="agency-home-guide__path-reset"
            onClick={() => onSelectionChange({ phase: null, category: null, tactic: null })}
          >
            Start over
          </button>
        </nav>
      ) : null}

      {phase === null ? (
        <OptionGrid
          options={phaseOptions}
          stepLabel="Choose a phase"
          stepHint={STEPS[0].hint}
          stepTheme={STEPS[0].theme}
          stepIcon={STEPS[0].icon}
          onSelect={(value) => onSelectionChange({ phase: value, category: null, tactic: null })}
        />
      ) : null}

      {phase !== null && category === null ? (
        <OptionGrid
          options={categoryOptions}
          stepLabel="Choose a category"
          stepHint={STEPS[1].hint}
          stepTheme={STEPS[1].theme}
          stepIcon={STEPS[1].icon}
          onSelect={(value) => onSelectionChange({ phase, category: value, tactic: null })}
        />
      ) : null}

      {phase !== null && category !== null && tactic === null ? (
        <OptionGrid
          options={tacticOptions}
          stepLabel="Choose a tactic"
          stepHint={STEPS[2].hint}
          stepTheme={STEPS[2].theme}
          stepIcon={STEPS[2].icon}
          onSelect={(value) => onSelectionChange({ phase, category, tactic: value })}
        />
      ) : null}

      {phase !== null && category !== null && tactic !== null ? (
        <section
          className="agency-home-guide__results agency-home-guide__results--tiers"
          aria-label="Matching solution tiers and packages"
        >
          <div className="agency-home-guide__results-head">
            <span className="agency-home-guide__results-badge" aria-hidden>
              {STEPS[3].icon}
            </span>
            <div>
              <h3 className="agency-home-guide__results-title">
                {matchedTiers.length} Solution Tier{matchedTiers.length === 1 ? "" : "s"}
                {matchedPresetPackages.length > 0
                  ? ` · ${matchedPresetPackages.length} Preset Package${
                      matchedPresetPackages.length === 1 ? "" : "s"
                    }`
                  : ""}
                {matchedPackageTypes.length > 0
                  ? ` · ${matchedPackageTypes.length} Configurable Package${
                      matchedPackageTypes.length === 1 ? "" : "s"
                    }`
                  : ""}{" "}
                on this path
              </h3>
              <p className="agency-home-guide__results-hint">
                Open a vault tier for scope and pricing, open a preset package workspace, or start
                building from a configurable package family.
              </p>
            </div>
          </div>

          {matchedPresetPackages.length > 0 ? (
            <div className="agency-home-guide__package-block agency-home-guide__package-block--preset">
              <h4 className="agency-home-guide__package-block-title">Preset packages</h4>
              <ul className="agency-home-guide__package-list">
                {matchedPresetPackages.map((pkg, i) => (
                  <li key={pkg.package_id} style={{ "--guide-stagger": i } as CSSProperties}>
                    <button
                      type="button"
                      className="agency-home-guide__package-card agency-home-guide__package-card--preset"
                      onClick={() => onOpenPresetPackage(pkg.package_id)}
                    >
                      <span className="agency-home-guide__package-accent" aria-hidden />
                      <span className="agency-home-guide__package-body">
                        <span className="agency-home-guide__package-name">{pkg.package_name}</span>
                        <span className="agency-home-guide__package-meta">
                          Open package workspace
                        </span>
                      </span>
                      <span className="agency-home-guide__package-chevron" aria-hidden>
                        →
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {matchedPackageTypes.length > 0 ? (
            <div className="agency-home-guide__package-block">
              <h4 className="agency-home-guide__package-block-title">Configurable packages</h4>
              <ul className="agency-home-guide__package-list">
                {matchedPackageTypes.map((pt, i) => {
                  const tierSlotCount = slotsForPackageType(packageBuilderSlots, pt.id).length;
                  return (
                    <li
                      key={pt.id}
                      style={{ "--guide-stagger": i } as CSSProperties}
                    >
                      <button
                        type="button"
                        className="agency-home-guide__package-card"
                        onClick={() => onOpenPackageType(pt.id)}
                      >
                        <span className="agency-home-guide__package-accent" aria-hidden />
                        <span className="agency-home-guide__package-body">
                          <span className="agency-home-guide__package-name">{pt.name}</span>
                          <span className="agency-home-guide__package-meta">
                            {tierSlotCount} package tier{tierSlotCount === 1 ? "" : "s"} · Build in
                            Package Builder
                          </span>
                        </span>
                        <span className="agency-home-guide__package-chevron" aria-hidden>
                          →
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {matchedTiers.length > 0 ? (
            <div className="agency-home-guide__tier-block">
              {matchedPackageTypes.length > 0 || matchedPresetPackages.length > 0 ? (
                <h4 className="agency-home-guide__tier-block-title">Vault tiers</h4>
              ) : null}
              <ul className="agency-home-guide__tier-list">
                {matchedTiers.map((row, i) => (
                  <li
                    key={row.tierId}
                    style={{ "--guide-stagger": i } as CSSProperties}
                  >
                    <button
                      type="button"
                      className="agency-home-guide__tier-card"
                      onClick={() => onOpenTier(row.solutionId, row.tierId)}
                    >
                      <span className="agency-home-guide__tier-accent" aria-hidden />
                      <span className="agency-home-guide__tier-body">
                        <span className="agency-home-guide__tier-main">
                          <span className="agency-home-guide__tier-name">{row.tierName}</span>
                          <span className="agency-home-guide__tier-solution">{row.solutionName}</span>
                        </span>
                        <span className="agency-home-guide__tier-metrics">
                          <span className="agency-home-guide__tier-metric">
                            <span className="agency-home-guide__tier-metric-label">Hours</span>
                            <span className="agency-home-guide__tier-metric-value">
                              {row.hoursDisplay}
                              {row.hoursDisplay !== "—" ? " h" : ""}
                            </span>
                          </span>
                          <span className="agency-home-guide__tier-metric agency-home-guide__tier-metric--sell">
                            <span className="agency-home-guide__tier-metric-label">Net sell</span>
                            <span className="agency-home-guide__tier-metric-value">{row.priceDisplay}</span>
                          </span>
                        </span>
                      </span>
                      <span className="agency-home-guide__tier-chevron" aria-hidden>
                        →
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {matchedTiers.length === 0 &&
          matchedPackageTypes.length === 0 &&
          matchedPresetPackages.length === 0 ? (
            <div className="agency-home-guide__empty" role="status">
              <p className="agency-home-guide__empty-title">Nothing on this path</p>
              <p className="agency-home-guide__empty-text">
                Try a different tactic or adjust your earlier selections.
              </p>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
