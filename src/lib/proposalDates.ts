/** ISO calendar date `YYYY-MM-DD` for proposal / offering scheduling. */
export type ProposalOfferingDates = {
  startDate: string;
  endDate: string;
};

export function emptyOfferingDates(): ProposalOfferingDates {
  return { startDate: "", endDate: "" };
}

export function normalizeIsoDateInput(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const t = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return "";
  const d = new Date(`${t}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return t;
}

function parseLocalDate(iso: string): Date | null {
  const t = normalizeIsoDateInput(iso);
  if (!t) return null;
  const d = new Date(`${t}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatProposalDisplayDate(iso: string | null | undefined): string {
  const d = parseLocalDate(iso ?? "");
  if (!d) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Human label for a date range, e.g. "Jan 1, 2026 – Mar 31, 2026". */
export function proposalDateRangeLabel(
  start: string | null | undefined,
  end: string | null | undefined
): string {
  const a = normalizeIsoDateInput(start);
  const b = normalizeIsoDateInput(end);
  if (!a && !b) return "—";
  if (a && b) {
    const da = parseLocalDate(a)!;
    const db = parseLocalDate(b)!;
    const sameYear = da.getFullYear() === db.getFullYear();
    const startFmt = da.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: sameYear ? undefined : "numeric",
    });
    const endFmt = db.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    return `${startFmt} – ${endFmt}`;
  }
  return formatProposalDisplayDate(a || b);
}

export function offeringDatesFromProposalDefaults(
  proposalStart: string,
  proposalEnd: string
): ProposalOfferingDates {
  return {
    startDate: normalizeIsoDateInput(proposalStart),
    endDate: normalizeIsoDateInput(proposalEnd),
  };
}

export function isValidOfferingDateRange(dates: ProposalOfferingDates): boolean {
  const a = normalizeIsoDateInput(dates.startDate);
  const b = normalizeIsoDateInput(dates.endDate);
  if (!a || !b) return true;
  return a <= b;
}
