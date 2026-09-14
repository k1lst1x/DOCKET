"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { CodeEntry } from "@/components/CodeEntry";

const START_ERRORS: Record<number, string> = {
  400: "Enter your full email address.",
  422: "We couldn't send a code to that address.",
  429: "Too many codes requested just now. Wait a minute, then try again.",
  503: "Sign-in isn't set up on this server yet.",
};

export function SignInFlow({ next }: { next: string }) {
  const router = useRouter();
  const emailRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, next }),
      });
      if (res.ok) {
        setStep("code");
        return;
      }
      setError(START_ERRORS[res.status] ?? "We couldn't send a code just now. Try again in a moment.");
      emailRef.current?.focus();
    } catch {
      setError("We couldn't reach Docket. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  if (step === "code") {
    return (
      <div>
        <CodeEntry
          email={email}
          intro={
            <>
              If <span className="font-semibold text-ink">{email}</span> belongs to a Docket member, we just emailed it a sign-in code.
            </>
          }
          onVerified={({ next: destination }) => {
            router.push(destination || next);
            router.refresh();
          }}
        />
        <button type="button" onClick={() => setStep("email")} className="link mt-5 text-sm">
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={sendCode} noValidate>
      <label htmlFor="signin-email" className="label">
        Email
      </label>
      <input
        ref={emailRef}
        id="signin-email"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? "signin-error" : undefined}
        className="field rounded-xl"
      />
      {error ? (
        <p id="signin-error" role="alert" className="mt-2 text-sm font-semibold text-signal">
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary mt-5 w-full rounded-full" disabled={sending || !email.trim()} aria-busy={sending}>
        {sending ? "Sending…" : "Email me a code"}
      </button>
      <p className="mt-5 text-sm text-ink-soft">
        New to Docket?{" "}
        <Link href="/groups" className="link">
          Join a group
        </Link>{" "}
        to create your account.
      </p>
    </form>
  );
}
