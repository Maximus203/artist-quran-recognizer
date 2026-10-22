"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export type ToastAction = { label: string; run: () => void };
type ToastState = { text: string; action?: ToastAction } | null;

/** Message bref avec une action facultative (« Annuler »). Annoncé en `role="status"`. */
export function useToast(durationMs = 6000) {
  const [toast, setToast] = useState<ToastState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const show = useCallback(
    (text: string, action?: ToastAction) => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ text, action });
      timer.current = setTimeout(() => setToast(null), durationMs);
    },
    [durationMs],
  );
  const hide = useCallback(() => setToast(null), []);
  const node = toast ? (
    <div className="toast" role="status" data-testid="toast">
      <span>{toast.text}</span>
      {toast.action ? (
        <button
          type="button"
          onClick={() => {
            toast.action?.run();
            setToast(null);
          }}
        >
          {toast.action.label}
        </button>
      ) : null}
    </div>
  ) : null;
  return { show, hide, node };
}
