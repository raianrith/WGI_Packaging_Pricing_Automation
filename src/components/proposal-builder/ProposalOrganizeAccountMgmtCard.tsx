import {
  ACCOUNT_MGMT_HOURS_ADDON_RATE,
  CONTINUOUS_IMPROVEMENT_HOURS_ADDON_RATE,
} from "../../lib/tierPricingMath";
import { formatProposalUsdValue } from "../../lib/proposalCardTasks";

type DerivedHoursCardProps = {
  title: string;
  ariaLabel: string;
  rate: number;
  derivedHours: number;
  resourceHours: number;
  flexBudgetUsd: number;
  hourlyRate: number;
  formatHoursShort: (n: number) => string;
};

function ProposalOrganizeDerivedHoursCard({
  title,
  ariaLabel,
  rate,
  derivedHours,
  resourceHours,
  flexBudgetUsd,
  hourlyRate,
  formatHoursShort,
}: DerivedHoursCardProps) {
  const pct = Math.round(rate * 100);
  const hasResource = resourceHours > 0;
  const hasFlex = flexBudgetUsd > 0;

  let formula: string;
  if (hasResource && hasFlex) {
    formula = `Calculated as ${pct}% of included resource hours (${formatHoursShort(resourceHours)} h) plus ${pct}% of Flex Budget sell (${formatProposalUsdValue(flexBudgetUsd)} ÷ ${formatProposalUsdValue(hourlyRate)}/h). Already built into tier sell prices — Flex Budget uses the proposal sell you entered. Shown for planning visibility only.`;
  } else if (hasFlex) {
    formula = `Calculated as ${pct}% of Flex Budget proposal sell (${formatProposalUsdValue(flexBudgetUsd)}) converted to hours at ${formatProposalUsdValue(hourlyRate)}/h. Shown for planning visibility only.`;
  } else {
    formula = `Calculated as ${pct}% of included resource hours across all scenarios (${formatHoursShort(resourceHours)} h × ${pct}% = ${formatHoursShort(derivedHours)} h). Already built into tier sell prices — shown here for planning visibility only.`;
  }

  return (
    <div className="proposal-organize-line proposal-organize-line--account-mgmt" aria-label={ariaLabel}>
      <div className="proposal-organize-line__accent" aria-hidden />

      <div className="proposal-organize-line__body">
        <div className="proposal-organize-line__header">
          <span className="proposal-organize-line__kind proposal-organize-line__kind--account-mgmt">
            Derived
          </span>
          <h4 className="proposal-organize-line__title">
            {title} — {pct}%
          </h4>

          <div className="proposal-organize-line__metrics">
            <span className="proposal-organize-line__metric">
              <span className="proposal-organize-line__metric-label">Hours</span>
              <span className="proposal-organize-line__metric-value">
                {formatHoursShort(derivedHours)} h
              </span>
            </span>
          </div>
        </div>

        <p className="proposal-organize-am__formula">{formula}</p>
      </div>
    </div>
  );
}

type Props = {
  accountMgmtHours: number;
  continuousImprovementHours: number;
  resourceHours: number;
  flexBudgetUsd?: number;
  hourlyRate?: number;
  formatHoursShort: (n: number) => string;
};

export function ProposalOrganizeAccountMgmtCard({
  accountMgmtHours,
  continuousImprovementHours,
  resourceHours,
  flexBudgetUsd = 0,
  hourlyRate = 210,
  formatHoursShort,
}: Props) {
  return (
    <div className="proposal-organize-am-stack" role="group" aria-label="Derived proposal hour add-ons">
      <ProposalOrganizeDerivedHoursCard
        title="Proposal Account Management Time"
        ariaLabel="Proposal Account Management Time"
        rate={ACCOUNT_MGMT_HOURS_ADDON_RATE}
        derivedHours={accountMgmtHours}
        resourceHours={resourceHours}
        flexBudgetUsd={flexBudgetUsd}
        hourlyRate={hourlyRate}
        formatHoursShort={formatHoursShort}
      />
      <ProposalOrganizeDerivedHoursCard
        title="Continuous Improvement Time"
        ariaLabel="Continuous Improvement Time"
        rate={CONTINUOUS_IMPROVEMENT_HOURS_ADDON_RATE}
        derivedHours={continuousImprovementHours}
        resourceHours={resourceHours}
        flexBudgetUsd={flexBudgetUsd}
        hourlyRate={hourlyRate}
        formatHoursShort={formatHoursShort}
      />
    </div>
  );
}
