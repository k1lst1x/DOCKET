import type { Metadata } from "next";
import { PlacesExplorer } from "@/components/places/PlacesExplorer";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "Places",
  description: "Explore schools, restaurants, salons, parks and more in every Fremont neighborhood on a live map.",
};

export default function PlacesPage() {
  return (
    <div className="flex min-h-[100svh] flex-col bg-sky-mist lg:h-[100svh]">
      <SiteHeader />
      <main id="main" className="flex min-h-0 flex-1 flex-col">
        <PlacesExplorer
          apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ""}
          mapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID"}
        />
      </main>
    </div>
  );
}
