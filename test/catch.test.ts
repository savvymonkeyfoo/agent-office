import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { INITIAL_ROWS, officeLayout } from '../src/client/layout.ts';
import { FishingGear } from '../src/client/break-room.ts';
import { PondFish, fishAt } from '../src/client/water.ts';
import { CAST_SECONDS, T, castAt, type Cast } from '../src/client/fishing.ts';

const PLACE = officeLayout(INITIAL_ROWS).hangouts.find((s) => s.name === 'fishing')!.places[0];
const CATCH: Cast = { landing: { x: -6.0, z: 10.7 }, fish: 1 };
const START = 40;
const at = (t: number) => castAt(CATCH, t, PLACE, START);
const times = (from: number, to: number, step = 0.01) => Array.from({ length: Math.round((to - from) / step) }, (_, i) => from + i * step);
const near = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/** The hooked fish as drawn, `t` seconds into the catch: its nose direction in the world, and its heading's right-hand side. */
function drawn(t: number) {
  const pond = new PondFish(new THREE.Scene());
  const frame = at(t);
  pond.update(START + t, frame.fish);
  const fish = pond.fish[1];
  fish.updateMatrixWorld(true);
  const nose = new THREE.Vector3(0, 0, 1).transformDirection(fish.matrixWorld);
  const h = frame.fish!.heading;
  return { nose, side: nose.dot(new THREE.Vector3(Math.cos(h), 0, -Math.sin(h))), frame, fish };
}

/** When the fish first comes up above the water, and when it first goes back under. */
const out = times(T.lift, CAST_SECONDS).find((t) => at(t).fish!.at.y > 0)!;
const backIn = times(T.drop, CAST_SECONDS).find((t) => at(t).fish!.at.y <= 0)!;

describe('#109 AC1 a splash as the fish leaves the water', () => {
  it('#109 AC1 no splash before the bite; a ring where the fish comes out as it leaves', () => {
    for (const t of times(0, T.lift - 0.05, 0.1)) expect(at(t).splash, `t=${t.toFixed(2)}`).toBeNull();
    expect(out).toBeDefined();
    const s = at(out).splash!;
    expect(s).not.toBeNull();
    expect(near(s, at(out).fish!.at)).toBeLessThan(0.05);
    expect(at(out + 0.3).splash!.radius, 'it spreads').toBeGreaterThan(s.radius);
  });

  it('#109 AC1 the gear draws the splash ring', () => {
    const gear = new FishingGear(new THREE.Scene());
    gear.start(CATCH, PLACE, START);
    for (let t = 0; t < out + 0.05; t += 0.05) gear.update(0.05);
    expect(gear.splash.visible).toBe(true);
    expect(near({ x: gear.splash.position.x, z: gear.splash.position.z }, CATCH.landing)).toBeLessThan(0.1);
  });

  it('#109 AC1 a plain cast never splashes', () => {
    for (const t of times(0, CAST_SECONDS, 0.1)) expect(castAt({ landing: CATCH.landing, fish: null }, t, PLACE).splash).toBeNull();
  });
});

describe('#109 AC2 nose-up on the line, wriggling', () => {
  it('#109 AC2 while lifted the drawn fish is within 25° of vertical, nose up', () => {
    for (const t of times(T.lifted, T.drop, 0.02)) {
      const { nose } = drawn(t);
      expect(THREE.MathUtils.radToDeg(nose.angleTo(new THREE.Vector3(0, 1, 0))), `t=${t.toFixed(2)}`).toBeLessThan(25);
    }
  });

  it('#109 AC2 it swings side to side at least twice a second', () => {
    const sides = times(T.lifted, T.lifted + 1, 0.01).map((t) => drawn(t).side);
    expect(Math.max(...sides)).toBeGreaterThan(0.1);
    expect(Math.min(...sides)).toBeLessThan(-0.1);
    const flips = sides.slice(1).filter((s, i) => Math.sign(s) !== Math.sign(sides[i]) && s !== 0).length;
    expect(flips, 'a swing back and forth is two flips').toBeGreaterThanOrEqual(4);
  });

  it('#109 AC2 the line still ends at the fish', () => {
    for (const t of times(T.lift, T.drop, 0.05)) expect(near(at(t).lineEnd, at(t).fish!.at)).toBeLessThan(1e-9);
  });
});

describe('#109 AC3 it drops back in with a splash and swims off', () => {
  it('#109 AC3 from release it falls faster and faster, never rising, until it is in the water', () => {
    expect(backIn).toBeDefined();
    const ys = times(T.drop, backIn).map((t) => at(t).fish!.at.y);
    const falls = ys.slice(1).map((y, i) => ys[i] - y);
    for (const f of falls) expect(f).toBeGreaterThanOrEqual(0);
    falls.slice(1).forEach((f, i) => expect(f, `step ${i}`).toBeGreaterThan(falls[i] - 1e-9));
    expect(falls.at(-1)!).toBeGreaterThan(falls[0] + 0.01);
  });

  it('#109 AC3 it lands in the pond with a splash ring where it goes in', () => {
    const entry = at(backIn).fish!.at;
    expect(((entry.x - -6.6) / 2) ** 2 + ((entry.z - 11) / 1.3) ** 2).toBeLessThan(0.85);
    const s = at(backIn + 0.05).splash!;
    expect(s).not.toBeNull();
    expect(near(s, entry)).toBeLessThan(0.1);
    expect(at(T.drop + 0.02).splash, 'the first splash has gone by the time it drops').toBeNull();
  });

  it('#109 AC3 then it stays under and swims back onto its usual loop', () => {
    for (const t of times(backIn, CAST_SECONDS)) expect(at(t).fish!.at.y, `t=${t.toFixed(2)}`).toBeLessThanOrEqual(0);
    const t = CAST_SECONDS - 0.05;
    const f = at(t).fish!, natural = fishAt(1, START + t);
    expect(near(f.at, natural)).toBeLessThan(1e-6);
    expect(f.heading).toBeCloseTo(natural.heading, 6);
    const { nose } = drawn(t);
    expect(Math.abs(nose.y), 'level again').toBeLessThan(1e-6);
  });
});
