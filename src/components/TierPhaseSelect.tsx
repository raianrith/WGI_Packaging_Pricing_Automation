import type { CSSProperties } from "react";
import { TierTaxonomySelect } from "./TierTaxonomySelect";
import { TIER_PHASE_FALLBACK, tierPhaseSelectOptions } from "../lib/tierTaxonomy";

type Props = {
  value: string;
  inputStyle: CSSProperties;
  onChange: (value: string) => void;
  disabled?: boolean;
  options?: readonly string[];
};

export function TierPhaseSelect({ value, inputStyle, onChange, disabled, options }: Props) {
  return (
    <TierTaxonomySelect
      value={value}
      options={options ?? TIER_PHASE_FALLBACK}
      buildMenuOptions={tierPhaseSelectOptions}
      placeholder="Select phase…"
      ariaLabel="Tier phase"
      inputStyle={inputStyle}
      onChange={onChange}
      disabled={disabled}
    />
  );
}
