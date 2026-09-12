"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { EmptyState } from "@/components/EmptyState";
import { WatchItemCard } from "@/components/WatchItemCard";
import { formatNumber } from "@/lib/format";
import { parseJoin, type JoinFieldErrors } from "@/lib/join";
import type { WatchItem } from "@/lib/types";

interface JoinGroup {
  slug: string;
  name: string;
  district: string;
  memberCount: number;
  watchlist: string[];
}

interface Joined {
  email: string;
  devLinkInConsole: boolean;
  items: WatchItem[];
}

export function JoinFlow({ group }: { group: JoinGroup }) {
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

    const payload = { name, email, topics, otherTopic: somethingElse ? otherTopic : "", canSpeakEvenings };
    const check = parseJoin(payload, group.watchlist);
    if (!check.ok) {
      setErrors(check.errors);
      (check.errors.name ? nameRef : check.errors.email ? emailRef : otherRef).current?.focus();
      return;
    }
    setErrors({});
    setSubmitting(true);

    try {
      const res = await fetch(`/api/groups/${group.slug}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 400 && data?.fields) {
        setErrors(data.fields);
        return;
      }
      if (!res.ok || !data) {
        setFormError("We couldn't add you just now. Your details are still here; try again in a moment.");
        return;
      }
      setJoined({ email: data.email, devLinkInConsole: data.devLinkInConsole, items: data.group.items });
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
        <p className="mt-3 max-w-read text-lg text-ink-soft">
          We sent a sign-in link to <span className="font-semibold text-ink">{joined.email}</span>. You don&apos;t need it to
          read any of this. It&apos;s for voting and volunteering later.
        </p>
        {joined.devLinkInConsole ? (
          <p className="mt-3 inline-block rounded bg-white px-3 py-1.5 text-sm text-ink-soft">
            Development mode: the link is printed in the server console instead of emailed.
          </p>
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
          <Link href={`/g/${group.slug}`} className="btn btn-secondary">
            Go to the group page
          </Link>
        </div>
      </section>
    );
  }

  const otherSelected = somethingElse;

  return (
    <div className="mx-auto max-w-3xl rounded-lg border border-rule bg-white p-6 sm:p-10">
      <p className="eyebrow">
        {group.district} · {formatNumber(group.memberCount)} members
      </p>
      <h1 className="display mt-2 text-[2.25rem] leading-tight sm:text-[3rem]">Join {group.name}</h1>
      <p className="mt-3 text-lg text-ink-soft">
        One screen, no password. You&apos;ll see what the group is watching as soon as you join.
      </p>

      <form noValidate onSubmit={onSubmit} className="mt-8 grid gap-7">
        {formError ? (
          <div role="alert" className="rounded border border-signal/50 bg-signal-wash px-4 py-3 text-base text-signal">
            {formError}
          </div>
        ) : null}

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
            className="field"
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
            className="field"
          />
          <p id="join-email-hint" className="mt-2 text-sm text-ink-soft">
            We send a sign-in link here. You can read everything without clicking it.
          </p>
          <FieldError id="join-email-error" message={errors.email} />
        </div>

        <fieldset>
          <legend className="label">Topics you care about</legend>
          <p className="-mt-1 mb-3 text-sm text-ink-soft">Pick any. These are what {group.name} watches.</p>
          <div className="flex flex-wrap gap-2.5">
            {group.watchlist.map((topic) => (
              <Chip key={topic} label={topic} checked={topics.includes(topic)} onChange={() => toggleTopic(topic)} />
            ))}
            <Chip label="Something else" checked={otherSelected} onChange={() => setSomethingElse((v) => !v)} />
          </div>
          {otherSelected ? (
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
                className="field"
              />
              <FieldError id="join-other-error" message={errors.otherTopic} />
            </div>
          ) : null}
        </fieldset>

        <div className="flex items-start gap-3 rounded border border-rule bg-sky-mist p-4">
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
          <button type="submit" className="btn btn-primary" disabled={submitting} aria-busy={submitting}>
            {submitting ? "Joining…" : `Join ${group.name}`}
          </button>
          <p className="text-sm text-ink-soft">No password. Leave any time.</p>
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
      <span
        className="inline-flex h-11 items-center gap-2 rounded-full border border-field bg-white px-4 text-base text-ink transition-colors hover:bg-sky-mist peer-checked:border-ink peer-checked:bg-ink peer-checked:text-white peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink"
      >
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
