import { useEffect, useMemo, useState } from "react";
import type { RoadmapCard } from "../../lib/roadmapModel";
import {
  effectiveHoursStr,
  effectivePriceStr,
  extraHoursFromAttachmentsScratch,
  scratchEffectiveHoursBreakdown,
  tryParseRoadmapHours,
} from "../../lib/roadmapModel";

type CatalogCtxLike = Parameters<typeof effectivePriceStr>[1];

type Props = {
  card: RoadmapCard;
  ctx: CatalogCtxLike;
  computeScratchSellPrice: (c: RoadmapCard, ctx: CatalogCtxLike) => string;
  formatHoursShort: (n: number) => string;
  onClose: () => void;
  onSave: (key: string, patch: Pick<RoadmapCard, "hoursOverride" | "priceOverride">) => void;
};

function cardWithoutProposalOverrides(card: RoadmapCard): RoadmapCard {
  return { ...card, hoursOverride: null, priceOverride: null };
}

function catalogHoursLabel(card: RoadmapCard, ctx: CatalogCtxLike, formatHoursShort: (n: number) => string): string {
  const base = card.hours.trim();
  if (card.kind !== "custom_tier") return base || "—";
  const attach = ctx ? extraHoursFromAttachmentsScratch(card, ctx) : 0;
  const manualN = tryParseRoadmapHours(base);
  if (attach > 0) {
    const total = (manualN ?? 0) + attach;
    return `${formatHoursShort(total)} h total · ${base || "0 h"} on card + ${formatHoursShort(attach)} h from solutions`;
  }
  return base || "—";
}

function catalogPriceLabel(
  card: RoadmapCard,
  ctx: CatalogCtxLike,
  computeScratchSellPrice: (c: RoadmapCard, ctx: CatalogCtxLike) => string
): string {
  const basis = cardWithoutProposalOverrides(card);
  if (card.kind === "custom_tier") return computeScratchSellPrice(basis, ctx);
  return basis.price.trim() || "—";
}

export function ProposalOrganizePricingModal({
  card,
  ctx,
  computeScratchSellPrice,
  formatHoursShort,
  onClose,
  onSave,
}: Props) {
  const actualHours = useMemo(() => catalogHoursLabel(card, ctx, formatHoursShort), [card, ctx, formatHoursShort]);
  const actualPrice = useMemo(
    () => catalogPriceLabel(card, ctx, computeScratchSellPrice),
    [card, ctx, computeScratchSellPrice]
  );

  const [proposalHours, setProposalHours] = useState(card.hoursOverride ?? "");
  const [proposalPrice, setProposalPrice] = useState(card.priceOverride ?? "");

  useEffect(() => {
    setProposalHours(card.hoursOverride ?? "");
    setProposalPrice(card.priceOverride ?? "");
  }, [card.key, card.hoursOverride, card.priceOverride]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const draftCard = useMemo((): RoadmapCard => {
    const hoursOverride = proposalHours.trim() ? proposalHours : null;
    const priceOverride = proposalPrice.trim() ? proposalPrice : null;
    return { ...card, hoursOverride, priceOverride };
  }, [card, proposalHours, proposalPrice]);

  const usedHours = effectiveHoursStr(draftCard);
  const usedPrice = effectivePriceStr(draftCard, ctx, computeScratchSellPrice);
  const hasCustomProposal = Boolean(proposalHours.trim() || proposalPrice.trim());

  const scratchNote =
    card.kind === "custom_tier"
      ? (() => {
          const br = scratchEffectiveHoursBreakdown(draftCard, ctx);
          if (!br) return null;
          return `Pricing uses ~${formatHoursShort(br.total)} h at blended rate × multipliers unless you set a proposal price.`;
        })()
      : null;

  function handleSave() {
    onSave(card.key, {
      hoursOverride: proposalHours.trim() ? proposalHours : null,
      priceOverride: proposalPrice.trim() ? proposalPrice : null,
    });
    onClose();
  }

  function handleReset() {
    setProposalHours("");
    setProposalPrice("");
  }

  return (
    <div
      className="roadmap-modal-backdrop proposal-pricing-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="roadmap-modal proposal-pricing-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="proposal-pricing-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="proposal-pricing-modal__head">
          <p className="proposal-pricing-modal__eyebrow">Line Pricing</p>
          <h2 id="proposal-pricing-modal-title" className="proposal-pricing-modal__title">
            Edit Hours &amp; Pricing
          </h2>
          <p className="proposal-pricing-modal__subtitle">{card.headline.trim() || "(untitled)"}</p>
        </header>

        <div className="roadmap-modal__body proposal-pricing-modal__body">
          <section className="proposal-pricing-modal__block proposal-pricing-modal__block--catalog" aria-label="Actual solution values">
            <h3 className="proposal-pricing-modal__block-title">Actual (Solutions)</h3>
            <p className="proposal-pricing-modal__block-note">Original values from solutions when this line was added.</p>
            <div className="proposal-pricing-modal__readonly-grid">
              <div className="proposal-pricing-modal__readonly">
                <span className="proposal-pricing-modal__readonly-label">Actual Hours</span>
                <strong>{actualHours}</strong>
              </div>
              <div className="proposal-pricing-modal__readonly">
                <span className="proposal-pricing-modal__readonly-label">Actual Price</span>
                <strong>{actualPrice}</strong>
              </div>
            </div>
          </section>

          <section className="proposal-pricing-modal__block proposal-pricing-modal__block--proposal" aria-label="Proposal values">
            <h3 className="proposal-pricing-modal__block-title">Proposal (Export)</h3>
            <p className="proposal-pricing-modal__block-note">
              Leave blank to use actual values. What you enter here is used in rollups and the final proposal.
            </p>
            <div className="proposal-pricing-modal__fields">
              <label className="proposal-pricing-modal__field">
                <span className="proposal-pricing-modal__field-label">Proposal Hours</span>
                <input
                  className="roadmap-input"
                  value={proposalHours}
                  placeholder={card.hours.trim() || "Same as actual"}
                  onChange={(e) => setProposalHours(e.target.value)}
                />
              </label>
              <label className="proposal-pricing-modal__field">
                <span className="proposal-pricing-modal__field-label">Proposal Price</span>
                <input
                  className="roadmap-input"
                  value={proposalPrice}
                  placeholder={actualPrice !== "—" ? actualPrice : "Same as actual"}
                  onChange={(e) => setProposalPrice(e.target.value)}
                />
              </label>
            </div>
            {scratchNote ? <p className="proposal-pricing-modal__scratch-note">{scratchNote}</p> : null}
          </section>

          <div className="proposal-pricing-modal__preview" role="status">
            <span className="proposal-pricing-modal__preview-label">Used In Proposal</span>
            <strong>
              {usedHours ? `${usedHours}${/h/i.test(usedHours) ? "" : " h"}` : "Hours —"} · {usedPrice || "Price —"}
            </strong>
            {!hasCustomProposal ? (
              <span className="proposal-pricing-modal__preview-hint">Matches solutions until you override above.</span>
            ) : (
              <span className="proposal-pricing-modal__preview-hint proposal-pricing-modal__preview-hint--custom">
                Custom proposal values active
              </span>
            )}
          </div>
        </div>

        <footer className="roadmap-modal__actions proposal-pricing-modal__actions">
          <button type="button" className="roadmap-btn roadmap-btn--ghost" onClick={handleReset} disabled={!hasCustomProposal}>
            Reset To Actual
          </button>
          <div className="proposal-pricing-modal__actions-main">
            <button type="button" className="roadmap-btn roadmap-btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="roadmap-btn roadmap-btn--primary" onClick={handleSave}>
              Save
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
