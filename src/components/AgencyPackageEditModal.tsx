import { useCallback, useEffect, type CSSProperties } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { insertAuditLog } from "../lib/audit";
import { notifyPackagingDataChanged } from "../lib/packagingEvents";
import type { TierPricingMathConfig } from "../lib/tierPricingMath";
import type {
  ImplementerHourGroupRow,
  Package,
  PackageSolutionTier,
  Solution,
  SolutionTier,
  SolutionTierPricing,
  TaskRow,
} from "../types";
import { PackagesBuilderPanel, type PackagesBuilderPanelStyles } from "./PackagesBuilderPanel";

const panel: CSSProperties = {
  padding: "1.25rem 1.35rem",
  marginBottom: "1.25rem",
};

const h2: CSSProperties = {
  margin: "0 0 0.85rem",
  fontSize: "1.08rem",
  fontWeight: 700,
  letterSpacing: "-0.02em",
};

const muted: CSSProperties = { color: "var(--muted)", fontSize: "0.88rem" };

const formGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
  gap: "0.75rem",
};

const lbl: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.35rem",
  fontSize: "0.78rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--muted)",
};

const input: CSSProperties = {
  fontFamily: "inherit",
  fontSize: "0.9rem",
  padding: "0.5rem 0.65rem",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
  width: "100%",
};

const textarea: CSSProperties = {
  ...input,
  resize: "vertical" as const,
  minHeight: 64,
};

const btn: CSSProperties = {
  padding: "0.5rem 0.9rem",
  fontSize: "0.85rem",
  fontWeight: 600,
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
  cursor: "pointer",
  transition: "background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease",
};

const btnPrimary: CSSProperties = {
  ...btn,
  background: "var(--accent)",
  color: "#fffcf7",
  borderColor: "rgba(13, 92, 77, 0.45)",
};

const btnSm: CSSProperties = {
  padding: "0.32rem 0.58rem",
  fontSize: "0.78rem",
  fontWeight: 600,
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  cursor: "pointer",
  transition: "background 0.12s ease",
};

const btnDangerSm: CSSProperties = {
  ...btnSm,
  color: "var(--danger)",
  borderColor: "rgba(185, 28, 28, 0.35)",
};

const tbl: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse" as const,
  fontSize: "0.85rem",
};

const th: CSSProperties = {
  textAlign: "left" as const,
  padding: "0.45rem 0.55rem",
  borderBottom: "1px solid var(--border)",
  fontWeight: 650,
  fontSize: "0.76rem",
  textTransform: "uppercase" as const,
  letterSpacing: "0.04em",
  color: "var(--muted)",
};

const td: CSSProperties = {
  padding: "0.45rem 0.55rem",
  borderBottom: "1px solid rgba(226, 220, 211, 0.65)",
  verticalAlign: "top" as const,
};

const builderStyles: PackagesBuilderPanelStyles = {
  panel,
  formGrid,
  lbl,
  input,
  textarea,
  btn,
  btnPrimary,
  btnDangerSm,
  btnSm,
  tbl,
  th,
  td,
  h2,
  muted,
};

export type AgencyPackageEditModalProps = {
  packageId: string;
  packageName: string;
  packages: Package[];
  solutions: Solution[];
  tiers: SolutionTier[];
  tasks: TaskRow[];
  tierPricing: SolutionTierPricing[];
  packageTiers: PackageSolutionTier[];
  implementerHourGroups: ImplementerHourGroupRow[];
  tierPricingMathConfig: TierPricingMathConfig;
  onClose: () => void;
  onSaved: () => Promise<void>;
  setOpErr: (message: string | null) => void;
  setOpOk: (message: string | null) => void;
  logAudit: (client: SupabaseClient, params: Parameters<typeof insertAuditLog>[1]) => Promise<void>;
};

export function AgencyPackageEditModal({
  packageId,
  packageName,
  packages,
  solutions,
  tiers,
  tasks,
  tierPricing,
  packageTiers,
  implementerHourGroups,
  tierPricingMathConfig,
  onClose,
  onSaved,
  setOpErr,
  setOpOk,
  logAudit,
}: AgencyPackageEditModalProps) {
  const handleSaved = useCallback(async () => {
    notifyPackagingDataChanged();
    await onSaved();
  }, [onSaved]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="agency-pkg-edit-overlay" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="agency-pkg-edit-title"
        className="agency-pkg-edit-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="agency-pkg-edit-modal__header">
          <div className="agency-pkg-edit-modal__heading">
            <p className="agency-pkg-edit-modal__eyebrow">Edit custom package</p>
            <h2 id="agency-pkg-edit-title" className="agency-pkg-edit-modal__title">
              {packageName}
            </h2>
            <p className="agency-pkg-edit-modal__meta">Reference {packageId}</p>
          </div>
          <button type="button" className="agency-pkg-edit-modal__close" onClick={onClose} aria-label="Close editor">
            ×
          </button>
        </header>

        <div className="agency-pkg-edit-modal__body">
          <PackagesBuilderPanel
            subTab="update"
            embedded
            initialEditPackageId={packageId}
            packages={packages}
            solutions={solutions}
            tiers={tiers}
            tasks={tasks}
            tierPricing={tierPricing}
            packageTiers={packageTiers}
            taskGroups={[]}
            taskGroupLines={[]}
            implementerHourGroups={implementerHourGroups}
            tierPricingMathConfig={tierPricingMathConfig}
            onSaved={handleSaved}
            setOpErr={setOpErr}
            setOpOk={setOpOk}
            logAudit={logAudit}
            styles={builderStyles}
            onPackageDeleted={onClose}
          />
        </div>
      </div>
    </div>
  );
}
