import type { SolutionTier, TierResourceExampleRow } from "../types";

export function emptyResourceExampleRow(): TierResourceExampleRow {
  return { example: "", date: "" };
}

/** Parse DB jsonb / API value into example rows. */
export function parseTierResourceExamplesFromDb(raw: unknown): TierResourceExampleRow[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.map((item) => {
      if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        return {
          example: typeof o.example === "string" ? o.example : "",
          date: typeof o.date === "string" ? o.date : "",
        };
      }
      return emptyResourceExampleRow();
    });
  }
  return [];
}

export function normalizedResourceExamplesForDb(rows: TierResourceExampleRow[]): TierResourceExampleRow[] | null {
  const out = rows
    .map((r) => ({
      example: r.example.trim(),
      date: r.date.trim(),
    }))
    .filter((r) => r.example !== "" || r.date !== "");
  return out.length ? out : null;
}

/** Single resources blob (legacy column + package `tier_overrides.solution_tier_resources`). */
export function effectiveResourceLegacyBlob(t: SolutionTier): string {
  return t.solution_tier_resources?.trim() ?? "";
}

/** Templates for display: vault `solution_tier_resource_templates`, else legacy/package blob (`solution_tier_resources`). */
export function effectiveResourceTemplates(t: SolutionTier): string {
  const tmpl = t.solution_tier_resource_templates?.trim();
  if (tmpl) return tmpl;
  return effectiveResourceLegacyBlob(t);
}

/** Canonical display string for Templates (package override blob overrides vault templates-only content). */
export function tierTemplatesForProposalDisplay(t: SolutionTier): string {
  const blob = effectiveResourceLegacyBlob(t);
  if (blob) return blob;
  return t.solution_tier_resource_templates?.trim() ?? "";
}

export function effectiveResourceTools(t: SolutionTier): string {
  return t.solution_tier_resource_tools?.trim() ?? "";
}

export function effectiveResourceExamples(t: SolutionTier): TierResourceExampleRow[] {
  const parsed = parseTierResourceExamplesFromDb(t.solution_tier_resource_examples ?? null);
  return parsed.length ? parsed : [];
}

/** Hydrate Solutions Builder tier form (prefer structured templates column over legacy blob). */
export function hydrateTierResourceEditorState(t: SolutionTier): {
  templates: string;
  tools: string;
  examples: TierResourceExampleRow[];
} {
  const structured = t.solution_tier_resource_templates?.trim();
  const legacy = t.solution_tier_resources?.trim();
  const templates = structured ?? legacy ?? "";
  const tools = effectiveResourceTools(t);
  let examples = effectiveResourceExamples(t);
  if (examples.length === 0) examples = [emptyResourceExampleRow()];
  return { templates, tools, examples };
}

export function resourceStructuredFieldsForSave(
  templates: string,
  tools: string,
  examples: TierResourceExampleRow[]
): Pick<
  SolutionTier,
  "solution_tier_resource_templates" | "solution_tier_resource_tools" | "solution_tier_resource_examples" | "solution_tier_resources"
> {
  const exNorm = normalizedResourceExamplesForDb(examples);
  return {
    solution_tier_resource_templates: templates.trim() ? templates : null,
    solution_tier_resource_tools: tools.trim() ? tools : null,
    solution_tier_resource_examples: exNorm,
    solution_tier_resources: null,
  };
}

/** Parse `solution_tier_resource_examples` during bulk CSV/Excel import (JSON string or array). */
export function parseTierResourceExamplesImportCell(raw: unknown): TierResourceExampleRow[] | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) return normalizedResourceExamplesForDb(parseTierResourceExamplesFromDb(raw));
  const s = String(raw).trim();
  if (!s) return null;
  try {
    const p = JSON.parse(s);
    return normalizedResourceExamplesForDb(parseTierResourceExamplesFromDb(p));
  } catch {
    return null;
  }
}

function normalizeStandaloneHeading(line: string): string {
  return line
    .replace(/\*+/g, "")
    .replace(/^#+\s*/, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Remove a first line that only repeats the read-only section title (e.g. **Templates:**),
 * so the UI heading is not duplicated.
 */
export function stripRedundantResourceMarkdownHeading(body: string, kind: "templates" | "tools"): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  const lines = trimmed.split(/\r?\n/);
  const first = normalizeStandaloneHeading(lines[0] ?? "");
  const redundant =
    kind === "templates"
      ? first === "templates:" || first === "template:"
      : first === "tools:" || first === "tool:";
  if (!redundant) return trimmed;
  return lines.slice(1).join("\n").trim();
}

/** Non-empty Templates, Tools, Examples, or legacy blob — for Resources section visibility. */
export function tierHasAnyResourceSectionContent(t: SolutionTier): boolean {
  const tmpl = t.solution_tier_resource_templates?.trim();
  if (tmpl) return true;
  if (effectiveResourceLegacyBlob(t)) return true;
  if (t.solution_tier_resource_tools?.trim()) return true;
  const ex = effectiveResourceExamples(t);
  if (ex.some((r) => r.example.trim() || r.date.trim())) return true;
  return false;
}
