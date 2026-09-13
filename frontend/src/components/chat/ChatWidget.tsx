"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChatPanel, SparkIcon } from "@/components/chat/ChatPanel";

/** Floating chat bubble, bottom right, on every page except /chat. */
export function ChatWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

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

  if (pathname.startsWith("/chat")) return null;

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <>
      {everOpened ? (
        <div
          id="chat-popup"
          hidden={!open}
          className="fixed bottom-24 right-4 z-50 h-[min(36rem,calc(100svh-8rem))] w-[min(24rem,calc(100vw-2rem))] rounded-2xl shadow-[0_18px_50px_rgba(38,38,38,0.22)] ring-1 ring-ink/10"
        >
          <ChatPanel variant="popup" onClose={close} autoFocus={open} />
        </div>
      ) : null}
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls="chat-popup"
        aria-label={open ? "Close Docket assistant" : "Open Docket assistant"}
        onClick={() => {
          setEverOpened(true);
          setOpen((v) => !v);
        }}
        className="on-dark fixed bottom-4 right-4 z-50 grid h-14 w-14 place-items-center rounded-full bg-ink text-white shadow-[0_10px_30px_rgba(38,38,38,0.28)] transition-transform hover:scale-105 hover:bg-black"
      >
        {open ? (
          <svg viewBox="0 0 20 20" aria-hidden="true" className="h-6 w-6">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : (
          <SparkIcon className="h-6 w-6" />
        )}
      </button>
    </>
  );
}
