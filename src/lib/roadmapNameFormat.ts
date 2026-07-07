import { normalizeIsoDateInput } from "./proposalDates";

/** Example: `CR Roadmap Jul–Oct 2026` */
export const ROADMAP_NAME_FORMAT_EXAMPLE = "CR Roadmap Jul–Oct 2026";

export const ROADMAP_NAME_FORMAT_HINT = "Format: [Client Code] [Project Name] [Mon–Mon YYYY]";

export const ROADMAP_NAME_CLIENT_CODE_TOOLTIP =
  "Client codes are standardized abbreviations — use the correct code, no variations, based on what's in the Account Assignments spreadsheet";

const ROADMAP_NAME_DATE_SUFFIX_RE = /\s+[A-Za-z]{3,9}[-–][A-Za-z]{3,9}\s+\d{4}$/;

export const ROADMAP_NAME_FORMAT_RE = /^(\S+)\s+(.+?)\s+[A-Za-z]{3,9}[-–][A-Za-z]{3,9}\s+\d{4}$/;

function parseLocalDate(iso: string): Date | null {
  const t = normalizeIsoDateInput(iso);
  if (!t) return null;
  const d = new Date(`${t}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function monthToken(iso: string): string {
  const d = parseLocalDate(iso);
  if (!d) return "";
  return d.toLocaleDateString("en-US", { month: "short" });
}

/** Suffix only, e.g. `Jul–Oct 2026`. */
export function roadmapNameMonthRangeLabel(
  start: string | null | undefined,
  end: string | null | undefined
): string {
  const a = normalizeIsoDateInput(start);
  const b = normalizeIsoDateInput(end);
  if (!a || !b) return "";
  const endDate = parseLocalDate(b);
  if (!endDate) return "";
  const startMon = monthToken(a);
  const endMon = monthToken(b);
  if (!startMon || !endMon) return "";
  return `${startMon}–${endMon} ${endDate.getFullYear()}`;
}

export function stripRoadmapNameDateSuffix(title: string): string {
  return title.replace(ROADMAP_NAME_DATE_SUFFIX_RE, "").trimEnd();
}

export function applyRoadmapNameDateSuffix(
  title: string,
  start: string | null | undefined,
  end: string | null | undefined
): string {
  const suffix = roadmapNameMonthRangeLabel(start, end);
  if (!suffix) return title.trim();
  const base = stripRoadmapNameDateSuffix(title.trim());
  return base ? `${base} ${suffix}` : suffix;
}

export function isValidRoadmapNameFormat(title: string): boolean {
  return ROADMAP_NAME_FORMAT_RE.test(title.trim());
}
