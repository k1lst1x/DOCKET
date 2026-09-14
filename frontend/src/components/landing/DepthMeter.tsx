"use client";

import { useEffect, useRef } from "react";
import styles from "./landing.module.css";

const SURFACE = 64;
const BEDROCK = -60;

/** An experience bar along the bottom that fills, and a Y level that drops, as you dig down the page. */
export function DepthMeter() {
  const meter = useRef<HTMLDivElement>(null);
  const level = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      meter.current?.style.setProperty("--progress", progress.toFixed(4));
      if (level.current) level.current.textContent = `Y ${Math.round(SURFACE + (BEDROCK - SURFACE) * progress)}`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  return (
    <div ref={meter} aria-hidden="true" className={styles.depth}>
      <span ref={level} className={styles.depthLevel}>
        Y {SURFACE}
      </span>
      <span className={styles.depthBar}>
        <span className={styles.depthFill} />
      </span>
    </div>
  );
}
