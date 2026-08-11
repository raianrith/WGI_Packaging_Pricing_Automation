import { ACCOUNT_MGMT_HOURS_ADDON_RATE } from "../../lib/tierPricingMath";

type Props = {
  accountMgmtHours: number;
  resourceHours: number;
  formatHoursShort: (n: number) => string;
};

export function ProposalOrganizeAccountMgmtCard({
  accountMgmtHours,
  resourceHours,
  formatHoursShort,
}: Props) {
  const pct = Math.round(ACCOUNT_MGMT_HOURS_ADDON_RATE * 100);

  return (
    <div
      className="proposal-organize-line proposal-organize-line--account-mgmt"
      aria-label="Proposal Account Management Time"
    >
      <div className="proposal-organize-line__accent" aria-hidden />

      <div className="proposal-organize-line__body">
        <div className="proposal-organize-line__header">
          <span className="proposal-organize-line__kind proposal-organize-line__kind--account-mgmt">
            Derived
          </span>
          <h4 className="proposal-organize-line__title">
            Proposal Account Management Time — {pct}%
          </h4>

          <div className="proposal-organize-line__metrics">
            <span className="proposal-organize-line__metric">
              <span className="proposal-organize-line__metric-label">Hours</span>
              <span className="proposal-organize-line__metric-value">
                {formatHoursShort(accountMgmtHours)} h
              </span>
            </span>
          </div>
        </div>

        <p className="proposal-organize-am__formula">
          Calculated as {pct}% of included resource hours across all scenarios (
          {formatHoursShort(resourceHours)} h × {pct}% = {formatHoursShort(accountMgmtHours)} h).
          Already built into tier sell prices — shown here for planning visibility only.
        </p>
      </div>
    </div>
  );
}
