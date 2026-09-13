"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface Me {
  signedIn: boolean;
  name?: string;
}

/** Header account control: "Sign in", or the member's initial with a sign-out menu. */
export function AccountLink() {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { signedIn: false }))
      .then((data: Me) => active && setMe(data))
      .catch(() => active && setMe({ signedIn: false }));
    return () => {
      active = false;
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
    setMe({ signedIn: false });
    router.refresh();
  }

  if (!me) return <span aria-hidden="true" className="inline-block h-10 w-10" />;

  if (!me.signedIn) {
    if (pathname.startsWith("/signin")) return null;
    return (
      <Link
        href={`/signin?next=${encodeURIComponent(pathname)}`}
        className="inline-flex h-10 items-center rounded-full border border-ink/25 bg-white/60 px-3 text-base font-medium text-ink hover:bg-white sm:px-4"
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
        className="on-dark grid h-10 w-10 place-items-center rounded-full bg-park text-base font-semibold text-white hover:bg-park-deep"
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
