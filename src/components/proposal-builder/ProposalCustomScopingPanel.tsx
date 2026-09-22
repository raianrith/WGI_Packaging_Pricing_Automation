import { useEffect, useId, useState } from "react";
import {
  CUSTOM_SCOPING_DELIVERABLE_TYPES,
  customScopingDeliverableLabel,
  customScopingRequestToForm,
  customScopingSummaryLines,
  emptyCustomScopingForm,
  formToCustomScopingRequest,
  normalizeCustomScopingForm,
  validateCustomScopingForm,
  type CustomScopingFormInput,
  type CustomScopingRequest,
  type CustomScopingState,
} from "../../lib/customScopingRequest";
import { proposalStepDef } from "./ProposalBuilderSteps";

type Props = {
  value: CustomScopingState;
  onChange: (next: CustomScopingState) => void;
};

export function ProposalCustomScopingPanel({ value, onChange }: Props) {
  const stepMeta = proposalStepDef("custom_scoping");
  const formId = useId();
  const [form, setForm] = useState<CustomScopingFormInput>(() => emptyCustomScopingForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** Form is open for first request, add-another=Yes, or edit. Hidden after a successful add. */
  const [showForm, setShowForm] = useState(false);
  const [addAnother, setAddAnother] = useState(false);

  useEffect(() => {
    if (!editingId) return;
    const existing = value.requests.find((r) => r.id === editingId);
    if (!existing) {
      setEditingId(null);
      setForm(emptyCustomScopingForm());
      setShowForm(value.requests.length === 0);
      setAddAnother(false);
    }
  }, [editingId, value.requests]);

  useEffect(() => {
    if (!value.required) {
      setShowForm(false);
      setAddAnother(false);
      return;
    }
    if (value.requests.length === 0) {
      setShowForm(true);
      setAddAnother(false);
    }
  }, [value.required, value.requests.length]);

  const patchForm = <K extends keyof CustomScopingFormInput>(
    key: K,
    next: CustomScopingFormInput[K]
  ) => {
    setForm((prev) => ({ ...prev, [key]: next }));
  };

  const resetFormFields = () => {
    setEditingId(null);
    setForm(emptyCustomScopingForm());
    setError(null);
  };

  const setRequired = (required: boolean) => {
    if (!required && value.requests.length > 0) {
      const ok = window.confirm(
        "Turn off custom scoping? Saved custom scoping requests on this proposal will be removed."
      );
      if (!ok) return;
      onChange({ required: false, requests: [] });
      resetFormFields();
      setExpandedId(null);
      setShowForm(false);
      setAddAnother(false);
      return;
    }
    onChange({ ...value, required });
    if (!required) {
      resetFormFields();
      setShowForm(false);
      setAddAnother(false);
      return;
    }
    if (value.requests.length === 0) {
      setShowForm(true);
      setAddAnother(false);
    }
  };

  const setAddAnotherChoice = (wantAnother: boolean) => {
    setAddAnother(wantAnother);
    if (wantAnother) {
      resetFormFields();
      setShowForm(true);
      return;
    }
    resetFormFields();
    setShowForm(false);
  };

  const startEdit = (request: CustomScopingRequest) => {
    setEditingId(request.id);
    setForm(customScopingRequestToForm(request));
    setError(null);
    setExpandedId(request.id);
    setShowForm(true);
    setAddAnother(false);
  };

  const cancelEdit = () => {
    resetFormFields();
    if (value.requests.length > 0) {
      setShowForm(false);
      setAddAnother(false);
    } else {
      setShowForm(true);
    }
  };

  const submitForm = () => {
    const normalized = normalizeCustomScopingForm(form);
    const check = validateCustomScopingForm(normalized);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    const existing = editingId
      ? value.requests.find((r) => r.id === editingId) ?? null
      : null;
    const nextRequest = formToCustomScopingRequest(normalized, existing);
    const requests = existing
      ? value.requests.map((r) => (r.id === existing.id ? nextRequest : r))
      : [...value.requests, nextRequest];
    onChange({ required: true, requests });
    resetFormFields();
    setExpandedId(nextRequest.id);
    setShowForm(false);
    setAddAnother(false);
  };

  const removeRequest = (id: string) => {
    const ok = window.confirm("Remove this custom scoping request from the proposal?");
    if (!ok) return;
    const requests = value.requests.filter((r) => r.id !== id);
    onChange({ required: value.required, requests });
    if (editingId === id) resetFormFields();
    if (expandedId === id) setExpandedId(null);
    if (requests.length === 0 && value.required) {
      setShowForm(true);
      setAddAnother(false);
    } else if (editingId === id) {
      setShowForm(false);
      setAddAnother(false);
    }
  };

  const formVisible = value.required && (showForm || value.requests.length === 0);

  return (
    <div className="proposal-step-panel proposal-custom-scoping">
      <header className="proposal-step-panel__head">
        <p className="proposal-step-panel__eyebrow">Step {stepMeta.number}</p>
        <h2 className="proposal-step-panel__title">{stepMeta.label}</h2>
        <p className="proposal-step-panel__lead">
          Capture out-of-catalog deliverables that need custom scoping before they can be priced and
          scheduled.
        </p>
      </header>

      <section className="proposal-custom-scoping__toggle-card" aria-labelledby={`${formId}-toggle`}>
        <div className="proposal-custom-scoping__toggle-copy">
          <h3 id={`${formId}-toggle`} className="proposal-custom-scoping__toggle-title">
            Do you require custom scoping?
          </h3>
          <p className="proposal-custom-scoping__toggle-hint">
            Default is no. Turn this on when the client needs work that is not already a directory
            solution.
          </p>
        </div>
        <div className="proposal-custom-scoping__toggle" role="group" aria-label="Custom scoping required">
          <button
            type="button"
            className={`proposal-custom-scoping__toggle-btn${!value.required ? " is-selected" : ""}`}
            aria-pressed={!value.required}
            onClick={() => setRequired(false)}
          >
            No
          </button>
          <button
            type="button"
            className={`proposal-custom-scoping__toggle-btn${value.required ? " is-selected" : ""}`}
            aria-pressed={value.required}
            onClick={() => setRequired(true)}
          >
            Yes
          </button>
        </div>
      </section>

      {!value.required ? (
        <p className="proposal-custom-scoping__idle">
          No custom scoping needed for this proposal. Continue to Organize when you are ready.
        </p>
      ) : (
        <>
          {value.requests.length > 0 ? (
            <section className="proposal-custom-scoping__list" aria-label="Saved custom scoping requests">
              <div className="proposal-custom-scoping__list-head">
                <h3 className="proposal-custom-scoping__section-title">
                  On this proposal
                  <span className="proposal-custom-scoping__count">{value.requests.length}</span>
                </h3>
              </div>
              <ul className="proposal-custom-scoping__cards">
                {value.requests.map((request) => {
                  const open = expandedId === request.id;
                  const rows = customScopingSummaryLines(request);
                  return (
                    <li key={request.id}>
                      <article
                        className={`proposal-custom-scoping-card${open ? " is-expanded" : ""}${
                          editingId === request.id ? " is-editing" : ""
                        }`}
                      >
                        <button
                          type="button"
                          className="proposal-custom-scoping-card__head"
                          aria-expanded={open}
                          onClick={() => setExpandedId(open ? null : request.id)}
                        >
                          <span className="proposal-custom-scoping-card__mark" aria-hidden>
                            {open ? "▾" : "▸"}
                          </span>
                          <span className="proposal-custom-scoping-card__main">
                            <span className="proposal-custom-scoping-card__title-row">
                              <strong className="proposal-custom-scoping-card__title">
                                {request.name}
                              </strong>
                              <span className="proposal-custom-scoping-card__type">
                                {customScopingDeliverableLabel(request)}
                              </span>
                            </span>
                            <span className="proposal-custom-scoping-card__preview">
                              {request.overviewAndGoal}
                            </span>
                          </span>
                          <span className="proposal-custom-scoping-card__hint">
                            {open ? "Collapse" : "Expand"}
                          </span>
                        </button>
                        {open ? (
                          <div className="proposal-custom-scoping-card__body">
                            <dl className="proposal-custom-scoping-card__grid">
                              {rows.map((row) => (
                                <div key={row.label} className="proposal-custom-scoping-card__detail">
                                  <dt>{row.label}</dt>
                                  <dd>{row.value}</dd>
                                </div>
                              ))}
                            </dl>
                            <div className="proposal-custom-scoping-card__actions">
                              <button
                                type="button"
                                className="roadmap-btn roadmap-btn--ghost roadmap-btn--sm"
                                onClick={() => startEdit(request)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="roadmap-btn roadmap-btn--ghost roadmap-btn--sm"
                                onClick={() => removeRequest(request.id)}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </article>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {value.requests.length > 0 && !formVisible ? (
            <section
              className="proposal-custom-scoping__toggle-card"
              aria-labelledby={`${formId}-add-another`}
            >
              <div className="proposal-custom-scoping__toggle-copy">
                <h3
                  id={`${formId}-add-another`}
                  className="proposal-custom-scoping__toggle-title"
                >
                  Add another custom scoping request?
                </h3>
                <p className="proposal-custom-scoping__toggle-hint">
                  Default is no. Switch to yes when you need to capture another out-of-catalog
                  deliverable.
                </p>
              </div>
              <div
                className="proposal-custom-scoping__toggle"
                role="group"
                aria-label="Add another custom scoping request"
              >
                <button
                  type="button"
                  className={`proposal-custom-scoping__toggle-btn${!addAnother ? " is-selected" : ""}`}
                  aria-pressed={!addAnother}
                  onClick={() => setAddAnotherChoice(false)}
                >
                  No
                </button>
                <button
                  type="button"
                  className={`proposal-custom-scoping__toggle-btn${addAnother ? " is-selected" : ""}`}
                  aria-pressed={addAnother}
                  onClick={() => setAddAnotherChoice(true)}
                >
                  Yes
                </button>
              </div>
            </section>
          ) : null}

          {formVisible ? (
          <section
            className="proposal-custom-scoping__form-card"
            aria-labelledby={`${formId}-form-title`}
          >
            <header className="proposal-custom-scoping__form-head">
              <h3 id={`${formId}-form-title`} className="proposal-custom-scoping__section-title">
                {editingId ? "Edit custom scoping request" : "New custom scoping request"}
              </h3>
              <p className="proposal-custom-scoping__form-lead">
                Answer enough for ops to scope and price the work. Required fields are marked.
              </p>
            </header>

            <div className="proposal-custom-scoping__form">
              <label className="proposal-custom-scoping__field">
                <span className="proposal-custom-scoping__label">
                  Name of request <em>*</em>
                </span>
                <input
                  className="roadmap-input"
                  value={form.name}
                  onChange={(e) => patchForm("name", e.target.value)}
                  placeholder="e.g. Trade show booth video package"
                />
              </label>

              <label className="proposal-custom-scoping__field">
                <span className="proposal-custom-scoping__label">
                  What type of deliverable do you need scoped? <em>*</em>
                </span>
                <select
                  className="roadmap-input"
                  value={form.deliverableType}
                  onChange={(e) =>
                    patchForm(
                      "deliverableType",
                      e.target.value as CustomScopingFormInput["deliverableType"]
                    )
                  }
                >
                  <option value="">Select a type…</option>
                  {CUSTOM_SCOPING_DELIVERABLE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>

              {form.deliverableType === "Other" ? (
                <label className="proposal-custom-scoping__field">
                  <span className="proposal-custom-scoping__label">
                    Describe the deliverable type <em>*</em>
                  </span>
                  <input
                    className="roadmap-input"
                    value={form.deliverableTypeOther}
                    onChange={(e) => patchForm("deliverableTypeOther", e.target.value)}
                    placeholder="e.g. Interactive HubSpot landing experience"
                  />
                </label>
              ) : null}

              <label className="proposal-custom-scoping__field">
                <span className="proposal-custom-scoping__label">
                  Overview / description and main goal <em>*</em>
                </span>
                <textarea
                  className="roadmap-input proposal-custom-scoping__textarea"
                  rows={4}
                  value={form.overviewAndGoal}
                  onChange={(e) => patchForm("overviewAndGoal", e.target.value)}
                  placeholder="What is the deliverable, and what should it achieve for the client?"
                />
              </label>

              <label className="proposal-custom-scoping__field">
                <span className="proposal-custom-scoping__label">
                  Will the client be providing any components (e.g. copy, graphics/images)?
                </span>
                <textarea
                  className="roadmap-input proposal-custom-scoping__textarea"
                  rows={3}
                  value={form.clientComponents}
                  onChange={(e) => patchForm("clientComponents", e.target.value)}
                  placeholder="List what the client will provide, or note if WGI is creating everything."
                />
              </label>

              <label className="proposal-custom-scoping__field">
                <span className="proposal-custom-scoping__label">
                  Examples / resources this request is based on (links welcome)
                </span>
                <textarea
                  className="roadmap-input proposal-custom-scoping__textarea"
                  rows={3}
                  value={form.examplesAndResources}
                  onChange={(e) => patchForm("examplesAndResources", e.target.value)}
                  placeholder="Paste links or describe reference examples."
                />
              </label>

              <div className="proposal-custom-scoping__grid-2">
                <label className="proposal-custom-scoping__field">
                  <span className="proposal-custom-scoping__label">
                    Does the client have a specific budget in mind?
                  </span>
                  <textarea
                    className="roadmap-input proposal-custom-scoping__textarea"
                    rows={3}
                    value={form.budget}
                    onChange={(e) => patchForm("budget", e.target.value)}
                    placeholder="Amount, range, or “not discussed”."
                  />
                </label>
                <label className="proposal-custom-scoping__field">
                  <span className="proposal-custom-scoping__label">
                    Specific deadline or dates (e.g. tradeshow)?
                  </span>
                  <textarea
                    className="roadmap-input proposal-custom-scoping__textarea"
                    rows={3}
                    value={form.deadline}
                    onChange={(e) => patchForm("deadline", e.target.value)}
                    placeholder="Hard dates, events, or soft timing."
                  />
                </label>
              </div>

              <label className="proposal-custom-scoping__field">
                <span className="proposal-custom-scoping__label">
                  Client expectations or assumptions we should know?
                </span>
                <textarea
                  className="roadmap-input proposal-custom-scoping__textarea"
                  rows={3}
                  value={form.expectations}
                  onChange={(e) => patchForm("expectations", e.target.value)}
                  placeholder='e.g. “We talked about using HubDB to build this.”'
                />
              </label>

              <label className="proposal-custom-scoping__field">
                <span className="proposal-custom-scoping__label">Any other notes?</span>
                <textarea
                  className="roadmap-input proposal-custom-scoping__textarea"
                  rows={3}
                  value={form.otherNotes}
                  onChange={(e) => patchForm("otherNotes", e.target.value)}
                  placeholder="Anything else that helps scoping."
                />
              </label>

              {error ? (
                <p className="proposal-custom-scoping__error" role="alert">
                  {error}
                </p>
              ) : null}

              <div className="proposal-custom-scoping__form-actions">
                {editingId || (value.requests.length > 0 && addAnother) ? (
                  <button
                    type="button"
                    className="roadmap-btn roadmap-btn--ghost"
                    onClick={() => {
                      if (editingId) cancelEdit();
                      else setAddAnotherChoice(false);
                    }}
                  >
                    {editingId ? "Cancel edit" : "Cancel"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="roadmap-btn roadmap-btn--primary"
                  onClick={submitForm}
                >
                  {editingId
                    ? "Save changes to proposal"
                    : "Add Custom Scoping Request to Proposal"}
                </button>
              </div>
            </div>
          </section>
          ) : null}
        </>
      )}
    </div>
  );
}
