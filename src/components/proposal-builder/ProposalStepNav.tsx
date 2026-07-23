import { adjacentStep, type ProposalBuilderStep } from "./ProposalBuilderSteps";

type Props = {
  step: ProposalBuilderStep;
  onStepChange: (step: ProposalBuilderStep) => void;
  nextDisabled?: boolean;
  nextLabel?: string;
  /** When set, replaces the default advance-to-next-step behavior. */
  onNext?: () => void;
  onSave?: () => void;
  saving?: boolean;
  saveLabel?: string;
  /** When false, Back/Next skip Ops Review + Client Ready. */
  includeOpsPath?: boolean;
};

export function ProposalStepNav({
  step,
  onStepChange,
  nextDisabled,
  nextLabel,
  onNext,
  onSave,
  saving = false,
  saveLabel = "Save proposal",
  includeOpsPath = true,
}: Props) {
  const prev = adjacentStep(step, "prev", includeOpsPath);
  const next = adjacentStep(step, "next", includeOpsPath);

  return (
    <footer className="proposal-step-nav">
      <div className="proposal-step-nav__start">
        {prev ? (
          <button type="button" className="roadmap-btn roadmap-btn--ghost" onClick={() => onStepChange(prev)}>
            ← Back
          </button>
        ) : (
          <span aria-hidden />
        )}
      </div>
      <div className="proposal-step-nav__actions">
        {onSave ? (
          <button
            type="button"
            className="roadmap-btn proposal-step-nav__save"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? "Saving…" : saveLabel}
          </button>
        ) : null}
        {next || onNext ? (
          <button
            type="button"
            className="roadmap-btn roadmap-btn--primary"
            disabled={nextDisabled || saving}
            onClick={() => {
              if (onNext) {
                onNext();
                return;
              }
              if (next) onStepChange(next);
            }}
          >
            {nextLabel ?? "Continue"} →
          </button>
        ) : null}
      </div>
    </footer>
  );
}
