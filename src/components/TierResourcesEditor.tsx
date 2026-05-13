import type { CSSProperties } from "react";
import { MarkdownTextarea } from "./MarkdownTextarea";
import type { TierResourceExampleRow } from "../types";

type Props = {
  templates: string;
  tools: string;
  examples: TierResourceExampleRow[];
  textareaStyle: CSSProperties;
  disabled?: boolean;
  onTemplates: (value: string) => void;
  onTools: (value: string) => void;
  onExamplesChange: (rows: TierResourceExampleRow[]) => void;
};

export default function TierResourcesEditor(props: Props) {
  const {
    templates,
    tools,
    examples,
    textareaStyle,
    disabled,
    onTemplates,
    onTools,
    onExamplesChange,
  } = props;

  function updRow(i: number, patch: Partial<TierResourceExampleRow>) {
    const next = examples.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    onExamplesChange(next);
  }

  function removeRow(i: number) {
    const next = examples.filter((_, idx) => idx !== i);
    onExamplesChange(next.length ? next : [{ example: "", date: "" }]);
  }

  function addRow() {
    onExamplesChange([...examples, { example: "", date: "" }]);
  }

  function dateInputValue(value: string) {
    const trimmed = value.trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : "";
  }

  return (
    <>
      <label style={{ display: "block", gridColumn: "1 / -1", marginBottom: "0.5rem" }}>
        <span className="admin-field-caption">Templates</span>
        <MarkdownTextarea value={templates} onChange={onTemplates} textareaStyle={textareaStyle} rows={5} disabled={disabled} />
      </label>

      <div style={{ gridColumn: "1 / -1" }} className="admin-example-editor">
        <div className="admin-field-caption" style={{ marginBottom: 6 }}>
          Examples with dates
        </div>
        <p className="admin-example-editor__hint" style={{ margin: "0 0 0.75rem", fontSize: "0.84rem", color: "var(--muted)" }}>
          One row per paired example and date (add rows as needed).
        </p>
        <div className="admin-example-editor__rows" style={{ display: "grid", gap: 14 }}>
          {examples.map((row, i) => (
            <div
              key={i}
              className="admin-example-editor__row"
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) auto",
                gap: "10px",
                alignItems: "flex-start",
              }}
            >
              <label style={{ display: "block" }} className="admin-example-editor__field">
                <span className="admin-field-caption">Example</span>
                <MarkdownTextarea
                  textareaStyle={textareaStyle}
                  rows={3}
                  value={row.example}
                  placeholder="Example"
                  disabled={disabled}
                  ariaLabel={`Resource example row ${i + 1}`}
                  onChange={(next) => updRow(i, { example: next })}
                />
              </label>
              <label style={{ display: "block" }} className="admin-example-editor__field">
                <span className="admin-field-caption">Example date</span>
                <div className="admin-example-editor__date-stack">
                  <div className="admin-example-editor__toolbar-spacer" aria-hidden="true" />
                  <input
                    type="date"
                    className="admin-example-editor__date-input"
                    style={textareaStyle}
                    value={dateInputValue(row.date)}
                    disabled={disabled}
                    aria-label={`Resource example date row ${i + 1}`}
                    title={
                      row.date.trim() && !dateInputValue(row.date)
                        ? `Existing non-date value: ${row.date}`
                        : "Pick example date"
                    }
                    onChange={(e) => updRow(i, { date: e.target.value })}
                  />
                </div>
              </label>
              <div style={{ alignSelf: "start" }} className="admin-example-editor__actions">
                <button
                  type="button"
                  className="admin-tier-resource-btn admin-tier-resource-btn--remove"
                  disabled={disabled}
                  aria-label={`Remove example row ${i + 1}`}
                  title="Remove row"
                  onClick={() => removeRow(i)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: "0.85rem" }} className="admin-example-editor__footer">
          <button
            type="button"
            className="admin-tier-resource-btn"
            disabled={disabled}
            onClick={addRow}
          >
            Add example
          </button>
        </div>
      </div>

      <label style={{ display: "block", gridColumn: "1 / -1", marginTop: "0.85rem" }}>
        <span className="admin-field-caption">Tools</span>
        <MarkdownTextarea value={tools} onChange={onTools} textareaStyle={textareaStyle} rows={5} disabled={disabled} />
      </label>
    </>
  );
}
