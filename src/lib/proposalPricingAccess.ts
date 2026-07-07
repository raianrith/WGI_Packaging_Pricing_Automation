import type { User } from "@supabase/supabase-js";

/** Accounts allowed to edit proposal hours & pricing in Organize & Reorder. */
const PROPOSAL_PRICING_EDITOR_EMAILS = ["cdrusch@weidert.com"] as const;

export const PROPOSAL_PRICING_EDITOR_CONTACT = "Chelsea";

export const PROPOSAL_PRICING_EDITOR_DENIED_MESSAGE = `Connect with ${PROPOSAL_PRICING_EDITOR_CONTACT} to update hours and pricing.`;

export function canEditProposalPricing(user: User | null | undefined): boolean {
  const email = user?.email?.trim().toLowerCase() ?? "";
  return PROPOSAL_PRICING_EDITOR_EMAILS.some((allowed) => allowed === email);
}
