"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { forgetMe, loadMe, peekMe, subscribeMe } from "@/lib/me-client";

/** Header account control: "Sign in", or the member's initial with a sign-out menu. */
export function AccountLink() {
  const pathname = usePathname();
  const router = useRouter();
  // Every page has its own header, so start from the answer the last page already fetched.
  const [me, setMe] = useState(peekMe);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    const refresh = () => void loadMe().then((data) => active && setMe(data));
    refresh();
    const unsubscribe = subscribeMe(refresh);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function signOut() {
    await fetch("/api/auth/signout", { method: "POST" }).catch(() => null);
    setOpen(false);
    forgetMe({ signedIn: false });
    router.refresh();
  }

  if (!me) return <span aria-hidden="true" className="inline-block h-10 w-10" />;

  if (!me.signedIn) {
    if (pathname.startsWith("/signin")) return null;
    return (
      <Link
        href={`/signin?next=${encodeURIComponent(pathname)}`}
        className="inline-flex h-10 items-center whitespace-nowrap rounded-full border border-ink/25 bg-white/60 px-3 text-[0.9375rem] font-medium text-ink hover:bg-white sm:px-4 sm:text-base"
      >
        Sign in
      </Link>
    );
  }

  const initial = (me.name ?? "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls="account-menu"
        aria-label={`Account menu for ${me.name ?? "you"}`}
        onClick={() => setOpen((v) => !v)}
        className="on-dark grid h-10 w-10 place-items-center rounded-full bg-park text-base font-semibold text-white hover:opacity-90"
      >
        {initial}
      </button>
      {open ? (
        <div id="account-menu" className="absolute right-0 top-12 z-40 w-60 rounded-2xl border border-rule bg-white p-3 shadow-[0_14px_36px_rgba(38,38,38,0.16)]">
          <p className="px-2 text-sm text-ink-muted">Signed in as</p>
          <p className="truncate px-2 text-base font-semibold text-ink">{me.name}</p>
          <button type="button" onClick={signOut} className="mt-2 w-full rounded-xl px-2 py-2 text-left text-base text-ink hover:bg-sky-mist">
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
