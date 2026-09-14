"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { contextSuggestions, type ChatContext } from "@/lib/chat-context";

// Chat UI. Messages go to /api/chat, which streams answers from Docket's chat agent. Every
// answer arrives with the sources it cites. When the agent is unreachable (including the static
// preview, which has no API routes) the assistant shows the NOT_CONNECTED notice instead.

interface Citation {
  ref: number;
  title: string;
  locator: string;
  url: string;
  /** Document date (YYYY-MM-DD) when the agent knows it; tells same-titled meetings apart. */
  date?: string | null;
}

const citationDate = (date?: string | null) =>
  date && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`))
    : null;

interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
  citations?: Citation[];
  /** False for general answers that don't come from Fremont city documents. */
  grounded?: boolean;
  /** For questions: the title of what the person was looking at when they asked. */
  about?: string;
}

type ChatEvent =
  | { type: "status"; message: string }
  | { type: "text"; text: string }
  | { type: "final"; answer: string; citations?: Citation[]; session_id?: string; refused?: boolean; grounded?: boolean }
  | { type: "error"; message: string };

// Keep these in step with what the chat agent has actually read (see backend/ ingest).
const GREETING =
  "Hi, I'm Docket's assistant. Ask me about Fremont City Council and Planning Commission agendas and minutes (June to September 2026), Fremont Unified school board agendas, recent city news, or the city's transportation plans. I link the documents behind every answer.";
const NOT_CONNECTED =
  "I'm not connected to Docket's data yet, so I can't answer that for real. Once I am, I'll answer with sources from Fremont city documents.";
// An outage (server error, expired credentials, dropped stream) rather than "never set up".
const UNAVAILABLE = "The assistant is temporarily unavailable. Please try again in a moment.";

const SUGGESTIONS = [
  "What's on the September 15 City Council agenda?",
  "What is the Fremont-Decoto Land Development Plan?",
  "What did the City Council decide about the City charter in July?",
];

const isHttpUrl = (url: string) => /^https?:\/\//i.test(url);

/**
 * Model output uses narrow no-break spaces and non-breaking hyphens that wrap
 * badly, and sometimes markdown emphasis the plain-text bubble would show literally.
 */
function tidy(text: string): string {
  return text
    .replace(/^[ \t]*[*-][ \t]+/gm, "• ")
    .replace(/[    ]/g, " ")
    .replace(/[‐‑]/g, "-")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/(^|[\s(“"'])\*([^*\n]+)\*(?=[\s).,;:!?”"']|$)/g, "$1$2");
}

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

export interface ChatState {
  messages: Message[];
  draft: string;
  setDraft: (draft: string) => void;
  /** Waiting for the first words of an answer. */
  thinking: boolean;
  /** An answer is still arriving. */
  pending: boolean;
  statusText: string | null;
  send: (text: string, context?: ChatContext | null) => Promise<void>;
}

/**
 * The conversation. It lives with whoever owns the panel (the popup or the chat page), so moving the
 * popup above an open dialog keeps the messages, the draft and an answer that is still streaming.
 */
export function useChat(): ChatState {
  const [messages, setMessages] = useState<Message[]>([{ id: 0, role: "assistant", text: GREETING }]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [pending, setPending] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const nextId = useRef(1);
  const sessionRef = useRef<string | null>(null);
  const busy = useRef(false);

  function upsertReply(reply: Message) {
    setMessages((m) => (m.some((msg) => msg.id === reply.id) ? m.map((msg) => (msg.id === reply.id ? reply : msg)) : [...m, reply]));
  }

  async function send(text: string, context: ChatContext | null = null) {
    const clean = text.trim();
    if (!clean || busy.current) return;
    busy.current = true;
    setPending(true);
    const replyId = nextId.current + 1;
    setMessages((m) => [...m, { id: nextId.current, role: "user", text: clean, about: context?.title }]);
    nextId.current += 2;
    setDraft("");
    setThinking(true);

    let streamed = "";
    let finished = false;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: clean, session_id: sessionRef.current, context }),
      });
      if (!res.ok || !res.body) {
        // 503: chat isn't configured; 404: no API routes (static preview). Anything else is an outage.
        upsertReply({ id: replyId, role: "assistant", text: res.status === 503 || res.status === 404 ? NOT_CONNECTED : UNAVAILABLE });
        return;
      }

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
            if (event.type === "status") {
              setStatusText(event.message);
            } else if (event.type === "text") {
              streamed += event.text;
              setThinking(false);
              setStatusText(null);
              upsertReply({ id: replyId, role: "assistant", text: streamed });
            } else if (event.type === "final") {
              finished = true;
              if (event.session_id) sessionRef.current = event.session_id;
              upsertReply({
                id: replyId,
                role: "assistant",
                text: event.answer,
                citations: (event.citations ?? []).filter((c) => isHttpUrl(c.url)),
                grounded: event.grounded,
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
      upsertReply({ id: replyId, role: "assistant", text: UNAVAILABLE });
    } finally {
      busy.current = false;
      setPending(false);
      setThinking(false);
      setStatusText(null);
    }
  }

  return { messages, draft, setDraft, thinking, pending, statusText, send };
}

interface ChatPanelProps {
  variant: "popup" | "page";
  chat: ChatState;
  /** What the person is looking at; questions are sent with it. */
  context?: ChatContext | null;
  onDismissContext?: () => void;
  onClose?: () => void;
  autoFocus?: boolean;
}

export function ChatPanel({ variant, chat, context = null, onDismissContext, onClose, autoFocus = false }: ChatPanelProps) {
  const { messages, draft, setDraft, thinking, pending, statusText, send } = chat;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(draft, context);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(draft, context);
    }
  }

  const onlyGreeting = messages.length === 1;
  const lastAbout = [...messages].reverse().find((m) => m.role === "user")?.about;
  // Starter questions at the start, and again whenever there's something new on screen to ask about.
  const suggestions = context ? contextSuggestions(context) : SUGGESTIONS;
  const showSuggestions = !pending && (onlyGreeting || (context !== null && lastAbout !== context.title));

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
          <p className="text-sm text-ink-muted">Answers from Fremont city documents</p>
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

      {context ? (
        <div className="flex items-center gap-3 border-b border-rule bg-sky-mist px-4 py-2.5 sm:px-5">
          <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-ink-soft">
            <svg viewBox="0 0 20 20" className="h-4 w-4">
              <path d="M1.5 10S4.5 4 10 4s8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6z" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <circle cx="10" cy="10" r="2.5" fill="currentColor" />
            </svg>
          </span>
          <p className="min-w-0 flex-1">
            <span className="block text-xs font-semibold text-ink-muted">Asking about this {context.label.toLowerCase()}</span>
            <span className="line-clamp-2 text-sm font-semibold leading-snug text-ink">{context.title}</span>
          </p>
          {onDismissContext ? (
            <button
              type="button"
              onClick={onDismissContext}
              aria-label="Ask without this context"
              title="Ask without this context"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-soft hover:bg-ink/5"
            >
              <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          ) : null}
        </div>
      ) : null}

      <div ref={logRef} role="log" aria-live="polite" aria-label="Conversation" className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-5 sm:px-5">
        {messages.map((m) => (
          <div key={m.id} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
            {m.role === "user" && m.about ? (
              <span className="mb-1 mr-1 max-w-[85%] truncate text-xs text-ink-muted">About: {m.about}</span>
            ) : null}
            {m.role === "assistant" && m.grounded === false ? (
              <span className="mb-1 ml-1 rounded-full bg-ochre-wash px-2.5 py-0.5 text-sm font-semibold text-ochre">
                General answer · not from city documents
              </span>
            ) : null}
            <p
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-base leading-relaxed ${
                m.role === "user" ? "rounded-br-md bg-ink text-white" : "rounded-bl-md bg-sky-mist text-ink"
              }`}
            >
              <span className="sr-only">{m.role === "user" ? "You: " : "Assistant: "}</span>
              {m.role === "assistant" ? tidy(m.text) : m.text}
            </p>
            {m.citations && m.citations.length > 0 ? (
              <ul aria-label="Sources" className="mt-2 grid w-full max-w-[85%] gap-1.5">
                {m.citations.map((c) => {
                  // Locators span a whole chunk ("first heading … last heading") and read as the
                  // wrong section, so the source is shown by document title only.
                  return (
                    <li key={`${m.id}-${c.ref}`} className="min-w-0">
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={citationDate(c.date) ? `${c.title} · ${citationDate(c.date)}` : c.title}
                        className="flex w-full min-w-0 items-center gap-2.5 overflow-hidden rounded-xl border border-rule bg-white px-3 py-2 text-sm transition-colors hover:border-ink/30 hover:bg-sky-mist"
                      >
                        <span className="shrink-0 rounded-md bg-sky-mist px-1.5 font-mono text-ink-soft">{c.ref}</span>
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 break-words font-semibold leading-snug text-ink">{c.title}</span>
                          {citationDate(c.date) ? <span className="block text-ink-muted">{citationDate(c.date)}</span> : null}
                        </span>
                        <svg viewBox="0 0 16 16" aria-hidden="true" className="mt-1 h-3.5 w-3.5 shrink-0 text-ink-muted">
                          <path d="M6 3h7v7M13 3L5.5 10.5M11 9.5V13H3V5h3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span className="sr-only">(opens in a new tab)</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        ))}
        {thinking ? (
          <div className="flex justify-start">
            <p className="flex items-center gap-3 rounded-2xl rounded-bl-md bg-sky-mist px-4 py-3">
              <span className="sr-only">{statusText ?? "Assistant is typing"}</span>
              <span aria-hidden="true" className="flex items-center gap-1.5">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-ink-muted" style={{ animationDelay: `${i * 120}ms` }} />
                ))}
              </span>
              {statusText ? (
                <span aria-hidden="true" className="text-sm text-ink-soft">
                  {statusText}
                </span>
              ) : null}
            </p>
          </div>
        ) : null}
        {showSuggestions ? (
          <div className="flex flex-wrap gap-2 pt-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void send(s, context)}
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
            placeholder={context ? `Ask about this ${context.label.toLowerCase()}…` : "Ask about Fremont…"}
            className="max-h-40 min-h-[2.5rem] flex-1 resize-none bg-transparent py-2 text-base text-ink placeholder:text-ink-muted focus:outline-none"
          />
          <button
            type="submit"
            disabled={!draft.trim() || pending}
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
