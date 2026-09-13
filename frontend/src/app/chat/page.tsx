import type { Metadata } from "next";
import { ChatWorkspace } from "@/components/chat/ChatWorkspace";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "Chat",
  description: "Ask Docket about Fremont agenda items, neighborhood votes and places.",
};

export default function ChatPage() {
  return (
    <div className="flex min-h-[100svh] flex-col bg-sky-mist">
      <SiteHeader />
      <main id="main" className="page flex min-h-0 flex-1 flex-col py-4 sm:py-6">
        <ChatWorkspace />
      </main>
    </div>
  );
}
