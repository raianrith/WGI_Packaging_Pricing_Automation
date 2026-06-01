export type ProposalBuilderMode = "create" | "saved";

type Props = {
  active: ProposalBuilderMode;
  onChange: (mode: ProposalBuilderMode) => void;
  savedCount: number;
};

function IconCreate() {
  return (
    <svg className="proposal-builder-mode-tabs__svg" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M10 4v12M4 10h12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconLibrary() {
  return (
    <svg className="proposal-builder-mode-tabs__svg" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M4 6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path d="M7 4V3.5A1.5 1.5 0 0 1 8.5 2h3A1.5 1.5 0 0 1 13 3.5V4" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

export function ProposalBuilderModeTabs({ active, onChange, savedCount }: Props) {
  return (
    <nav className="proposal-builder-mode-tabs" aria-label="Proposal builder sections">
      <div className="proposal-builder-mode-tabs__track" role="tablist">
        <div
          className={`proposal-builder-mode-tabs__slider${active === "create" ? " proposal-builder-mode-tabs__slider--right" : ""}`}
          aria-hidden
        />
        <button
          type="button"
          role="tab"
          aria-selected={active === "saved"}
          className={`proposal-builder-mode-tabs__tab${active === "saved" ? " is-active" : ""}`}
          onClick={() => onChange("saved")}
        >
          <span className="proposal-builder-mode-tabs__icon">
            <IconLibrary />
          </span>
          <span className="proposal-builder-mode-tabs__label">Saved Proposals</span>
          {savedCount > 0 ? (
            <span className="proposal-builder-mode-tabs__count">{savedCount}</span>
          ) : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={active === "create"}
          className={`proposal-builder-mode-tabs__tab${active === "create" ? " is-active" : ""}`}
          onClick={() => onChange("create")}
        >
          <span className="proposal-builder-mode-tabs__icon">
            <IconCreate />
          </span>
          <span className="proposal-builder-mode-tabs__label">Create New Proposal</span>
        </button>
      </div>
    </nav>
  );
}
