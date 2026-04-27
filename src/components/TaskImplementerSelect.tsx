import { useMemo } from "react";
import type { CSSProperties } from "react";

type Props = {
  value: string;
  options: string[];
  inputStyle: CSSProperties;
  onChange: (value: string) => void;
  disabled?: boolean;
};

/**
 * Dropdown of known implementer labels; keeps current value visible even if not in `options`.
 */
export function TaskImplementerSelect({ value, options, inputStyle, onChange, disabled }: Props) {
  const merged = useMemo(() => {
    const s = new Set(options);
    const out = [...options];
    if (value.trim() && !s.has(value)) out.push(value);
    return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [options, value]);
  return (
    <select style={inputStyle} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      <option value="">—</option>
      {merged.map((x) => (
        <option key={x} value={x}>
          {x}
        </option>
      ))}
    </select>
  );
}
