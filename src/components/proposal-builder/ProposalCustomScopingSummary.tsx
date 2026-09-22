import { useState } from "react";
import {
  customScopingDeliverableLabel,
  customScopingSummaryLines,
  type CustomScopingRequest,
  type CustomScopingState,
} from "../../lib/customScopingRequest";

type Props = {
  state: CustomScopingState | null | undefined;
  /** Tighter spacing for Organize / Ops Review embeds. */
  compact?: boolean;
  title?: string;
  className?: string;
};

export function ProposalCustomScopingSummary({
  state,
  compact = false,
  title = "Custom Scoping Requests",
  className = "",
}: Props) {
  const requests = state?.requests ?? [];
  const [expandedId, setExpandedId] = useState<string | null>(null);
  if (!state?.required || requests.length === 0) return null;

  return (
    <section
      className={`proposal-custom-scoping-summary${compact ? " is-compact" : ""}${
        className ? ` ${className}` : ""
      }`}
      aria-label={title}
    >
      <header className="proposal-custom-scoping-summary__head">
        <h3 className="proposal-custom-scoping-summary__title">{title}</h3>
        <span className="proposal-custom-scoping-summary__count">
          {requests.length} request{requests.length === 1 ? "" : "s"}
        </span>
      </header>
      <ul className="proposal-custom-scoping-summary__list">
        {requests.map((request) => {
          const open = expandedId === request.id;
          return (
            <li key={request.id}>
              <article
                className={`proposal-custom-scoping-summary__item${open ? " is-expanded" : ""}`}
              >
                <button
                  type="button"
                  className="proposal-custom-scoping-summary__item-btn"
                  aria-expanded={open}
                  onClick={() => setExpandedId(open ? null : request.id)}
                >
                  <span className="proposal-custom-scoping-summary__mark" aria-hidden>
                    {open ? "▾" : "▸"}
                  </span>
                  <span className="proposal-custom-scoping-summary__main">
                    <span className="proposal-custom-scoping-summary__item-head">
                      <strong className="proposal-custom-scoping-summary__name">
                        {request.name}
                      </strong>
                      <span className="proposal-custom-scoping-summary__type">
                        {customScopingDeliverableLabel(request)}
                      </span>
                    </span>
                    {!open ? (
                      <span className="proposal-custom-scoping-summary__preview">
                        {request.overviewAndGoal}
                      </span>
                    ) : null}
                  </span>
                  <span className="proposal-custom-scoping-summary__hint">
                    {open ? "Collapse" : "Expand"}
                  </span>
                </button>
                {open ? (
                  <div className="proposal-custom-scoping-summary__body">
                    <RequestDetails request={request} />
                  </div>
                ) : null}
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RequestDetails({ request }: { request: CustomScopingRequest }) {
  const rows = customScopingSummaryLines(request);
  return (
    <dl className="proposal-custom-scoping-summary__details">
      {rows.map((row) => (
        <div key={row.label} className="proposal-custom-scoping-summary__detail">
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
