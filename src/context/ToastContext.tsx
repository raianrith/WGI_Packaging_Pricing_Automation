import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type ToastVariant = "success" | "error" | "note";

type ToastRow = {
  id: string;
  variant: ToastVariant;
  message: string;
  /** Admin panels use paired setOpErr / setOpOk semantics; everything else stacks as `free`. */
  source: "admin" | "free";
};

export type ToastContextValue = {
  setOpErr: (message: string | null) => void;
  setOpOk: (message: string | null) => void;
  toastSuccess: (message: string) => void;
  toastError: (message: string) => void;
  toastNote: (message: string) => void;
  dismissToast: (id: string) => void;
};

const ToastCtx = createContext<ToastContextValue | null>(null);

function toastId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const STACK_BASE: CSSProperties = {
  padding: "0.75rem 0.95rem",
  borderRadius: "var(--radius-lg)",
  fontSize: "0.9rem",
  lineHeight: 1.45,
};

const VARIANT_STYLE: Record<ToastVariant, CSSProperties> = {
  error: {
    ...STACK_BASE,
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "var(--danger)",
  },
  success: {
    ...STACK_BASE,
    background: "#ecfdf5",
    border: "1px solid #a7f3d0",
    color: "#065f46",
  },
  note: {
    ...STACK_BASE,
    background: "#fffbeb",
    border: "1px solid #fde68a",
    color: "#92400e",
  },
};

/** Modifiers for stacked toasts rendered in the portal. */
function mapVariantToModifier(v: ToastVariant): "err" | "ok" | "note" {
  if (v === "error") return "err";
  if (v === "success") return "ok";
  return "note";
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastRow[]>([]);
  const adminSuccessTimersRef = useRef<Map<string, number>>(new Map());
  const freeSuccessTimersRef = useRef<Map<string, number>>(new Map());

  const clearAdminSuccessTimers = useCallback(() => {
    adminSuccessTimersRef.current.forEach((t) => window.clearTimeout(t));
    adminSuccessTimersRef.current.clear();
  }, []);

  const dismissToast = useCallback((id: string) => {
    const at = adminSuccessTimersRef.current.get(id);
    if (at !== undefined) {
      window.clearTimeout(at);
      adminSuccessTimersRef.current.delete(id);
    }
    const ft = freeSuccessTimersRef.current.get(id);
    if (ft !== undefined) {
      window.clearTimeout(ft);
      freeSuccessTimersRef.current.delete(id);
    }
    setItems((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const setOpErr = useCallback(
    (message: string | null) => {
      if (message === null) {
        setItems((prev) => prev.filter((x) => !(x.source === "admin" && x.variant === "error")));
        return;
      }
      clearAdminSuccessTimers();
      setItems((prev) => {
        const without = prev.filter((x) => !(x.source === "admin" && x.variant === "error"));
        return [
          ...without,
          { id: toastId(), variant: "error", message, source: "admin" },
        ];
      });
    },
    [clearAdminSuccessTimers]
  );

  const setOpOk = useCallback(
    (message: string | null) => {
      if (message === null) {
        clearAdminSuccessTimers();
        setItems((prev) => prev.filter((x) => !(x.source === "admin" && x.variant === "success")));
        return;
      }
      clearAdminSuccessTimers();
      setItems((prev) => {
        const without = prev.filter((x) => !(x.source === "admin" && x.variant === "success"));
        return [
          ...without,
          { id: toastId(), variant: "success", message, source: "admin" },
        ];
      });
    },
    [clearAdminSuccessTimers]
  );

  const toastError = useCallback((message: string) => {
    setItems((prev) => [...prev, { id: toastId(), variant: "error", message, source: "free" }]);
  }, []);

  const toastNote = useCallback((message: string) => {
    setItems((prev) => [...prev, { id: toastId(), variant: "note", message, source: "free" }]);
  }, []);

  const toastSuccess = useCallback((message: string) => {
    const id = toastId();
    setItems((prev) => [...prev, { id, variant: "success", message, source: "free" }]);
    const t = window.setTimeout(() => {
      freeSuccessTimersRef.current.delete(id);
      setItems((prev) => prev.filter((x) => x.id !== id));
    }, 6000);
    freeSuccessTimersRef.current.set(id, t);
  }, []);

  useEffect(() => {
    const hasAdminErr = items.some((i) => i.source === "admin" && i.variant === "error");
    if (hasAdminErr) {
      clearAdminSuccessTimers();
      return;
    }
    const admins = items.filter((i) => i.source === "admin" && i.variant === "success");
    for (const s of admins) {
      if (adminSuccessTimersRef.current.has(s.id)) continue;
      const tid = window.setTimeout(() => {
        adminSuccessTimersRef.current.delete(s.id);
        setItems((prev) => prev.filter((x) => x.id !== s.id));
      }, 6000);
      adminSuccessTimersRef.current.set(s.id, tid);
    }
    return undefined;
  }, [items, clearAdminSuccessTimers]);

  const value = useMemo<ToastContextValue>(
    () => ({
      setOpErr,
      setOpOk,
      toastSuccess,
      toastError,
      toastNote,
      dismissToast,
    }),
    [dismissToast, setOpErr, setOpOk, toastError, toastNote, toastSuccess]
  );

  return (
    <ToastCtx.Provider value={value}>
      {children}
      {typeof document !== "undefined" &&
        createPortal(
          items.length > 0 ? (
            <div className="admin-op-toast-stack app-toast-stack" aria-live="polite">
              {items.map((t) => (
                <div
                  key={t.id}
                  className={`admin-op-toast admin-op-toast--${mapVariantToModifier(t.variant)}`}
                  role={t.variant === "error" ? "alert" : "status"}
                  style={VARIANT_STYLE[t.variant]}
                >
                  <span className="admin-op-toast__text">{t.message}</span>
                  <button
                    type="button"
                    className="admin-op-toast__dismiss"
                    aria-label="Dismiss message"
                    onClick={() => dismissToast(t.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null,
          document.body
        )}
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastCtx);
  if (!ctx) {
    throw new Error("useToast must be used inside ToastProvider");
  }
  return ctx;
}
