import type { Metadata } from "next";
import { SignInFlow } from "@/components/SignInFlow";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { safeNextPath } from "@/lib/auth";

export const metadata: Metadata = { title: "Log in or register", robots: { index: false } };

type Search = { next?: string | string[]; mode?: string | string[] };

export default async function SignInPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { next, mode } = await searchParams;
  // With no destination, signing in opens the app (/app), not the landing page.
  const destination = safeNextPath(Array.isArray(next) ? next[0] : next, "/app");
  const initialMode = (Array.isArray(mode) ? mode[0] : mode) === "register" ? "register" : "login";

  return (
    <>
      <SiteHeader />
      <main id="main" className="bg-sky-mist">
        <div className="page py-10 sm:py-16">
          <div className="mx-auto max-w-md rounded-2xl border border-rule bg-white p-6 sm:p-10">
            <SignInFlow next={destination} initialMode={initialMode} />
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
