import type { CSSProperties } from "react";
import { MarkdownTextarea } from "./MarkdownTextarea";

const formSubHeading: CSSProperties = {
  margin: "1rem 0 0.45rem",
  fontSize: "0.82rem",
  fontWeight: 650,
  color: "var(--muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

export type PackageDetailFieldKey =
  | "package_category"
  | "package_owner"
  | "package_overview"
  | "package_overview_link"
  | "package_direction"
  | "package_what_is_it"
  | "package_why_is_it_valuable"
  | "package_when_should_it_be_used"
  | "package_assumption_prerequisites"
  | "package_in_scope"
  | "package_out_of_scope"
  | "package_final_deliverable"
  | "package_how_do_we_get_this_work_done"
  | "package_sop"
  | "package_resources"
  | "package_resource_templates"
  | "package_resource_tools";

export type PackageDetailsFormBlockStyles = {
  lbl: CSSProperties;
  input: CSSProperties;
  textarea: CSSProperties;
  formGrid: CSSProperties;
};

type Props = {
  packageIdReadonly?: string;
  values: Partial<Record<PackageDetailFieldKey, string>>;
  onChange: (key: PackageDetailFieldKey, value: string) => void;
  styles: PackageDetailsFormBlockStyles;
};

export function emptyPackageDetails(): Record<PackageDetailFieldKey, string> {
  const keys: PackageDetailFieldKey[] = [
    "package_category",
    "package_owner",
    "package_overview",
    "package_overview_link",
    "package_direction",
    "package_what_is_it",
    "package_why_is_it_valuable",
    "package_when_should_it_be_used",
    "package_assumption_prerequisites",
    "package_in_scope",
    "package_out_of_scope",
    "package_final_deliverable",
    "package_how_do_we_get_this_work_done",
    "package_sop",
    "package_resources",
    "package_resource_templates",
    "package_resource_tools",
  ];
  return Object.fromEntries(keys.map((k) => [k, ""])) as Record<PackageDetailFieldKey, string>;
}

export function packageRowToDetailsValues(
  p: import("../types").Package | null | undefined
): Record<PackageDetailFieldKey, string> {
  const e = emptyPackageDetails();
  if (!p) return e;
  for (const k of Object.keys(e) as PackageDetailFieldKey[]) {
    const v = p[k as keyof import("../types").Package];
    e[k] = typeof v === "string" && v ? v : "";
  }
  return e;
}

/** Same narrative layout as Solutions Builder tier form, stored on `packages` (not tier overlays). */
export function PackageDetailsFormBlock({ packageIdReadonly, values, onChange, styles: s }: Props) {
  const { lbl, input, textarea, formGrid } = s;
  const v = (k: PackageDetailFieldKey) => values[k] ?? "";

  return (
    <div className="admin-form-stack" style={formGrid}>
      {packageIdReadonly != null ? (
        <label style={lbl}>
          <span className="admin-field-caption">Package id</span>
          <input style={input} readOnly tabIndex={-1} value={packageIdReadonly} />
        </label>
      ) : null}
      <label style={lbl}>
        <span className="admin-field-caption">Package category</span>
        <input style={input} value={v("package_category")} onChange={(e) => onChange("package_category", e.target.value)} />
      </label>
      <label style={lbl}>
        <span className="admin-field-caption">Package owner</span>
        <input style={input} value={v("package_owner")} onChange={(e) => onChange("package_owner", e.target.value)} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <span className="admin-field-caption">Overview</span>
        <MarkdownTextarea value={v("package_overview")} onChange={(x) => onChange("package_overview", x)} textareaStyle={textarea} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <span className="admin-field-caption">Overview link</span>
        <input
          style={input}
          value={v("package_overview_link")}
          onChange={(e) => onChange("package_overview_link", e.target.value)}
        />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <span className="admin-field-caption">Direction</span>
        <MarkdownTextarea value={v("package_direction")} onChange={(x) => onChange("package_direction", x)} textareaStyle={textarea} />
      </label>

      <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Description</h4>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <span className="admin-field-caption">What is it</span>
        <MarkdownTextarea value={v("package_what_is_it")} onChange={(x) => onChange("package_what_is_it", x)} textareaStyle={textarea} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <span className="admin-field-caption">Why is it valuable</span>
        <MarkdownTextarea
          value={v("package_why_is_it_valuable")}
          onChange={(x) => onChange("package_why_is_it_valuable", x)}
          textareaStyle={textarea}
        />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <span className="admin-field-caption">When should it be used</span>
        <MarkdownTextarea
          value={v("package_when_should_it_be_used")}
          onChange={(x) => onChange("package_when_should_it_be_used", x)}
          textareaStyle={textarea}
        />
      </label>

      <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Scope</h4>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <span className="admin-field-caption">What assumptions or prerequisites must be in place</span>
        <MarkdownTextarea
          value={v("package_assumption_prerequisites")}
          onChange={(x) => onChange("package_assumption_prerequisites", x)}
          textareaStyle={textarea}
        />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <span className="admin-field-caption">What is included in scope</span>
        <MarkdownTextarea value={v("package_in_scope")} onChange={(x) => onChange("package_in_scope", x)} textareaStyle={textarea} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <span className="admin-field-caption">What is not included in scope</span>
        <MarkdownTextarea value={v("package_out_of_scope")} onChange={(x) => onChange("package_out_of_scope", x)} textareaStyle={textarea} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <span className="admin-field-caption">What is the final deliverable</span>
        <MarkdownTextarea
          value={v("package_final_deliverable")}
          onChange={(x) => onChange("package_final_deliverable", x)}
          textareaStyle={textarea}
        />
      </label>

      <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Process</h4>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <span className="admin-field-caption">How do we get this work done</span>
        <MarkdownTextarea
          value={v("package_how_do_we_get_this_work_done")}
          onChange={(x) => onChange("package_how_do_we_get_this_work_done", x)}
          textareaStyle={textarea}
        />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <span className="admin-field-caption">SOP</span>
        <MarkdownTextarea value={v("package_sop")} onChange={(x) => onChange("package_sop", x)} textareaStyle={textarea} />
      </label>

      <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Resources</h4>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <span className="admin-field-caption">Templates</span>
        <MarkdownTextarea
          value={v("package_resource_templates")}
          onChange={(x) => onChange("package_resource_templates", x)}
          textareaStyle={textarea}
        />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <span className="admin-field-caption">Tools</span>
        <MarkdownTextarea
          value={v("package_resource_tools")}
          onChange={(x) => onChange("package_resource_tools", x)}
          textareaStyle={textarea}
        />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <span className="admin-field-caption">Resources</span>
        <MarkdownTextarea
          value={v("package_resources")}
          onChange={(x) => onChange("package_resources", x)}
          textareaStyle={textarea}
        />
      </label>
    </div>
  );
}
