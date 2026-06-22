import type { CSSProperties } from "react";
import { TierTaxonomySelect } from "./TierTaxonomySelect";
import { TIER_CATEGORY_OPTIONS, displayTierCategoryLabel, tierCategorySelectOptions } from "../lib/tierCategories";

type Props = {
  value: string;
  inputStyle: CSSProperties;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** When set, uses admin-managed list from Supabase instead of built-in defaults only. */
  options?: readonly string[];
};

export function TierCategorySelect({ value, inputStyle, onChange, disabled, options }: Props) {
  return (
    <TierTaxonomySelect
      value={value}
      options={options ?? TIER_CATEGORY_OPTIONS}
      buildMenuOptions={tierCategorySelectOptions}
      placeholder="Select category…"
      ariaLabel="Tier category"
      inputStyle={inputStyle}
      onChange={onChange}
      disabled={disabled}
      formatDisplay={displayTierCategoryLabel}
    />
  );
}
