type Props = {
  isDirty: boolean;
  saving: boolean;
  onSave: () => void;
};

export function ProposalSaveReminderBanner({ isDirty, saving, onSave }: Props) {
  return (
    <div
      className={`proposal-save-banner${isDirty ? " proposal-save-banner--dirty" : ""}`}
      role="status"
      aria-live="polite"
    >
      <div className="proposal-save-banner__icon" aria-hidden>
        {isDirty ? "!" : "i"}
      </div>
      <div className="proposal-save-banner__copy">
        <strong className="proposal-save-banner__title">
          {isDirty ? "Unsaved changes" : "Save before you leave"}
        </strong>
        <p className="proposal-save-banner__text">
          {isDirty
            ? "Save your proposal before navigating to Solutions, Admin, or other pages — unsaved work will be lost."
            : "Use Save proposal at the bottom of each step before switching pages if you make more edits."}
        </p>
      </div>
      {isDirty ? (
        <button
          type="button"
          className="roadmap-btn roadmap-btn--primary proposal-save-banner__save"
          disabled={saving}
          onClick={onSave}
        >
          {saving ? "Saving…" : "Save now"}
        </button>
      ) : null}
    </div>
  );
}
