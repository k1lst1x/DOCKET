import type { LngLat } from "./types";

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export function haversineKm([lng1, lat1]: LngLat, [lng2, lat2]: LngLat): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/** Ray casting on the outer ring. */
export function pointInPolygon([x, y]: LngLat, ring: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Shortest distance from a point to a polygon edge, 0 when inside. Uses a local
 * equirectangular projection, which is accurate to meters at neighborhood scale.
 */
export function distanceToPolygonKm(point: LngLat, ring: LngLat[]): number {
  if (pointInPolygon(point, ring)) return 0;
  const kx = 111.32 * Math.cos(toRad(point[1]));
  const ky = 110.574;
  let min = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = (ring[j][0] - point[0]) * kx;
    const ay = (ring[j][1] - point[1]) * ky;
    const bx = (ring[i][0] - point[0]) * kx;
    const by = (ring[i][1] - point[1]) * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lenSq));
    min = Math.min(min, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return min;
}
