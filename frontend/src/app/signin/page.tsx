import type { Metadata } from "next";
import { SignInFlow } from "@/components/SignInFlow";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { safeNextPath } from "@/lib/auth";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  const destination = safeNextPath(Array.isArray(next) ? next[0] : next, "/");

  return (
    <>
      <SiteHeader />
      <main id="main" className="bg-sky-mist">
        <div className="page py-10 sm:py-16">
          <div className="mx-auto max-w-md rounded-2xl border border-rule bg-white p-6 sm:p-10">
            <h1 className="display text-[2.25rem] leading-tight">Sign in</h1>
            <p className="mt-2 text-base text-ink-soft">No password. We&apos;ll email you a 6-digit code.</p>
            <div className="mt-6">
              <SignInFlow next={destination} />
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
