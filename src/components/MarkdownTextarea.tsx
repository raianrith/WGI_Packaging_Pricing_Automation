import { useCallback, useRef, type CSSProperties } from "react";

export type MarkdownTextareaProps = {
  value: string;
  onChange: (next: string) => void;
  textareaStyle: CSSProperties;
  rows?: number;
};

export function MarkdownTextarea({ value, onChange, textareaStyle, rows = 2 }: MarkdownTextareaProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const setNext = useCallback(
    (next: string, nextStart?: number, nextEnd?: number) => {
      onChange(next);
      window.setTimeout(() => {
        const el = ref.current;
        if (!el) return;
        el.focus();
        if (typeof nextStart === "number" && typeof nextEnd === "number") {
          el.setSelectionRange(nextStart, nextEnd);
        }
      }, 0);
    },
    [onChange]
  );

  const wrapSelection = useCallback(
    (before: string, after: string, fallback = "text") => {
      const el = ref.current;
      if (!el) return;
      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? start;
      const selected = value.slice(start, end);
      const content = selected || fallback;
      const next = `${value.slice(0, start)}${before}${content}${after}${value.slice(end)}`;
      const caretStart = start + before.length;
      const caretEnd = caretStart + content.length;
      setNext(next, caretStart, caretEnd);
    },
    [setNext, value]
  );

  const prefixSelectedLines = useCallback(
    (prefix: string) => {
      const el = ref.current;
      if (!el) return;
      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? start;
      const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
      const lineEndRaw = value.indexOf("\n", end);
      const lineEnd = lineEndRaw === -1 ? value.length : lineEndRaw;
      const selectedBlock = value.slice(lineStart, lineEnd);
      const nextBlock = selectedBlock
        .split("\n")
        .map((line) => (line.trim().length === 0 ? line : `${prefix}${line}`))
        .join("\n");
      const next = `${value.slice(0, lineStart)}${nextBlock}${value.slice(lineEnd)}`;
      setNext(next, lineStart, lineStart + nextBlock.length);
    },
    [setNext, value]
  );

  return (
    <div className="admin-md-field">
      <div className="admin-md-toolbar" role="toolbar" aria-label="Formatting">
        <button type="button" className="admin-md-toolbar__btn" onClick={() => wrapSelection("**", "**", "bold text")}>
          Bold
        </button>
        <button type="button" className="admin-md-toolbar__btn" onClick={() => wrapSelection("*", "*", "italic text")}>
          Italic
        </button>
        <button type="button" className="admin-md-toolbar__btn" onClick={() => prefixSelectedLines("- ")}>
          Bullet list
        </button>
        <button
          type="button"
          className="admin-md-toolbar__btn"
          onClick={() => wrapSelection("[", "](https://example.com)", "link text")}
        >
          Link
        </button>
      </div>
      <textarea ref={ref} style={textareaStyle} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
