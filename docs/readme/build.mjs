#!/usr/bin/env node
// Draws the pixel-art images the repository README uses. Run from the repository root:
//   node docs/readme/build.mjs
//
// GitHub strips scripts and styles from README markdown but renders SVG images with their own CSS
// animations, so every animation lives inside these files. Images can't load web fonts either, so
// text is drawn from a small bitmap font. Block textures, birds and icons mirror
// frontend/src/components/pixel, so the README and the About page look like the same world.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = dirname(fileURLToPath(import.meta.url));
const INK = "#262626";

// ---------- Bitmap font: 5×7 capitals and digits, lowercase with descenders, 8 rows ----------

const FONT = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".####", "#....", "#....", "#..##", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["###", ".#.", ".#.", ".#.", ".#.", ".#.", "###"],
  J: ["....#", "....#", "....#", "....#", "#...#", "#...#", ".###."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", ".#.#.", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  a: [".....", ".....", ".###.", "....#", ".####", "#...#", ".####"],
  b: ["#....", "#....", "#.##.", "##..#", "#...#", "#...#", "####."],
  c: [".....", ".....", ".###.", "#....", "#....", "#...#", ".###."],
  d: ["....#", "....#", ".##.#", "#..##", "#...#", "#...#", ".####"],
  e: [".....", ".....", ".###.", "#...#", "#####", "#....", ".####"],
  f: ["..##", ".#..", "####", ".#..", ".#..", ".#..", ".#.."],
  g: [".....", ".....", ".####", "#...#", "#...#", ".####", "....#", "####."],
  h: ["#....", "#....", "#.##.", "##..#", "#...#", "#...#", "#...#"],
  i: ["#", ".", "#", "#", "#", "#", "#"],
  j: ["....#", ".....", "....#", "....#", "....#", "....#", "#...#", ".###."],
  k: ["#...", "#...", "#..#", "#.#.", "##..", "#.#.", "#..#"],
  l: ["#.", "#.", "#.", "#.", "#.", "#.", ".#"],
  m: [".....", ".....", "##.#.", "#.#.#", "#.#.#", "#...#", "#...#"],
  n: [".....", ".....", "####.", "#...#", "#...#", "#...#", "#...#"],
  o: [".....", ".....", ".###.", "#...#", "#...#", "#...#", ".###."],
  p: [".....", ".....", "####.", "#...#", "#...#", "####.", "#....", "#...."],
  q: [".....", ".....", ".####", "#...#", "#...#", ".####", "....#", "....#"],
  r: [".....", ".....", "#.##.", "##..#", "#....", "#....", "#...."],
  s: [".....", ".....", ".####", "#....", ".###.", "....#", "####."],
  t: [".#..", ".#..", "####", ".#..", ".#..", ".#..", "..##"],
  u: [".....", ".....", "#...#", "#...#", "#...#", "#...#", ".####"],
  v: [".....", ".....", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  w: [".....", ".....", "#...#", "#...#", "#.#.#", "#.#.#", ".####"],
  x: [".....", ".....", "#...#", ".#.#.", "..#..", ".#.#.", "#...#"],
  y: [".....", ".....", "#...#", "#...#", "#...#", ".####", "....#", "####."],
  z: [".....", ".....", "#####", "...#.", "..#..", ".#...", "#####"],
  0: [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  1: ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", "#####"],
  2: [".###.", "#...#", "....#", "..##.", ".#...", "#....", "#####"],
  3: [".###.", "#...#", "....#", "..##.", "....#", "#...#", ".###."],
  4: ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  5: ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  6: ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  7: ["#####", "#...#", "....#", "...#.", "..#..", "..#..", "..#.."],
  8: [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  9: [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  " ": ["...", "...", "...", "...", "...", "...", "..."],
  ".": [".", ".", ".", ".", ".", ".", "#"],
  ",": [".", ".", ".", ".", ".", "#", "#", "#"],
  "!": ["#", "#", "#", "#", "#", ".", "#"],
  "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
  ":": [".", ".", "#", ".", ".", ".", "#"],
  "'": ["#", "#", ".", ".", ".", ".", "."],
  "-": ["....", "....", "....", "####", "....", "....", "...."],
  "+": [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."],
  "/": ["....#", "...#.", "...#.", "..#..", ".#...", ".#...", "#...."],
  "&": [".##..", "#..#.", ".##..", ".#...", "#.#.#", "#..#.", ".##.#"],
  "(": ["..#", ".#.", "#..", "#..", "#..", ".#.", "..#"],
  ")": ["#..", ".#.", "..#", "..#", "..#", ".#.", "#.."],
  "%": ["#...#", "#..#.", "...#.", "..#..", ".#...", ".#..#", "#...#"],
  ">": ["#...", ".#..", "..#.", "...#", "..#.", ".#..", "#..."],
  "#": [".#.#.", "#####", ".#.#.", ".#.#.", "#####", ".#.#.", "....."],
};
for (const rows of Object.values(FONT)) while (rows.length < 8) rows.push(".".repeat(rows[0].length));

function glyph(ch) {
  const rows = FONT[ch];
  if (!rows) throw new Error(`No pixel glyph for ${JSON.stringify(ch)}`);
  return rows;
}

function textWidth(str) {
  let width = 0;
  for (const ch of str) width += glyph(ch)[0].length + 1;
  return Math.max(0, width - 1);
}

/** Path data for a line of text: one subpath per horizontal run of pixels. */
function textPath(str, x, y, s = 1) {
  let d = "";
  let cx = x;
  for (const ch of str) {
    const rows = glyph(ch);
    rows.forEach((row, ry) => {
      let start = -1;
      for (let i = 0; i <= row.length; i += 1) {
        const on = i < row.length && row[i] === "#";
        if (on && start < 0) start = i;
        if (!on && start >= 0) {
          d += `M${cx + start * s} ${y + ry * s}h${(i - start) * s}v${s}h${-(i - start) * s}z`;
          start = -1;
        }
      }
    });
    cx += (rows[0].length + 1) * s;
  }
  return d;
}

/** Text with a hard drop shadow one pixel down and right, the way a block game draws its GUI. */
function text(str, { x, y, s = 1, fill = "#FFFFFF", shadow, align = "left" }) {
  const width = textWidth(str) * s;
  const left = align === "center" ? Math.round(x - width / 2) : align === "right" ? x - width : x;
  const under = shadow ? `<path fill="${shadow}" d="${textPath(str, left + s, y + s, s)}"/>` : "";
  return `${under}<path fill="${fill}" d="${textPath(str, left, y, s)}"/>`;
}

// ---------- Sprites and shapes ----------

/** A pixel map as paths, one per color. "." is transparent. */
function sprite(rows, palette, x = 0, y = 0) {
  const byColor = new Map();
  rows.forEach((row, ry) => {
    let start = 0;
    for (let i = 1; i <= row.length; i += 1) {
      if (i < row.length && row[i] === row[start]) continue;
      const fill = palette[row[start]];
      if (fill) byColor.set(fill, `${byColor.get(fill) ?? ""}M${x + start} ${y + ry}h${i - start}v1h${start - i}z`);
      start = i;
    }
  });
  return [...byColor].map(([fill, d]) => `<path fill="${fill}" d="${d}"/>`).join("");
}

const rect = (x, y, w, h, fill, extra = "") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${extra}/>`;

function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const escapeXml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function svg({ w, h, scale, title, body, style = "", defs = "" }) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * scale}" height="${h * scale}" shape-rendering="crispEdges" role="img" aria-label="${escapeXml(title)}">` +
    `<title>${escapeXml(title)}</title>` +
    `<style>${style}@media (prefers-reduced-motion: reduce){*{animation:none!important}}</style>` +
    defs +
    body +
    `</svg>\n`
  );
}

const pct = (n) => `${+n.toFixed(3)}%`;

// Block textures, from frontend/src/components/pixel/blocks.tsx.
const EARTH = { h: "#8CC63F", g: "#6DB33F", G: "#4E9A3A", d: "#8B5A2B", D: "#6B4423", e: "#A0703F" };
const LOG_ROWS = ["bBnbBbnB", "bBbbBnbB", "nBbbBbbB", "bBbnBbbB", "bBbbBbnB", "bBnbBbbB", "bBbbBnbB", "nBbbBbbB"];
const PLANK_ROWS = ["qppppPpq", "ppqppPpp", "pppqpPpp", "PPPPPPPP", "pPpqpppp", "pPppqppp", "qPpppppq", "PPPPPPPP"];
const STONE_ROWS = ["tssssssu", "ssSstssu", "sssSsssu", "uuuuuuuu", "stsuSsss", "sssussts", "sSsusSss", "uuuuuuuu"];
const TEX = {
  grass: { palette: EARTH, rows: ["hgGghgGg", "gGghgGhg", "GgGgGgdG", "dGdDgdGd", "dDedDded", "edDdeDdD", "DdedDedd", "deDdddeD"] },
  dirt: { palette: EARTH, rows: ["dDedDded", "edDdeDdD", "DdedDedd", "deDdddeD", "dedDeddD", "DdeddDed", "ddDedeDd", "eDdDdded"] },
  leaves: { palette: { l: "#4E9A3A", L: "#2F6A31", m: "#6DB33F", k: "#1F3D1A" }, rows: ["lmLlmlLl", "LlmkLmlm", "mLllmLkl", "lkmLllmL", "mlLmkLlm", "LmlLmlmk", "lLkmlLml", "mlmLlkLl"] },
  log: { palette: { b: "#6B4A2E", B: "#4A3320", n: "#8A6440" }, rows: LOG_ROWS },
  planks: { palette: { q: "#C99A5B", p: "#B0834A", P: "#8A6336" }, rows: PLANK_ROWS },
  birch: { palette: { q: "#EFE5BF", p: "#DDCF9C", P: "#B8A974" }, rows: PLANK_ROWS },
  roof: { palette: { q: "#7A5436", p: "#63432A", P: "#45301E" }, rows: PLANK_ROWS },
  stone: { palette: { t: "#B5B5B5", s: "#9A9A9A", S: "#858585", u: "#6E6E6E" }, rows: STONE_ROWS },
  title: { palette: { t: "#F2F2F2", s: "#DCDCDC", S: "#C8C8C8", u: "#AFAFAF" }, rows: STONE_ROWS },
};

function patterns(names) {
  return `<defs>${names
    .map((name) => `<pattern id="${name}" patternUnits="userSpaceOnUse" width="8" height="8">${sprite(TEX[name].rows, TEX[name].palette)}</pattern>`)
    .join("")}</defs>`;
}

// Birds, from blocks.tsx.
const BIRDS = {
  cardinal: { body: "#C8352B", wing: "#8F2019", belly: "#E0645A" },
  bluejay: { body: "#3D7CC9", wing: "#2A5A99", belly: "#DCE8F5" },
  goldfinch: { body: "#F2C230", wing: "#3A3A3A", belly: "#F7DC6F" },
  courier: { body: "#262626", wing: "#111111", belly: "#5F6368" },
};
const PERCHED = ["....bbb.", "...bbbbk", "..bbbbb.", ".wwwwbc.", "wwwwccc.", "w.cccc..", "...f.f.."];
const WINGS_UP = [".ww.....", "..ww....", "...wwbb.", "wbbbbbbk", "ww.ccc..", "........", "........"];
const WINGS_DOWN = ["........", "........", ".....bb.", "wbbbbbbk", "ww.wwc..", "...ww...", "..w....."];
const birdPalette = (c) => ({ b: c.body, w: c.wing, c: c.belly, k: "#F2A33A", f: "#5A3A1A" });
const flipRows = (rows) => rows.map((row) => [...row].reverse().join(""));

function flyingBird(colors, flip = false) {
  const up = flip ? flipRows(WINGS_UP) : WINGS_UP;
  const down = flip ? flipRows(WINGS_DOWN) : WINGS_DOWN;
  const eye = flip ? 1 : 6;
  return (
    `<g class="wu">${sprite(up, birdPalette(colors))}${rect(eye, 2, 1, 1, "#111111")}</g>` +
    `<g class="wd">${sprite(down, birdPalette(colors))}${rect(eye, 2, 1, 1, "#111111")}</g>`
  );
}
const WING_CSS =
  ".wu{animation:wu .36s step-end infinite}.wd{opacity:0;animation:wd .36s step-end infinite}" +
  "@keyframes wu{0%{opacity:1}50%{opacity:0}}@keyframes wd{0%{opacity:0}50%{opacity:1}}";

function perchedBird(colors, flip = false) {
  const rows = flip ? flipRows(PERCHED) : PERCHED;
  return `${sprite(rows, birdPalette(colors))}<g class="blink">${rect(flip ? 2 : 5, 1, 1, 1, "#111111")}</g>`;
}
const BLINK_CSS = ".blink{animation:blink 5s step-end infinite}@keyframes blink{0%{opacity:1}92%{opacity:0}96%{opacity:1}}";

// 12×12 icons, from frontend/src/components/pixel/PixelIcon.tsx.
const ICONS = {
  reads: {
    palette: { o: INK, w: "#FFFFFF", l: "#8DC2F5", s: "#DCE3E8" },
    rows: ["....oooooooo", "..oooooooo.o", "..owwwwwwo.o", "..owllllwo.o", "..owwwwwwo.o", "..owllllwo.o", "..owwwwwwo.o", "..owlllwwo.o", "..owwwwwwooo", "..owllwwwo..", "..oooooooo..", "............"],
  },
  checks: {
    palette: { o: INK, g: "#DDEBF6", c: "#2F6A31", h: "#865700" },
    rows: ["..oooo......", ".oggggo.....", "oggggcgo....", "ogggcggo....", "ocgcgggo....", "ogcggggo....", ".oggggo.....", "..oooooh....", "......ohh...", ".......ohh..", "........ohh.", ".........oo."],
  },
  tells: {
    palette: { o: INK, b: "#3D7CC9", w: "#2A5A99", c: "#DCE8F5", k: "#F2A33A", f: "#5A3A1A", p: "#FFFFFF", l: "#7A7F85" },
    rows: ["............", "......ooo...", ".....obbbo..", "....obbbobko", "...obbbbbo..", "..owwwwbcco.", ".owwwwccco..", ".ow.cccc.pp.", "..o..f.f.pl.", ".........pp.", "............", "............"],
  },
  feed: {
    palette: { o: INK, w: "#FFFFFF", d: "#5F6368" },
    rows: ["............", "............", ".oooooooooo.", "owwwwwwwwwwo", "owwwwwwwwwwo", "owwdwwdwwdwo", "owwwwwwwwwwo", ".oooooooooo.", "..oo........", "..o.........", "............", "............"],
  },
  groups: {
    palette: { o: INK, r: "#B3261E", w: "#F7F1E3", d: "#7A5A48", g: "#8DC2F5" },
    rows: [".....oo.....", "....orro....", "...orrrro...", "..orrrrrro..", ".orrrrrrrro.", "oooooooooooo", ".owwwwwwwwo.", ".owggwwddwo.", ".owggwwddwo.", ".owwwwwddwo.", ".oooooooooo.", "............"],
  },
  places: {
    palette: { o: INK, p: "#B3261E", w: "#FFFFFF", s: "#7A7F85" },
    rows: ["...oooooo...", "..oppppppo..", ".opppwwpppo.", ".oppwwwwppo.", ".oppwwwwppo.", ".opppwwpppo.", "..oppppppo..", "...oppppo...", "....oppo....", ".....oo.....", "..ssssssss..", "............"],
  },
  news: {
    palette: { o: INK, w: "#FFFFFF", l: "#7A7F85", i: "#8DC2F5" },
    rows: ["oooooooooooo", "owwwwwwwwwwo", "owoooooooowo", "owwwwwwwwwwo", "owiiiwwllwwo", "owiiiwwwwwwo", "owiiiwwllwwo", "owwwwwwwwwwo", "owllllwllwwo", "owwwwwwwwwwo", "oooooooooooo", "............"],
  },
  chat: {
    palette: { o: INK, k: "#2F6A31", w: "#FFFFFF" },
    rows: ["............", ".oooooooooo.", "okkkkkkkkkko", "okkkkwwwkkko", "okkkkkkkwkko", "okkkkkkwkkko", "okkkkkwkkkko", "okkkkkkkkkko", "okkkkkwkkkko", ".ooookoooooo", "....ok......", "....o......."],
  },
  votes: {
    palette: { o: INK, w: "#FFFFFF", c: "#2F6A31", s: "#B3D6F6" },
    rows: ["....oooo....", "....owwo....", "....owco....", "...ocwwo....", "oooooooooooo", "osssssssssso", "osooooooooso", "osssssssssso", "osssssssssso", "osssssssssso", "oooooooooooo", "............"],
  },
  // Extras for the README: a chest for storage, a shield for moderation, a torch-lit alert.
  chest: {
    palette: { o: INK, q: "#C99A5B", p: "#B0834A", P: "#8A6336", k: "#B5B5B5" },
    rows: ["............", "oooooooooooo", "oqqqqqqqqqqo", "oppppppppppo", "oooookkooooo", "oqqqqkkqqqqo", "oppppppppppo", "oqqqqqqqqqqo", "oppppppppppo", "oPPPPPPPPPPo", "oooooooooooo", "............"],
  },
  shield: {
    palette: { o: INK, b: "#3D7CC9", B: "#2A5A99", w: "#FFFFFF" },
    rows: [".oooooooooo.", "obbbbbbBBBBo", "obbbbbbBBBBo", "obbbbbwBBBBo", "obbbbwwBBBBo", "obwbwwbBBBBo", "obwwwbbBBBBo", ".obwbbbBBBo.", ".obbbbbBBBo.", "..obbbbBBo..", "...obbBBo...", "....oooo...."],
  },
  alert: {
    palette: { o: INK, y: "#F2C230", Y: "#C99A00", r: "#B3261E" },
    rows: [".....oo.....", "....oyyo....", "....oyyo....", "...oyyyYo...", "...oyrrYo...", "..oyyrrYYo..", "..oyyrrYYo..", ".oyyyrrYYYo.", ".oyyyyyYYYo.", "oyyyyrrYYYYo", "oyyyyyyYYYYo", "oooooooooooo"],
  },
  question: {
    palette: { o: INK, w: "#FFFFFF", k: INK },
    rows: [".oooooooooo.", "owwwwwwwwwwo", "owwwkkkwwwwo", "owwkwwwkwwwo", "owwwwwwkwwwo", "owwwwwkwwwwo", "owwwwkwwwwwo", "owwwwwwwwwwo", "owwwwkwwwwwo", ".oooooooooo.", "..oo........", "..o........."],
  },
  checkmark: {
    palette: { o: INK, w: "#FFFFFF", c: "#2F6A31" },
    rows: [".oooooooooo.", "owwwwwwwwwwo", "owwwwwwwwcwo", "owwwwwwwccwo", "owwwwwwccwwo", "owcwwwccwwwo", "owccwccwwwwo", "owwccccwwwwo", "owwwccwwwwwo", ".oooooooooo.", "..oo........", "..o........."],
  },
};
const icon = (name, x, y) => sprite(ICONS[name].rows, ICONS[name].palette, x, y);

function flower(x, ground, color) {
  return rect(x + 1, ground - 3, 1, 3, "#2F6A31") + rect(x + 2, ground - 2, 1, 1, "#4E9A3A") + rect(x, ground - 5, 3, 2, color) + rect(x + 1, ground - 6, 1, 1, color);
}
function tuft(x, ground) {
  return `<g fill="#3F8A35">${rect(x, ground - 2, 1, 2, "#3F8A35")}${rect(x + 2, ground - 3, 1, 3, "#3F8A35")}${rect(x + 4, ground - 2, 1, 2, "#3F8A35")}</g>`;
}

// ---------- hero.svg: the title screen ----------

function hero() {
  const W = 320;
  const H = 128;
  const G = 112; // top of the ground
  const style = [];
  const body = [];

  ["#7FB8F0", "#8DC2F5", "#9ECBF5", "#B3D6F6", "#C6E0F6", "#DDEBF6"].forEach((c, i) => body.push(rect(0, i * 19, W, 19, c)));

  // A square sun.
  body.push(rect(282, 8, 16, 16, "#FFF3B0"), rect(285, 11, 10, 10, "#FFE680"));

  // Flat clouds drifting right. Each starts somewhere on screen so a still frame looks right.
  [
    { x: 18, y: 14, dur: 95 },
    { x: 150, y: 60, dur: 120 },
    { x: 236, y: 30, dur: 80 },
  ].forEach((c, i) => {
    const from = -c.x - 40;
    const to = W + 8 - c.x;
    const delay = -((c.x + 40) / (W + 48)) * c.dur;
    style.push(`.cl${i}{animation:cl${i} ${c.dur}s steps(${W + 48}) ${delay.toFixed(1)}s infinite}@keyframes cl${i}{from{transform:translateX(${from}px)}to{transform:translateX(${to}px)}}`);
    body.push(`<g transform="translate(${c.x} ${c.y})"><g class="cl${i}">${rect(0, 4, 32, 5, "#FFFFFF")}${rect(8, 0, 16, 4, "#FFFFFF")}${rect(0, 9, 32, 2, "#E6F0F8")}</g></g>`);
  });

  // Two ranges of blocky hills.
  const hills = (color, min, max, seed) => {
    const r = rng(seed);
    let h = min + 4;
    let d = "";
    for (let x = 0; x < W; x += 8) {
      h = Math.max(min, Math.min(max, h + [-4, 0, 0, 4][Math.floor(r() * 4)]));
      d += `M${x} ${G - h}h8v${h}h-8z`;
    }
    return `<path fill="${color}" d="${d}"/>`;
  };
  body.push(hills("#B7D3C0", 12, 32, 7), hills("#98C2A2", 4, 20, 19));

  // Ground.
  body.push(rect(0, G, W, 8, "url(#grass)"), rect(0, G + 8, W, 8, "url(#dirt)"));

  // Oak tree with a cardinal on top.
  body.push(rect(24, G - 12, 8, 12, "url(#log)"), rect(8, G - 28, 40, 16, "url(#leaves)"), rect(16, G - 36, 24, 8, "url(#leaves)"));
  body.push(`<g transform="translate(30 ${G - 43})">${perchedBird(BIRDS.cardinal)}</g>`);

  // A house.
  body.push(rect(56, G - 24, 32, 24, "url(#planks)"));
  [[52, G - 28, 40], [56, G - 32, 32], [60, G - 36, 24], [64, G - 40, 16]].forEach(([x, y, w]) => body.push(rect(x, y, w, 4, "url(#roof)")));
  body.push(rect(68, G - 12, 8, 12, "#5A3A1A"), rect(74, G - 7, 1, 1, "#F2C230"));
  body.push(rect(59, G - 20, 7, 7, INK), rect(60, G - 19, 5, 5, "#8DC2F5"), rect(78, G - 20, 7, 7, INK), rect(79, G - 19, 5, 5, "#8DC2F5"));

  // City hall: stone, white columns, a flag.
  body.push(rect(228, G - 24, 64, 24, "url(#stone)"));
  [[224, G - 28, 72], [232, G - 32, 56], [244, G - 36, 32]].forEach(([x, y, w]) => body.push(rect(x, y, w, 4, "url(#stone)")));
  [234, 244, 272, 282].forEach((x) => body.push(rect(x, G - 22, 4, 22, "#EDEDED"), rect(x + 3, G - 22, 1, 22, "#C8C8C8")));
  body.push(rect(254, G - 14, 12, 14, "#4A3320"), rect(259, G - 14, 1, 14, "#2F2014"));
  body.push(rect(259, G - 46, 1, 10, "#5F6368"));
  const FLAG_A = ["rrrrrr....", "rrrrrrrrrr", "rrrrwwrrrr", "rrrrrrrrrr", "....rrrrrr"];
  const FLAG_B = ["....rrrrrr", "rrrrrrrrrr", "rrrrwwrrrr", "rrrrrrrrrr", "rrrrrr...."];
  body.push(`<g class="wu" style="animation-duration:.9s">${sprite(FLAG_A, { r: "#B3261E", w: "#FFFFFF" }, 260, G - 46)}</g>`);
  body.push(`<g class="wd" style="animation-duration:.9s">${sprite(FLAG_B, { r: "#B3261E", w: "#FFFFFF" }, 260, G - 46)}</g>`);

  // Flowers and grass along the ground.
  [[4, "#E53935"], [44, "#F2C230"], [100, "#E53935"], [132, "#F2C230"], [208, "#E53935"], [304, "#F2C230"]].forEach(([x, c]) => body.push(flower(x, G, c)));
  [36, 94, 118, 160, 188, 216, 300, 312].forEach((x) => body.push(tuft(x, G)));

  // A neighbor walks between the house and city hall and now and then has something nice to say.
  const PERSON = ["..hh..", ".hhhh.", ".hssh.", ".ssss.", "..ss..", ".bbbb.", "bbbbbb", "sbbbbs", "sbbbbs", ".pppp.", ".p..p.", ".p..p.", ".k..k."];
  const personPalette = { h: "#4A3320", s: "#E0B08A", b: "#2F6A31", p: "#2A3A5A", k: INK };
  const BUBBLE_HEART = [
    ".ooooooooo.", "owwwwwwwwwo", "owwrrwrrwwo", "owrrrrrrrwo", "owwrrrrrwwo", "owwwrrrwwwo", "owwwwrwwwwo", "owwwwwwwwwo", ".ooooooooo.", "...oo......", "...o.......",
  ];
  style.push(
    `.walk{animation:walk 18s steps(88) infinite alternate}@keyframes walk{to{transform:translateX(84px)}}`,
    `.bob{animation:bob .5s step-end infinite}@keyframes bob{50%{transform:translateY(-1px)}}`,
    `.heart{transform-box:fill-box;transform-origin:20% 100%;transform:scale(0);animation:heart 6s steps(6) infinite}` +
      `@keyframes heart{0%,40%{transform:scale(0)}46%,78%{transform:scale(1)}84%,100%{transform:scale(0)}}`,
  );
  body.push(
    `<g transform="translate(114 ${G - 13})"><g class="walk"><g class="bob">${sprite(PERSON, personPalette)}</g>` +
      `<g transform="translate(4 -13)"><g class="heart">${sprite(BUBBLE_HEART, { o: INK, w: "#FFFFFF", r: "#B3261E" })}</g></g></g></g>`,
  );

  // The courier bird carries a page from city hall to the house.
  style.push(
    `.courier{animation:courier 11s steps(120) infinite}` +
      `@keyframes courier{0%{transform:translate(0,0);opacity:0}4%{opacity:1}50%{transform:translate(-150px,-2px)}88%{opacity:1}94%{transform:translate(-172px,2px);opacity:0}100%{transform:translate(-172px,2px);opacity:0}}`,
  );
  body.push(`<g transform="translate(250 ${G - 34})"><g class="courier">${flyingBird(BIRDS.courier, true)}${rect(0, 5, 3, 3, "#FFFFFF")}${rect(0, 6, 3, 1, "#7A7F85")}</g></g>`);

  // Title: stone letters with an ink outline and a deep bottom edge.
  const title = "DOCKET";
  const s = 4;
  const tx = Math.round((W - textWidth(title) * s) / 2);
  const ty = 8;
  let logo = "";
  for (let dy = -1; dy <= 5; dy += 1) for (let dx = -1; dx <= 1; dx += 1) logo += `<path fill="${INK}" d="${textPath(title, tx + dx, ty + dy, s)}"/>`;
  for (let dy = 4; dy >= 1; dy -= 1) logo += `<path fill="${dy > 2 ? "#4A4A4A" : "#6E6E6E"}" d="${textPath(title, tx, ty + dy, s)}"/>`;
  logo += `<path fill="url(#title)" d="${textPath(title, tx, ty, s)}"/>`;
  body.push(logo);

  // Yellow splash text that pulses and changes, like the title screen of a certain block game.
  const splashes = ["Reads city hall!", "32 neighborhoods!", "Cites its sources!", "Neighbors welcome!", "Now with live news!"];
  const each = 100 / splashes.length;
  style.push(`.pulse{animation:pulse .45s ease-in-out infinite alternate}@keyframes pulse{from{transform:scale(1)}to{transform:scale(1.09)}}`);
  const splashBody = splashes
    .map((line, i) => {
      style.push(
        `.sp${i}{opacity:${i === 0 ? 1 : 0};animation:sp${i} ${splashes.length * 3.5}s step-end infinite}` +
          `@keyframes sp${i}{0%{opacity:${i === 0 ? 1 : 0}}${i === 0 ? "" : `${pct(i * each)}{opacity:1}`}${pct((i + 1) * each)}{opacity:0}}`,
      );
      return `<g class="sp${i}">${text(line, { x: 0, y: -4, fill: "#FFFF55", shadow: "#3F3F15", align: "center" })}</g>`;
    })
    .join("");
  body.push(`<g transform="translate(266 34) rotate(-14)" shape-rendering="geometricPrecision"><g class="pulse">${splashBody}</g></g>`);

  body.push(text("Neighbors, news, maps & city hall, in one place.", { x: W / 2, y: 56, fill: "#FFFFFF", shadow: "#2C4A6B", align: "center" }));

  style.push(WING_CSS, BLINK_CSS);
  return svg({
    w: W,
    h: H,
    scale: 4,
    title: "DOCKET: a pixel-art title screen with a tree, a house and Fremont city hall, a neighbor walking and a bird carrying a page",
    style: style.join(""),
    defs: patterns(["grass", "dirt", "leaves", "log", "planks", "roof", "stone", "title"]),
    body: body.join(""),
  });
}

// ---------- hotbar.svg: the features as an item hotbar ----------

const HOTBAR = [
  { icon: "feed", name: "Neighborhood Feed", lore: "Post, reply, like, share photos", color: "#FFFFFF" },
  { icon: "groups", name: "Neighborhood Groups", lore: "Every Fremont neighborhood", color: "#FFFFFF", count: "32" },
  { icon: "places", name: "Places Map", lore: "Schools, food, issues, incidents", color: "#FFFFFF" },
  { icon: "news", name: "Fremont News", lore: "Police, fire, traffic, city hall", color: "#FFFFFF" },
  { icon: "votes", name: "Community Votes", lore: "Vote, review, weigh pros & cons", color: "#FFFFFF" },
  { icon: "chat", name: "Ask Docket", lore: "Answers with numbered sources", color: "#55FFFF" },
  { icon: "reads", name: "City Hall Reader", lore: "Agendas, minutes, staff reports", color: "#FF55FF", count: "11" },
  { icon: "checks", name: "Citation Checker", lore: "Facts checked against sources", color: "#FF55FF" },
  { icon: "tells", name: "Block Courier", lore: "Updates for the blocks affected", color: "#FF55FF" },
];

function hotbar() {
  const W = 216;
  const slot = 20;
  const n = HOTBAR.length;
  const bx = Math.round((W - n * slot) / 2);
  const by = 38;
  const H = by + slot + 4;
  const secs = 2.4;
  const total = n * secs;
  const style = [];
  const body = [];

  HOTBAR.forEach((item, i) => {
    const w = Math.max(textWidth(item.name), textWidth(item.lore)) + 9;
    if (w > W) throw new Error(`Tooltip for ${item.name} is too wide`);
    const x = Math.round((W - w) / 2);
    const y = 4;
    const h = 27;
    const box =
      rect(x + 1, y, w - 2, h, "#100010") +
      rect(x, y + 1, w, h - 2, "#100010") +
      rect(x + 1, y + 1, w - 2, 1, "#5000FF") +
      rect(x + 1, y + h - 2, w - 2, 1, "#28007F") +
      rect(x + 1, y + 2, 1, h - 4, "#3C00BF") +
      rect(x + w - 2, y + 2, 1, h - 4, "#3C00BF");
    const on = pct((i / n) * 100);
    const off = pct(((i + 1) / n) * 100);
    style.push(
      `.tip${i}{opacity:${i === 0 ? 1 : 0};animation:tip${i} ${total}s step-end infinite}` +
        `@keyframes tip${i}{0%{opacity:${i === 0 ? 1 : 0}}${i === 0 ? "" : `${on}{opacity:1}`}${off}{opacity:0}}`,
    );
    body.push(
      `<g class="tip${i}">${box}${text(item.name, { x: x + 4, y: y + 4, fill: item.color, shadow: "#3F3F3F" })}${text(item.lore, { x: x + 4, y: y + 15, fill: "#AAAAAA", shadow: "#2A2A2A" })}</g>`,
    );
  });

  body.push(rect(bx - 1, by - 1, n * slot + 2, slot + 2, INK));
  HOTBAR.forEach((item, i) => {
    const x = bx + i * slot;
    body.push(
      rect(x, by, slot, slot, "#555555"),
      rect(x + 1, by + 1, slot - 2, slot - 2, "#8B8B8B"),
      rect(x + 1, by + 1, slot - 2, 1, "#373737"),
      rect(x + 1, by + 1, 1, slot - 2, "#373737"),
      rect(x + 2, by + slot - 2, slot - 3, 1, "#C6C6C6"),
      rect(x + slot - 2, by + 2, 1, slot - 3, "#C6C6C6"),
      icon(item.icon, x + 4, by + 4),
    );
    if (item.count) body.push(text(item.count, { x: x + slot - 2, y: by + slot - 9, fill: "#FFFFFF", shadow: "#3F3F3F", align: "right" }));
  });

  const stops = HOTBAR.map((_, i) => `${pct((i / n) * 100)}{transform:translateX(${i * slot}px)}`).join("");
  style.push(`.sel{animation:sel ${total}s step-end infinite}@keyframes sel{${stops}}`);
  body.push(
    `<g class="sel"><path fill-rule="evenodd" fill="${INK}" d="M${bx - 3} ${by - 3}h26v26h-26zM${bx - 2} ${by - 2}v24h24v-24z"/>` +
      `<path fill-rule="evenodd" fill="#FFFFFF" d="M${bx - 2} ${by - 2}h24v24h-24zM${bx} ${by}v20h20v-20z"/></g>`,
  );

  return svg({
    w: W,
    h: H,
    scale: 4,
    title: "Docket's features as a nine-slot item hotbar: feed, groups, places, news, votes, chat, city hall reader, citation checker and block courier",
    style: style.join(""),
    body: body.join(""),
  });
}

// ---------- pipeline.svg: a minecart carries a document through the agent graph ----------

const STATIONS = [
  { icon: "reads", name: "CRAWL", lore: "robots.txt" },
  { icon: "chest", name: "INGEST", lore: "chunk+embed" },
  { icon: "checks", name: "RESEARCH", lore: "vector+BM25" },
  { icon: "news", name: "WRITE", lore: "cited drafts" },
  { icon: "checkmark", name: "VERIFY", lore: "facts verbatim" },
  { icon: "tells", name: "PUBLISH", lore: "to your block" },
];

function pipeline() {
  const W = 480;
  const H = 88;
  const gap = 80;
  const rail = 70;
  const style = [];
  const body = [rect(0, 0, W, H, "url(#stone)"), rect(0, 0, W, 72, "#000000", ' fill-opacity="0.55"')];
  const secs = 3;
  const hold = 1.8;
  const total = STATIONS.length * secs;

  // Torches between stations.
  style.push(`.fl{animation:fl .7s step-end infinite}@keyframes fl{50%{opacity:.55}}`);
  for (let i = 0; i < STATIONS.length - 1; i += 1) {
    const x = 40 + gap * i + gap / 2;
    body.push(rect(x - 3, 26, 7, 7, "#F2A33A", ' fill-opacity="0.18"'), rect(x, 30, 1, 7, "#6B4A2E"), `<g class="fl">${rect(x, 28, 1, 2, "#FFE680")}${rect(x - 1, 29, 3, 1, "#F2A33A")}</g>`);
  }

  STATIONS.forEach((station, i) => {
    const cx = 40 + gap * i;
    const on = ((i * secs) / total) * 100;
    const off = ((i * secs + hold) / total) * 100;
    style.push(
      `.g${i}{opacity:${i === 0 ? 1 : 0};animation:g${i} ${total}s step-end infinite}` +
        `@keyframes g${i}{0%{opacity:${i === 0 ? 1 : 0}}${i === 0 ? "" : `${pct(on)}{opacity:1}`}${pct(off)}{opacity:0}}`,
    );
    body.push(
      `<g class="g${i}">${rect(cx - 17, 25, 34, 34, "#FFE680", ' fill-opacity="0.45"')}${rect(cx - 19, 27, 38, 30, "#FFE680", ' fill-opacity="0.25"')}</g>`,
      rect(cx - 15, 27, 30, 30, INK),
      rect(cx - 14, 28, 28, 28, "url(#planks)"),
      rect(cx - 12, 30, 24, 24, "#5A3E22"),
      `<g transform="translate(${cx - 12} 30) scale(2)">${icon(station.icon, 0, 0)}</g>`,
      text(station.name, { x: cx, y: 3, fill: "#FFFFFF", shadow: "#3F3F3F", align: "center" }),
      text(station.lore, { x: cx, y: 13, fill: "#AAAAAA", shadow: "#1F1F1F", align: "center" }),
    );
  });

  // Rails and the floor.
  body.push(rect(0, 72, W, 1, INK));
  for (let x = 1; x < W; x += 6) body.push(rect(x, 72, 4, 2, "#6B4A2E"));
  body.push(rect(0, rail - 1, W, 1, "#C6C6C6"), rect(0, rail, W, 2, "#7A7A7A"));

  // The minecart, loaded with a page.
  const CART = [
    "...wwwwww.....",
    "...wllllw.....",
    "oooooooooooooo",
    "oggggggggggggo",
    "oGGGGGGGGGGGGo",
    "oggggggggggggo",
    ".oooooooooooo.",
    "..kk......kk..",
    "..kk......kk..",
  ];
  const frames = [];
  STATIONS.forEach((_, i) => {
    frames.push(`${pct(((i * secs) / total) * 100)}{transform:translateX(${i * gap}px)}`);
    frames.push(`${pct(((i * secs + hold) / total) * 100)}{transform:translateX(${i * gap}px)}`);
  });
  frames.push(`100%{transform:translateX(${STATIONS.length * gap}px)}`);
  style.push(`.cart{animation:cart ${total}s linear infinite}@keyframes cart{${frames.join("")}}`);
  body.push(`<g transform="translate(33 ${rail - 9})"><g class="cart">${sprite(CART, { o: INK, g: "#8A8F96", G: "#6E737A", k: "#3A3A3A", w: "#FFFFFF", l: "#7A7F85" })}</g></g>`);

  return svg({
    w: W,
    h: H,
    scale: 2.5,
    title: "Docket's pipeline agent as a mine track: crawl, ingest, research, write, verify, publish",
    style: style.join(""),
    defs: patterns(["stone", "planks"]),
    body: body.join(""),
  });
}

// ---------- achievements.svg: eval results as advancement toasts ----------

const ADVANCEMENTS = [
  { icon: "reads", name: "Found the Evidence", stat: "Retrieval hit rate 20/20" },
  { icon: "chat", name: "Question Answered", stat: "Answered 19 of 20" },
  { icon: "checks", name: "Sources on Point", stat: "Valid citations 19/20" },
  { icon: "news", name: "Right Record Cited", stat: "Expected evidence 18/20" },
  { icon: "question", name: "Knows When to Say No", stat: "Correct refusals 5/5" },
];

function achievements() {
  const W = 172;
  const H = 34;
  const total = ADVANCEMENTS.length * 4;
  const each = 100 / ADVANCEMENTS.length;
  const style = [];
  const body = [];
  ADVANCEMENTS.forEach((a, i) => {
    const x = 2;
    const y = 2;
    const w = W - 4;
    const h = H - 4;
    const start = i * each;
    const frames = [
      `0%{transform:translateX(${i === 0 ? 0 : W}px)}`,
      i === 0 ? "" : `${pct(start)}{transform:translateX(${W}px)}`,
      `${pct(start + each * 0.1)}{transform:translateX(0)}`,
      `${pct(start + each * 0.88)}{transform:translateX(0)}`,
      `${pct(start + each)}{transform:translateX(${W}px)}`,
      `100%{transform:translateX(${W}px)}`,
    ];
    style.push(
      `.t${i}{transform:translateX(${i === 0 ? 0 : W}px);animation:t${i} ${total}s steps(${Math.round(total * 12)}) infinite}@keyframes t${i}{${frames.join("")}}`,
    );
    body.push(
      `<g class="t${i}">` +
        rect(x + 1, y, w - 2, h, INK) +
        rect(x, y + 1, w, h - 2, INK) +
        rect(x + 1, y + 1, w - 2, h - 2, "#C6C6C6") +
        rect(x + 2, y + 2, w - 4, h - 4, "#212121") +
        rect(x + 5, y + 5, 20, 20, "#373737") +
        rect(x + 6, y + 6, 18, 18, "#8B8B8B") +
        icon(a.icon, x + 9, y + 9) +
        text(a.name, { x: x + 30, y: y + 5, fill: "#FFFF55", shadow: "#3F3F15" }) +
        text(a.stat, { x: x + 30, y: y + 16, fill: "#FFFFFF", shadow: "#3F3F3F" }) +
        `</g>`,
    );
  });
  return svg({
    w: W,
    h: H,
    scale: 4,
    title: "Groundedness eval results as advancement toasts: retrieval 20/20, answered 19/20, valid citations 19/20, expected evidence 18/20, correct refusals 5/5",
    style: style.join(""),
    body: body.join(""),
  });
}

// ---------- footer.svg: the neighborhood asleep, with the agent still reading ----------

function footer() {
  const W = 320;
  const H = 76;
  const G = 68;
  const style = [];
  const body = [];
  ["#0E1A2B", "#122238", "#152841", "#172B45"].forEach((c, i) => body.push(rect(0, i * 17, W, 17, c)));

  const r = rng(42);
  style.push(`.tw{animation:tw 3s step-end infinite}@keyframes tw{50%{opacity:.25}62%{opacity:1}}`);
  for (let i = 0; i < 44; i += 1) {
    const x = Math.floor(r() * W);
    const y = Math.floor(r() * 44);
    const big = r() < 0.15;
    const star = big
      ? rect(x, y - 1, 1, 3, "#FFFFFF") + rect(x - 1, y, 3, 1, "#FFFFFF")
      : rect(x, y, 1, 1, r() < 0.5 ? "#FFFFFF" : "#BFD4F2");
    body.push(`<g class="tw" style="animation-delay:-${(r() * 3).toFixed(2)}s;animation-duration:${(2 + r() * 3).toFixed(1)}s">${star}</g>`);
  }

  // Moon.
  body.push(rect(6, 4, 12, 12, "#F4F1DE"), rect(9, 7, 3, 3, "#D9D4B8"), rect(13, 11, 2, 2, "#D9D4B8"));

  body.push(text("Your block, on the docket.", { x: W / 2, y: 22, s: 2, fill: "#FFFFFF", shadow: "#0A1220", align: "center" }));

  // Rooftops with windows; some lights go on and off.
  style.push(`.gl{animation:gl 5s step-end infinite}@keyframes gl{0%{opacity:1}70%{opacity:.15}85%{opacity:1}}`);
  let x = 0;
  const rr = rng(7);
  while (x < W) {
    const w = 16 + Math.floor(rr() * 3) * 8;
    const h = 8 + Math.floor(rr() * 3) * 4;
    body.push(rect(x, G - h, w, h, "#0A1220"), rect(x + 2, G - h - 3, w - 4, 3, "#0A1220"));
    for (let wx = x + 4; wx < x + w - 4; wx += 6) {
      if (rr() < 0.5) {
        const lit = rect(wx, G - h + 3, 2, 2, "#F7DC6F");
        body.push(rr() < 0.4 ? `<g class="gl" style="animation-delay:-${(rr() * 5).toFixed(2)}s">${lit}</g>` : lit);
      }
    }
    x += w + 4 + Math.floor(rr() * 2) * 8;
  }

  // Docket's window stays lit: the agent reads while the block sleeps.
  body.push(rect(150, G - 20, 20, 20, "#0A1220"), rect(146, G - 24, 28, 4, "#0A1220"), rect(156, G - 14, 8, 6, "#FFE680"), rect(159, G - 14, 1, 6, "#0A1220"), rect(156, G - 11, 8, 1, "#0A1220"));
  style.push(`.zz{opacity:0;animation:zz 3.6s steps(9) infinite}@keyframes zz{0%{transform:translate(0,0);opacity:0}20%{opacity:1}100%{transform:translate(4px,-4px);opacity:0}}`);
  body.push(`<g class="zz">${text("z", { x: 176, y: G - 22, fill: "#8FA6C8" })}</g>`, `<g class="zz" style="animation-delay:-1.8s">${text("z", { x: 184, y: G - 24, fill: "#8FA6C8" })}</g>`);

  // Fireflies.
  style.push(`.ff{animation:ff 6s ease-in-out infinite}@keyframes ff{0%,100%{transform:translate(0,0);opacity:.15}25%{transform:translate(3px,-2px);opacity:1}50%{transform:translate(6px,1px);opacity:.35}75%{transform:translate(2px,3px);opacity:1}}`);
  [[40, G - 6], [96, G - 12], [214, G - 8], [262, G - 14], [300, G - 5]].forEach(([fx, fy], i) =>
    body.push(`<g class="ff" style="animation-delay:-${i * 1.3}s">${rect(fx, fy, 1, 1, "#EFF58A")}</g>`),
  );

  body.push(rect(0, G, W, 8, "url(#grass)"), rect(0, G, W, 8, "#0E1A2B", ' fill-opacity="0.55"'));

  style.push(BLINK_CSS);
  return svg({
    w: W,
    h: H,
    scale: 4,
    title: "Your block, on the docket: a night-time pixel neighborhood with twinkling stars and lit windows",
    style: style.join(""),
    defs: patterns(["grass"]),
    body: body.join(""),
  });
}

// ---------- divider.svg: a strip of grass blocks ----------

function divider() {
  const W = 320;
  const H = 14;
  const G = 6;
  const body = [rect(0, G, W, 8, "url(#grass)")];
  const r = rng(3);
  for (let x = 2; x < W - 6; x += 10 + Math.floor(r() * 14)) {
    const pick = r();
    if (pick < 0.2) body.push(flower(x, G, "#E53935"));
    else if (pick < 0.35) body.push(flower(x, G, "#F2C230"));
    else if (pick < 0.8) body.push(tuft(x, G));
  }
  return svg({ w: W, h: H, scale: 4, title: "", defs: patterns(["grass"]), body: body.join("") }).replace('role="img" aria-label=""', 'aria-hidden="true"');
}

// ---------- Buttons and icons ----------

function button(label, { accent = false } = {}) {
  const w = Math.max(textWidth(label) + 24, 76);
  const h = 20;
  const body =
    rect(0, 0, w, h, INK) +
    rect(1, 1, w - 2, h - 2, accent ? "#5C8F3A" : "#6F6F6F") +
    rect(1, 1, w - 2, 1, accent ? "#8CC63F" : "#AAAAAA") +
    rect(1, 1, 1, h - 3, accent ? "#8CC63F" : "#AAAAAA") +
    rect(1, h - 3, w - 2, 2, accent ? "#3F6A28" : "#4F4F4F") +
    text(label, { x: w / 2, y: 6, fill: accent ? "#FFFFA0" : "#FFFFFF", shadow: "#3F3F3F", align: "center" });
  return svg({ w, h, scale: 2, title: label, body });
}

// ---------- Write everything ----------

function write(name, content) {
  const path = join(OUT, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log(`${name.padEnd(28)} ${(content.length / 1024).toFixed(1)} KB`);
}

write("hero.svg", hero());
write("hotbar.svg", hotbar());
write("pipeline.svg", pipeline());
write("achievements.svg", achievements());
write("footer.svg", footer());
write("divider.svg", divider());

const BUTTONS = [
  ["play", "Live preview", true],
  ["features", "Features"],
  ["how", "How it works"],
  ["quickstart", "Quick start"],
  ["architecture", "Architecture"],
  ["docs", "Docs"],
];
for (const [slug, label, accent] of BUTTONS) write(`buttons/${slug}.svg`, button(label, { accent }));

for (const name of Object.keys(ICONS)) {
  write(`icons/${name}.svg`, svg({ w: 12, h: 12, scale: 4, title: "", body: icon(name, 0, 0) }).replace('role="img" aria-label=""', 'aria-hidden="true"'));
}
