import type { CSSProperties, ReactNode } from "react";
import type { PackageTierOverrideKey } from "../lib/packageTierOverrides";
import { MarkdownTextarea } from "./MarkdownTextarea";

const formSubHeading: CSSProperties = {
  margin: "1rem 0 0.45rem",
  fontSize: "0.82rem",
  fontWeight: 650,
  color: "var(--muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

export type SolutionTierFormUpdateBlockStyles = {
  lbl: CSSProperties;
  input: CSSProperties;
  textarea: CSSProperties;
  formGrid: CSSProperties;
};

type Props = {
  tierIdReadonly: string;
  values: Partial<Record<PackageTierOverrideKey, string>>;
  onChange: (key: PackageTierOverrideKey, value: string) => void;
  autofillBlock: ReactNode;
  styles: SolutionTierFormUpdateBlockStyles;
};

/** Same field layout as Solutions Builder → Update → tier form (vault tier editor). Used for package-tier overrides. */
export function SolutionTierFormUpdateBlock({ tierIdReadonly, values, onChange, autofillBlock, styles: s }: Props) {
  const { lbl, input, textarea, formGrid } = s;
  const v = (k: PackageTierOverrideKey) => values[k] ?? "";

  return (
    <div className="admin-form-stack" style={formGrid}>
      <label style={lbl}>
        <span className="admin-field-caption">Tier id</span>
        <input style={input} readOnly tabIndex={-1} value={tierIdReadonly} title="Vault tier id (read-only in package context)" />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <span className="admin-field-caption">Tier name</span>
        <input style={input} value={v("solution_tier_name")} onChange={(e) => onChange("solution_tier_name", e.target.value)} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <span className="admin-field-caption">Owner</span>
        <input style={input} value={v("solution_tier_owner")} onChange={(e) => onChange("solution_tier_owner", e.target.value)} />
      </label>
      {autofillBlock}

      <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Description</h4>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <span className="admin-field-caption">What is it</span>
        <MarkdownTextarea value={v("solution_tier_what_is_it")} onChange={(x) => onChange("solution_tier_what_is_it", x)} textareaStyle={textarea} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <span className="admin-field-caption">Why is it valuable</span>
        <MarkdownTextarea
          value={v("solution_tier_why_is_it_valuable")}
          onChange={(x) => onChange("solution_tier_why_is_it_valuable", x)}
          textareaStyle={textarea}
        />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <span className="admin-field-caption">When should it be used</span>
        <MarkdownTextarea
          value={v("solution_tier_when_should_it_be_used")}
          onChange={(x) => onChange("solution_tier_when_should_it_be_used", x)}
          textareaStyle={textarea}
        />
      </label>

      <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Scope</h4>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <span className="admin-field-caption">What assumptions or prerequisites must be in place</span>
        <MarkdownTextarea
          value={v("solution_tier_assumption_prerequisites")}
          onChange={(x) => onChange("solution_tier_assumption_prerequisites", x)}
          textareaStyle={textarea}
        />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <span className="admin-field-caption">What is included in scope</span>
        <MarkdownTextarea value={v("solution_tier_in_scope")} onChange={(x) => onChange("solution_tier_in_scope", x)} textareaStyle={textarea} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <span className="admin-field-caption">What is not included in scope</span>
        <MarkdownTextarea value={v("solution_tier_out_of_scope")} onChange={(x) => onChange("solution_tier_out_of_scope", x)} textareaStyle={textarea} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <span className="admin-field-caption">What is the final deliverable</span>
        <MarkdownTextarea
          value={v("solution_tier_final_deliverable")}
          onChange={(x) => onChange("solution_tier_final_deliverable", x)}
          textareaStyle={textarea}
        />
      </label>

      <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Process</h4>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <span className="admin-field-caption">How do we get this work done</span>
        <MarkdownTextarea
          value={v("solution_tier_how_do_we_get_this_work_done")}
          onChange={(x) => onChange("solution_tier_how_do_we_get_this_work_done", x)}
          textareaStyle={textarea}
        />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <span className="admin-field-caption">SOP</span>
        <MarkdownTextarea value={v("solution_tier_sop")} onChange={(x) => onChange("solution_tier_sop", x)} textareaStyle={textarea} />
      </label>

      <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Selling</h4>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <span className="admin-field-caption">How can this solution be described to the client</span>
        <MarkdownTextarea
          value={v("solution_tier_described_to_client")}
          onChange={(x) => onChange("solution_tier_described_to_client", x)}
          textareaStyle={textarea}
        />
      </label>

      <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Resources</h4>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <span className="admin-field-caption">Resources</span>
        <MarkdownTextarea value={v("solution_tier_resources")} onChange={(x) => onChange("solution_tier_resources", x)} textareaStyle={textarea} />
      </label>
    </div>
  );
}
