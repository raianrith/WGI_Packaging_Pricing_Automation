import { useEffect, useId, useState } from "react";
import {
  emptyOpsReviewSection,
  normalizeOpsReviewSubmission,
  OPS_REVIEW_CLAUDE_SUMMARY_PROMPT,
  validateOpsReviewSubmission,
  type OpsReviewDisplayMode,
  type OpsReviewSection,
  type OpsReviewSubmissionMeta,
} from "../../lib/opsReviewSubmission";

type Props = {
  open: boolean;
  busy?: boolean;
  defaultProjectOwner?: string;
  onCancel: () => void;
  onConfirm: (meta: OpsReviewSubmissionMeta) => void;
};

export function ProposalOpsReviewSubmitModal({
  open,
  busy = false,
  defaultProjectOwner = "",
  onCancel,
  onConfirm,
}: Props) {
  const ownerId = useId();
  const wiId = useId();
  const summaryId = useId();
  const [projectOwner, setProjectOwner] = useState("");
  const [wisconsinBasedClient, setWisconsinBasedClient] = useState<boolean | null>(null);
  const [claudeChatSummary, setClaudeChatSummary] = useState("");
  const [displayMode, setDisplayMode] = useState<OpsReviewDisplayMode>("proposal_total");
  const [sections, setSections] = useState<OpsReviewSection[]>(() => [emptyOpsReviewSection()]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setProjectOwner(defaultProjectOwner.trim());
    setWisconsinBasedClient(null);
    setClaudeChatSummary("");
    setDisplayMode("proposal_total");
    setSections([emptyOpsReviewSection()]);
    setError(null);
  }, [open, defaultProjectOwner]);

  if (!open) return null;

  const draft: OpsReviewSubmissionMeta = {
    projectOwner,
    wisconsinBasedClient,
    claudeChatSummary,
    displayMode,
    sections,
  };

  const submit = () => {
    const normalized = normalizeOpsReviewSubmission(draft);
    const check = validateOpsReviewSubmission(normalized);
    if (!check.ok) {
      setError(check.error ?? "Please complete the required details.");
      return;
    }
    setError(null);
    onConfirm(normalized);
  };

  const updateSection = (id: string, patch: Partial<Pick<OpsReviewSection, "name" | "notes">>) => {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const removeSection = (id: string) => {
    setSections((prev) => (prev.length <= 1 ? prev : prev.filter((s) => s.id !== id)));
  };

  return (
    <div
      className="roadmap-modal-backdrop proposal-travel-modal-backdrop"
      role="presentation"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className="roadmap-modal proposal-travel-modal proposal-ops-review-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="proposal-ops-review-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="proposal-travel-modal__close"
          aria-label="Close"
          disabled={busy}
          onClick={onCancel}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M18 6L6 18M6 6l12 12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>

        <header className="proposal-ops-review-modal__head">
          <p className="proposal-ops-review-modal__eyebrow">Operations review</p>
          <h2 id="proposal-ops-review-title" className="proposal-ops-review-modal__title">
            Prepare this handoff
          </h2>
          <p className="proposal-ops-review-modal__lead">
            A few details help Ops understand the proposal and present it clearly to the client.
          </p>
        </header>

        <div className="proposal-ops-review-modal__body">
          <label className="proposal-ops-review-modal__field" htmlFor={ownerId}>
            <span className="proposal-ops-review-modal__label">Project owner</span>
            <span className="proposal-ops-review-modal__hint">Who should Ops treat as the primary contact?</span>
            <input
              id={ownerId}
              className="roadmap-input proposal-ops-review-modal__input"
              value={projectOwner}
              onChange={(e) => setProjectOwner(e.target.value)}
              placeholder="Full name"
              autoComplete="name"
              disabled={busy}
              autoFocus
            />
          </label>

          <fieldset className="proposal-ops-review-modal__fieldset" aria-labelledby={wiId}>
            <legend id={wiId} className="proposal-ops-review-modal__label">
              Is this a Wisconsin-based client?
            </legend>
            <p className="proposal-ops-review-modal__hint">Select yes or no.</p>
            <div className="proposal-ops-review-modal__yesno">
              <label
                className={
                  wisconsinBasedClient === true
                    ? "proposal-ops-review-modal__option is-selected"
                    : "proposal-ops-review-modal__option"
                }
              >
                <input
                  type="radio"
                  name="ops-review-wisconsin"
                  checked={wisconsinBasedClient === true}
                  onChange={() => setWisconsinBasedClient(true)}
                  disabled={busy}
                />
                <span className="proposal-ops-review-modal__option-mark" aria-hidden />
                <span className="proposal-ops-review-modal__option-copy">
                  <strong>Yes</strong>
                </span>
              </label>
              <label
                className={
                  wisconsinBasedClient === false
                    ? "proposal-ops-review-modal__option is-selected"
                    : "proposal-ops-review-modal__option"
                }
              >
                <input
                  type="radio"
                  name="ops-review-wisconsin"
                  checked={wisconsinBasedClient === false}
                  onChange={() => setWisconsinBasedClient(false)}
                  disabled={busy}
                />
                <span className="proposal-ops-review-modal__option-mark" aria-hidden />
                <span className="proposal-ops-review-modal__option-copy">
                  <strong>No</strong>
                </span>
              </label>
            </div>
          </fieldset>

          <div className="proposal-ops-review-modal__field">
            <label className="proposal-ops-review-modal__label" htmlFor={summaryId}>
              Claude conversation summary
            </label>
            <p className="proposal-ops-review-modal__hint">
              Capture the thinking behind this proposal from the Claude chat that shaped it.
            </p>
            <div className="proposal-ops-review-modal__prompt" role="note">
              <span className="proposal-ops-review-modal__prompt-label">Ask Claude</span>
              <p className="proposal-ops-review-modal__prompt-text">
                {OPS_REVIEW_CLAUDE_SUMMARY_PROMPT}
              </p>
            </div>
            <textarea
              id={summaryId}
              className="roadmap-input proposal-ops-review-modal__textarea"
              rows={7}
              value={claudeChatSummary}
              onChange={(e) => setClaudeChatSummary(e.target.value)}
              placeholder="Summarize the solutions included and why each one was chosen…"
              disabled={busy}
            />
          </div>

          <fieldset className="proposal-ops-review-modal__fieldset">
            <legend className="proposal-ops-review-modal__label">Client presentation</legend>
            <p className="proposal-ops-review-modal__hint">
              Choose how pricing should appear when this proposal is shared with the client.
            </p>
            <div className="proposal-ops-review-modal__options">
              <label
                className={
                  displayMode === "proposal_total"
                    ? "proposal-ops-review-modal__option is-selected"
                    : "proposal-ops-review-modal__option"
                }
              >
                <input
                  type="checkbox"
                  checked={displayMode === "proposal_total"}
                  onChange={() => setDisplayMode("proposal_total")}
                  disabled={busy}
                />
                <span className="proposal-ops-review-modal__option-mark" aria-hidden />
                <span className="proposal-ops-review-modal__option-copy">
                  <strong>Single proposal total</strong>
                  <span className="proposal-ops-review-modal__option-detail">
                    Present one combined Proposal Total on a single line.
                  </span>
                </span>
              </label>
              <label
                className={
                  displayMode === "section_totals"
                    ? "proposal-ops-review-modal__option is-selected"
                    : "proposal-ops-review-modal__option"
                }
              >
                <input
                  type="checkbox"
                  checked={displayMode === "section_totals"}
                  onChange={() => {
                    setDisplayMode("section_totals");
                    setSections((prev) => (prev.length > 0 ? prev : [emptyOpsReviewSection()]));
                  }}
                  disabled={busy}
                />
                <span className="proposal-ops-review-modal__option-mark" aria-hidden />
                <span className="proposal-ops-review-modal__option-copy">
                  <strong>Section totals</strong>
                  <span className="proposal-ops-review-modal__option-detail">
                    Group the proposal into named sections, each with its own total.
                  </span>
                </span>
              </label>
            </div>
          </fieldset>

          {displayMode === "section_totals" ? (
            <div className="proposal-ops-review-modal__sections" aria-label="Proposal sections">
              <div className="proposal-ops-review-modal__sections-head">
                <div>
                  <h3 className="proposal-ops-review-modal__sections-title">Sections</h3>
                  <p className="proposal-ops-review-modal__sections-lead">
                    Name each grouping and add any notes Ops should keep in mind.
                  </p>
                </div>
                <button
                  type="button"
                  className="roadmap-btn roadmap-btn--ghost proposal-ops-review-modal__add-section"
                  disabled={busy}
                  onClick={() => setSections((prev) => [...prev, emptyOpsReviewSection()])}
                >
                  Add section
                </button>
              </div>
              {sections.map((section, index) => (
                <div key={section.id} className="proposal-ops-review-modal__section-card">
                  <div className="proposal-ops-review-modal__section-card-head">
                    <span className="proposal-ops-review-modal__section-index">
                      Section {index + 1}
                    </span>
                    <button
                      type="button"
                      className="proposal-ops-review-modal__section-remove"
                      disabled={busy || sections.length <= 1}
                      onClick={() => removeSection(section.id)}
                    >
                      Remove
                    </button>
                  </div>
                  <label className="proposal-ops-review-modal__field">
                    <span className="proposal-ops-review-modal__label">Section name</span>
                    <input
                      className="roadmap-input proposal-ops-review-modal__input"
                      value={section.name}
                      onChange={(e) => updateSection(section.id, { name: e.target.value })}
                      placeholder="e.g. Discovery, Launch, Ongoing support"
                      disabled={busy}
                    />
                  </label>
                  <label className="proposal-ops-review-modal__field">
                    <span className="proposal-ops-review-modal__label">Notes</span>
                    <textarea
                      className="roadmap-input proposal-ops-review-modal__textarea proposal-ops-review-modal__textarea--short"
                      rows={3}
                      value={section.notes}
                      onChange={(e) => updateSection(section.id, { notes: e.target.value })}
                      placeholder="Anything Ops or the client should know about this section…"
                      disabled={busy}
                    />
                  </label>
                </div>
              ))}
            </div>
          ) : null}

          {error ? (
            <p className="proposal-ops-review-modal__error" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="proposal-ops-review-modal__footer">
          <button
            type="button"
            className="roadmap-btn roadmap-btn--ghost"
            disabled={busy}
            onClick={onCancel}
          >
            Keep editing
          </button>
          <button
            type="button"
            className="roadmap-btn roadmap-btn--primary"
            disabled={busy}
            onClick={submit}
          >
            {busy ? "Sending…" : "Send to Ops"}
            <span aria-hidden>→</span>
          </button>
        </footer>
      </div>
    </div>
  );
}
