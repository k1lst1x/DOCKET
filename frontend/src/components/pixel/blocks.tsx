import { Sprite, vars, type Palette } from "@/components/pixel/Sprite";
import styles from "@/components/pixel/pixel.module.css";

// 8×8 block textures in the spirit of a voxel sandbox game. Every scene lays blocks on a
// grid of 8 user units so the tiles line up with the ground.

const EARTH: Palette = { h: "#8CC63F", g: "#6DB33F", G: "#4E9A3A", d: "#8B5A2B", D: "#6B4423", e: "#A0703F" };
const LOG_ROWS = ["bBnbBbnB", "bBbbBnbB", "nBbbBbbB", "bBbnBbbB", "bBbbBbnB", "bBnbBbbB", "bBbbBnbB", "nBbbBbbB"];
const PLANK_ROWS = ["qppppPpq", "ppqppPpp", "pppqpPpp", "PPPPPPPP", "pPpqpppp", "pPppqppp", "qPpppppq", "PPPPPPPP"];

const TEXTURES = {
  grass: {
    palette: EARTH,
    rows: ["hgGghgGg", "gGghgGhg", "GgGgGgdG", "dGdDgdGd", "dDedDded", "edDdeDdD", "DdedDedd", "deDdddeD"],
  },
  dirt: {
    palette: EARTH,
    rows: ["dDedDded", "edDdeDdD", "DdedDedd", "deDdddeD", "dedDeddD", "DdeddDed", "ddDedeDd", "eDdDdded"],
  },
  leaves: {
    palette: { l: "#4E9A3A", L: "#2F6A31", m: "#6DB33F", k: "#1F3D1A" },
    rows: ["lmLlmlLl", "LlmkLmlm", "mLllmLkl", "lkmLllmL", "mlLmkLlm", "LmlLmlmk", "lLkmlLml", "mlmLlkLl"],
  },
  log: { palette: { b: "#6B4A2E", B: "#4A3320", n: "#8A6440" }, rows: LOG_ROWS },
  // The same bark turned on its side, for branches.
  logSide: {
    palette: { b: "#6B4A2E", B: "#4A3320", n: "#8A6440" },
    rows: LOG_ROWS.map((_, r) => LOG_ROWS.map((row) => row[r]).join("")),
  },
  planks: { palette: { q: "#C99A5B", p: "#B0834A", P: "#8A6336" }, rows: PLANK_ROWS },
  birch: { palette: { q: "#EFE5BF", p: "#DDCF9C", P: "#B8A974" }, rows: PLANK_ROWS },
  roof: { palette: { q: "#7A5436", p: "#63432A", P: "#45301E" }, rows: PLANK_ROWS },
  stone: {
    palette: { t: "#B5B5B5", s: "#9A9A9A", S: "#858585", u: "#6E6E6E" },
    rows: ["tssssssu", "ssSstssu", "sssSsssu", "uuuuuuuu", "stsuSsss", "sssussts", "sSsusSss", "uuuuuuuu"],
  },
} satisfies Record<string, { palette: Palette; rows: readonly string[] }>;

export type Texture = keyof typeof TEXTURES;

/** Pattern defs for block textures. Ids are namespaced so two scenes can share a page. */
export function BlockPatterns({ prefix, only }: { prefix: string; only?: Texture[] }) {
  const names = only ?? (Object.keys(TEXTURES) as Texture[]);
  return (
    <defs>
      {names.map((name) => (
        <pattern key={name} id={`${prefix}-${name}`} patternUnits="userSpaceOnUse" width={8} height={8}>
          <Sprite rows={TEXTURES[name].rows} palette={TEXTURES[name].palette} />
        </pattern>
      ))}
    </defs>
  );
}

export function tex(prefix: string, name: Texture) {
  return `url(#${prefix}-${name})`;
}

// Birds: 8×7 sprites facing right, feet on the bottom row.

export interface BirdColors {
  body: string;
  wing: string;
  belly: string;
}

export const BIRDS = {
  dove: { body: "#B8BEC6", wing: "#8C939C", belly: "#E6E9ED" },
  cardinal: { body: "#C8352B", wing: "#8F2019", belly: "#E0645A" },
  robin: { body: "#6B5A4E", wing: "#4B3F37", belly: "#E07A3A" },
  goldfinch: { body: "#F2C230", wing: "#3A3A3A", belly: "#F7DC6F" },
  bluejay: { body: "#3D7CC9", wing: "#2A5A99", belly: "#DCE8F5" },
  sparrow: { body: "#9A7B5B", wing: "#6E5236", belly: "#E8D9C4" },
  courier: { body: "#262626", wing: "#111111", belly: "#5F6368" },
} satisfies Record<string, BirdColors>;

const PERCHED = ["....bbb.", "...bbbbk", "..bbbbb.", ".wwwwbc.", "wwwwccc.", "w.cccc..", "...f.f.."];
const WINGS_UP = [".ww.....", "..ww....", "...wwbb.", "wbbbbbbk", "ww.ccc..", "........", "........"];
const WINGS_DOWN = ["........", "........", ".....bb.", "wbbbbbbk", "ww.wwc..", "...ww...", "..w....."];

function birdPalette(colors: BirdColors): Palette {
  return { b: colors.body, w: colors.wing, c: colors.belly, k: "#F2A33A", f: "#5A3A1A" };
}

const flipX = "translate(8 0) scale(-1 1)";

export function PerchedBird({ colors, flip = false, blinkEvery = "5s", asleep = false }: { colors: BirdColors; flip?: boolean; blinkEvery?: string; asleep?: boolean }) {
  return (
    <g transform={flip ? flipX : undefined}>
      <Sprite rows={PERCHED} palette={birdPalette(colors)} />
      {asleep ? (
        <rect x={4} y={1} width={2} height={1} fill="#111111" />
      ) : (
        <rect x={5} y={1} width={1} height={1} fill="#111111" className={styles.blink} style={vars({ "--blink": blinkEvery })} />
      )}
    </g>
  );
}

export function FlyingBird({ colors, flip = false }: { colors: BirdColors; flip?: boolean }) {
  const palette = birdPalette(colors);
  return (
    <g transform={flip ? flipX : undefined}>
      <g className={styles.wingUp}>
        <Sprite rows={WINGS_UP} palette={palette} />
        <rect x={6} y={2} width={1} height={1} fill="#111111" />
      </g>
      <g className={styles.wingDown}>
        <Sprite rows={WINGS_DOWN} palette={palette} />
        <rect x={6} y={2} width={1} height={1} fill="#111111" />
      </g>
    </g>
  );
}

// Speech bubbles: 11×10 with an ink outline and a tail at the bottom left.

export type BubbleGlyph = "doc" | "alert" | "check" | "heart" | "question";

const GLYPHS: Record<BubbleGlyph, { color: string; rects: [number, number, number, number][] }> = {
  doc: { color: "#5F6368", rects: [[3, 2, 5, 1], [3, 4, 5, 1], [3, 6, 3, 1]] },
  alert: { color: "#B3261E", rects: [[5, 1, 1, 4], [5, 6, 1, 1]] },
  check: { color: "#2F6A31", rects: [[2, 4, 1, 1], [3, 5, 1, 1], [4, 6, 1, 1], [5, 5, 1, 1], [6, 4, 1, 1], [7, 3, 1, 1], [8, 2, 1, 1]] },
  heart: { color: "#B3261E", rects: [[3, 2, 2, 1], [6, 2, 2, 1], [2, 3, 7, 1], [3, 4, 5, 1], [4, 5, 3, 1], [5, 6, 1, 1]] },
  question: { color: "#262626", rects: [[4, 1, 3, 1], [7, 2, 1, 1], [6, 3, 1, 1], [5, 4, 1, 1], [5, 6, 1, 1]] },
};

export function Bubble({ glyph }: { glyph: BubbleGlyph }) {
  const { color, rects } = GLYPHS[glyph];
  return (
    <g>
      <rect x={1} y={0} width={9} height={1} fill="#262626" />
      <rect x={0} y={1} width={1} height={7} fill="#262626" />
      <rect x={10} y={1} width={1} height={7} fill="#262626" />
      <rect x={1} y={8} width={9} height={1} fill="#262626" />
      <rect x={1} y={1} width={9} height={7} fill="#FFFFFF" />
      <rect x={3} y={9} width={2} height={1} fill="#262626" />
      {rects.map(([x, y, w, h]) => (
        <rect key={`${x}:${y}`} x={x} y={y} width={w} height={h} fill={color} />
      ))}
    </g>
  );
}

/** A little red poppy or a dandelion standing on the ground line. */
export function Flower({ x, ground, color }: { x: number; ground: number; color: string }) {
  return (
    <g>
      <rect x={x + 1} y={ground - 3} width={1} height={3} fill="#2F6A31" />
      <rect x={x + 2} y={ground - 2} width={1} height={1} fill="#4E9A3A" />
      <rect x={x} y={ground - 5} width={3} height={2} fill={color} />
      <rect x={x + 1} y={ground - 6} width={1} height={1} fill={color} />
    </g>
  );
}

export function GrassTuft({ x, ground }: { x: number; ground: number }) {
  return (
    <g fill="#3F8A35">
      <rect x={x} y={ground - 2} width={1} height={2} />
      <rect x={x + 2} y={ground - 3} width={1} height={3} />
      <rect x={x + 4} y={ground - 2} width={1} height={2} />
    </g>
  );
}
