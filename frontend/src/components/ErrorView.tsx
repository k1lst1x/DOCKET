import type { ReactNode } from "react";
import { ErrorScene } from "@/components/pixel/ErrorScene";

interface ErrorViewProps {
  code: string;
  label: string;
  headline: string;
  body: ReactNode;
  actions: ReactNode;
  mood: "lost" | "broken";
}

/** Shared body for the 404 and error pages: the message beside the status code built from blocks. */
export function ErrorView({ code, label, headline, body, actions, mood }: ErrorViewProps) {
  return (
    <main id="main" className="bg-sky-mist">
      <div className="page py-6 sm:py-12">
        <section className="grid overflow-hidden rounded-2xl border border-rule bg-gradient-to-b from-sky-top/70 via-sky to-sky-haze lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-end">
          <div className="px-6 pb-4 pt-8 sm:px-10 sm:pt-12 lg:pb-14">
            <p className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 font-mono text-sm font-medium text-ink">
              <span aria-hidden="true" className={`h-2 w-2 rounded-full ${mood === "lost" ? "bg-ochre" : "bg-signal"}`} />
              {code} · {label}
            </p>
            <h1 className="display mt-4 text-[2rem] leading-[1.1] sm:text-[2.75rem]">{headline}</h1>
            <div className="mt-3 max-w-read text-lg leading-relaxed text-ink-soft">{body}</div>
            <div className="mt-7 flex flex-wrap gap-3">{actions}</div>
          </div>
          <ErrorScene code={code} mood={mood} className="mx-auto h-auto w-full max-w-xl" />
        </section>
      </div>
    </main>
  );
}
