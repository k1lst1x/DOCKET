import { BIRDS, PerchedBird } from "@/components/pixel/blocks";
import { vars } from "@/components/pixel/Sprite";
import styles from "@/components/pixel/pixel.module.css";

// The same neighborhood after dark: lit windows, fireflies, and a bird asleep in the tree.
// Wide viewBox sliced to the container, like the hero.

const STARS = [
  [14, 8], [38, 18], [62, 6], [90, 22], [118, 10], [146, 4], [172, 16], [206, 6],
  [252, 20], [276, 8], [300, 16], [128, 28], [84, 34], [236, 32], [20, 30], [310, 30],
];

const FIREFLIES = [
  [96, 52], [140, 46], [176, 56], [214, 50], [232, 58], [262, 48], [70, 56], [120, 58],
];

const HOUSES = [
  { x: 24, w: 30, lit: [true, false] },
  { x: 102, w: 32, lit: [true, true] },
  { x: 232, w: 30, lit: [false, true] },
  { x: 280, w: 28, lit: [true, true] },
];

export function NightScene({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 80" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false" className={`${styles.scene} ${className}`}>
      {STARS.map(([x, y], i) => (
        <rect key={`${x}:${y}`} x={x} y={y} width={1} height={1} fill="#F7F1E3" className={styles.twinkle} style={vars({ "--dur": `${2.4 + (i % 5) * 0.7}s`, "--delay": `${(i % 7) * -0.6}s` })} />
      ))}

      {/* Square moon */}
      <rect x={220} y={6} width={12} height={12} fill="#F7F1E3" />
      <rect x={223} y={9} width={3} height={3} fill="#DCE3E8" />
      <rect x={228} y={13} width={2} height={2} fill="#DCE3E8" />

      {HOUSES.map((house) => (
        <g key={house.x} transform={`translate(${house.x} 0)`}>
          <rect x={0} y={48} width={house.w} height={16} fill="#2E2520" />
          <rect x={-2} y={44} width={house.w + 4} height={4} fill="#1C1512" />
          <rect x={4} y={40} width={house.w - 8} height={4} fill="#1C1512" />
          {house.lit.map((on, i) => (
            <g key={i}>
              {on ? <rect x={3 + i * 14} y={49} width={10} height={10} fill="#F2C94C" className={styles.glow} style={vars({ "--delay": `${i * -1.3}s` })} /> : null}
              <rect x={5 + i * 14} y={51} width={6} height={6} fill={on ? "#F2C94C" : "#3B332C"} />
              <rect x={7 + i * 14} y={51} width={1} height={6} fill="#2E2520" />
            </g>
          ))}
        </g>
      ))}

      {/* Street lamp */}
      <rect x={160} y={42} width={1} height={22} fill="#3B3B3B" />
      <rect x={158} y={40} width={5} height={3} fill="#F2C94C" />
      <rect x={154} y={38} width={13} height={9} fill="#F2C94C" className={styles.glow} opacity={0.3} />

      {/* Sleeping tree */}
      <rect x={196} y={44} width={4} height={20} fill="#2A1C12" />
      <rect x={188} y={24} width={20} height={4} fill="#1D3A1F" />
      <rect x={184} y={28} width={28} height={8} fill="#1D3A1F" />
      <rect x={188} y={36} width={20} height={8} fill="#1D3A1F" />
      <rect x={190} y={26} width={3} height={2} fill="#2F5A2F" />
      <rect x={200} y={30} width={4} height={2} fill="#2F5A2F" />
      <g transform="translate(194 17)">
        <PerchedBird colors={BIRDS.bluejay} asleep />
      </g>
      {[0, 1.2, 2.4].map((delay) => (
        <g key={delay} transform="translate(203 13)">
          <g className={styles.snore} style={vars({ "--delay": `${delay}s` })} fill="#DDEBF6">
            <rect x={0} y={0} width={3} height={1} />
            <rect x={1} y={1} width={1} height={1} />
            <rect x={0} y={2} width={3} height={1} />
          </g>
        </g>
      ))}

      {FIREFLIES.map(([x, y], i) => (
        <rect key={`${x}:${y}`} x={x} y={y} width={1} height={1} fill="#EFF58A" className={styles.firefly} style={vars({ "--dur": `${5 + (i % 4)}s`, "--delay": `${i * -0.9}s` })} />
      ))}

      {/* Ground */}
      <rect x={0} y={64} width={320} height={4} fill="#24461F" />
      <rect x={0} y={68} width={320} height={12} fill="#2B1D14" />
      {[12, 58, 144, 250, 300].map((x) => (
        <rect key={x} x={x} y={70 + (x % 3) * 2} width={2} height={1} fill="#3A281B" />
      ))}
    </svg>
  );
}
