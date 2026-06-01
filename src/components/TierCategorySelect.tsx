import type { CSSProperties } from "react";
import { TierTaxonomySelect } from "./TierTaxonomySelect";
import { tierCategorySelectOptions } from "../lib/tierCategories";

type Props = {
  value: string;
  inputStyle: CSSProperties;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** When set, uses admin-managed list from Supabase instead of built-in defaults only. */
  options?: readonly string[];
};

export function TierCategorySelect({ value, inputStyle, onChange, disabled, options }: Props) {
  const canonical = options ?? tierCategorySelectOptions("");
  return (
    <TierTaxonomySelect
      value={value}
      options={canonical}
      placeholder="Select category…"
      ariaLabel="Tier category"
      inputStyle={inputStyle}
      onChange={onChange}
      disabled={disabled}
    />
  );
}
