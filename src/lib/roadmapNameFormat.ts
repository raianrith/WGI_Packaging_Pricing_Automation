import { normalizeIsoDateInput } from "./proposalDates";

/** Example: `CR Roadmap Jul–Oct 2026` */
export const ROADMAP_NAME_FORMAT_EXAMPLE = "CR Roadmap Jul–Oct 2026";

export const ROADMAP_NAME_FORMAT_HINT = "Format: [Client Code] [Project Name] [Mon–Mon YYYY]";

export const ROADMAP_NAME_CLIENT_CODE_TOOLTIP =
  "Client codes are standardized abbreviations — use the correct code, no variations, based on what's in the Account Assignments spreadsheet";

const ROADMAP_NAME_DATE_SUFFIX_RE =
  /\s+(?:[A-Za-z]{3,9}[-–][A-Za-z]{3,9}\s+\d{4}|[A-Za-z]{3,9}\s+\d{4}\s*[-–]\s*[A-Za-z]{3,9}\s+\d{4})$/;

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

export function inferClientCode(clientLabel: string, pastTitles: string[] = []): string {
  const label = clientLabel.trim();
  if (!label) return "";
  for (const title of pastTitles) {
    const m = title.trim().match(/^(\S+)\s+/);
    if (m?.[1] && m[1].length <= 6 && /[A-Za-z]/.test(m[1])) return m[1];
  }
  const words = label.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    const w = words[0]!;
    return (w.length <= 4 ? w : w.slice(0, 3)).toUpperCase();
  }
  return words
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 5);
}

export function generateRoadmapName(
  clientLabel: string,
  start: string | null | undefined,
  end: string | null | undefined,
  pastTitles: string[] = [],
  projectName = "Roadmap"
): string {
  const code = inferClientCode(clientLabel, pastTitles);
  const suffix = roadmapNameMonthRangeLabel(start, end);
  return [code, projectName.trim() || "Roadmap", suffix].filter(Boolean).join(" ");
}

const MONTH_TOKEN =
  "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";

/**
 * List/display title: keep the first complete date range and drop leftover
 * typed suffixes like `Nov-Feb 2 Nov-Feb 20 Nov-Feb 2027`.
 */
export function displayProposalTitle(raw: string): string {
  const untitled = "Untitled proposal";
  let t = raw.replace(/\s+/g, " ").trim();
  if (!t) return untitled;

  t = t
    .replace(
      new RegExp(
        String.raw`\s+(?:${MONTH_TOKEN})\s+\d{4}(?=\s+(?:${MONTH_TOKEN})[-–](?:${MONTH_TOKEN})\s+\d{4})`,
        "i"
      ),
      ""
    )
    .trim();

  const fullRange = new RegExp(
    String.raw`^(.+?\b(?:${MONTH_TOKEN})\s+\d{4}\s*[-–]\s*(?:${MONTH_TOKEN})\s+\d{4})\b`,
    "i"
  );
  const full = t.match(fullRange);
  if (full?.[1]) return full[1].trim();

  const firstSuffix = new RegExp(
    String.raw`^(.+?\s+(?:${MONTH_TOKEN})[-–](?:${MONTH_TOKEN})\s+\d{4})\b`,
    "i"
  );
  const suffixed = t.match(firstSuffix);
  if (suffixed?.[1]) return suffixed[1].trim();

  const cleaned = t
    .replace(
      new RegExp(String.raw`(?:\s+(?:${MONTH_TOKEN})[-–](?:${MONTH_TOKEN})(?:\s+\d{1,3})?)+$`, "i"),
      ""
    )
    .trim();
  return cleaned || untitled;
}
