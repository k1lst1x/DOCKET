import { Sprite, type Palette } from "@/components/pixel/Sprite";

// 12×12 pixel icons for the About page.

const INK = "#262626";

const ICONS = {
  reads: {
    palette: { o: INK, w: "#FFFFFF", l: "#8DC2F5", s: "#DCE3E8" },
    rows: [
      "....oooooooo",
      "..oooooooo.o",
      "..owwwwwwo.o",
      "..owllllwo.o",
      "..owwwwwwo.o",
      "..owllllwo.o",
      "..owwwwwwo.o",
      "..owlllwwo.o",
      "..owwwwwwooo",
      "..owllwwwo..",
      "..oooooooo..",
      "............",
    ],
  },
  checks: {
    palette: { o: INK, g: "#DDEBF6", c: "#2F6A31", h: "#865700" },
    rows: [
      "..oooo......",
      ".oggggo.....",
      "oggggcgo....",
      "ogggcggo....",
      "ocgcgggo....",
      "ogcggggo....",
      ".oggggo.....",
      "..oooooh....",
      "......ohh...",
      ".......ohh..",
      "........ohh.",
      ".........oo.",
    ],
  },
  tells: {
    palette: { o: INK, b: "#3D7CC9", w: "#2A5A99", c: "#DCE8F5", k: "#F2A33A", f: "#5A3A1A", p: "#FFFFFF", l: "#7A7F85" },
    rows: [
      "............",
      "......ooo...",
      ".....obbbo..",
      "....obbbobko",
      "...obbbbbo..",
      "..owwwwbcco.",
      ".owwwwccco..",
      ".ow.cccc.pp.",
      "..o..f.f.pl.",
      ".........pp.",
      "............",
      "............",
    ],
  },
  feed: {
    palette: { o: INK, w: "#FFFFFF", d: "#5F6368" },
    rows: [
      "............",
      "............",
      ".oooooooooo.",
      "owwwwwwwwwwo",
      "owwwwwwwwwwo",
      "owwdwwdwwdwo",
      "owwwwwwwwwwo",
      ".oooooooooo.",
      "..oo........",
      "..o.........",
      "............",
      "............",
    ],
  },
  groups: {
    palette: { o: INK, r: "#B3261E", w: "#F7F1E3", d: "#7A5A48", g: "#8DC2F5" },
    rows: [
      ".....oo.....",
      "....orro....",
      "...orrrro...",
      "..orrrrrro..",
      ".orrrrrrrro.",
      "oooooooooooo",
      ".owwwwwwwwo.",
      ".owggwwddwo.",
      ".owggwwddwo.",
      ".owwwwwddwo.",
      ".oooooooooo.",
      "............",
    ],
  },
  places: {
    palette: { o: INK, p: "#B3261E", w: "#FFFFFF", s: "#7A7F85" },
    rows: [
      "...oooooo...",
      "..oppppppo..",
      ".opppwwpppo.",
      ".oppwwwwppo.",
      ".oppwwwwppo.",
      ".opppwwpppo.",
      "..oppppppo..",
      "...oppppo...",
      "....oppo....",
      ".....oo.....",
      "..ssssssss..",
      "............",
    ],
  },
  news: {
    palette: { o: INK, w: "#FFFFFF", l: "#7A7F85", i: "#8DC2F5" },
    rows: [
      "oooooooooooo",
      "owwwwwwwwwwo",
      "owoooooooowo",
      "owwwwwwwwwwo",
      "owiiiwwllwwo",
      "owiiiwwwwwwo",
      "owiiiwwllwwo",
      "owwwwwwwwwwo",
      "owllllwllwwo",
      "owwwwwwwwwwo",
      "oooooooooooo",
      "............",
    ],
  },
  chat: {
    palette: { o: INK, k: "#2F6A31", w: "#FFFFFF" },
    rows: [
      "............",
      ".oooooooooo.",
      "okkkkkkkkkko",
      "okkkkwwwkkko",
      "okkkkkkkwkko",
      "okkkkkkwkkko",
      "okkkkkwkkkko",
      "okkkkkkkkkko",
      "okkkkkwkkkko",
      ".ooookoooooo",
      "....ok......",
      "....o.......",
    ],
  },
  votes: {
    palette: { o: INK, w: "#FFFFFF", c: "#2F6A31", s: "#B3D6F6" },
    rows: [
      "....oooo....",
      "....owwo....",
      "....owco....",
      "...ocwwo....",
      "oooooooooooo",
      "osssssssssso",
      "osooooooooso",
      "osssssssssso",
      "osssssssssso",
      "osssssssssso",
      "oooooooooooo",
      "............",
    ],
  },
} satisfies Record<string, { palette: Palette; rows: readonly string[] }>;

export type PixelIconName = keyof typeof ICONS;

export function PixelIcon({ name, className = "h-10 w-10" }: { name: PixelIconName; className?: string }) {
  const icon = ICONS[name];
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false" shapeRendering="crispEdges" className={className}>
      <Sprite rows={icon.rows} palette={icon.palette} />
    </svg>
  );
}
