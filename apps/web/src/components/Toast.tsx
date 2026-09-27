"use client";

export interface ToastMessage {
  id: number;
  kind: "success" | "error";
  text: string;
}

interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: number) => void;
}

/** A stack of dismissible success/error toasts, fixed to the bottom-right corner. */
export default function Toast({ toasts, onDismiss }: ToastProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto flex items-center gap-3 rounded-lg px-4 py-3 text-sm text-white shadow-lg ${
            t.kind === "success" ? "bg-accent" : "bg-danger"
          }`}
        >
          <span>{t.text}</span>
          <button
            type="button"
            onClick={() => onDismiss(t.id)}
            className="text-white/80 hover:text-white"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
