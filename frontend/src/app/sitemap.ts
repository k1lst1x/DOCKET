import type { MetadataRoute } from "next";
import { listGroups } from "@/lib/data";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return [
    { url: `${base}/` },
    { url: `${base}/app` },
    { url: `${base}/groups` },
    ...listGroups().map((g) => ({ url: `${base}/g/${g.slug}`, lastModified: g.lastActivityAt })),
  ];
}
