import { useEffect, useId, useState } from "react";
import {
  isValidOfferingDateRange,
  offeringDatesFromProposalDefaults,
  proposalDateRangeLabel,
  type ProposalOfferingDates,
} from "../../lib/proposalDates";

type Props = {
  open: boolean;
  title: string;
  subtitle?: string;
  itemLabel?: string;
  proposalStartDate: string;
  proposalEndDate: string;
  onCancel: () => void;
  onConfirm: (dates: ProposalOfferingDates) => void;
};

export function ProposalOfferingDatesModal({
  open,
  title,
  subtitle,
  itemLabel,
  proposalStartDate,
  proposalEndDate,
  onCancel,
  onConfirm,
}: Props) {
  const startFieldId = useId();
  const endFieldId = useId();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  useEffect(() => {
    if (!open) return;
    const defaults = offeringDatesFromProposalDefaults(proposalStartDate, proposalEndDate);
    setStartDate(defaults.startDate);
    setEndDate(defaults.endDate);
  }, [open, proposalEndDate, proposalStartDate]);

  if (!open) return null;

  const dates: ProposalOfferingDates = { startDate, endDate };
  const rangeInvalid = !isValidOfferingDateRange(dates);
  const preview = proposalDateRangeLabel(startDate, endDate);

  return (
    <div
      className="roadmap-modal-backdrop proposal-travel-modal-backdrop"
      role="presentation"
      onClick={onCancel}
    >
      <div
        className="roadmap-modal proposal-travel-modal proposal-offering-dates-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="proposal-offering-dates-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="proposal-travel-modal__close"
          aria-label="Close"
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

        <header className="proposal-travel-modal__head">
          <div className="proposal-travel-modal__icon" aria-hidden>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" strokeWidth="1.75" />
              <path d="M8 3v4M16 3v4M4 10h16" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          </div>
          <div className="proposal-travel-modal__head-copy">
            <p className="proposal-travel-modal__eyebrow">Schedule</p>
            <h2 id="proposal-offering-dates-title" className="proposal-travel-modal__title">
              {title}
            </h2>
            {subtitle ? <p className="proposal-travel-modal__subtitle">{subtitle}</p> : null}
            {itemLabel ? (
              <p className="proposal-offering-dates-modal__item">
                Adding <strong>{itemLabel}</strong>
              </p>
            ) : null}
          </div>
        </header>

        <div className="proposal-travel-modal__body">
          <label className="proposal-travel-modal__field" htmlFor={startFieldId}>
            <span className="proposal-travel-modal__field-label">Start date</span>
            <input
              id={startFieldId}
              type="date"
              className="roadmap-input proposal-offering-dates-modal__date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              autoFocus
            />
          </label>

          <label className="proposal-travel-modal__field" htmlFor={endFieldId}>
            <span className="proposal-travel-modal__field-label">End date</span>
            <input
              id={endFieldId}
              type="date"
              className="roadmap-input proposal-offering-dates-modal__date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !rangeInvalid) onConfirm(dates);
                if (e.key === "Escape") onCancel();
              }}
            />
          </label>

          {preview !== "—" ? (
            <p className="proposal-offering-dates-modal__preview" role="status">
              {preview}
            </p>
          ) : null}

          {rangeInvalid ? (
            <p className="proposal-offering-dates-modal__warn" role="alert">
              End date must be on or after the start date.
            </p>
          ) : null}
        </div>

        <footer className="roadmap-modal__actions proposal-travel-modal__actions">
          <button type="button" className="roadmap-btn roadmap-btn--ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="roadmap-btn roadmap-btn--primary"
            disabled={rangeInvalid}
            onClick={() => onConfirm(dates)}
          >
            Add to proposal
          </button>
        </footer>
      </div>
    </div>
  );
}
