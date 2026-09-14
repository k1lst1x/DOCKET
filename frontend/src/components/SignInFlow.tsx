"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { PASSWORD_MAX, PASSWORD_MIN, parseLogin, parseRegistration, type AccountFieldErrors } from "@/lib/account-fields";
import { forgetMe } from "@/lib/me-client";

export type AccountMode = "login" | "register";

const FAILURES: Record<number, string> = {
  401: "That email and password don't match an account. Check both, or register if you're new.",
  429: "Too many attempts from this connection. Wait a minute, then try again.",
  503: "Accounts are unavailable right now. Try again in a moment.",
};

/** Log in or register with an email and password. Either one signs you in right away. */
export function SignInFlow({ next, initialMode = "login" }: { next: string; initialMode?: AccountMode }) {
  const router = useRouter();
  const [mode, setMode] = useState<AccountMode>(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<AccountFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const registering = mode === "register";

  function switchMode(to: AccountMode) {
    setMode(to);
    setErrors({});
    setFormError(null);
  }

  function focusFirst(found: AccountFieldErrors) {
    (found.name ? nameRef : found.email ? emailRef : passwordRef).current?.focus();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);

    const check = registering ? parseRegistration({ name, email, password }) : parseLogin({ email, password });
    if (!check.ok) {
      setErrors(check.errors);
      focusFirst(check.errors);
      return;
    }
    setErrors({});
    setSubmitting(true);

    try {
      const res = await fetch(registering ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(check.value),
      });
      if (res.ok) {
        forgetMe();
        router.push(next);
        router.refresh();
        return;
      }
      const data = await res.json().catch(() => null);
      if (data?.fields) {
        setErrors(data.fields);
        focusFirst(data.fields);
      } else {
        setFormError(FAILURES[res.status] ?? "We couldn't finish just now. Try again in a moment.");
      }
    } catch {
      setFormError("We couldn't reach Docket. Check your connection and try again.");
    }
    setSubmitting(false);
  }

  return (
    <div>
      <h1 className="display text-[2.25rem] leading-tight">{registering ? "Create your account" : "Log in"}</h1>
      <p className="mt-2 text-base text-ink-soft">
        {registering ? "Your name, email and a password. You're signed in as soon as you register." : "Use the email and password for your Docket account."}
      </p>

      <div role="group" aria-label="Log in or register" className="mt-6 grid grid-cols-2 gap-1 rounded-full bg-sky-mist p-1">
        {(["login", "register"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={mode === option}
            onClick={() => switchMode(option)}
            className={`h-10 rounded-full text-base font-semibold ${mode === option ? "on-dark bg-ink text-white" : "text-ink hover:bg-white"}`}
          >
            {option === "login" ? "Log in" : "Register"}
          </button>
        ))}
      </div>

      <form noValidate onSubmit={onSubmit} className="mt-6 grid gap-5">
        {formError ? (
          <div role="alert" className="rounded-xl border border-signal/50 bg-signal-wash px-4 py-3 text-base text-signal">
            {formError}
          </div>
        ) : null}

        {registering ? (
          <div>
            <label htmlFor="account-name" className="label">
              Your name
            </label>
            <input
              ref={nameRef}
              id="account-name"
              name="name"
              type="text"
              autoComplete="name"
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? "account-name-error" : undefined}
              className="field rounded-xl"
            />
            <FieldError id="account-name-error" message={errors.name} />
          </div>
        ) : null}

        <div>
          <label htmlFor="account-email" className="label">
            Email
          </label>
          <input
            ref={emailRef}
            id="account-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete={registering ? "email" : "username"}
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "account-email-error" : undefined}
            className="field rounded-xl"
          />
          <FieldError id="account-email-error" message={errors.email} />
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="account-password" className="label">
              Password
            </label>
            <button type="button" onClick={() => setShowPassword((v) => !v)} aria-controls="account-password" className="link text-sm">
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          <input
            ref={passwordRef}
            id="account-password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete={registering ? "new-password" : "current-password"}
            maxLength={PASSWORD_MAX}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={Boolean(errors.password)}
            aria-describedby={`${registering ? "account-password-hint" : ""}${errors.password ? " account-password-error" : ""}`.trim() || undefined}
            className="field rounded-xl"
          />
          {registering ? (
            <p id="account-password-hint" className="mt-2 text-sm text-ink-soft">
              At least {PASSWORD_MIN} characters.
            </p>
          ) : null}
          <FieldError id="account-password-error" message={errors.password} />
        </div>

        <button type="submit" className="btn btn-primary w-full rounded-full" disabled={submitting} aria-busy={submitting}>
          {submitting ? (registering ? "Creating account…" : "Logging in…") : registering ? "Create account" : "Log in"}
        </button>
      </form>

      <p className="mt-5 text-sm text-ink-soft">
        {registering ? "Already have an account? " : "New to Docket? "}
        <button type="button" onClick={() => switchMode(registering ? "login" : "register")} className="link">
          {registering ? "Log in" : "Create an account"}
        </button>
      </p>
    </div>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-2 text-sm font-semibold text-signal">
      {message}
    </p>
  );
}
