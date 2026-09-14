import { TEXTURES } from "@/components/pixel/blocks";
import type { Palette } from "@/components/pixel/Sprite";

// Block textures as CSS background images, for page layers and panels that aren't SVG scenes.
// Each tile is an 8×8 SVG; shade darkens it in the image itself, so neighboring blocks from
// different layers (see layerEdge) can keep their own shade.

export interface BlockTexture {
  palette: Palette;
  rows: readonly string[];
}

export const DEEPSLATE: BlockTexture = {
  palette: { a: "#505056", A: "#3F3F45", b: "#5E5E64", B: "#333338" },
  rows: ["aAbaAbaa", "bbaaBabA", "AabBaaba", "aaBaAbba", "baaAbaaB", "aBabaAab", "abAaaBba", "BaabaaAb"],
};

export const BEDROCK: BlockTexture = {
  palette: { k: "#1C1C1C", K: "#3A3A3A", m: "#565656", n: "#0E0E0E" },
  rows: ["kKnkmKkn", "Kknmkknk", "nkKkkmKk", "kmkKnkkK", "KknkkKmk", "kkmKknkn", "nKkkmkKk", "kkKnkkmK"],
};

const ORE_MASK = ["........", "..oO....", ".oOo..o.", "..o..oOo", "......O.", ".Oo.....", ".oOo..o.", "..o..oO."];

function withOre(base: BlockTexture, light: string, dark: string): BlockTexture {
  return {
    palette: { ...base.palette, o: light, O: dark },
    rows: base.rows.map((row, y) => [...row].map((ch, x) => (ORE_MASK[y][x] === "." ? ch : ORE_MASK[y][x])).join("")),
  };
}

export const ORES = {
  diamond: withOre(DEEPSLATE, "#5DECF5", "#1AA7B0"),
  emerald: withOre(DEEPSLATE, "#3DF07A", "#0A9A40"),
  redstone: withOre(DEEPSLATE, "#FF3B30", "#A30E0E"),
  gold: withOre(DEEPSLATE, "#FCEE4B", "#C7962A"),
} satisfies Record<string, BlockTexture>;

export const BLOCKS = {
  grass: TEXTURES.grass,
  dirt: TEXTURES.dirt,
  stone: TEXTURES.stone,
  planks: TEXTURES.planks,
  birch: TEXTURES.birch,
  deepslate: DEEPSLATE,
  bedrock: BEDROCK,
} satisfies Record<string, BlockTexture>;

function rects(texture: BlockTexture, dx: number, shade: number) {
  let out = "";
  texture.rows.forEach((row, y) => {
    let start = 0;
    for (let i = 1; i <= row.length; i += 1) {
      if (i < row.length && row[i] === row[start]) continue;
      const fill = texture.palette[row[start]];
      if (fill) out += `<rect x='${dx + start}' y='${y}' width='${i - start}' height='1' fill='${fill}'/>`;
      start = i;
    }
  });
  if (shade > 0) out += `<rect x='${dx}' y='0' width='8' height='8' fill='#000' opacity='${shade}'/>`;
  return out;
}

function svgUrl(width: number, body: string) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${width} 8' width='${width}' height='8' shape-rendering='crispEdges'>${body}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** One block as a CSS url(), darkened by shade (0 to 1). */
export function blockUrl(texture: BlockTexture, shade = 0) {
  return svgUrl(8, rects(texture, 0, shade));
}

/** A row of blocks where one layer meets the next, as a repeating CSS url(). */
export function layerEdge(blocks: [BlockTexture, number][]) {
  return svgUrl(blocks.length * 8, blocks.map(([texture, shade], i) => rects(texture, i * 8, shade)).join(""));
}
