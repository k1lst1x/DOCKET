import { BIRDS, FlyingBird, type BirdColors } from "@/components/pixel/blocks";
import styles from "@/components/pixel/pixel.module.css";

// Birds crossing the whole hero, edge to edge, over the headline and the scene.
// Positions are percentages of the hero, so the routes stretch with it; the hero clips
// sideways, so birds fly out of view instead of stopping at a box.

const FLIGHTS: { route: string; dur: string; delay: string; flip?: boolean; birds: { colors: BirdColors; dx: number; dy: number }[] }[] = [
  {
    route: styles.routeHigh,
    dur: "26s",
    delay: "-2s",
    birds: [
      { colors: BIRDS.dove, dx: 0, dy: 0 },
      { colors: BIRDS.sparrow, dx: -1.6, dy: 0.9 },
      { colors: BIRDS.dove, dx: -1.8, dy: -0.8 },
    ],
  },
  {
    route: styles.routeMid,
    dur: "21s",
    delay: "-13s",
    flip: true,
    birds: [{ colors: BIRDS.cardinal, dx: 0, dy: 0 }],
  },
  {
    route: styles.routeLow,
    dur: "33s",
    delay: "-22s",
    birds: [
      { colors: BIRDS.goldfinch, dx: 0, dy: 0 },
      { colors: BIRDS.bluejay, dx: -1.5, dy: 0.6 },
    ],
  },
];

export function HeroFlock() {
  return (
    <div aria-hidden="true" className={`pointer-events-none absolute inset-0 z-30 ${styles.flock}`}>
      {FLIGHTS.map((flight) => (
        <div key={flight.route} className={`${styles.flight} ${flight.route}`} style={{ animationDuration: flight.dur, animationDelay: flight.delay }}>
          {flight.birds.map((bird, i) => (
            <div
              key={i}
              className={styles.glide}
              style={{ left: `calc(var(--bird) * ${bird.dx})`, top: `calc(var(--bird) * ${bird.dy})`, animationDelay: `${i * -0.5}s` }}
            >
              <svg viewBox="0 0 8 7" shapeRendering="crispEdges" className="block h-full w-full overflow-visible">
                <FlyingBird colors={bird.colors} flip={flight.flip} />
              </svg>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
