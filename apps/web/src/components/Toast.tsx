"use client";

import { AlertIcon, XIcon } from "./Icons";

export interface ToastMessage {
  id: number;
  kind: "success" | "error";
  text: string;
  /** A quiet action in the toast, such as Undo. */
  action?: { label: string; onClick: () => void };
}

interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: number) => void;
}

/**
 * A stack of dismissible success/error toasts, fixed to the bottom-right corner (#415). Each is a glass capsule that
 * rises in (still under Reduce Motion); an error carries a red glyph, the only red on it, and is announced as an alert.
 */
export default function Toast({ toasts, onDismiss }: ToastProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === "error" ? "alert" : "status"}
          className="pointer-events-auto glass-fake glass-frost isolate toast-in rounded-[22px] min-h-11 flex flex-wrap items-center gap-x-2 py-1 pl-4 pr-1 text-sm text-text max-w-[min(26rem,calc(100vw-2rem))]"
        >
          {t.kind === "error" && <AlertIcon className="size-5 shrink-0 text-danger" aria-hidden />}
          <span className="min-w-[min(10rem,100%)] flex-1 py-2 [overflow-wrap:anywhere]">{t.text}</span>
          <div className="ml-auto flex shrink-0 items-center">
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action?.onClick();
                  onDismiss(t.id);
                }}
                className="btn-ink font-semibold"
              >
                {t.action.label}
              </button>
            )}
            <button type="button" onClick={() => onDismiss(t.id)} className="btn-icon" aria-label="Dismiss">
              <XIcon className="size-5" aria-hidden />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
