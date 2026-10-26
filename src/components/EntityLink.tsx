import { Link, useLocation, useNavigate, type LinkProps } from "react-router-dom";
import { useProposalDraftGuard } from "../context/ProposalDraftGuardContext";
import { isProposalBuilderPath } from "../lib/entityLinks";

/** In-app entity link. Confirms before leaving an unsaved proposal. */
export function EntityLink({ to, onClick, className, children, ...rest }: LinkProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { guard, confirmLeave } = useProposalDraftGuard();
  const href = typeof to === "string" ? to : to.pathname ?? "";

  return (
    <Link
      {...rest}
      to={to}
      className={className ? `entity-link ${className}` : "entity-link"}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented) return;
        if (!isProposalBuilderPath(location.pathname)) return;
        if (isProposalBuilderPath(href.split("?")[0] ?? href)) return;
        if (!guard?.isActive || !guard.isDirty) return;
        e.preventDefault();
        confirmLeave(() => navigate(to));
      }}
    >
      {children}
    </Link>
  );
}
