export type ProposalBuilderMode = "create" | "saved" | "awaiting_ops" | "client_ready";

type Props = {
  active: ProposalBuilderMode;
  onChange: (mode: ProposalBuilderMode) => void;
  savedCount: number;
  awaitingOpsCount: number;
  clientReadyCount: number;
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

function IconOpsQueue() {
  return (
    <svg className="proposal-builder-mode-tabs__svg" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M4 5.5h12M4 10h12M4 14.5h8"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <circle cx="15.5" cy="14.5" r="2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function IconClientReady() {
  return (
    <svg className="proposal-builder-mode-tabs__svg" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M4 10.5 8 14.5 16 5.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function sliderClass(active: ProposalBuilderMode): string {
  if (active === "awaiting_ops") return " proposal-builder-mode-tabs__slider--pos-1";
  if (active === "client_ready") return " proposal-builder-mode-tabs__slider--pos-2";
  if (active === "create") return " proposal-builder-mode-tabs__slider--pos-3";
  return " proposal-builder-mode-tabs__slider--pos-0";
}

export function ProposalBuilderModeTabs({
  active,
  onChange,
  savedCount,
  awaitingOpsCount,
  clientReadyCount,
}: Props) {
  return (
    <nav className="proposal-builder-mode-tabs" aria-label="Proposal builder sections">
      <div className="proposal-builder-mode-tabs__track proposal-builder-mode-tabs__track--four" role="tablist">
        <div className={`proposal-builder-mode-tabs__slider${sliderClass(active)}`} aria-hidden />
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
          <span className="proposal-builder-mode-tabs__count">{savedCount}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={active === "awaiting_ops"}
          className={`proposal-builder-mode-tabs__tab${active === "awaiting_ops" ? " is-active" : ""}`}
          onClick={() => onChange("awaiting_ops")}
        >
          <span className="proposal-builder-mode-tabs__icon">
            <IconOpsQueue />
          </span>
          <span className="proposal-builder-mode-tabs__label">Proposals Awaiting Ops Review</span>
          <span className="proposal-builder-mode-tabs__count">{awaitingOpsCount}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={active === "client_ready"}
          className={`proposal-builder-mode-tabs__tab${active === "client_ready" ? " is-active" : ""}`}
          onClick={() => onChange("client_ready")}
        >
          <span className="proposal-builder-mode-tabs__icon">
            <IconClientReady />
          </span>
          <span className="proposal-builder-mode-tabs__label">Client Ready Proposals</span>
          <span className="proposal-builder-mode-tabs__count">{clientReadyCount}</span>
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
