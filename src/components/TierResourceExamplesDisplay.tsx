import ReactMarkdown from "react-markdown";
import type { TierResourceExampleRow } from "../types";

type Props = {
  rows: TierResourceExampleRow[];
  /** Extra classes on the list wrapper (e.g. roadmap context). */
  className?: string;
};

/** Read-only list: one row per example + date pair (Agency roadmap-style tier resources). */
export function TierResourceExamplesDisplay({ rows, className }: Props) {
  if (rows.length === 0) return null;
  const listCls = ["tier-resource-examples", className].filter(Boolean).join(" ");
  return (
    <ul className={listCls}>
      {rows.map((r, i) => {
        const example = r.example.trim() || "—";
        const date = r.date.trim() || "—";
        return (
          <li key={i} className="tier-resource-examples__item">
            <div className="tier-resource-examples__row">
              {rows.length > 1 ? (
                <span className="tier-resource-examples__index" aria-hidden>
                  {i + 1}.
                </span>
              ) : null}
              <div className="tier-resource-examples__grid">
                <div className="tier-resource-examples__cell">
                  <span className="tier-resource-examples__label">Example</span>
                  <div className="tier-resource-examples__value tier-resource-examples__value--markdown">
                    <ReactMarkdown
                      components={{
                        a: ({ href, children }) => (
                          <a href={href} className="agency-hub__link" target="_blank" rel="noopener noreferrer">
                            {children}
                          </a>
                        ),
                      }}
                    >
                      {example}
                    </ReactMarkdown>
                  </div>
                </div>
                <div className="tier-resource-examples__cell">
                  <span className="tier-resource-examples__label">Date</span>
                  <span className="tier-resource-examples__value">{date}</span>
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
