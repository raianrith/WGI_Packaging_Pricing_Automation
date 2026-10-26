import type { Ref } from "react";

type Props = {
  id: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  inputRef?: Ref<HTMLInputElement>;
};

export function ProposalClientPicker({ id, value, options, onChange, inputRef }: Props) {
  const listId = `${id}-list`;
  return (
    <label className="roadmap-field">
      <span className="roadmap-field__cap">Client</span>
      <input
        id={id}
        ref={inputRef}
        className="roadmap-input"
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search Productive clients…"
        autoComplete="off"
      />
      <datalist id={listId}>
        {options.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <p className="roadmap-muted roadmap-field__note">
        Use the exact client name as it appears in Productive. Recent clients appear as you type.
      </p>
    </label>
  );
}
