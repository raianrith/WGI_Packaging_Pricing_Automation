export type ProposalBuilderStep =
  | "setup"
  | "packages"
  | "catalog"
  | "board"
  | "review"
  | "client_service"
  | "client_ready";

export type ProposalStepDef = {
  id: ProposalBuilderStep;
  number: number;
  label: string;
  hint: string;
  examples?: string;
};

const STEPS: ProposalStepDef[] = [
  { id: "setup", number: 1, label: "Setup", hint: "Client, Budget & Scenarios" },
  {
    id: "packages",
    number: 2,
    label: "Add Packages",
    hint: "Optional · Build or Pre-Built",
  },
  { id: "catalog", number: 3, label: "Add Solutions", hint: "Tiers & Extras" },
  { id: "board", number: 4, label: "Organize Proposal", hint: "Scope & Compare" },
  { id: "review", number: 5, label: "Preview Proposal", hint: "Save & Export" },
  {
    id: "client_service",
    number: 6,
    label: "Ops Review",
    hint: "Tasks & Hours",
  },
  {
    id: "client_ready",
    number: 7,
    label: "Client Ready Proposal",
    hint: "Final View & PDF",
  },
];

const EARLY_STEP_IDS = new Set<ProposalBuilderStep>([
  "setup",
  "packages",
  "catalog",
  "board",
  "review",
]);

type Props = {
  active: ProposalBuilderStep;
  onChange: (step: ProposalBuilderStep) => void;
  setupComplete: boolean;
  lineItemCount: number;
  /** When false, Ops Review + Client Ready are hidden (Saved / Create flows). */
  includeOpsPath?: boolean;
};

export function proposalStepDef(id: ProposalBuilderStep): ProposalStepDef {
  return STEPS.find((s) => s.id === id) ?? STEPS[0]!;
}

export function visibleProposalSteps(includeOpsPath: boolean): ProposalStepDef[] {
  if (includeOpsPath) return STEPS;
  return STEPS.filter((s) => EARLY_STEP_IDS.has(s.id));
}

export function ProposalBuilderSteps({
  active,
  onChange,
  setupComplete,
  lineItemCount,
  includeOpsPath = true,
}: Props) {
  const steps = visibleProposalSteps(includeOpsPath);

  function stepStatus(id: ProposalBuilderStep): "done" | "active" | "pending" {
    if (id === active) return "active";
    const order = proposalStepOrder(includeOpsPath);
    const ai = order.indexOf(active);
    const si = order.indexOf(id);
    if (si < ai) return "done";
    if (id === "setup" && setupComplete && active !== "setup") return "done";
    if (id === "catalog" && lineItemCount > 0 && si < ai) return "done";
    return "pending";
  }

  return (
    <nav className="proposal-builder-rail" aria-label="Proposal builder steps">
      <p className="proposal-builder-rail__eyebrow">Your Path</p>
      <ol className="proposal-builder-rail__list">
        {steps.map((step) => {
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

export function proposalStepOrder(includeOpsPath = true): ProposalBuilderStep[] {
  return visibleProposalSteps(includeOpsPath).map((s) => s.id);
}

export function adjacentStep(
  current: ProposalBuilderStep,
  dir: "prev" | "next",
  includeOpsPath = true
): ProposalBuilderStep | null {
  const order = proposalStepOrder(includeOpsPath);
  const i = order.indexOf(current);
  if (i < 0) return null;
  const next = dir === "next" ? i + 1 : i - 1;
  return order[next] ?? null;
}
