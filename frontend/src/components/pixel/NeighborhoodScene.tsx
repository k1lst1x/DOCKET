"use client";

import { useEffect, useRef, useState } from "react";
import {
  BIRDS,
  BlockPatterns,
  Bubble,
  Flower,
  FlyingBird,
  GrassTuft,
  PerchedBird,
  tex,
  type BirdColors,
  type BubbleGlyph,
} from "@/components/pixel/blocks";
import { Sprite, vars } from "@/components/pixel/Sprite";
import styles from "@/components/pixel/pixel.module.css";

// The About hero: a blocky Fremont block where a courier bird carries news from city hall to
// the neighborhood tree, and the birds pass it on. The viewBox is wide (480×160) and sliced to
// the container, so phones see the city hall and tree while wide screens also get the houses.

const P = "hero";

const TREE_BIRDS: { colors: BirdColors; x: number; y: number; flip?: boolean; sx: string; dur: string; delay: string }[] = [
  // sx pulls each bird toward the middle as it takes off, so phones (which crop the sides) see the whole flight.
  { colors: BIRDS.dove, x: 296, y: 25, sx: "-18px", dur: "4.6s", delay: "0s" },
  { colors: BIRDS.cardinal, x: 272, y: 33, flip: true, sx: "-34px", dur: "3.8s", delay: "1.2s" },
  { colors: BIRDS.robin, x: 273, y: 89, flip: true, sx: "-46px", dur: "5.2s", delay: "0.4s" },
  { colors: BIRDS.goldfinch, x: 312, y: 81, sx: "-26px", dur: "4.2s", delay: "2s" },
  { colors: BIRDS.bluejay, x: 328, y: 41, sx: "-38px", dur: "3.4s", delay: "0.8s" },
];

const BUBBLES: { glyph: BubbleGlyph; x: number; y: number; delay: string }[] = [
  { glyph: "doc", x: 282, y: 76, delay: "0s" },
  { glyph: "alert", x: 294, y: 12, delay: "0.8s" },
  { glyph: "check", x: 310, y: 68, delay: "1.6s" },
  // Kept left of x=340, the right edge phones can see.
  { glyph: "heart", x: 316, y: 30, delay: "2.4s" },
];

const LEAVES = [
  { x: 270, y: 80, dur: "7s", delay: "0s", dx: "-12px" },
  { x: 318, y: 80, dur: "8.5s", delay: "2.5s", dx: "10px" },
  { x: 300, y: 72, dur: "9s", delay: "5s", dx: "-6px" },
  { x: 330, y: 66, dur: "7.5s", delay: "3.6s", dx: "14px" },
];

const BURST = [
  { x: 276, y: 50, dx: "-26px", delay: "0s" },
  { x: 292, y: 40, dx: "-12px", delay: "0.1s" },
  { x: 312, y: 44, dx: "16px", delay: "0.05s" },
  { x: 330, y: 56, dx: "28px", delay: "0.15s" },
  { x: 300, y: 70, dx: "4px", delay: "0.2s" },
  { x: 270, y: 66, dx: "-20px", delay: "0.25s" },
];

const CLOUDS = [
  { x: 60, y: 20, dur: "110s", delay: "-40s" },
  { x: 200, y: 8, dur: "140s", delay: "-95s" },
  { x: 380, y: 26, dur: "120s", delay: "-15s" },
];

const WALKER_TOP = [".hhh.", "hssXs", ".sss.", ".ccc.", "ccccc", "ccccc", "scccs", ".ccc.", ".ppp."];
const WALKER_PALETTE = { h: "#5A3A1A", s: "#E0AC7E", X: "#262626", c: "#E0A030", p: "#3A3A5A", b: "#262626" };

export function NeighborhoodScene({ className = "" }: { className?: string }) {
  const [shaking, setShaking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function shake() {
    if (shaking) return;
    setShaking(true);
    timer.current = setTimeout(() => setShaking(false), 3300);
  }

  return (
    <div className={`relative ${className}`}>
      <svg
        viewBox="0 0 480 160"
        preserveAspectRatio="xMidYMax slice"
        aria-hidden="true"
        focusable="false"
        className={`${styles.scene} ${styles.open} ${shaking ? styles.shaking : ""}`}
      >
        <BlockPatterns prefix={P} />

        {/* Square sun */}
        <rect x={344} y={12} width={16} height={16} fill="#FFE27A" />
        <rect x={347} y={15} width={10} height={10} fill="#FFF1A8" />

        {CLOUDS.map((c) => (
          <g key={c.x} transform={`translate(0 ${c.y})`}>
            <g className={styles.cloud} style={vars({ "--dur": c.dur, "--delay": c.delay, "--from": "-60px", "--to": "540px" })}>
              <g transform={`translate(${c.x} 0)`} fill="#FFFFFF" opacity={0.95}>
                <rect x={0} y={4} width={32} height={6} />
                <rect x={6} y={0} width={14} height={4} />
                <rect x={22} y={2} width={8} height={2} />
              </g>
            </g>
          </g>
        ))}

        <House x={32} walls="planks" />
        <House x={400} walls="birch" />
        <g transform="translate(52 65)">
          <PerchedBird colors={BIRDS.sparrow} blinkEvery="6s" />
        </g>
        {/* Mailbox with its flag up */}
        <rect x={92} y={118} width={1} height={10} fill="#5A3A1A" />
        <rect x={88} y={112} width={8} height={6} fill="#3D7CC9" />
        <rect x={96} y={109} width={1} height={5} fill="#B3261E" />

        <CityHall />

        {/* Ground */}
        <rect x={0} y={128} width={480} height={8} fill={tex(P, "grass")} />
        <rect x={0} y={136} width={480} height={24} fill={tex(P, "dirt")} />
        {[100, 236, 376, 22, 458].map((x) => (
          <GrassTuft key={x} x={x} ground={128} />
        ))}
        <Flower x={114} ground={128} color="#D93A2B" />
        <Flower x={246} ground={128} color="#F2C230" />
        <Flower x={352} ground={128} color="#D93A2B" />
        <Flower x={366} ground={128} color="#C9A8E6" />
        <Flower x={12} ground={128} color="#F2C230" />

        <Walker />

        {/* The neighborhood tree */}
        <g className={styles.treeTarget} onClick={shake}>
          <g transform="translate(112 0)">
            <rect x={184} y={72} width={8} height={56} fill={tex(P, "log")} />
            <rect x={152} y={96} width={32} height={8} fill={tex(P, "logSide")} />
            <rect x={192} y={88} width={32} height={8} fill={tex(P, "logSide")} />
            <g className={styles.canopy}>
              <rect x={168} y={32} width={40} height={8} fill={tex(P, "leaves")} />
              <rect x={160} y={40} width={56} height={8} fill={tex(P, "leaves")} />
              <rect x={152} y={48} width={72} height={16} fill={tex(P, "leaves")} />
              <rect x={160} y={64} width={56} height={8} fill={tex(P, "leaves")} />
              <rect x={168} y={72} width={16} height={8} fill={tex(P, "leaves")} />
              <rect x={192} y={72} width={16} height={8} fill={tex(P, "leaves")} />
              <rect x={152} y={88} width={8} height={8} fill={tex(P, "leaves")} />
              <rect x={216} y={80} width={8} height={8} fill={tex(P, "leaves")} />
              {/* Light from above, shade below */}
              <rect x={168} y={32} width={40} height={2} fill="#FFFFFF" opacity={0.14} />
              <rect x={160} y={64} width={56} height={8} fill="#1F3D1A" opacity={0.22} />
              <rect x={168} y={72} width={40} height={8} fill="#1F3D1A" opacity={0.3} />
            </g>
          </g>

          {TREE_BIRDS.map((bird) => (
            <g key={bird.x + bird.y} transform={`translate(${bird.x} ${bird.y})`}>
              <g className={styles.scatter} style={vars({ "--sx": bird.sx })}>
                <g className={styles.hop} style={vars({ "--dur": bird.dur, "--delay": bird.delay })}>
                  <g className={styles.perch}>
                    <PerchedBird colors={bird.colors} flip={bird.flip} blinkEvery={bird.dur} />
                  </g>
                  <g className={styles.fly}>
                    <FlyingBird colors={bird.colors} flip={bird.flip} />
                  </g>
                </g>
              </g>
            </g>
          ))}
        </g>

        {LEAVES.map((leaf) => (
          <rect
            key={leaf.x}
            x={leaf.x}
            y={leaf.y}
            width={2}
            height={2}
            fill="#4E9A3A"
            className={styles.leaf}
            style={vars({ "--dur": leaf.dur, "--delay": leaf.delay, "--dx": leaf.dx })}
          />
        ))}
        {BURST.map((leaf) => (
          <rect
            key={`${leaf.x}:${leaf.y}`}
            x={leaf.x}
            y={leaf.y}
            width={2}
            height={2}
            fill="#6DB33F"
            className={styles.burst}
            style={vars({ "--dx": leaf.dx, "--dy": "40px", "--delay": leaf.delay })}
          />
        ))}

        {/* Courier bird with today's city hall paper */}
        <g className={styles.courier}>
          <g className={styles.courierPerched}>
            <PerchedBird colors={BIRDS.courier} blinkEvery="3.5s" />
          </g>
          <g className={styles.courierOut}>
            <FlyingBird colors={BIRDS.courier} />
          </g>
          <g className={styles.courierBack}>
            <FlyingBird colors={BIRDS.courier} flip />
          </g>
          <g className={styles.courierPaper}>
            <rect x={7} y={2} width={4} height={4} fill="#FFFFFF" />
            <rect x={8} y={3} width={2} height={1} fill="#7A7F85" />
            <rect x={8} y={5} width={2} height={1} fill="#7A7F85" />
          </g>
        </g>

        {BUBBLES.map((b) => (
          <g key={b.glyph} transform={`translate(${b.x} ${b.y})`}>
            <g className={styles.bubble} style={vars({ "--delay": b.delay })}>
              <Bubble glyph={b.glyph} />
            </g>
          </g>
        ))}
      </svg>

      <button
        type="button"
        onClick={shake}
        className="absolute bottom-3 right-4 rounded-full border border-white/40 bg-ink/70 px-4 py-1.5 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-ink sm:bottom-5 sm:right-6"
      >
        {shaking ? "Wheee…" : "Shake the tree"}
      </button>
    </div>
  );
}

function House({ x, walls }: { x: number; walls: "planks" | "birch" }) {
  return (
    <g transform={`translate(${x} 0)`}>
      <rect x={0} y={96} width={48} height={32} fill={tex(P, walls)} />
      <rect x={-4} y={88} width={56} height={8} fill={tex(P, "roof")} />
      <rect x={8} y={80} width={32} height={8} fill={tex(P, "roof")} />
      <rect x={20} y={72} width={8} height={8} fill={tex(P, "roof")} />
      <rect x={12} y={112} width={8} height={16} fill="#5C3B1E" />
      <rect x={18} y={119} width={1} height={1} fill="#F2C230" />
      <rect x={27} y={103} width={14} height={10} fill="#5C3B1E" />
      <rect x={28} y={104} width={12} height={8} fill="#A7D3F0" />
      <rect x={33} y={104} width={2} height={8} fill="#5C3B1E" />
      <rect x={28} y={104} width={5} height={2} fill="#D8EEFB" />
    </g>
  );
}

function CityHall() {
  return (
    <g transform="translate(104 0)">
      <rect x={16} y={120} width={80} height={8} fill={tex(P, "stone")} />
      <rect x={24} y={80} width={64} height={40} fill={tex(P, "stone")} />
      <rect x={44} y={120} width={24} height={2} fill="#C8C8C8" />

      {/* Columns */}
      {[29, 43, 61, 75].map((cx) => (
        <g key={cx}>
          <rect x={cx - 1} y={82} width={6} height={2} fill="#EDE8DC" />
          <rect x={cx} y={84} width={4} height={34} fill="#EDE8DC" />
          <rect x={cx + 3} y={84} width={1} height={34} fill="#CFC8B8" />
          <rect x={cx - 1} y={118} width={6} height={2} fill="#EDE8DC" />
        </g>
      ))}

      {/* Windows and door */}
      {[35, 67].map((wx) => (
        <g key={wx}>
          <rect x={wx} y={90} width={6} height={12} fill="#4A4A4A" />
          <rect x={wx + 1} y={91} width={4} height={10} fill="#A7D3F0" />
          <rect x={wx + 1} y={91} width={2} height={3} fill="#D8EEFB" />
        </g>
      ))}
      <rect x={50} y={88} width={8} height={8} fill="#4A4A4A" />
      <rect x={51} y={89} width={6} height={6} fill="#A7D3F0" />
      <rect x={50} y={104} width={8} height={16} fill="#5C3B1E" />
      <rect x={51} y={103} width={6} height={1} fill="#5C3B1E" />
      <rect x={54} y={104} width={1} height={16} fill="#45301E" />
      <rect x={56} y={112} width={1} height={1} fill="#F2C230" />

      {/* Stepped roof with a clock */}
      <rect x={20} y={72} width={72} height={8} fill={tex(P, "roof")} />
      <rect x={32} y={64} width={48} height={8} fill={tex(P, "roof")} />
      <rect x={44} y={56} width={24} height={8} fill={tex(P, "roof")} />
      <rect x={53} y={65} width={6} height={6} fill="#262626" />
      <rect x={54} y={66} width={4} height={4} fill="#F7F1E3" />
      <rect x={56} y={66} width={1} height={2} fill="#262626" />
      <rect x={56} y={68} width={2} height={1} fill="#262626" />

      {/* Flag with the Docket D Lens */}
      <rect x={56} y={34} width={1} height={22} fill="#4A4A4A" />
      <rect x={55} y={32} width={3} height={2} fill="#F2C230" />
      <g className={styles.flag}>
        <rect x={57} y={35} width={12} height={8} fill="#102D3E" />
        <rect x={59} y={37} width={2} height={4} fill="#5A9FC4" />
        <rect x={61} y={37} width={4} height={4} fill="#EDF1F3" />
        <rect x={62} y={38} width={2} height={2} fill="#75BDDC" />
        <rect x={65} y={40} width={1} height={1} fill="#F2BC5B" />
      </g>
      <g className={styles.flagAlt}>
        <rect x={57} y={35} width={4} height={8} fill="#102D3E" />
        <rect x={61} y={34} width={4} height={8} fill="#102D3E" />
        <rect x={65} y={36} width={4} height={8} fill="#102D3E" />
        <rect x={59} y={37} width={2} height={4} fill="#5A9FC4" />
        <rect x={61} y={36} width={4} height={4} fill="#EDF1F3" />
        <rect x={62} y={37} width={2} height={2} fill="#75BDDC" />
        <rect x={65} y={41} width={1} height={1} fill="#F2BC5B" />
      </g>
    </g>
  );
}

function Walker() {
  return (
    <g className={styles.walker}>
      <g className={styles.walkerRight}>
        <WalkerSprite />
      </g>
      <g className={styles.walkerLeft} transform="translate(5 0) scale(-1 1)">
        <WalkerSprite />
      </g>
    </g>
  );
}

function WalkerSprite() {
  return (
    <g>
      <Sprite rows={WALKER_TOP} palette={WALKER_PALETTE} />
      <Sprite rows={["..p..", "..p..", ".bb.."]} palette={WALKER_PALETTE} y={9} className={styles.stride} />
      <Sprite rows={[".p.p.", "p...p", "b...b"]} palette={WALKER_PALETTE} y={9} className={styles.strideAlt} />
    </g>
  );
}
