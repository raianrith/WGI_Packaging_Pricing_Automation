import { adjacentStep, type ProposalBuilderStep } from "./ProposalBuilderSteps";

type Props = {
  step: ProposalBuilderStep;
  onStepChange: (step: ProposalBuilderStep) => void;
  nextDisabled?: boolean;
  nextLabel?: string;
  onSave?: () => void;
  saving?: boolean;
  saveLabel?: string;
};

export function ProposalStepNav({
  step,
  onStepChange,
  nextDisabled,
  nextLabel,
  onSave,
  saving = false,
  saveLabel = "Save proposal",
}: Props) {
  const prev = adjacentStep(step, "prev");
  const next = adjacentStep(step, "next");

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
        {next ? (
          <button
            type="button"
            className="roadmap-btn roadmap-btn--primary"
            disabled={nextDisabled}
            onClick={() => onStepChange(next)}
          >
            {nextLabel ?? "Continue"} →
          </button>
        ) : null}
      </div>
    </footer>
  );
}
