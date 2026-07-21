import { proposalStepDef } from "./ProposalBuilderSteps";

export type PackageAddPath = "build" | "prebuilt";

type Props = {
  onChoose: (path: PackageAddPath) => void;
};

export function ProposalPackagesChoice({ onChoose }: Props) {
  const stepMeta = proposalStepDef("packages");

  return (
    <div className="proposal-step-panel proposal-packages-choice">
      <header className="proposal-step-panel__head proposal-packages-choice__head">
        <p className="proposal-step-panel__eyebrow">Step {stepMeta.number}</p>
        <h2 className="proposal-step-panel__title">{stepMeta.label}</h2>
        <p className="proposal-step-panel__lead">
          Packages are optional. Choose how you want to add one—or skip ahead and come back anytime.
        </p>
      </header>

      <div className="proposal-packages-choice__grid" role="group" aria-label="How to add a package">
        <button
          type="button"
          className="proposal-packages-choice__card"
          onClick={() => onChoose("build")}
        >
          <span className="proposal-packages-choice__icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span className="proposal-packages-choice__card-text">
            <span className="proposal-packages-choice__card-title">Build a new package</span>
            <span className="proposal-packages-choice__card-desc">
              Pick a configurable template, customize it in the wizard, then add it to your proposal.
            </span>
          </span>
          <span className="proposal-packages-choice__card-cta" aria-hidden>
            Continue →
          </span>
        </button>

        <button
          type="button"
          className="proposal-packages-choice__card"
          onClick={() => onChoose("prebuilt")}
        >
          <span className="proposal-packages-choice__icon proposal-packages-choice__icon--library" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
              <path
                d="M4 6.5A2.5 2.5 0 0 1 6.5 4H18a2 2 0 0 1 2 2v12.5a1.5 1.5 0 0 1-1.5 1.5H6.5A2.5 2.5 0 0 1 4 17.5v-11Z"
                stroke="currentColor"
                strokeWidth="1.75"
              />
              <path d="M8 8h8M8 12h6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          </span>
          <span className="proposal-packages-choice__card-text">
            <span className="proposal-packages-choice__card-title">Use a pre-built package</span>
            <span className="proposal-packages-choice__card-desc">
              Browse packages you already built and add one ready-made to the active scenario and phase.
            </span>
          </span>
          <span className="proposal-packages-choice__card-cta" aria-hidden>
            Continue →
          </span>
        </button>
      </div>
    </div>
  );
}

type PathBarProps = {
  path: PackageAddPath;
  onSelectPath: (path: PackageAddPath) => void;
  onBackToOptions: () => void;
};

export function ProposalPackagesPathBar({ path, onSelectPath, onBackToOptions }: PathBarProps) {
  return (
    <div className="proposal-packages-path">
      <button type="button" className="proposal-packages-path__back" onClick={onBackToOptions}>
        ← All options
      </button>
      <div className="proposal-packages-path__tabs" role="tablist" aria-label="Package add method">
        <button
          type="button"
          role="tab"
          aria-selected={path === "build"}
          className={`proposal-packages-path__tab${path === "build" ? " is-active" : ""}`}
          onClick={() => onSelectPath("build")}
        >
          Build new
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={path === "prebuilt"}
          className={`proposal-packages-path__tab${path === "prebuilt" ? " is-active" : ""}`}
          onClick={() => onSelectPath("prebuilt")}
        >
          Pre-built
        </button>
      </div>
    </div>
  );
}

type SwitchPromptProps = {
  fromPath: PackageAddPath;
  onSwitch: () => void;
  onDismiss: () => void;
};

export function ProposalPackagesSwitchPrompt({ fromPath, onSwitch, onDismiss }: SwitchPromptProps) {
  const goingToPrebuilt = fromPath === "build";

  return (
    <aside className="proposal-packages-switch" aria-live="polite">
      <div className="proposal-packages-switch__copy">
        <p className="proposal-packages-switch__eyebrow">Package added</p>
        <p className="proposal-packages-switch__title">
          {goingToPrebuilt
            ? "Want to add a pre-built package too?"
            : "Want to build a new package too?"}
        </p>
        <p className="proposal-packages-switch__desc">
          {goingToPrebuilt
            ? "Browse packages you’ve already built and drop one into this proposal."
            : "Pick a template, customize it, and add another package to this proposal."}
        </p>
      </div>
      <div className="proposal-packages-switch__actions">
        <button type="button" className="roadmap-btn roadmap-btn--primary" onClick={onSwitch}>
          {goingToPrebuilt ? "Add pre-built package" : "Build a new package"}
        </button>
        <button type="button" className="roadmap-btn roadmap-btn--ghost" onClick={onDismiss}>
          Stay here
        </button>
      </div>
    </aside>
  );
}
