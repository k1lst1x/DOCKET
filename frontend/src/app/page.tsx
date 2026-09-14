import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";

// The front door: what Docket is and how it works. The app itself (the neighborhood feed) is at /app.
export const metadata: Metadata = {
  title: { absolute: "Docket — your whole Fremont neighborhood, in one place" },
  description:
    "Docket is the neighborhood app for Fremont, California: a feed for neighbors, local news and live incidents, a places map, neighborhood groups and community votes, with an AI agent that reads city hall and cites its sources.",
};

export default function Home() {
  return <LandingPage />;
}
