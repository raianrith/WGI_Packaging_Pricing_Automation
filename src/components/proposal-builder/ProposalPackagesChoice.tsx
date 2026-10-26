import { proposalStepDef } from "./ProposalBuilderSteps";

export type PackageAddPath = "build" | "prebuilt" | "playbook";

type Props = {
  onChoose: (path: PackageAddPath) => void;
};

export function ProposalPackagesChoice({ onChoose }: Props) {
  const stepMeta = proposalStepDef("add_scope");

  return (
    <div className="proposal-step-panel proposal-packages-choice">
      <header className="proposal-step-panel__head proposal-packages-choice__head">
        <p className="proposal-step-panel__eyebrow">Step {stepMeta.number}</p>
        <h2 className="proposal-step-panel__title">{stepMeta.label}</h2>
        <p className="proposal-step-panel__lead">
          Packages are optional. Pick a path below, or use <strong>Next: Solutions</strong> at the
          bottom to skip and come back later.
        </p>
      </header>

      <div className="proposal-packages-choice__grid" role="group" aria-label="How to add a package">
        <button
          type="button"
          className="proposal-packages-choice__card"
          onClick={() => onChoose("build")}
        >
          <span className="proposal-packages-choice__kicker">01</span>
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
          <span className="proposal-packages-choice__kicker">02</span>
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
            <span className="proposal-packages-choice__card-title">Copy a Previously Created Package</span>
            <span className="proposal-packages-choice__card-desc">
              Browse packages you already built and add one ready-made to the active scenario and phase.
            </span>
          </span>
          <span className="proposal-packages-choice__card-cta" aria-hidden>
            Continue →
          </span>
        </button>

        <button
          type="button"
          className="proposal-packages-choice__card"
          onClick={() => onChoose("playbook")}
        >
          <span className="proposal-packages-choice__kicker">03</span>
          <span className="proposal-packages-choice__icon proposal-packages-choice__icon--playbook" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
              <rect x="3.5" y="3.5" width="7" height="7" rx="1.75" stroke="currentColor" strokeWidth="1.75" />
              <rect x="13.5" y="3.5" width="7" height="7" rx="1.75" stroke="currentColor" strokeWidth="1.75" />
              <rect x="3.5" y="13.5" width="7" height="7" rx="1.75" stroke="currentColor" strokeWidth="1.75" />
              <path d="M17 14v6M14 17h6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          </span>
          <span className="proposal-packages-choice__card-text">
            <span className="proposal-packages-choice__card-title">Build New Playbook Package</span>
            <span className="proposal-packages-choice__card-desc">
              Bundle several built packages and solutions into one playbook with combined hours and pricing.
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
  onBackToOptions?: () => void;
  includePlaybook?: boolean;
};

const PATH_TABS: Array<{ id: PackageAddPath; label: string }> = [
  { id: "build", label: "Build" },
  { id: "prebuilt", label: "Re-use" },
  { id: "playbook", label: "Playbook" },
];

export function ProposalPackagesPathBar({
  path,
  onSelectPath,
  onBackToOptions,
  includePlaybook = true,
}: PathBarProps) {
  const tabs = includePlaybook ? PATH_TABS : PATH_TABS.filter((tab) => tab.id !== "playbook");
  return (
    <div className="proposal-packages-path">
      {onBackToOptions ? (
      <button type="button" className="proposal-packages-path__back" onClick={onBackToOptions}>
        ← All options
      </button>
      ) : null}
      <div className="proposal-packages-path__tabs" role="tablist" aria-label="Package add method">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={path === tab.id}
            className={`proposal-packages-path__tab${path === tab.id ? " is-active" : ""}`}
            onClick={() => onSelectPath(tab.id)}
          >
            {tab.label}
          </button>
        ))}
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
        <p className="proposal-packages-switch__eyebrow">
          {fromPath === "playbook" ? "Playbook package added" : "Package added"}
        </p>
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
