import type { CSSProperties, ReactElement, SVGProps } from "react";

export type Palette = Record<string, string>;

/** CSS custom properties for inline styles (animation timing per sprite). */
export function vars(values: Record<string, string>): CSSProperties {
  return values as CSSProperties;
}

/**
 * Draws a pixel map as SVG: one string per row, one character per pixel, "." is transparent.
 * Runs of the same color merge into a single rect to keep the DOM small.
 */
export function Sprite({
  rows,
  palette,
  x = 0,
  y = 0,
  ...rest
}: { rows: readonly string[]; palette: Palette; x?: number; y?: number } & SVGProps<SVGGElement>) {
  const rects: ReactElement[] = [];
  rows.forEach((row, ry) => {
    let start = 0;
    for (let i = 1; i <= row.length; i += 1) {
      if (i < row.length && row[i] === row[start]) continue;
      const fill = palette[row[start]];
      if (fill) {
        rects.push(<rect key={`${ry}:${start}`} x={x + start} y={y + ry} width={i - start} height={1} fill={fill} />);
      }
      start = i;
    }
  });
  return <g {...rest}>{rects}</g>;
}
