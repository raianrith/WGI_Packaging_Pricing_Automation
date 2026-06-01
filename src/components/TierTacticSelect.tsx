import type { CSSProperties } from "react";
import { TierTaxonomySelect } from "./TierTaxonomySelect";
import { TIER_TACTIC_FALLBACK } from "../lib/tierTaxonomy";

type Props = {
  value: string;
  inputStyle: CSSProperties;
  onChange: (value: string) => void;
  disabled?: boolean;
  options?: readonly string[];
};

export function TierTacticSelect({ value, inputStyle, onChange, disabled, options }: Props) {
  return (
    <TierTaxonomySelect
      value={value}
      options={options ?? TIER_TACTIC_FALLBACK}
      placeholder="Select tactic…"
      ariaLabel="Tier tactic"
      inputStyle={inputStyle}
      onChange={onChange}
      disabled={disabled}
    />
  );
}
