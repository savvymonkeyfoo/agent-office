// Pool dip (#57): a floating ring and its rider drift around the ring's home spot, slowly turning
// and bobbing. The motion is a function of seconds afloat and a few numbers the controller draws
// from its (injectable) random, so the same seed gives the same motion.

/** How far a ring may drift from home: a little across the pool, more along it (the rings sit side by side across). */
export const DRIFT = { x: 0.12, z: 0.6 };
/** Seconds to paddle back home before climbing out. */
export const RETURN_SECONDS = 1.5;
/** Seconds over which the drift builds up after climbing in. */
const SETTLE = 3;

export interface Drift { ax: number; az: number; wx: number; wz: number; px: number; pz: number; spin: number; bob: number }
export interface Afloat { x: number; z: number; spin: number; bob: number }

export function driftParams(random: () => number): Drift {
  const between = (min: number, max: number) => min + random() * (max - min);
  return {
    ax: between(0.5, 1) * DRIFT.x, az: between(0.5, 1) * DRIFT.z,
    wx: between(0.15, 0.3), wz: between(0.12, 0.25),
    px: between(0, Math.PI * 2), pz: between(0, Math.PI * 2),
    spin: between(0.15, 0.4) * (random() < 0.5 ? -1 : 1),
    bob: between(0, Math.PI * 2),
  };
}

/** Where a ring is (from its home), how far it has turned and how high it bobs, `t` seconds afloat. */
export function driftAt(d: Drift, t: number): Afloat {
  const k = Math.min(1, Math.max(0, t) / SETTLE), settle = k * k * (3 - 2 * k);
  return {
    x: settle * d.ax * Math.sin(d.wx * t + d.px),
    z: settle * d.az * Math.sin(d.wz * t + d.pz),
    spin: d.spin * t,
    bob: settle * Math.sin(1.5 * t + d.bob) * 0.03,
  };
}

/** A ring someone is climbing into: back at home, square and level (#110). */
export const CLIMBING_IN: Afloat = { x: 0, z: 0, spin: 0, bob: 0 };

/** An empty ring's own lazy drift (#110), the same every time for the same ring, each turned its own way. */
export function emptyDriftAt(ring: number, t: number): Afloat {
  let seed = (ring + 1) * 104729;
  const d = driftParams(() => (seed = (seed * 16807) % 2147483647) / 2147483647);
  return { ...driftAt(d, t + SETTLE), spin: 0.2 * t + ring * 2.4 };
}
