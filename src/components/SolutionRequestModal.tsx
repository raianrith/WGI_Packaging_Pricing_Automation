import { useEffect, useId, useState } from "react";
import {
  emptySolutionRequestForm,
  normalizeSolutionRequestForm,
  SOLUTION_REQUEST_PRIORITIES,
  solutionRequestPriorityLabel,
  validateSolutionRequestForm,
  type SolutionRequestFormInput,
  type SolutionRequestPriority,
} from "../lib/solutionRequests";

type Props = {
  open: boolean;
  busy?: boolean;
  defaultName?: string;
  defaultEmail?: string;
  onCancel: () => void;
  onConfirm: (form: SolutionRequestFormInput) => void;
};

export function SolutionRequestModal({
  open,
  busy = false,
  defaultName = "",
  defaultEmail = "",
  onCancel,
  onConfirm,
}: Props) {
  const titleId = useId();
  const [form, setForm] = useState<SolutionRequestFormInput>(() =>
    emptySolutionRequestForm(defaultName, defaultEmail)
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(emptySolutionRequestForm(defaultName, defaultEmail));
    setError(null);
  }, [open, defaultName, defaultEmail]);

  if (!open) return null;

  const patch = <K extends keyof SolutionRequestFormInput>(
    key: K,
    value: SolutionRequestFormInput[K]
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const submit = () => {
    const normalized = normalizeSolutionRequestForm(form);
    const check = validateSolutionRequestForm(normalized);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setError(null);
    onConfirm(normalized);
  };

  return (
    <div
      className="roadmap-modal-backdrop solution-request-modal-backdrop"
      role="presentation"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className="roadmap-modal solution-request-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="proposal-travel-modal__close"
          aria-label="Close"
          disabled={busy}
          onClick={onCancel}
        >
          ×
        </button>

        <header className="solution-request-modal__head">
          <p className="solution-request-modal__eyebrow">Solutions Directory</p>
          <h2 id={titleId} className="solution-request-modal__title">
            Request a new solution
          </h2>
          <p className="solution-request-modal__lead">
            Tell us what should be productized so Chelsea and the team can review scope,
            placement, and build readiness.
          </p>
        </header>

        <div className="solution-request-modal__body">
          <section className="solution-request-modal__section">
            <h3 className="solution-request-modal__section-title">Requester</h3>
            <div className="solution-request-modal__grid solution-request-modal__grid--2">
              <label className="solution-request-modal__field">
                <span className="solution-request-modal__label">
                  Requested by <em>*</em>
                </span>
                <input
                  className="roadmap-input"
                  value={form.requestedByName}
                  disabled={busy}
                  onChange={(e) => patch("requestedByName", e.target.value)}
                  placeholder="Full name"
                  autoComplete="name"
                />
              </label>
              <label className="solution-request-modal__field">
                <span className="solution-request-modal__label">
                  Email <em>*</em>
                </span>
                <input
                  className="roadmap-input"
                  type="email"
                  value={form.requestedByEmail}
                  disabled={busy}
                  onChange={(e) => patch("requestedByEmail", e.target.value)}
                  placeholder="name@weidert.com"
                  autoComplete="email"
                />
              </label>
            </div>
          </section>

          <section className="solution-request-modal__section">
            <h3 className="solution-request-modal__section-title">What to productize</h3>
            <div className="solution-request-modal__grid">
              <label className="solution-request-modal__field">
                <span className="solution-request-modal__label">
                  Proposed solution name <em>*</em>
                </span>
                <input
                  className="roadmap-input"
                  value={form.solutionName}
                  disabled={busy}
                  onChange={(e) => patch("solutionName", e.target.value)}
                  placeholder="e.g. Competitive Messaging Sprint"
                />
              </label>
              <label className="solution-request-modal__field">
                <span className="solution-request-modal__label">
                  Client / business need <em>*</em>
                </span>
                <textarea
                  className="roadmap-input solution-request-modal__textarea"
                  rows={3}
                  value={form.clientNeed}
                  disabled={busy}
                  onChange={(e) => patch("clientNeed", e.target.value)}
                  placeholder="What problem are we solving for the client?"
                />
              </label>
              <label className="solution-request-modal__field">
                <span className="solution-request-modal__label">
                  Typical client or use case <em>*</em>
                </span>
                <textarea
                  className="roadmap-input solution-request-modal__textarea"
                  rows={3}
                  value={form.typicalUseCase}
                  disabled={busy}
                  onChange={(e) => patch("typicalUseCase", e.target.value)}
                  placeholder="Who asks for this, and when would we recommend it?"
                />
              </label>
              <label className="solution-request-modal__field">
                <span className="solution-request-modal__label">
                  Desired outcomes / deliverables <em>*</em>
                </span>
                <textarea
                  className="roadmap-input solution-request-modal__textarea"
                  rows={3}
                  value={form.desiredDeliverables}
                  disabled={busy}
                  onChange={(e) => patch("desiredDeliverables", e.target.value)}
                  placeholder="What should the client walk away with?"
                />
              </label>
            </div>
          </section>

          <section className="solution-request-modal__section">
            <h3 className="solution-request-modal__section-title">
              Suggested directory placement
            </h3>
            <p className="solution-request-modal__hint">
              Optional — helps reviewers map this into phase, category, and tactic.
            </p>
            <div className="solution-request-modal__grid solution-request-modal__grid--3">
              <label className="solution-request-modal__field">
                <span className="solution-request-modal__label">Phase</span>
                <input
                  className="roadmap-input"
                  value={form.suggestedPhase}
                  disabled={busy}
                  onChange={(e) => patch("suggestedPhase", e.target.value)}
                  placeholder="e.g. Attract"
                />
              </label>
              <label className="solution-request-modal__field">
                <span className="solution-request-modal__label">Category</span>
                <input
                  className="roadmap-input"
                  value={form.suggestedCategory}
                  disabled={busy}
                  onChange={(e) => patch("suggestedCategory", e.target.value)}
                  placeholder="e.g. Content"
                />
              </label>
              <label className="solution-request-modal__field">
                <span className="solution-request-modal__label">Tactic</span>
                <input
                  className="roadmap-input"
                  value={form.suggestedTactic}
                  disabled={busy}
                  onChange={(e) => patch("suggestedTactic", e.target.value)}
                  placeholder="e.g. Thought leadership"
                />
              </label>
            </div>
          </section>

          <section className="solution-request-modal__section">
            <h3 className="solution-request-modal__section-title">Scope & build notes</h3>
            <div className="solution-request-modal__grid solution-request-modal__grid--2">
              <label className="solution-request-modal__field">
                <span className="solution-request-modal__label">In scope (draft)</span>
                <textarea
                  className="roadmap-input solution-request-modal__textarea"
                  rows={3}
                  value={form.inScope}
                  disabled={busy}
                  onChange={(e) => patch("inScope", e.target.value)}
                  placeholder="What should this offering include?"
                />
              </label>
              <label className="solution-request-modal__field">
                <span className="solution-request-modal__label">Out of scope (draft)</span>
                <textarea
                  className="roadmap-input solution-request-modal__textarea"
                  rows={3}
                  value={form.outOfScope}
                  disabled={busy}
                  onChange={(e) => patch("outOfScope", e.target.value)}
                  placeholder="What should stay excluded?"
                />
              </label>
            </div>
            <div className="solution-request-modal__grid">
              <label className="solution-request-modal__field">
                <span className="solution-request-modal__label">Known tasks or work involved</span>
                <textarea
                  className="roadmap-input solution-request-modal__textarea"
                  rows={3}
                  value={form.knownWork}
                  disabled={busy}
                  onChange={(e) => patch("knownWork", e.target.value)}
                  placeholder="Roles, steps, tools, or estimate of effort if known"
                />
              </label>
              <label className="solution-request-modal__field">
                <span className="solution-request-modal__label">
                  Why productize this? <em>*</em>
                </span>
                <textarea
                  className="roadmap-input solution-request-modal__textarea"
                  rows={3}
                  value={form.whyProductize}
                  disabled={busy}
                  onChange={(e) => patch("whyProductize", e.target.value)}
                  placeholder="How often is this requested? Why belong in the directory?"
                />
              </label>
              <label className="solution-request-modal__field">
                <span className="solution-request-modal__label">Related existing offerings</span>
                <textarea
                  className="roadmap-input solution-request-modal__textarea"
                  rows={2}
                  value={form.relatedOfferings}
                  disabled={busy}
                  onChange={(e) => patch("relatedOfferings", e.target.value)}
                  placeholder="Nearby solutions or packages this builds on"
                />
              </label>
            </div>
          </section>

          <section className="solution-request-modal__section">
            <h3 className="solution-request-modal__section-title">Priority & notes</h3>
            <fieldset className="solution-request-modal__priority" disabled={busy}>
              <legend className="solution-request-modal__label">Priority</legend>
              <div className="solution-request-modal__priority-options">
                {SOLUTION_REQUEST_PRIORITIES.map((p) => (
                  <label
                    key={p}
                    className={`solution-request-modal__priority-option${
                      form.priority === p ? " is-selected" : ""
                    }`}
                  >
                    <input
                      type="radio"
                      name="solution-request-priority"
                      value={p}
                      checked={form.priority === p}
                      onChange={() => patch("priority", p as SolutionRequestPriority)}
                    />
                    <span>{solutionRequestPriorityLabel(p)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="solution-request-modal__field">
              <span className="solution-request-modal__label">Additional notes</span>
              <textarea
                className="roadmap-input solution-request-modal__textarea"
                rows={2}
                value={form.additionalNotes}
                disabled={busy}
                onChange={(e) => patch("additionalNotes", e.target.value)}
                placeholder="Anything else reviewers should know"
              />
            </label>
          </section>

          {error ? (
            <p className="solution-request-modal__error" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="solution-request-modal__footer">
          <button
            type="button"
            className="roadmap-btn roadmap-btn--ghost"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="roadmap-btn roadmap-btn--primary"
            disabled={busy}
            onClick={submit}
          >
            {busy ? "Submitting…" : "Submit request"}
          </button>
        </footer>
      </div>
    </div>
  );
}
