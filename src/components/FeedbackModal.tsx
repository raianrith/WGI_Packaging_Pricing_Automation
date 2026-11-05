import { useEffect, useId, useState } from "react";
import {
  APP_FEEDBACK_AREAS,
  APP_FEEDBACK_CATEGORIES,
  APP_FEEDBACK_PRIORITIES,
  appFeedbackAreaLabel,
  appFeedbackCategoryLabel,
  appFeedbackPriorityLabel,
  defaultAreaForCategory,
  emptyAppFeedbackForm,
  normalizeAppFeedbackForm,
  validateAppFeedbackForm,
  type AppFeedbackArea,
  type AppFeedbackCategory,
  type AppFeedbackFormInput,
  type AppFeedbackPriority,
} from "../lib/appFeedback";

type Props = {
  open: boolean;
  busy?: boolean;
  defaultName?: string;
  defaultEmail?: string;
  initialCategory?: AppFeedbackCategory | "";
  onCancel: () => void;
  onConfirm: (form: AppFeedbackFormInput) => void;
};

export function FeedbackModal({
  open,
  busy = false,
  defaultName = "",
  defaultEmail = "",
  initialCategory = "",
  onCancel,
  onConfirm,
}: Props) {
  const titleId = useId();
  const [form, setForm] = useState<AppFeedbackFormInput>(() =>
    emptyAppFeedbackForm(defaultName, defaultEmail, initialCategory)
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(emptyAppFeedbackForm(defaultName, defaultEmail, initialCategory));
    setError(null);
  }, [open, defaultName, defaultEmail, initialCategory]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const patch = <K extends keyof AppFeedbackFormInput>(
    key: K,
    value: AppFeedbackFormInput[K]
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const setCategory = (category: AppFeedbackCategory | "") => {
    setForm((prev) => ({
      ...prev,
      category,
      area: defaultAreaForCategory(category),
    }));
  };

  const submit = () => {
    const normalized = normalizeAppFeedbackForm(form);
    const check = validateAppFeedbackForm(normalized);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setError(null);
    onConfirm(normalized);
  };

  const isBug = form.category === "bug";
  const isNewSolution = form.category === "new_solution";
  const needsRelated =
    form.category === "task_alignment" ||
    form.category === "solution_content" ||
    form.category === "package";

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
          className="solution-request-modal__close"
          aria-label="Close"
          disabled={busy}
          onClick={onCancel}
        >
          ×
        </button>

        <header className="solution-request-modal__head">
          <p className="solution-request-modal__eyebrow">Feedback</p>
          <h2 id={titleId} className="solution-request-modal__title">
            Tell us what to fix or improve
          </h2>
          <p className="solution-request-modal__lead">
            Pick a category and fill the fields that appear. The more detail you give, the faster we
            can act.
          </p>
        </header>

        <div className="solution-request-modal__body">
          <section className="solution-request-modal__section">
            <h3 className="solution-request-modal__section-title">Requester</h3>
            <div className="solution-request-modal__grid solution-request-modal__grid--2">
              <label className="solution-request-modal__field">
                <span className="solution-request-modal__label">
                  Your name <em>*</em>
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
            <h3 className="solution-request-modal__section-title">Classify</h3>
            <div className="solution-request-modal__grid solution-request-modal__grid--2">
              <label className="solution-request-modal__field">
                <span className="solution-request-modal__label">
                  What is this for? <em>*</em>
                </span>
                <select
                  className="roadmap-input"
                  value={form.category}
                  disabled={busy}
                  onChange={(e) => setCategory(e.target.value as AppFeedbackCategory | "")}
                >
                  <option value="">Select a category…</option>
                  {APP_FEEDBACK_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {appFeedbackCategoryLabel(c)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="solution-request-modal__field">
                <span className="solution-request-modal__label">
                  Where in the app? <em>*</em>
                </span>
                <select
                  className="roadmap-input"
                  value={form.area}
                  disabled={busy}
                  onChange={(e) => patch("area", e.target.value as AppFeedbackArea)}
                >
                  {APP_FEEDBACK_AREAS.map((a) => (
                    <option key={a} value={a}>
                      {appFeedbackAreaLabel(a)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="solution-request-modal__field">
                <span className="solution-request-modal__label">
                  Priority <em>*</em>
                </span>
                <select
                  className="roadmap-input"
                  value={form.priority}
                  disabled={busy}
                  onChange={(e) => patch("priority", e.target.value as AppFeedbackPriority)}
                >
                  {APP_FEEDBACK_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {appFeedbackPriorityLabel(p)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="solution-request-modal__field">
                <span className="solution-request-modal__label">Page or URL</span>
                <input
                  className="roadmap-input"
                  value={form.pageOrUrl}
                  disabled={busy}
                  onChange={(e) => patch("pageOrUrl", e.target.value)}
                  placeholder="e.g. /roadmap or Solutions Catalog"
                />
              </label>
            </div>
          </section>

          <section className="solution-request-modal__section">
            <h3 className="solution-request-modal__section-title">Details</h3>
            <div className="solution-request-modal__grid">
              <label className="solution-request-modal__field">
                <span className="solution-request-modal__label">
                  Short title <em>*</em>
                </span>
                <input
                  className="roadmap-input"
                  value={form.title}
                  disabled={busy}
                  onChange={(e) => patch("title", e.target.value)}
                  placeholder={
                    isNewSolution
                      ? "e.g. Competitive Messaging Sprint"
                      : "One-line summary of the issue or ask"
                  }
                />
              </label>

              {needsRelated ? (
                <label className="solution-request-modal__field">
                  <span className="solution-request-modal__label">
                    {form.category === "package" ? "Package name" : "Solution / tier / task"}{" "}
                    <em>*</em>
                  </span>
                  <input
                    className="roadmap-input"
                    value={form.relatedName}
                    disabled={busy}
                    onChange={(e) => patch("relatedName", e.target.value)}
                    placeholder={
                      form.category === "package" ? "Which package?" : "Name what’s wrong or missing"
                    }
                  />
                </label>
              ) : null}

              <label className="solution-request-modal__field">
                <span className="solution-request-modal__label">
                  {isNewSolution ? "Client / business need" : "What should we know?"} <em>*</em>
                </span>
                <textarea
                  className="roadmap-input solution-request-modal__textarea"
                  rows={3}
                  value={form.details}
                  disabled={busy}
                  onChange={(e) => patch("details", e.target.value)}
                  placeholder={
                    isBug
                      ? "What broke, and who hit it?"
                      : isNewSolution
                        ? "What problem are we solving for the client?"
                        : "Describe the change, bug, or content gap."
                  }
                />
              </label>

              <label className="solution-request-modal__field">
                <span className="solution-request-modal__label">Impact</span>
                <textarea
                  className="roadmap-input solution-request-modal__textarea"
                  rows={2}
                  value={form.impact}
                  disabled={busy}
                  onChange={(e) => patch("impact", e.target.value)}
                  placeholder="Who is blocked? How often does this come up?"
                />
              </label>
            </div>
          </section>

          {isBug ? (
            <section className="solution-request-modal__section">
              <h3 className="solution-request-modal__section-title">Bug details</h3>
              <div className="solution-request-modal__grid">
                <label className="solution-request-modal__field">
                  <span className="solution-request-modal__label">Steps to reproduce</span>
                  <textarea
                    className="roadmap-input solution-request-modal__textarea"
                    rows={3}
                    value={form.stepsToReproduce}
                    disabled={busy}
                    onChange={(e) => patch("stepsToReproduce", e.target.value)}
                    placeholder="1. Go to… 2. Click… 3. See…"
                  />
                </label>
                <div className="solution-request-modal__grid solution-request-modal__grid--2">
                  <label className="solution-request-modal__field">
                    <span className="solution-request-modal__label">Expected</span>
                    <textarea
                      className="roadmap-input solution-request-modal__textarea"
                      rows={2}
                      value={form.expectedBehavior}
                      disabled={busy}
                      onChange={(e) => patch("expectedBehavior", e.target.value)}
                      placeholder="What should happen?"
                    />
                  </label>
                  <label className="solution-request-modal__field">
                    <span className="solution-request-modal__label">Actual</span>
                    <textarea
                      className="roadmap-input solution-request-modal__textarea"
                      rows={2}
                      value={form.actualBehavior}
                      disabled={busy}
                      onChange={(e) => patch("actualBehavior", e.target.value)}
                      placeholder="What happened instead?"
                    />
                  </label>
                </div>
              </div>
            </section>
          ) : null}

          {isNewSolution ? (
            <>
              <section className="solution-request-modal__section">
                <h3 className="solution-request-modal__section-title">New solution details</h3>
                <div className="solution-request-modal__grid">
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
                  <label className="solution-request-modal__field">
                    <span className="solution-request-modal__label">
                      Why productize? <em>*</em>
                    </span>
                    <textarea
                      className="roadmap-input solution-request-modal__textarea"
                      rows={3}
                      value={form.whyProductize}
                      disabled={busy}
                      onChange={(e) => patch("whyProductize", e.target.value)}
                      placeholder="Why should this become a directory solution?"
                    />
                  </label>
                </div>
              </section>
              <section className="solution-request-modal__section">
                <h3 className="solution-request-modal__section-title">
                  Suggested directory placement
                </h3>
                <div className="solution-request-modal__grid solution-request-modal__grid--2">
                  <label className="solution-request-modal__field">
                    <span className="solution-request-modal__label">Phase</span>
                    <input
                      className="roadmap-input"
                      value={form.suggestedPhase}
                      disabled={busy}
                      onChange={(e) => patch("suggestedPhase", e.target.value)}
                      placeholder="Optional"
                    />
                  </label>
                  <label className="solution-request-modal__field">
                    <span className="solution-request-modal__label">Category</span>
                    <input
                      className="roadmap-input"
                      value={form.suggestedCategory}
                      disabled={busy}
                      onChange={(e) => patch("suggestedCategory", e.target.value)}
                      placeholder="Optional"
                    />
                  </label>
                  <label className="solution-request-modal__field">
                    <span className="solution-request-modal__label">Tactic</span>
                    <input
                      className="roadmap-input"
                      value={form.suggestedTactic}
                      disabled={busy}
                      onChange={(e) => patch("suggestedTactic", e.target.value)}
                      placeholder="Optional"
                    />
                  </label>
                </div>
              </section>
            </>
          ) : null}

          <section className="solution-request-modal__section">
            <h3 className="solution-request-modal__section-title">Anything else</h3>
            <label className="solution-request-modal__field">
              <span className="solution-request-modal__label">Additional notes</span>
              <textarea
                className="roadmap-input solution-request-modal__textarea"
                rows={2}
                value={form.additionalNotes}
                disabled={busy}
                onChange={(e) => patch("additionalNotes", e.target.value)}
                placeholder="Screenshots descriptions, workarounds, related tickets…"
              />
            </label>
          </section>

          {error ? <p className="solution-request-modal__error">{error}</p> : null}
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
            {busy ? "Submitting…" : "Submit Feedback / Request New Solution"}
          </button>
        </footer>
      </div>
    </div>
  );
}
