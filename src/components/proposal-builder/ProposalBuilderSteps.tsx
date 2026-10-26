export type ProposalBuilderStep =
  | "setup"
  | "add_scope"
  | "board"
  | "review"
  | "ops_scoping"
  | "client_service"
  | "client_ready";

export type AddScopeTab = "solutions" | "packages" | "past" | "custom";

export type ProposalStepDef = {
  id: ProposalBuilderStep;
  number: number;
  label: string;
  hint: string;
  examples?: string;
};

const STEPS: ProposalStepDef[] = [
  { id: "setup", number: 1, label: "Setup", hint: "Client, dates, structure" },
  { id: "add_scope", number: 2, label: "Add scope", hint: "Solutions, packages, custom" },
  { id: "board", number: 3, label: "Organize", hint: "Scope & compare" },
  { id: "review", number: 4, label: "Review & submit", hint: "Client preview" },
  { id: "ops_scoping", number: 5, label: "Custom Scoping", hint: "Fulfill requests" },
  { id: "client_service", number: 6, label: "Ops Review", hint: "Tasks & hours" },
  { id: "client_ready", number: 7, label: "Client Ready", hint: "Final view & PDF" },
];

const EARLY_STEP_IDS = new Set<ProposalBuilderStep>(["setup", "add_scope", "board", "review"]);

type Props = {
  active: ProposalBuilderStep;
  onChange: (step: ProposalBuilderStep) => void;
  setupComplete: boolean;
  lineItemCount: number;
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
    if (id === "add_scope" && lineItemCount > 0 && si < ai) return "done";
    return "pending";
  }

  const activeDef = steps.find((s) => s.id === active) ?? steps[0]!;

  return (
    <nav className="proposal-builder-rail" aria-label="Proposal builder steps">
      <p className="proposal-builder-rail__progress">
        Step {activeDef.number} of {steps.length}
      </p>
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

const ADD_SCOPE_TABS: { id: AddScopeTab; label: string }[] = [
  { id: "solutions", label: "Solutions" },
  { id: "packages", label: "Packages" },
  { id: "past", label: "Past" },
  { id: "custom", label: "Custom" },
];

type AddScopeTabsProps = {
  active: AddScopeTab;
  onChange: (tab: AddScopeTab) => void;
};

export function ProposalAddScopeTabs({ active, onChange }: AddScopeTabsProps) {
  return (
    <div className="proposal-add-scope-tabs" role="tablist" aria-label="Add scope">
      {ADD_SCOPE_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          className={`proposal-add-scope-tabs__tab${active === tab.id ? " is-active" : ""}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
