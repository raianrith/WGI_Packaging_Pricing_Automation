import ReactMarkdown from "react-markdown";
import type { Package } from "../types";

function Prose({ text }: { text: string }) {
  return (
    <div className="agency-tier-prose agency-pkg-narrative__prose">
      <ReactMarkdown
        components={{
          a: ({ href, children }) => (
            <a href={href} className="agency-hub__link" target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function Block({ title, text }: { title: string; text: string }) {
  return (
    <div className="agency-pkg-narrative__block">
      <h5 className="agency-pkg-narrative__block-title">{title}</h5>
      <Prose text={text} />
    </div>
  );
}

type Props = {
  narrative: Partial<Package>;
  compact?: boolean;
};

export function PackageNarrativeSections({ narrative: p, compact = false }: Props) {
  const hasOverview =
    p.package_overview?.trim() || p.package_direction?.trim() || p.package_overview_link?.trim();
  const hasDesc =
    p.package_what_is_it?.trim() ||
    p.package_why_is_it_valuable?.trim() ||
    p.package_when_should_it_be_used?.trim();
  const hasScope =
    p.package_assumption_prerequisites?.trim() ||
    p.package_in_scope?.trim() ||
    p.package_out_of_scope?.trim() ||
    p.package_final_deliverable?.trim();
  const hasProcess = p.package_how_do_we_get_this_work_done?.trim() || p.package_sop?.trim();
  const hasResources =
    p.package_resource_templates?.trim() ||
    p.package_resource_tools?.trim() ||
    p.package_resources?.trim();

  if (!hasOverview && !hasDesc && !hasScope && !hasProcess && !hasResources && !p.package_owner?.trim()) {
    return null;
  }

  const sectionClass = compact
    ? "agency-pkg-narrative__section agency-pkg-narrative__section--compact"
    : "agency-pkg-narrative__section";

  return (
    <div className="agency-pkg-narrative">
      {p.package_owner?.trim() ? (
        <p className="agency-pkg-narrative__owner">
          Owner: <strong>{p.package_owner.trim()}</strong>
        </p>
      ) : null}

      {hasOverview ? (
        <section className={sectionClass}>
          <h4 className="agency-pkg-narrative__section-title">Overview</h4>
          {p.package_overview?.trim() ? <Block title="Package overview" text={p.package_overview.trim()} /> : null}
          {p.package_direction?.trim() ? <Block title="Direction" text={p.package_direction.trim()} /> : null}
          {p.package_overview_link?.trim() ? (
            <p className="agency-pkg-narrative__link-line">
              Overview link:{" "}
              <a
                className="agency-hub__link"
                href={p.package_overview_link.trim()}
                target="_blank"
                rel="noopener noreferrer"
              >
                {p.package_overview_link.trim()}
              </a>
            </p>
          ) : null}
        </section>
      ) : null}

      {hasDesc ? (
        <section className={sectionClass}>
          <h4 className="agency-pkg-narrative__section-title">Description</h4>
          {p.package_what_is_it?.trim() ? <Block title="What is it" text={p.package_what_is_it.trim()} /> : null}
          {p.package_why_is_it_valuable?.trim() ? (
            <Block title="Why is it valuable" text={p.package_why_is_it_valuable.trim()} />
          ) : null}
          {p.package_when_should_it_be_used?.trim() ? (
            <Block title="When should it be used" text={p.package_when_should_it_be_used.trim()} />
          ) : null}
        </section>
      ) : null}

      {hasScope ? (
        <section className={sectionClass}>
          <h4 className="agency-pkg-narrative__section-title">Scope</h4>
          {p.package_assumption_prerequisites?.trim() ? (
            <Block title="Assumptions and prerequisites" text={p.package_assumption_prerequisites.trim()} />
          ) : null}
          {p.package_in_scope?.trim() ? (
            <Block title="What is included in scope" text={p.package_in_scope.trim()} />
          ) : null}
          {p.package_out_of_scope?.trim() ? (
            <Block title="What is not included in scope" text={p.package_out_of_scope.trim()} />
          ) : null}
          {p.package_final_deliverable?.trim() ? (
            <Block title="What is the final deliverable" text={p.package_final_deliverable.trim()} />
          ) : null}
        </section>
      ) : null}

      {hasProcess ? (
        <section className={sectionClass}>
          <h4 className="agency-pkg-narrative__section-title">Process</h4>
          {p.package_how_do_we_get_this_work_done?.trim() ? (
            <Block title="How do we get this work done" text={p.package_how_do_we_get_this_work_done.trim()} />
          ) : null}
          {p.package_sop?.trim() ? <Block title="SOP" text={p.package_sop.trim()} /> : null}
        </section>
      ) : null}

      {hasResources ? (
        <section className={sectionClass}>
          <h4 className="agency-pkg-narrative__section-title">Resources</h4>
          {p.package_resource_templates?.trim() ? (
            <Block title="Templates" text={p.package_resource_templates.trim()} />
          ) : null}
          {p.package_resource_tools?.trim() ? <Block title="Tools" text={p.package_resource_tools.trim()} /> : null}
          {p.package_resources?.trim() ? <Block title="Resources" text={p.package_resources.trim()} /> : null}
        </section>
      ) : null}
    </div>
  );
}
