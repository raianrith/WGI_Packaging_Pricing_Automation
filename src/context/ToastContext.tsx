import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type ToastVariant = "success" | "error" | "note";

/** Auto-dismiss delay for every toast in the app stack. */
const TOAST_AUTO_DISMISS_MS = 2000;

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

const VARIANT_META: Record<
  ToastVariant,
  { title: string; icon: string; modifier: "err" | "ok" | "note" }
> = {
  error: { title: "Issue", icon: "!", modifier: "err" },
  success: { title: "Success", icon: "✓", modifier: "ok" },
  note: { title: "Note", icon: "i", modifier: "note" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastRow[]>([]);
  const dismissTimersRef = useRef<Map<string, number>>(new Map());

  const clearDismissTimer = useCallback((id: string) => {
    const t = dismissTimersRef.current.get(id);
    if (t !== undefined) {
      window.clearTimeout(t);
      dismissTimersRef.current.delete(id);
    }
  }, []);

  const dismissToast = useCallback(
    (id: string) => {
      clearDismissTimer(id);
      setItems((prev) => prev.filter((x) => x.id !== id));
    },
    [clearDismissTimer]
  );

  const setOpErr = useCallback(
    (message: string | null) => {
      if (message === null) {
        setItems((prev) => prev.filter((x) => !(x.source === "admin" && x.variant === "error")));
        return;
      }
      setItems((prev) => {
        const without = prev.filter((x) => !(x.source === "admin" && x.variant === "error"));
        const withoutSuccess = without.filter(
          (x) => !(x.source === "admin" && x.variant === "success")
        );
        return [
          ...withoutSuccess,
          { id: toastId(), variant: "error", message, source: "admin" },
        ];
      });
    },
    []
  );

  const setOpOk = useCallback((message: string | null) => {
    if (message === null) {
      setItems((prev) => prev.filter((x) => !(x.source === "admin" && x.variant === "success")));
      return;
    }
    setItems((prev) => {
      const without = prev.filter((x) => !(x.source === "admin" && x.variant === "success"));
      return [
        ...without,
        { id: toastId(), variant: "success", message, source: "admin" },
      ];
    });
  }, []);

  const toastError = useCallback((message: string) => {
    setItems((prev) => [...prev, { id: toastId(), variant: "error", message, source: "free" }]);
  }, []);

  const toastNote = useCallback((message: string) => {
    setItems((prev) => [...prev, { id: toastId(), variant: "note", message, source: "free" }]);
  }, []);

  const toastSuccess = useCallback((message: string) => {
    setItems((prev) => [...prev, { id: toastId(), variant: "success", message, source: "free" }]);
  }, []);

  useEffect(() => {
    const visibleIds = new Set(items.map((i) => i.id));

    dismissTimersRef.current.forEach((timerId, id) => {
      if (!visibleIds.has(id)) {
        window.clearTimeout(timerId);
        dismissTimersRef.current.delete(id);
      }
    });

    for (const row of items) {
      if (dismissTimersRef.current.has(row.id)) continue;
      const tid = window.setTimeout(() => {
        dismissTimersRef.current.delete(row.id);
        setItems((prev) => prev.filter((x) => x.id !== row.id));
      }, TOAST_AUTO_DISMISS_MS);
      dismissTimersRef.current.set(row.id, tid);
    }
  }, [items]);

  useEffect(() => {
    return () => {
      dismissTimersRef.current.forEach((t) => window.clearTimeout(t));
      dismissTimersRef.current.clear();
    };
  }, []);

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
                  className={`admin-op-toast admin-op-toast--${VARIANT_META[t.variant].modifier}`}
                  role={t.variant === "error" ? "alert" : "status"}
                >
                  <div className="admin-op-toast__icon" aria-hidden>
                    {VARIANT_META[t.variant].icon}
                  </div>
                  <div className="admin-op-toast__body">
                    <div className="admin-op-toast__title-row">
                      <strong className="admin-op-toast__title">{VARIANT_META[t.variant].title}</strong>
                    </div>
                    <span className="admin-op-toast__text">{t.message}</span>
                  </div>
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
