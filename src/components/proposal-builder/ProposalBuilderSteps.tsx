export type ProposalBuilderStep =
  | "setup"
  | "scenarios"
  | "preset_packages"
  | "configurable_packages"
  | "catalog"
  | "variable_tiers"
  | "board"
  | "review";

export type ProposalStepDef = {
  id: ProposalBuilderStep;
  number: number;
  label: string;
  hint: string;
  examples?: string;
};

const STEPS: ProposalStepDef[] = [
  { id: "setup", number: 1, label: "Setup", hint: "Client & Budget" },
  { id: "scenarios", number: 2, label: "Scenarios & Phases", hint: "Names & Structure" },
  {
    id: "configurable_packages",
    number: 3,
    label: "Add Configurable Packages",
    hint: "Optional · Skip Anytime",
  },
  { id: "catalog", number: 4, label: "Add Solutions", hint: "Solution Tiers" },
  {
    id: "variable_tiers",
    number: 5,
    label: "Add Variable Solutions",
    examples: "Paid Campaign Management, Rush Charge, Travel Time",
    hint: "Dynamic pricing",
  },
  { id: "board", number: 6, label: "Organize & Reorder Proposal", hint: "Scope & Compare" },
  { id: "review", number: 7, label: "Review", hint: "Save & Export" },
];

type Props = {
  active: ProposalBuilderStep;
  onChange: (step: ProposalBuilderStep) => void;
  setupComplete: boolean;
  scenarioCount: number;
  lineItemCount: number;
};

export function proposalStepDef(id: ProposalBuilderStep): ProposalStepDef {
  return STEPS.find((s) => s.id === id) ?? STEPS[0]!;
}

export function ProposalBuilderSteps({
  active,
  onChange,
  setupComplete,
  scenarioCount,
  lineItemCount,
}: Props) {
  function stepStatus(id: ProposalBuilderStep): "done" | "active" | "pending" {
    if (id === active) return "active";
    const order = proposalStepOrder();
    const ai = order.indexOf(active);
    const si = order.indexOf(id);
    if (si < ai) return "done";
    if (id === "setup" && setupComplete && active !== "setup") return "done";
    if (id === "scenarios" && scenarioCount > 0 && si < ai) return "done";
    if (id === "catalog" && lineItemCount > 0 && si < ai) return "done";
    return "pending";
  }

  return (
    <nav className="proposal-builder-rail" aria-label="Proposal builder steps">
      <p className="proposal-builder-rail__eyebrow">Your Path</p>
      <ol className="proposal-builder-rail__list">
        {STEPS.map((step) => {
          const status = stepStatus(step.id);
          return (
            <li key={step.id}>
              <button
                type="button"
                className={`proposal-builder-rail__step proposal-builder-rail__step--${status}`}
                aria-current={status === "active" ? "step" : undefined}
                onClick={() => onChange(step.id)}
              >
                <span className="proposal-builder-rail__num" aria-hidden>
                  {status === "done" ? "✓" : step.number}
                </span>
                <span className="proposal-builder-rail__text">
                  <span className="proposal-builder-rail__label">{step.label}</span>
                  {step.examples ? (
                    <span className="proposal-builder-rail__examples">{step.examples}</span>
                  ) : null}
                  <span className="proposal-builder-rail__hint">{step.hint}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function proposalStepOrder(): ProposalBuilderStep[] {
  return STEPS.map((s) => s.id);
}

export function adjacentStep(
  current: ProposalBuilderStep,
  dir: "prev" | "next"
): ProposalBuilderStep | null {
  const order = proposalStepOrder();
  const i = order.indexOf(current);
  if (i < 0) return null;
  const next = dir === "next" ? i + 1 : i - 1;
  return order[next] ?? null;
}
