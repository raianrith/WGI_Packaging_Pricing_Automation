import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type ProposalDraftGuard = {
  isActive: boolean;
  isDirty: boolean;
  message: string;
};

type ProposalDraftGuardContextValue = {
  guard: ProposalDraftGuard | null;
  setGuard: (guard: ProposalDraftGuard | null) => void;
  confirmLeave: (proceed: () => void) => void;
};

const ProposalDraftGuardContext = createContext<ProposalDraftGuardContextValue | null>(null);

export function ProposalDraftGuardProvider({ children }: { children: ReactNode }) {
  const [guard, setGuard] = useState<ProposalDraftGuard | null>(null);

  const confirmLeave = useCallback(
    (proceed: () => void) => {
      if (!guard?.isActive || !guard.isDirty) {
        proceed();
        return;
      }
      const ok = window.confirm(guard.message);
      if (ok) proceed();
    },
    [guard]
  );

  const value = useMemo(
    () => ({
      guard,
      setGuard,
      confirmLeave,
    }),
    [guard, confirmLeave]
  );

  return (
    <ProposalDraftGuardContext.Provider value={value}>{children}</ProposalDraftGuardContext.Provider>
  );
}

export function useProposalDraftGuard(): ProposalDraftGuardContextValue {
  const ctx = useContext(ProposalDraftGuardContext);
  if (!ctx) {
    throw new Error("useProposalDraftGuard must be used within ProposalDraftGuardProvider");
  }
  return ctx;
}
