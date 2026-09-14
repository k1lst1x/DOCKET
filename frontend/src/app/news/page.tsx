import type { Metadata } from "next";
import { NewsCenter } from "@/components/news/NewsCenter";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "Fremont news",
  description: "Every recent Fremont story in one place: police and crime, fires and disasters, traffic, housing, city hall and community, by neighborhood.",
};

export default function NewsPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="bg-sky-mist">
        <section className="border-b border-rule bg-white">
          <div className="page py-8 sm:py-10">
            <p className="eyebrow">News</p>
            <h1 className="display mt-2 text-[2.5rem] leading-tight sm:text-[3.25rem]">Fremont news</h1>
            <p className="mt-2 max-w-read text-lg text-ink-soft">
              Every recent story, community post and live incident across Fremont&apos;s neighborhoods. Search it, filter it by neighborhood or topic,
              and it updates on its own while you read.
            </p>
          </div>
        </section>
        <div className="page py-6 sm:py-8">
          <NewsCenter />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
