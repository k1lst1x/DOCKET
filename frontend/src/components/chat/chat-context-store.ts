"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { ChatContext } from "@/lib/chat-context";

// The one thing the assistant popup treats as "what you're looking at". Pages share a context at
// priority 1, a selected item at 2 and an open popup at 3; the highest priority wins, and the most
// recent one breaks ties. Contexts are removed when the component sharing them goes away.

interface Entry {
  id: number;
  priority: number;
  context: ChatContext;
}

let entries: Entry[] = [];
let current: ChatContext | null = null;
let nextId = 0;
const listeners = new Set<() => void>();

function publish() {
  let best: Entry | null = null;
  for (const entry of entries) {
    if (!best || entry.priority > best.priority || (entry.priority === best.priority && entry.id > best.id)) best = entry;
  }
  current = best?.context ?? null;
  for (const listener of listeners) listener();
}

/** Shares what this component shows with the assistant while it is mounted. */
export function useChatContext(context: ChatContext | null, priority = 1) {
  const serialized = context ? JSON.stringify(context) : null;
  useEffect(() => {
    if (!serialized) return;
    const entry: Entry = { id: ++nextId, priority, context: JSON.parse(serialized) as ChatContext };
    entries = [...entries, entry];
    publish();
    return () => {
      entries = entries.filter((e) => e !== entry);
      publish();
    };
  }, [serialized, priority]);
}

/** For server-rendered pages: renders nothing and shares the context while the page is open. */
export function ShareChatContext({ context, priority = 1 }: { context: ChatContext; priority?: number }) {
  useChatContext(context, priority);
  return null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCurrentChatContext(): ChatContext | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}

export const OPEN_CHAT_EVENT = "docket:open-chat";

/** Opens the assistant popup with whatever is on screen as context. */
export function openChat() {
  window.dispatchEvent(new Event(OPEN_CHAT_EVENT));
}
