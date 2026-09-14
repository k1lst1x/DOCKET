import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NewsFeed } from "@/components/news/NewsFeed";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { getGroup, listGroups } from "@/lib/data";

type Params = Promise<{ slug: string }>;

export function generateStaticParams() {
  return listGroups().map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const group = getGroup((await params).slug);
  if (!group) return { title: "Group not found", robots: { index: false } };
  return {
    title: `${group.district} news`,
    description: `Live news for ${group.district}, Fremont: police, fire and disasters, traffic, housing, city hall and community stories.`,
    alternates: { canonical: `/g/${group.slug}/news` },
  };
}

export default async function GroupNewsPage({ params }: { params: Params }) {
  const group = getGroup((await params).slug);
  if (!group) notFound();

  return (
    <>
      <SiteHeader />
      <main id="main" className="bg-sky-mist">
        <section className="border-b border-rule bg-white">
          <div className="page py-8 sm:py-12">
            <nav aria-label="Breadcrumb">
              <ol className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                <li>
                  <Link href={`/g/${group.slug}`} className="link">
                    {group.name}
                  </Link>
                </li>
                <li aria-hidden="true">/</li>
                <li aria-current="page">News</li>
              </ol>
            </nav>
            <h1 className="display mt-3 text-[2.5rem] leading-tight sm:text-[3.25rem]">{group.district} news</h1>
            <p className="mt-2 max-w-read text-lg text-ink-soft">
              What&apos;s happening in and around {group.district}: police and fire, disasters, traffic, housing, city hall and community stories. It
              updates on its own while you read.
            </p>
          </div>
        </section>
        <div className="page py-6 sm:py-10">
          <NewsFeed slug={group.slug} district={group.district} boundary={group.boundary} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
