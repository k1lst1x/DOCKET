import { BIRDS, BlockPatterns, Bubble, Flower, PerchedBird, tex } from "@/components/pixel/blocks";
import { vars } from "@/components/pixel/Sprite";
import styles from "@/components/pixel/pixel.module.css";

// The status code built out of blocks, with a bird sitting on it.
// "lost" (404): grass blocks, the bird looks around with a question.
// "broken" (500): cracked stone, a loose block wobbles and the bird raises the alarm.

const DIGITS: Record<string, readonly string[]> = {
  "0": ["###", "#.#", "#.#", "#.#", "###"],
  "1": [".#.", "##.", ".#.", ".#.", "###"],
  "2": ["###", "..#", "###", "#..", "###"],
  "3": ["###", "..#", ".##", "..#", "###"],
  "4": ["#.#", "#.#", "###", "..#", "..#"],
  "5": ["###", "#..", "###", "..#", "###"],
  "6": ["###", "#..", "###", "#.#", "###"],
  "7": ["###", "..#", "..#", ".#.", ".#."],
  "8": ["###", "#.#", "###", "#.#", "###"],
  "9": ["###", "#.#", "###", "..#", "###"],
};

const BLOCK = 8;
const TOP = 40;
const GROUND = TOP + 5 * BLOCK;
const MARGIN = 48;

export function ErrorScene({ code, mood, className = "" }: { code: string; mood: "lost" | "broken"; className?: string }) {
  const prefix = `err-${code}`;
  const digits = code.split("").filter((d) => DIGITS[d]);
  const digitsWidth = (digits.length * 4 - 1) * BLOCK;
  const width = digitsWidth + MARGIN * 2;
  const perchCol = Math.max(0, DIGITS[digits[0]]?.[0].indexOf("#") ?? 0);
  const birdX = MARGIN + perchCol * BLOCK;
  const blocks: { x: number; y: number; exposed: boolean; loose: boolean }[] = [];

  digits.forEach((digit, di) => {
    const rows = DIGITS[digit];
    rows.forEach((row, r) => {
      [...row].forEach((cell, c) => {
        if (cell !== "#") return;
        blocks.push({
          x: MARGIN + (di * 4 + c) * BLOCK,
          y: TOP + r * BLOCK,
          exposed: r === 0 || rows[r - 1][c] !== "#",
          loose: mood === "broken" && di === digits.length - 1 && r === 0 && c === 2,
        });
      });
    });
  });

  const fill = (exposed: boolean) => tex(prefix, mood === "broken" ? "stone" : exposed ? "grass" : "dirt");

  return (
    <svg viewBox={`0 0 ${width} ${GROUND + 24}`} aria-hidden="true" focusable="false" className={`${styles.scene} ${className}`}>
      <BlockPatterns prefix={prefix} only={["grass", "dirt", "leaves", "log", "planks", "stone"]} />

      {/* Drifting cloud */}
      <g transform="translate(0 10)">
        <g className={styles.cloud} style={vars({ "--dur": "60s", "--delay": "-22s", "--from": "-40px", "--to": `${width + 10}px` })} fill="#FFFFFF">
          <rect x={0} y={4} width={26} height={5} />
          <rect x={5} y={0} width={12} height={4} />
        </g>
      </g>

      {/* Signpost */}
      <rect x={21} y={60} width={2} height={20} fill="#6B4A2E" />
      <rect x={10} y={50} width={24} height={12} fill={tex(prefix, "planks")} />
      <g transform="translate(17 51)">
        {mood === "lost" ? (
          <g fill="#262626">
            <rect x={3} y={1} width={4} height={1} />
            <rect x={7} y={2} width={1} height={2} />
            <rect x={5} y={4} width={2} height={1} />
            <rect x={5} y={5} width={1} height={2} />
            <rect x={5} y={8} width={1} height={1} />
          </g>
        ) : (
          <g fill="#B3261E">
            <rect x={5} y={1} width={1} height={5} />
            <rect x={5} y={8} width={1} height={1} />
          </g>
        )}
      </g>

      {blocks.map((b) =>
        b.loose ? (
          <g key={`${b.x}:${b.y}`} className={styles.wobble}>
            <rect x={b.x} y={b.y} width={BLOCK} height={BLOCK} fill={fill(b.exposed)} />
          </g>
        ) : (
          <rect key={`${b.x}:${b.y}`} x={b.x} y={b.y} width={BLOCK} height={BLOCK} fill={fill(b.exposed)} />
        ),
      )}

      {mood === "broken" ? (
        <g fill="#3A3A3A">
          {/* Cracks */}
          {blocks
            .filter((_, i) => i % 3 === 1)
            .map((b) => (
              <g key={`crack-${b.x}:${b.y}`}>
                <rect x={b.x + 2} y={b.y + 1} width={1} height={2} />
                <rect x={b.x + 3} y={b.y + 3} width={2} height={1} />
                <rect x={b.x + 5} y={b.y + 4} width={1} height={2} />
              </g>
            ))}
        </g>
      ) : null}

      {/* Small tree on the right */}
      <rect x={width - 28} y={56} width={8} height={24} fill={tex(prefix, "log")} />
      <rect x={width - 40} y={40} width={32} height={16} fill={tex(prefix, "leaves")} />
      <rect x={width - 32} y={32} width={16} height={8} fill={tex(prefix, "leaves")} />
      <rect x={width - 40} y={50} width={32} height={6} fill="#1F3D1A" opacity={0.25} />

      {/* Ground */}
      <rect x={0} y={GROUND} width={width} height={8} fill={tex(prefix, "grass")} />
      <rect x={0} y={GROUND + 8} width={width} height={16} fill={tex(prefix, "dirt")} />
      <Flower x={4} ground={GROUND} color="#F2C230" />
      <Flower x={38} ground={GROUND} color="#D93A2B" />
      <Flower x={width - 48} ground={GROUND} color="#C9A8E6" />

      <g transform={`translate(${birdX} ${TOP - 7})`}>
        {mood === "lost" ? (
          <>
            <g className={styles.lookRight}>
              <PerchedBird colors={BIRDS.bluejay} />
            </g>
            <g className={styles.lookLeft}>
              <PerchedBird colors={BIRDS.bluejay} flip />
            </g>
          </>
        ) : (
          <g className={styles.hop} style={vars({ "--dur": "1.6s" })}>
            <PerchedBird colors={BIRDS.cardinal} />
          </g>
        )}
      </g>
      <g transform={`translate(${birdX - 1} ${TOP - 20})`}>
        <g className={styles.bob}>
          <Bubble glyph={mood === "lost" ? "question" : "alert"} />
        </g>
      </g>
    </svg>
  );
}
