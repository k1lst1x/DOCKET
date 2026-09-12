import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Docket — Fremont, California",
  description: "City-hall agenda items for Fremont neighborhood groups.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
