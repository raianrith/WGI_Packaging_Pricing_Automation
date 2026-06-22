import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { tierTaxonomySelectOptions } from "../lib/tierTaxonomy";

type Props = {
  value: string;
  options: readonly string[];
  placeholder: string;
  ariaLabel: string;
  inputStyle: CSSProperties;
  onChange: (value: string) => void;
  disabled?: boolean;
  buildMenuOptions?: (value: string, canonical: readonly string[]) => string[];
  formatDisplay?: (label: string) => string;
};

export function TierTaxonomySelect({
  value,
  options,
  placeholder,
  ariaLabel,
  inputStyle,
  onChange,
  disabled,
  buildMenuOptions,
  formatDisplay,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const menuOptions = (buildMenuOptions ?? tierTaxonomySelectOptions)(value, options);
  const format = formatDisplay ?? ((label: string) => label);
  const display = value.trim() ? format(value) : placeholder;

  useEffect(() => {
    if (!open) return;
    function handlePointer(e: MouseEvent) {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handlePointer);
    return () => document.removeEventListener("mousedown", handlePointer);
  }, [open]);

  useEffect(() => {
    if (!disabled) return;
    setOpen(false);
  }, [disabled]);

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="tier-category-select">
      <button
        type="button"
        className="tier-category-select__trigger"
        style={inputStyle}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className={`tier-category-select__value${value.trim() ? "" : " is-placeholder"}`}>
          {display}
        </span>
        <span className="tier-category-select__chevron" aria-hidden />
      </button>
      {open && !disabled ? (
        <ul id={listId} className="tier-category-select__menu" role="listbox" aria-label={ariaLabel}>
          <li role="presentation">
            <button
              type="button"
              role="option"
              aria-selected={!value.trim()}
              className={`tier-category-select__option${!value.trim() ? " is-selected" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick("")}
            >
              {placeholder}
            </button>
          </li>
          {menuOptions.map((label) => {
            const selected = value === label;
            return (
              <li key={label} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`tier-category-select__option${selected ? " is-selected" : ""}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(label)}
                >
                  {format(label)}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
