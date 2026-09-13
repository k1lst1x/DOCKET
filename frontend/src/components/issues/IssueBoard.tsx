"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IssueDialog } from "@/components/issues/IssueDialog";
import { WatchItemCard } from "@/components/WatchItemCard";
import type { WatchItem } from "@/lib/types";

/**
 * The group's watched items. Each opens in a dialog; the open item lives in the
 * URL (?issue=…), so it can be shared, and Back closes it.
 */
export function IssueBoard({ items }: { items: WatchItem[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const trigger = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const syncFromUrl = () => {
      const id = new URLSearchParams(window.location.search).get("issue");
      setOpenId(id && items.some((i) => i.issueId === id) ? id : null);
    };
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, [items]);

  const open = (issueId: string, el: HTMLElement) => {
    trigger.current = el;
    const url = new URL(window.location.href);
    url.searchParams.set("issue", issueId);
    window.history.pushState({ docketIssue: issueId }, "", url);
    setOpenId(issueId);
  };

  const close = useCallback(() => {
    setOpenId(null);
    const url = new URL(window.location.href);
    if (url.searchParams.has("issue")) {
      if ((window.history.state as { docketIssue?: string } | null)?.docketIssue) {
        window.history.back();
      } else {
        url.searchParams.delete("issue");
        window.history.replaceState(window.history.state, "", url);
      }
    }
    trigger.current?.focus();
  }, []);

  return (
    <>
      <ol className="mt-8 grid gap-5">
        {items.map((item) => (
          <WatchItemCard key={item.id} item={item} onOpen={(el) => open(item.issueId, el)} />
        ))}
      </ol>
      <IssueDialog issueId={openId} onClose={close} fallbackTitle={items.find((i) => i.issueId === openId)?.title} />
    </>
  );
}
