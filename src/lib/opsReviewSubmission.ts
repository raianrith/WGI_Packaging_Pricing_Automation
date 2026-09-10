export type OpsReviewDisplayMode = "proposal_total" | "section_totals";

export type OpsReviewSection = {
  id: string;
  name: string;
  notes: string;
};

export type OpsReviewSubmissionMeta = {
  projectOwner: string;
  /** Whether the client is Wisconsin-based. */
  wisconsinBasedClient: boolean | null;
  claudeChatSummary: string;
  displayMode: OpsReviewDisplayMode;
  sections: OpsReviewSection[];
};

export const OPS_REVIEW_CLAUDE_SUMMARY_PROMPT =
  "Briefly summarize each solution included in this proposal and the reasoning behind it.";

export function opsReviewDisplayModeLabel(mode: OpsReviewDisplayMode): string {
  if (mode === "section_totals") return "Section totals";
  return "Single proposal total";
}

export function wisconsinBasedClientLabel(value: boolean | null | undefined): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "—";
}

export function newOpsReviewSectionId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `section-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyOpsReviewSection(): OpsReviewSection {
  return { id: newOpsReviewSectionId(), name: "", notes: "" };
}

export function isOpsReviewDisplayMode(value: unknown): value is OpsReviewDisplayMode {
  return value === "proposal_total" || value === "section_totals";
}

function parseWisconsinBasedClient(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === "yes" || value === "true" || value === "Yes") return true;
  if (value === "no" || value === "false" || value === "No") return false;
  return null;
}

export function parseOpsReviewSubmissionMeta(raw: unknown): OpsReviewSubmissionMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const projectOwner = typeof o.projectOwner === "string" ? o.projectOwner.trim() : "";
  const wisconsinBasedClient = parseWisconsinBasedClient(o.wisconsinBasedClient);
  const claudeChatSummary =
    typeof o.claudeChatSummary === "string" ? o.claudeChatSummary.trim() : "";
  if (!isOpsReviewDisplayMode(o.displayMode)) return null;
  const sectionsRaw = Array.isArray(o.sections) ? o.sections : [];
  const sections: OpsReviewSection[] = sectionsRaw
    .map((s) => {
      if (!s || typeof s !== "object") return null;
      const row = s as Record<string, unknown>;
      const id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : newOpsReviewSectionId();
      const name = typeof row.name === "string" ? row.name : "";
      const notes = typeof row.notes === "string" ? row.notes : "";
      return { id, name, notes };
    })
    .filter((s): s is OpsReviewSection => s != null);
  return {
    projectOwner,
    wisconsinBasedClient,
    claudeChatSummary,
    displayMode: o.displayMode,
    sections:
      o.displayMode === "section_totals"
        ? sections.length > 0
          ? sections
          : [emptyOpsReviewSection()]
        : sections,
  };
}

export type OpsReviewFormValidation = {
  ok: boolean;
  error?: string;
};

export function validateOpsReviewSubmission(
  meta: OpsReviewSubmissionMeta
): OpsReviewFormValidation {
  if (!meta.projectOwner.trim()) {
    return { ok: false, error: "Please add the project owner." };
  }
  if (meta.wisconsinBasedClient !== true && meta.wisconsinBasedClient !== false) {
    return { ok: false, error: "Please indicate whether this is a Wisconsin-based client." };
  }
  if (!meta.claudeChatSummary.trim()) {
    return { ok: false, error: "Please include a Claude conversation summary." };
  }
  if (!isOpsReviewDisplayMode(meta.displayMode)) {
    return { ok: false, error: "Please choose how the proposal should appear for the client." };
  }
  if (meta.displayMode === "section_totals") {
    if (meta.sections.length === 0) {
      return { ok: false, error: "Add at least one section for section totals." };
    }
    for (let i = 0; i < meta.sections.length; i++) {
      if (!meta.sections[i].name.trim()) {
        return { ok: false, error: `Please name section ${i + 1}.` };
      }
    }
  }
  return { ok: true };
}

export function normalizeOpsReviewSubmission(
  meta: OpsReviewSubmissionMeta
): OpsReviewSubmissionMeta {
  return {
    projectOwner: meta.projectOwner.trim(),
    wisconsinBasedClient:
      meta.wisconsinBasedClient === true || meta.wisconsinBasedClient === false
        ? meta.wisconsinBasedClient
        : null,
    claudeChatSummary: meta.claudeChatSummary.trim(),
    displayMode: meta.displayMode,
    sections:
      meta.displayMode === "section_totals"
        ? meta.sections.map((s) => ({
            id: s.id || newOpsReviewSectionId(),
            name: s.name.trim(),
            notes: s.notes.trim(),
          }))
        : [],
  };
}
