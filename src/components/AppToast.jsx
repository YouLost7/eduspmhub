import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";

/**
 * Fixed corner toast with enter/exit motion. Auto-dismisses; optional manual dismiss.
 * @param {{ message: string; variant?: "success" | "error"; durationMs?: number; onDismiss?: () => void }} props
 */
export function AppToast({ message, variant = "success", durationMs = 6200, onDismiss }) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const open = Boolean(message && String(message).trim());

  useEffect(() => {
    if (!open) return undefined;
    const id = window.setTimeout(() => {
      onDismissRef.current?.();
    }, durationMs);
    return () => window.clearTimeout(id);
  }, [message, open, durationMs]);

  return (
    <div className="app-toast-host" aria-live="polite">
      <AnimatePresence mode="wait">
        {open ? (
          <motion.aside
            key={message}
            role="status"
            className={`app-toast app-toast--${variant}`}
            initial={{ opacity: 0, x: 48, scale: 0.94 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 28, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
          >
            <span className="app-toast-icon" aria-hidden="true">
              {variant === "success" ? "✓" : "!"}
            </span>
            <span className="app-toast-text">{message}</span>
            <button
              type="button"
              className="app-toast-dismiss"
              onClick={() => onDismissRef.current?.()}
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </motion.aside>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
