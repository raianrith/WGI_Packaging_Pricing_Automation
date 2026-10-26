export type ProposalBuilderMode = "create" | "saved" | "awaiting_ops" | "client_ready";

type Props = {
  active: ProposalBuilderMode;
  onChange: (mode: ProposalBuilderMode) => void;
  onNewProposal: () => void;
  savedCount: number;
  awaitingOpsCount: number;
  clientReadyCount: number;
};

export function ProposalBuilderModeTabs({
  active,
  onChange,
  onNewProposal,
  savedCount,
  awaitingOpsCount,
  clientReadyCount,
}: Props) {
  const libraryActive = active === "create" ? null : active;

  return (
    <div className="proposal-builder-mode-tabs">
      <nav aria-label="Proposal libraries">
        <div className="proposal-builder-mode-tabs__track" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={libraryActive === "saved"}
            aria-label="Saved Proposals"
            className={`proposal-builder-mode-tabs__tab${libraryActive === "saved" ? " is-active" : ""}`}
            onClick={() => onChange("saved")}
          >
            <span className="proposal-builder-mode-tabs__label">Saved</span>
            <span className="proposal-builder-mode-tabs__count">{savedCount}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={libraryActive === "awaiting_ops"}
            aria-label="Proposals Awaiting Ops Review"
            className={`proposal-builder-mode-tabs__tab${libraryActive === "awaiting_ops" ? " is-active" : ""}`}
            onClick={() => onChange("awaiting_ops")}
          >
            <span className="proposal-builder-mode-tabs__label">Ops Review</span>
            <span className="proposal-builder-mode-tabs__count">{awaitingOpsCount}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={libraryActive === "client_ready"}
            aria-label="Client Ready Proposals"
            className={`proposal-builder-mode-tabs__tab${libraryActive === "client_ready" ? " is-active" : ""}`}
            onClick={() => onChange("client_ready")}
          >
            <span className="proposal-builder-mode-tabs__label">Client Ready</span>
            <span className="proposal-builder-mode-tabs__count">{clientReadyCount}</span>
          </button>
        </div>
      </nav>
      <button
        type="button"
        className={`proposal-builder-new-btn${active === "create" ? " is-active" : ""}`}
        aria-pressed={active === "create"}
        onClick={onNewProposal}
      >
        New proposal
      </button>
    </div>
  );
}
