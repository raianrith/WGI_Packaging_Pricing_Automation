import { adjacentStep, type ProposalBuilderStep } from "./ProposalBuilderSteps";

type Props = {
  step: ProposalBuilderStep;
  onStepChange: (step: ProposalBuilderStep) => void;
  nextDisabled?: boolean;
  nextLabel?: string;
};

export function ProposalStepNav({ step, onStepChange, nextDisabled, nextLabel }: Props) {
  const prev = adjacentStep(step, "prev");
  const next = adjacentStep(step, "next");

  return (
    <footer className="proposal-step-nav">
      {prev ? (
        <button type="button" className="roadmap-btn roadmap-btn--ghost" onClick={() => onStepChange(prev)}>
          ← Back
        </button>
      ) : (
        <span />
      )}
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
    </footer>
  );
}
