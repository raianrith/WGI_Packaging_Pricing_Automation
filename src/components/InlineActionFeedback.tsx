import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { useToast } from "../context/ToastContext";

export type InlineActionFeedbackModel =
  | { message: string; variant: "ok" | "err" }
  | null;

/** Surfaces the same messages as global stack toasts (no inline copy under controls). */
export function InlineActionFeedback({
  model,
  style: _style,
}: {
  model: InlineActionFeedbackModel;
  /** Kept for call-site compatibility; layout is handled by the toast stack. */
  style?: CSSProperties;
}) {
  const { toastSuccess, toastError } = useToast();
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    if (!model) {
      lastKey.current = null;
      return;
    }
    const key = `${model.variant}:${model.message}`;
    if (lastKey.current === key) return;
    lastKey.current = key;
    if (model.variant === "err") {
      toastError(model.message);
    } else {
      toastSuccess(model.message);
    }
  }, [model, toastError, toastSuccess]);

  return null;
}

export function pickInlineFeedback(
  fb: { zone: string; message: string; variant: "ok" | "err" } | null,
  zone: string
): InlineActionFeedbackModel {
  if (!fb || fb.zone !== zone) return null;
  return { message: fb.message, variant: fb.variant };
}
