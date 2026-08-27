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

export type ToastProgressUpdate = {
  /** Override the progress label mid-flight. */
  label?: string;
  /** Completed units (e.g. tasks written). */
  current?: number;
  /** Total units when known. */
  total?: number;
};

export type ToastProgressState = {
  label: string;
  current: number | null;
  total: number | null;
};

export type ToastContextValue = {
  setOpErr: (message: string | null) => void;
  setOpOk: (message: string | null) => void;
  /** Clear success toasts without starting the progress bar (nav / sync UI resets). */
  clearOpOk: () => void;
  /** Clear error toasts without affecting progress. */
  clearOpErr: () => void;
  toastSuccess: (message: string) => void;
  toastError: (message: string) => void;
  toastNote: (message: string) => void;
  dismissToast: (id: string) => void;
  /** Show the global progress toast (indeterminate unless current/total are set). */
  beginProgress: (label: string, opts?: { current?: number; total?: number }) => void;
  updateProgress: (update: ToastProgressUpdate) => void;
  endProgress: () => void;
  /**
   * Run async work under the global progress toast.
   * Progress stays visible until a success/error toast is shown (or endProgress is called).
   */
  runWithProgress: <T>(
    label: string,
    work: (report: (update: ToastProgressUpdate) => void) => Promise<T>
  ) => Promise<T>;
  progress: ToastProgressState | null;
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

function progressPercent(progress: ToastProgressState): number | null {
  if (progress.total == null || progress.total <= 0 || progress.current == null) return null;
  return Math.max(0, Math.min(100, Math.round((progress.current / progress.total) * 100)));
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastRow[]>([]);
  const [progress, setProgress] = useState<ToastProgressState | null>(null);
  const dismissTimersRef = useRef<Map<string, number>>(new Map());
  const progressGenRef = useRef(0);

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

  const endProgress = useCallback(() => {
    progressGenRef.current += 1;
    setProgress(null);
  }, []);

  const beginProgress = useCallback((label: string, opts?: { current?: number; total?: number }) => {
    progressGenRef.current += 1;
    setProgress({
      label: label.trim() || "Working…",
      current: opts?.current ?? null,
      total: opts?.total ?? null,
    });
  }, []);

  const updateProgress = useCallback((update: ToastProgressUpdate) => {
    setProgress((prev) => {
      if (!prev) {
        return {
          label: update.label?.trim() || "Working…",
          current: update.current ?? null,
          total: update.total ?? null,
        };
      }
      return {
        label: update.label?.trim() ? update.label.trim() : prev.label,
        current: update.current !== undefined ? update.current : prev.current,
        total: update.total !== undefined ? update.total : prev.total,
      };
    });
  }, []);

  const runWithProgress = useCallback(
    async <T,>(
      label: string,
      work: (report: (update: ToastProgressUpdate) => void) => Promise<T>
    ): Promise<T> => {
      beginProgress(label);
      const gen = progressGenRef.current;
      try {
        return await work((update) => {
          if (progressGenRef.current !== gen) return;
          updateProgress(update);
        });
      } catch (err) {
        if (progressGenRef.current === gen) endProgress();
        throw err;
      }
    },
    [beginProgress, endProgress, updateProgress]
  );

  const clearOpErr = useCallback(() => {
    setItems((prev) => prev.filter((x) => !(x.source === "admin" && x.variant === "error")));
  }, []);

  const clearOpOk = useCallback(() => {
    setItems((prev) => prev.filter((x) => !(x.source === "admin" && x.variant === "success")));
  }, []);

  const setOpErr = useCallback(
    (message: string | null) => {
      if (message === null) {
        clearOpErr();
        return;
      }
      endProgress();
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
    [clearOpErr, endProgress]
  );

  const setOpOk = useCallback(
    (message: string | null) => {
      if (message === null) {
        // Conventional “start of admin action” signal — show progress until success/error.
        clearOpOk();
        beginProgress("Working…");
        return;
      }
      endProgress();
      setItems((prev) => {
        const without = prev.filter((x) => !(x.source === "admin" && x.variant === "success"));
        return [
          ...without,
          { id: toastId(), variant: "success", message, source: "admin" },
        ];
      });
    },
    [beginProgress, clearOpOk, endProgress]
  );

  const toastError = useCallback(
    (message: string) => {
      endProgress();
      setItems((prev) => [...prev, { id: toastId(), variant: "error", message, source: "free" }]);
    },
    [endProgress]
  );

  const toastNote = useCallback(
    (message: string) => {
      endProgress();
      setItems((prev) => [...prev, { id: toastId(), variant: "note", message, source: "free" }]);
    },
    [endProgress]
  );

  const toastSuccess = useCallback(
    (message: string) => {
      endProgress();
      setItems((prev) => [...prev, { id: toastId(), variant: "success", message, source: "free" }]);
    },
    [endProgress]
  );

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
      clearOpOk,
      clearOpErr,
      toastSuccess,
      toastError,
      toastNote,
      dismissToast,
      beginProgress,
      updateProgress,
      endProgress,
      runWithProgress,
      progress,
    }),
    [
      beginProgress,
      clearOpErr,
      clearOpOk,
      dismissToast,
      endProgress,
      progress,
      runWithProgress,
      setOpErr,
      setOpOk,
      toastError,
      toastNote,
      toastSuccess,
      updateProgress,
    ]
  );

  const pct = progress ? progressPercent(progress) : null;
  const progressDetail =
    progress && progress.current != null && progress.total != null && progress.total > 0
      ? `${progress.current} of ${progress.total}`
      : null;

  return (
    <ToastCtx.Provider value={value}>
      {children}
      {typeof document !== "undefined" &&
        createPortal(
          items.length > 0 || progress ? (
            <div className="admin-op-toast-stack app-toast-stack" aria-live="polite">
              {progress ? (
                <div
                  className="admin-op-toast admin-op-toast--progress"
                  role="status"
                  aria-busy="true"
                  aria-valuemin={pct != null ? 0 : undefined}
                  aria-valuemax={pct != null ? 100 : undefined}
                  aria-valuenow={pct ?? undefined}
                >
                  <div className="admin-op-toast__icon admin-op-toast__icon--spinner" aria-hidden>
                    <span className="admin-op-toast__spinner" />
                  </div>
                  <div className="admin-op-toast__body">
                    <div className="admin-op-toast__title-row">
                      <strong className="admin-op-toast__title">In progress</strong>
                      {progressDetail ? (
                        <span className="admin-op-toast__progress-count">{progressDetail}</span>
                      ) : null}
                    </div>
                    <span className="admin-op-toast__text">{progress.label}</span>
                    <div
                      className={`admin-op-toast__bar${pct == null ? " admin-op-toast__bar--indeterminate" : ""}`}
                      aria-hidden
                    >
                      <div
                        className="admin-op-toast__bar-fill"
                        style={pct != null ? { width: `${pct}%` } : undefined}
                      />
                    </div>
                  </div>
                </div>
              ) : null}
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

/**
 * Mirror a local busy/saving flag onto the global progress toast.
 * Prefer `runWithProgress` when you can report current/total.
 */
export function useToastBusy(busy: boolean, label = "Working…"): void {
  const { beginProgress, endProgress } = useToast();
  useEffect(() => {
    if (busy) beginProgress(label);
    else endProgress();
    return () => endProgress();
  }, [busy, label, beginProgress, endProgress]);
}
