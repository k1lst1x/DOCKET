"use client";

import { useEffect, useState } from "react";

const SPLASHES = [
  "Cites every source!",
  "32 neighborhoods!",
  "No password needed!",
  "Reads the agenda packet!",
  "Now with minecarts!",
  "Refreshed every minute!",
  "Made for Fremont!",
  "Votes are opinions!",
  "Before the deadline!",
];

/** Yellow title-screen splash. A new one on every visit, or on click. */
export function SplashText({ className = "" }: { className?: string }) {
  const [index, setIndex] = useState(0);

  // Picked after hydration so the server and client agree on the first render; the splash is
  // still invisible then, waiting on its entrance delay.
  useEffect(() => setIndex(Math.floor(Math.random() * SPLASHES.length)), []);

  return (
    <span aria-hidden="true" className={className} onClick={() => setIndex((i) => (i + 1) % SPLASHES.length)}>
      {SPLASHES[index]}
    </span>
  );
}
