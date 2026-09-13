"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

// Chat UI. Messages go to /api/chat, which streams answers from Docket's chat agent. Every
// answer arrives with the sources it cites. When the agent is unreachable (including the static
// preview, which has no API routes) the assistant shows the NOT_CONNECTED notice instead.

interface Citation {
  ref: number;
  title: string;
  locator: string;
  url: string;
}

interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
  citations?: Citation[];
}

type ChatEvent =
  | { type: "status"; message: string }
  | { type: "text"; text: string }
  | { type: "final"; answer: string; citations?: Citation[]; session_id?: string; refused?: boolean }
  | { type: "error"; message: string };

const GREETING =
  "Hi, I'm Docket's assistant. Soon I'll explain agenda items, summarize how neighbors voted, and find places near you.";
const NOT_CONNECTED =
  "I'm not connected to Docket's data yet, so I can't answer that for real. Once I am, I'll answer with sources from Fremont city documents.";

const SUGGESTIONS = [
  "What's due this week in Niles?",
  "Explain the Irvington BART traffic plan",
  "Which schools are near Lake Elizabeth?",
];

const isHttpUrl = (url: string) => /^https?:\/\//i.test(url);

function parseEvents(block: string): ChatEvent[] {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return [];
  try {
    return [JSON.parse(data) as ChatEvent];
  } catch {
    return [];
  }
}

interface ChatPanelProps {
  variant: "popup" | "page";
  onClose?: () => void;
  autoFocus?: boolean;
}

export function ChatPanel({ variant, onClose, autoFocus = false }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([{ id: 0, role: "assistant", text: GREETING }]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);
  const sessionRef = useRef<string | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  function upsertReply(reply: Message) {
    setMessages((m) => (m.some((msg) => msg.id === reply.id) ? m.map((msg) => (msg.id === reply.id ? reply : msg)) : [...m, reply]));
  }

  async function send(text: string) {
    const clean = text.trim();
    if (!clean || thinking) return;
    const replyId = nextId.current + 1;
    setMessages((m) => [...m, { id: nextId.current, role: "user", text: clean }]);
    nextId.current += 2;
    setDraft("");
    setThinking(true);

    let streamed = "";
    let finished = false;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: clean, session_id: sessionRef.current }),
      });
      if (!res.ok || !res.body) throw new Error(`chat request failed: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          for (const event of parseEvents(block)) {
            if (event.type === "text") {
              streamed += event.text;
              setThinking(false);
              upsertReply({ id: replyId, role: "assistant", text: streamed });
            } else if (event.type === "final") {
              finished = true;
              if (event.session_id) sessionRef.current = event.session_id;
              upsertReply({
                id: replyId,
                role: "assistant",
                text: event.answer,
                citations: (event.citations ?? []).filter((c) => isHttpUrl(c.url)),
              });
            } else if (event.type === "error") {
              throw new Error(event.message);
            }
          }
          boundary = buffer.indexOf("\n\n");
        }
      }
      if (!finished) throw new Error("chat stream ended early");
    } catch {
      upsertReply({ id: replyId, role: "assistant", text: NOT_CONNECTED });
    } finally {
      setThinking(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(draft);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(draft);
    }
  }

  const onlyGreeting = messages.length === 1;

  return (
    <section
      aria-labelledby={titleId}
      className={`flex h-full min-h-0 flex-col overflow-hidden bg-white ${variant === "popup" ? "rounded-2xl" : "rounded-2xl border border-rule"}`}
    >
      <header className="flex items-center gap-3 border-b border-rule px-5 py-4">
        <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-full bg-[linear-gradient(135deg,#8DC2F5,#6DB33F)] text-white">
          <SparkIcon />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-base font-semibold leading-tight text-ink">
            Docket assistant
          </h2>
          <p className="text-sm text-ink-muted">Preview · not connected yet</p>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close chat"
            className="grid h-10 w-10 place-items-center rounded-full text-ink hover:bg-ink/5"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        ) : null}
      </header>

      <div ref={logRef} role="log" aria-live="polite" aria-label="Conversation" className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-5 sm:px-5">
        {messages.map((m) => (
          <div key={m.id} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
            <p
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-base leading-relaxed ${
                m.role === "user" ? "rounded-br-md bg-ink text-white" : "rounded-bl-md bg-sky-mist text-ink"
              }`}
            >
              <span className="sr-only">{m.role === "user" ? "You: " : "Assistant: "}</span>
              {m.text}
            </p>
            {m.citations && m.citations.length > 0 ? (
              <ul aria-label="Sources" className="mt-1.5 max-w-[85%] space-y-1 pl-1 text-sm text-ink-muted">
                {m.citations.map((c) => (
                  <li key={`${m.id}-${c.ref}`}>
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline decoration-rule underline-offset-2 hover:text-ink"
                    >
                      [{c.ref}] {c.title}
                      {c.locator && c.locator !== "document start" ? ` — ${c.locator}` : ""}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
        {thinking ? (
          <div className="flex justify-start">
            <p className="flex items-center gap-1.5 rounded-2xl rounded-bl-md bg-sky-mist px-4 py-3.5">
              <span className="sr-only">Assistant is typing</span>
              {[0, 1, 2].map((i) => (
                <span key={i} aria-hidden="true" className="h-2 w-2 animate-bounce rounded-full bg-ink-muted" style={{ animationDelay: `${i * 120}ms` }} />
              ))}
            </p>
          </div>
        ) : null}
        {onlyGreeting ? (
          <div className="flex flex-wrap gap-2 pt-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void send(s)}
                className="rounded-full border border-rule bg-white px-3.5 py-2 text-left text-sm text-ink hover:border-ink/40 hover:bg-sky-mist"
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <form onSubmit={onSubmit} className="border-t border-rule p-3 sm:p-4">
        <div className="flex items-end gap-2 rounded-2xl border border-field bg-white p-1.5 pl-4 focus-within:border-ink">
          <label htmlFor={`${titleId}-input`} className="sr-only">
            Message Docket assistant
          </label>
          <textarea
            ref={inputRef}
            id={`${titleId}-input`}
            rows={1}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
            }}
            onKeyDown={onKeyDown}
            placeholder="Ask about Fremont…"
            className="max-h-40 min-h-[2.5rem] flex-1 resize-none bg-transparent py-2 text-base text-ink placeholder:text-ink-muted focus:outline-none"
          />
          <button
            type="submit"
            disabled={!draft.trim() || thinking}
            aria-label="Send message"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink text-white transition-opacity hover:bg-black disabled:opacity-40"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5">
              <path d="M10 16V4M4.5 9.5L10 4l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <p className="mt-2 px-1 text-sm text-ink-muted">Enter to send · Shift + Enter for a new line</p>
      </form>
    </section>
  );
}

export function SparkIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={className}>
      <path d="M10 2l1.8 4.9L17 8.5l-5.2 1.7L10 15l-1.8-4.8L3 8.5l5.2-1.6z" fill="currentColor" />
      <circle cx="16" cy="15.5" r="1.6" fill="currentColor" />
    </svg>
  );
}
