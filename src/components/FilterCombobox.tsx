import {
  useEffect,
  useId,
  useRef,
  type CSSProperties,
} from "react";

export type FilterComboOption = {
  value: string;
  label: string;
  hint?: string;
};

type Props = {
  label: string;
  labelStyle?: CSSProperties;
  inputStyle?: CSSProperties;
  placeholder?: string;
  inputValue: string;
  onInputChange: (v: string) => void;
  options: FilterComboOption[];
  onOptionSelect: (value: string) => void;
  disabled?: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

export function FilterCombobox({
  label,
  labelStyle,
  inputStyle,
  placeholder = "Type to narrow…",
  inputValue,
  onInputChange,
  options,
  onOptionSelect,
  disabled,
  isOpen,
  onOpenChange,
}: Props) {
  const uid = useId();
  const listId = `${uid}-list`;
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handle(e: MouseEvent) {
      if (wrapRef.current?.contains(e.target as Node)) return;
      onOpenChange(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [isOpen, onOpenChange]);

  return (
    <div ref={wrapRef} className="filter-combobox kb-filter-field">
      <label style={labelStyle}>
        {label}
        <input
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listId}
          aria-autocomplete="list"
          disabled={disabled}
          className="kb-filter-input filter-combobox__input"
          style={inputStyle}
          value={inputValue}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(e) => {
            onInputChange(e.target.value);
            onOpenChange(true);
          }}
          onFocus={() => onOpenChange(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onOpenChange(false);
          }}
        />
      </label>
      {isOpen && !disabled && (
        <ul
          id={listId}
          role="listbox"
          className="filter-combobox__list"
          aria-label={`${label} options`}
        >
          {options.length === 0 ? (
            <li className="filter-combobox__empty" role="presentation">
              No matches
            </li>
          ) : (
            options.map((o) => (
              <li key={o.value} role="presentation">
                <button
                  type="button"
                  role="option"
                  className="filter-combobox__option"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onOptionSelect(o.value);
                    onOpenChange(false);
                  }}
                >
                  <span className="filter-combobox__option-label">{o.label}</span>
                  {o.hint ? (
                    <span className="filter-combobox__option-hint">{o.hint}</span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
