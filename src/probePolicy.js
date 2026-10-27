import { CITY } from './plan.js';

// Intersections remain accessible and are outside all generated building footprints.
export function probeAnchor(x, z) {
  const snap = value => Math.max(-CITY.half, Math.min(CITY.half, Math.round(value / CITY.span) * CITY.span));
  return { x: snap(x), z: snap(z) };
}
export function probeKey(anchor) { return `${anchor.x},${anchor.z}`; }
