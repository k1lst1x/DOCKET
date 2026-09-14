"use client";

import { useEffect } from "react";

/**
 * Turns on scroll reveals inside the element with this id. Children marked data-reveal start
 * hidden and get data-in as they scroll into view, once. Anything already on screen is shown
 * right away, and nothing is hidden without JavaScript or with reduced motion.
 */
export function ScrollReveal({ rootId }: { rootId: string }) {
  useEffect(() => {
    const root = document.getElementById(rootId);
    if (!root || !("IntersectionObserver" in window)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute("data-in", "");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.15 },
    );

    const viewport = window.innerHeight;
    for (const el of root.querySelectorAll<HTMLElement>("[data-reveal]")) {
      const box = el.getBoundingClientRect();
      if (box.top < viewport && box.bottom > 0) el.setAttribute("data-in", "");
      else observer.observe(el);
    }
    root.setAttribute("data-motion", "");

    return () => {
      observer.disconnect();
      root.removeAttribute("data-motion");
    };
  }, [rootId]);

  return null;
}
