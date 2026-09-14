"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { OPEN_CHAT_EVENT, useCurrentChatContext } from "@/components/chat/chat-context-store";
import { ChatPanel, SparkIcon, useChat } from "@/components/chat/ChatPanel";
import { contextKey } from "@/lib/chat-context";

/**
 * The open modal dialog on top, if any. A modal dialog makes the rest of the page inert and blurs it
 * behind its backdrop, so the chat bubble moves inside the dialog while one is open.
 */
function useTopModal(): HTMLDialogElement | null {
  const [modal, setModal] = useState<HTMLDialogElement | null>(null);
  useEffect(() => {
    const check = () => {
      const open = [...document.querySelectorAll("dialog")].filter((d) => {
        try {
          return d.open && d.matches(":modal");
        } catch {
          return d.open;
        }
      });
      setModal(open.at(-1) ?? null);
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    return () => observer.disconnect();
  }, []);
  return modal;
}

/** Floating chat bubble, bottom right, on every page except /chat. It knows what you're looking at. */
export function ChatWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const [dismissed, setDismissed] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const chat = useChat();
  const modal = useTopModal();
  const current = useCurrentChatContext();
  const context = current && contextKey(current) !== dismissed ? current : null;

  useEffect(() => {
    if (!open) return;
    // Capture, and cancel the key, so Escape closes the chat without also closing a dialog under it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  useEffect(() => {
    const onOpen = () => {
      setDismissed("");
      setEverOpened(true);
      setOpen(true);
    };
    window.addEventListener(OPEN_CHAT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CHAT_EVENT, onOpen);
  }, []);

  if (pathname.startsWith("/chat")) return null;

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const ui = (
    <>
      {everOpened ? (
        <div
          id="chat-popup"
          hidden={!open}
          className="fixed bottom-24 right-4 z-50 h-[min(36rem,calc(100svh-8rem))] w-[min(24rem,calc(100vw-2rem))] rounded-2xl text-left shadow-[0_18px_50px_rgba(38,38,38,0.22)] ring-1 ring-ink/10"
        >
          <ChatPanel
            variant="popup"
            chat={chat}
            context={context}
            onDismissContext={() => setDismissed(contextKey(current))}
            onClose={close}
            autoFocus={open}
          />
        </div>
      ) : null}
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls="chat-popup"
        aria-label={open ? "Close Docket assistant" : context ? `Ask Docket assistant about this ${context.label.toLowerCase()}` : "Open Docket assistant"}
        title={!open && context ? `Ask about “${context.title}”` : undefined}
        onClick={() => {
          setEverOpened(true);
          setOpen((v) => !v);
        }}
        className="on-dark fixed bottom-4 right-4 z-50 grid h-14 w-14 place-items-center rounded-full bg-ink text-white shadow-[0_10px_30px_rgba(38,38,38,0.28)] transition-transform hover:scale-105 hover:bg-ink-strong"
      >
        {open ? (
          <svg viewBox="0 0 20 20" aria-hidden="true" className="h-6 w-6">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : (
          <SparkIcon className="h-6 w-6" />
        )}
        {!open && context ? <span aria-hidden="true" className="absolute right-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-[#6DB33F] ring-2 ring-white" /> : null}
      </button>
    </>
  );

  return modal ? createPortal(ui, modal) : ui;
}
