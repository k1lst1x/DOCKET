"use client";

import { useEffect, useId, useRef, useState } from "react";

interface ConfirmProps {
  triggerLabel: string;
  message: string;
  confirmLabel: string;
  tone?: "danger" | "commit";
  disabled?: boolean;
  onConfirm: () => void | Promise<void>;
}

/** Inline confirm bar for destructive or committing actions. No modal. */
export function Confirm({ triggerLabel, message, confirmLabel, tone = "danger", disabled, onConfirm }: ConfirmProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const hasOpened = useRef(false);
  const barId = useId();

  useEffect(() => {
    if (open) {
      hasOpened.current = true;
      confirmRef.current?.focus();
    } else if (hasOpened.current) {
      triggerRef.current?.focus();
    }
  }, [open]);

  async function run() {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through. Try again.");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-expanded={false}
        aria-controls={barId}
        onClick={() => setOpen(true)}
        className={`btn ${tone === "danger" ? "btn-danger-outline" : "btn-primary"}`}
      >
        {triggerLabel}
      </button>
    );
  }

  return (
    <div
      id={barId}
      role="group"
      aria-label={message}
      onKeyDown={(e) => e.key === "Escape" && !pending && setOpen(false)}
      className={`flex flex-wrap items-center gap-3 rounded border px-4 py-3 ${
        tone === "danger" ? "border-signal/50 bg-signal-wash" : "border-ink/25 bg-sky-mist"
      }`}
    >
      <p className="mr-auto text-base text-ink">{message}</p>
      {error ? (
        <p role="alert" className="w-full text-sm text-signal">
          {error}
        </p>
      ) : null}
      <button type="button" className="btn btn-secondary h-10 px-4" onClick={() => setOpen(false)} disabled={pending}>
        Cancel
      </button>
      <button
        ref={confirmRef}
        type="button"
        className={`btn h-10 px-4 ${tone === "danger" ? "btn-danger" : "btn-primary"}`}
        onClick={run}
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? "Working…" : confirmLabel}
      </button>
    </div>
  );
}
