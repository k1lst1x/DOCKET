"use client";

import { useState } from "react";
import { ChatPanel, SparkIcon } from "@/components/chat/ChatPanel";

/** Full-page chat: a slim sidebar and a large conversation. */
export function ChatWorkspace() {
  const [session, setSession] = useState(0);

  return (
    <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="flex flex-col gap-4 rounded-2xl border border-rule bg-white p-4 md:p-5">
        <button type="button" onClick={() => setSession((s) => s + 1)} className="btn btn-primary w-full rounded-full">
          <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5">
            <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          New chat
        </button>
        <div className="hidden md:block">
          <p className="eyebrow">What I&apos;ve read</p>
          <ul className="mt-2 grid gap-1.5 text-sm text-ink-soft">
            <li>City Council agendas and minutes, June to September 2026</li>
            <li>Planning Commission agendas and minutes</li>
            <li>Fremont Unified school board agendas, May to September 2026</li>
            <li>City news, early September 2026</li>
            <li>Fremont&apos;s transportation plans</li>
          </ul>
        </div>
        <div className="mt-auto hidden rounded-xl bg-sky-mist p-4 md:block">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <SparkIcon className="h-4 w-4" />
            Every answer is sourced
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            Each answer links the documents it came from. If those don&apos;t cover your question, I&apos;ll say so. Conversations aren&apos;t saved between visits.
          </p>
        </div>
      </aside>
      <div className="min-h-[32rem] md:h-[calc(100svh-7.5rem)] md:min-h-0">
        <ChatPanel key={session} variant="page" autoFocus={session > 0} />
      </div>
    </div>
  );
}
