"use client";

import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { AuthErrorCode } from "@/lib/auth-codes";

const MESSAGES: Record<AuthErrorCode, string> = {
  wrong_code: "That code isn't right. Check the most recent email from Docket.",
  expired: "That code has expired. Send yourself a new one below.",
  signin_required: "Your email is confirmed. We just sent a sign-in code, so enter that one.",
  busy: "Too many tries just now. Wait a minute, then try again.",
  undeliverable: "We couldn't email that address.",
  not_configured: "Sign-in isn't set up on this server yet.",
  failed: "We couldn't check that code. Try again.",
};

interface CodeEntryProps {
  email: string;
  intro?: ReactNode;
  onVerified: (result: { name: string; next: string }) => void;
}

/** Six-digit email code: confirm, or send a fresh one. */
export function CodeEntry({ email, intro, onVerified }: CodeEntryProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"verify" | "resend" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (code.length < 6 || busy) return;
    setBusy("verify");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        onVerified({ name: data.name, next: data.next });
        return;
      }
      const reason = (data?.error ?? "failed") as AuthErrorCode;
      if (reason === "signin_required") {
        setNotice(MESSAGES.signin_required);
        setCode("");
      } else {
        setError(MESSAGES[reason] ?? MESSAGES.failed);
      }
      inputRef.current?.focus();
    } catch {
      setError("We couldn't reach Docket. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function resend() {
    if (busy) return;
    setBusy("resend");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/auth/resend", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        setNotice(`We sent a new code to ${email}.`);
        setCode("");
        inputRef.current?.focus();
      } else {
        const reason = (data?.error ?? "failed") as AuthErrorCode;
        setError(reason === "expired" ? "This sign-in timed out. Start again to get a new code." : MESSAGES[reason] ?? MESSAGES.failed);
      }
    } catch {
      setError("We couldn't reach Docket. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      {intro ? <p className="text-base text-ink-soft">{intro}</p> : null}
      <label htmlFor={id} className="label mt-4">
        6-digit code
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          ref={inputRef}
          id={id}
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={8}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          className="field w-full rounded-xl text-center font-mono text-2xl tracking-[0.35em] sm:w-56 sm:flex-none"
        />
        <button type="submit" className="btn btn-primary rounded-full" disabled={code.length < 6 || busy !== null} aria-busy={busy === "verify"}>
          {busy === "verify" ? "Checking…" : "Confirm"}
        </button>
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-2 text-sm font-semibold text-signal">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-2 text-sm font-semibold text-park">
          {notice}
        </p>
      ) : null}
      <p className="mt-3 text-sm text-ink-soft">
        No email after a minute? Check spam, or{" "}
        <button type="button" onClick={resend} disabled={busy !== null} className="link disabled:opacity-60">
          {busy === "resend" ? "sending…" : "send a new code"}
        </button>
        .
      </p>
    </form>
  );
}
