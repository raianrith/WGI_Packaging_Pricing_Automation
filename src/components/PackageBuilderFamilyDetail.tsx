import type { PackageBuilderSlotTemplate } from "../types";
import { PACKAGE_SLOT_NARRATIVE_KEYS, packageNarrativeFromSlot } from "../lib/packageSlotNarrative";
import { slotLimitSummary } from "../lib/packageBuilderSlots";
import { PackageNarrativeSections } from "./PackageNarrativeSections";

function slotHasNarrative(slot: PackageBuilderSlotTemplate): boolean {
  return PACKAGE_SLOT_NARRATIVE_KEYS.some((k) => Boolean(slot[k]?.trim()));
}

type Props = {
  slots: PackageBuilderSlotTemplate[];
};

export function PackageBuilderFamilyDetail({ slots }: Props) {
  if (slots.length === 0) {
    return (
      <p className="agency-pkg-build-start__card-detail-empty">No package tiers configured for this family.</p>
    );
  }

  const anyNarrative = slots.some(slotHasNarrative);

  return (
    <div className="agency-pkg-build-start__card-detail-inner">
      {slots.map((slot) => {
        const narrative = packageNarrativeFromSlot(slot);
        const limits = slotLimitSummary(slot);
        const showTierHeading = slots.length > 1;
        return (
          <div key={slot.id} className="agency-pkg-build-start__card-detail-tier">
            {showTierHeading ? (
              <div className="agency-pkg-build-start__card-detail-tier-head">
                <h4 className="agency-pkg-build-start__card-detail-tier-title">{slot.label.trim() || "Tier"}</h4>
                {limits !== "No limits configured" ? (
                  <span className="agency-pkg-build-start__card-detail-tier-limits">{limits}</span>
                ) : null}
              </div>
            ) : null}
            {slot.tier_notes?.trim() ? (
              <p className="agency-pkg-build-start__card-detail-note">{slot.tier_notes.trim()}</p>
            ) : null}
            <PackageNarrativeSections narrative={narrative} compact />
            {!slotHasNarrative(slot) && !slot.tier_notes?.trim() ? (
              <p className="agency-pkg-build-start__card-detail-empty">
                No details configured{showTierHeading ? ` for ${slot.label.trim() || "this tier"}` : " yet"}.
              </p>
            ) : null}
          </div>
        );
      })}
      {!anyNarrative && slots.every((s) => !s.tier_notes?.trim()) ? (
        <p className="agency-pkg-build-start__card-detail-empty">
          Details can be added in Admin → Configurable Package.
        </p>
      ) : null}
    </div>
  );
}
