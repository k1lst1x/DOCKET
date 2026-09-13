"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CodeEntry } from "@/components/CodeEntry";
import { EmptyState } from "@/components/EmptyState";
import { WatchItemCard } from "@/components/WatchItemCard";
import type { CodeStatus } from "@/lib/auth-codes";
import { formatNumber } from "@/lib/format";
import { parseJoin, parsePreferences, type JoinFieldErrors } from "@/lib/join";
import type { WatchItem } from "@/lib/types";

interface JoinGroup {
  slug: string;
  name: string;
  district: string;
  memberCount: number;
  watchlist: string[];
}

interface SignedInMember {
  name: string;
  email: string;
}

interface Joined {
  email: string;
  /** "member": a signed-in member joined in one step, no code needed. */
  code: CodeStatus | "member";
  items: WatchItem[];
}

function codeProblem(code: CodeStatus, email: string) {
  switch (code) {
    case "undeliverable":
      return `We couldn't send a code to ${email} yet, so voting from this device will have to wait. Everything below is still yours to read.`;
    case "busy":
      return "Too many codes were requested just now. You can sign in again in a minute from the Sign in button.";
    case "not_configured":
      return "Sign-in isn't set up on this server yet, so we couldn't send a code.";
    default:
      return "We couldn't send your code just now. You can sign in later from the Sign in button.";
  }
}

export function JoinFlow({ group, member }: { group: JoinGroup; member: SignedInMember | null }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [topics, setTopics] = useState<string[]>([]);
  const [somethingElse, setSomethingElse] = useState(false);
  const [otherTopic, setOtherTopic] = useState("");
  const [canSpeakEvenings, setCanSpeakEvenings] = useState(false);
  const [errors, setErrors] = useState<JoinFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [joined, setJoined] = useState<Joined | null>(null);
  const [signedInAs, setSignedInAs] = useState<string | null>(null);

  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const otherRef = useRef<HTMLInputElement>(null);
  const joinedHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (joined) joinedHeading.current?.focus();
  }, [joined]);

  const toggleTopic = (topic: string) =>
    setTopics((current) => (current.includes(topic) ? current.filter((t) => t !== topic) : [...current, topic]));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const preferences = { topics, otherTopic: somethingElse ? otherTopic : "", canSpeakEvenings };
    const payload = member ? preferences : { name, email, ...preferences };
    const check = member ? parsePreferences(payload, group.watchlist) : parseJoin(payload, group.watchlist);
    if (!check.ok) {
      setErrors(check.errors);
      (check.errors.name ? nameRef : check.errors.email ? emailRef : otherRef).current?.focus();
      return;
    }
    setErrors({});
    setSubmitting(true);

    try {
      const res = await fetch(`/api/groups/${group.slug}/${member ? "membership" : "join"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 400 && data?.fields) {
        setErrors(data.fields);
        return;
      }
      if (member && res.status === 401) {
        setFormError("Your sign-in has expired. Reload the page to join with your name and email.");
        return;
      }
      if (!res.ok || !data) {
        setFormError(
          res.status === 429
            ? "Too many join requests from this connection. Wait a minute and try again."
            : "We couldn't add you just now. Your choices are still here; try again in a moment.",
        );
        return;
      }
      if (member) {
        setSignedInAs(member.name);
        setJoined({ email: member.email, code: "member", items: data.group.items });
        router.refresh();
      } else {
        setJoined({ email: data.email, code: data.code, items: data.group.items });
      }
    } catch {
      setFormError("We couldn't reach Docket. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (joined) {
    return (
      <section aria-labelledby="joined-heading" className="mx-auto max-w-4xl">
        <p className="eyebrow text-park">You&apos;re in</p>
        <h1 id="joined-heading" ref={joinedHeading} tabIndex={-1} className="display mt-2 text-[2.25rem] leading-tight sm:text-[3rem]">
          Here&apos;s what {group.name} is watching.
        </h1>

        {signedInAs ? (
          <p role="status" className="mt-5 inline-flex rounded-2xl bg-park-wash px-4 py-3 text-base font-semibold text-park">
            {joined.code === "member"
              ? `Saved to your account, ${signedInAs}. You won't need to join again.`
              : `Email confirmed. You're signed in as ${signedInAs}.`}
          </p>
        ) : joined.code === "sent" ? (
          <div className="mt-6 max-w-read rounded-2xl border border-rule bg-white p-5 sm:p-6">
            <CodeEntry
              email={joined.email}
              intro={
                <>
                  We emailed a 6-digit code to <span className="font-semibold text-ink">{joined.email}</span>. Enter it to confirm your
                  email so you can vote and volunteer. You can read everything below either way.
                </>
              }
              onVerified={({ name: verifiedName }) => {
                setSignedInAs(verifiedName);
                router.refresh();
              }}
            />
          </div>
        ) : joined.code !== "member" ? (
          <p className="mt-5 max-w-read rounded-2xl bg-white px-4 py-3 text-base text-ink-soft">{codeProblem(joined.code, joined.email)}</p>
        ) : null}

        {joined.items.length ? (
          <ol className="mt-8 grid gap-5">
            {joined.items.map((item) => (
              <WatchItemCard key={item.id} item={item} />
            ))}
          </ol>
        ) : (
          <EmptyState
            className="mt-8"
            headline={`Nothing on the agenda for ${group.district} right now.`}
            body="When Docket finds something that touches these streets, it will show up on the group page before the deadline."
          />
        )}

        <div className="mt-8">
          <Link href={`/g/${group.slug}`} className="btn btn-primary rounded-full">
            Open the group page to vote
          </Link>
        </div>
      </section>
    );
  }

  return (
    <div className="mx-auto max-w-3xl rounded-2xl border border-rule bg-white p-6 sm:p-10">
      <p className="eyebrow">
        {group.district} · {formatNumber(group.memberCount)} members
      </p>
      <h1 className="display mt-2 text-[2.25rem] leading-tight sm:text-[3rem]">Join {group.name}</h1>
      <p className="mt-3 text-lg text-ink-soft">
        {member ? (
          <>
            You&apos;re signed in as <span className="font-semibold text-ink">{member.name}</span>, so this is one step: pick what you care
            about and join.
          </>
        ) : (
          "One screen, no password. You'll see what the group is watching as soon as you join."
        )}
      </p>

      <form noValidate onSubmit={onSubmit} className="mt-8 grid gap-7">
        {formError ? (
          <div role="alert" className="rounded-xl border border-signal/50 bg-signal-wash px-4 py-3 text-base text-signal">
            {formError}
          </div>
        ) : null}

        {member ? null : (
          <>
            <div>
              <label htmlFor="join-name" className="label">
                Your name
              </label>
              <input
                ref={nameRef}
                id="join-name"
                name="name"
                type="text"
                autoComplete="name"
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? "join-name-error" : undefined}
                className="field rounded-xl"
              />
              <FieldError id="join-name-error" message={errors.name} />
            </div>

            <div>
              <label htmlFor="join-email" className="label">
                Email
              </label>
              <input
                ref={emailRef}
                id="join-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={Boolean(errors.email)}
                aria-describedby={`join-email-hint${errors.email ? " join-email-error" : ""}`}
                className="field rounded-xl"
              />
              <p id="join-email-hint" className="mt-2 text-sm text-ink-soft">
                We&apos;ll email a 6-digit code so you can vote later. You can read everything without it.
              </p>
              <FieldError id="join-email-error" message={errors.email} />
            </div>
          </>
        )}

        <fieldset>
          <legend className="label">Topics you care about</legend>
          <p className="-mt-1 mb-3 text-sm text-ink-soft">Pick any. These are what {group.name} watches.</p>
          <div className="flex flex-wrap gap-2.5">
            {group.watchlist.map((topic) => (
              <Chip key={topic} label={topic} checked={topics.includes(topic)} onChange={() => toggleTopic(topic)} />
            ))}
            <Chip label="Something else" checked={somethingElse} onChange={() => setSomethingElse((v) => !v)} />
          </div>
          {somethingElse ? (
            <div className="mt-4">
              <label htmlFor="join-other" className="label">
                What else should the group watch?
              </label>
              <input
                ref={otherRef}
                id="join-other"
                name="otherTopic"
                type="text"
                maxLength={120}
                value={otherTopic}
                onChange={(e) => setOtherTopic(e.target.value)}
                aria-invalid={Boolean(errors.otherTopic)}
                aria-describedby={errors.otherTopic ? "join-other-error" : undefined}
                className="field rounded-xl"
              />
              <FieldError id="join-other-error" message={errors.otherTopic} />
            </div>
          ) : null}
        </fieldset>

        <div className="flex items-start gap-3 rounded-xl border border-rule bg-sky-mist p-4">
          <input
            id="join-speak"
            name="canSpeakEvenings"
            type="checkbox"
            checked={canSpeakEvenings}
            onChange={(e) => setCanSpeakEvenings(e.target.checked)}
            aria-describedby="join-speak-hint"
            className="mt-1 h-5 w-5 shrink-0 accent-ink"
          />
          <div>
            <label htmlFor="join-speak" className="text-base font-semibold text-ink">
              I can sometimes speak at evening hearings
            </label>
            <p id="join-speak-hint" className="text-sm text-ink-soft">
              Puts you on the group&apos;s speaker rota for council and commission meetings.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <button type="submit" className="btn btn-primary rounded-full" disabled={submitting} aria-busy={submitting}>
            {submitting ? "Joining…" : `Join ${group.name}`}
          </button>
          <p className="text-sm text-ink-soft">{member ? "Saved to your account." : "No password. Leave any time."}</p>
        </div>
      </form>
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

function Chip({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="relative inline-flex cursor-pointer">
      <input type="checkbox" checked={checked} onChange={onChange} className="peer sr-only" />
      <span className="inline-flex h-11 items-center gap-2 rounded-full border border-field bg-white px-4 text-base text-ink transition-colors hover:bg-sky-mist peer-checked:border-ink peer-checked:bg-ink peer-checked:text-white peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink">
        {checked ? (
          <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4">
            <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        ) : null}
        {label}
      </span>
    </label>
  );
}
