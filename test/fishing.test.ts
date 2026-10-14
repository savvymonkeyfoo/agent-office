import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BREAK_ROOM, INITIAL_ROWS, officeLayout } from '../src/client/layout.ts';
import { Character } from '../src/client/character.ts';
import { lookFor } from '../src/client/look.ts';
import { FishingGear } from '../src/client/break-room.ts';
import { PondFish, fishAt } from '../src/client/water.ts';
import { CAST_SECONDS, T, castAt, rodPitch, type Cast } from '../src/client/fishing.ts';
import { ofType, office } from './office-sim.ts';

const START = officeLayout(INITIAL_ROWS);
const PLACE = START.hangouts.find((s) => s.name === 'fishing')!.places[0];
const { pond, jetty } = BREAK_ROOM;
const JETTY_END = jetty.x - jetty.w / 2;
const inPond = (p: { x: number; z: number }, margin = 1) => ((p.x - pond.x) / pond.rx) ** 2 + ((p.z - pond.z) / pond.rz) ** 2 < margin;
const PLAIN: Cast = { landing: { x: -6.3, z: 11.3 }, fish: null };
const CATCH: Cast = { landing: { x: -6.0, z: 10.7 }, fish: 1 };
const v = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.y, p.z);

/** An angler at the jetty, `t` seconds into `cast`; the rod's tip and the hands, in the world. */
function angler(cast: Cast, t: number) {
  const character = new Character(lookFor('session-1'));
  character.placeAt(START.seats[0], 'done', PLACE);
  character.fish(cast);
  for (let s = 0; s < t - 1e-9; s += 0.05) character.update(s, Math.min(0.05, t - s));
  character.root.updateMatrixWorld(true);
  let rod: THREE.Mesh | undefined;
  character.root.traverse((o) => { if (o.userData.part === 'rod') rod = o as THREE.Mesh; });
  const h = (rod!.geometry as THREE.CylinderGeometry).parameters.height;
  const tip = new THREE.Vector3(0, h / 2, 0).applyMatrix4(rod!.matrixWorld);
  const hands = character.hands.map((m) => m.getWorldPosition(new THREE.Vector3()));
  return { character, tip, hands };
}

describe('#58 AC1 the rod reaches out over the pond', () => {
  it('#58 AC1 while waiting, the rod tip is beyond the jetty\'s end, inside the pond, and above the hands', () => {
    for (const t of [2, 3.5, 5]) {
      const { tip, hands } = angler(PLAIN, t);
      expect(tip.x, `t=${t}`).toBeLessThan(JETTY_END);
      expect(inPond(tip), `t=${t}`).toBe(true);
      for (const hand of hands) expect(tip.y).toBeGreaterThan(hand.y);
      expect(tip.distanceTo(v(castAt(PLAIN, t, PLACE).tip)), 'the script and the rod agree').toBeLessThan(0.02);
    }
  });
});

describe('#58 AC2 a line from the rod tip to the float, or the fish', () => {
  it('#58 AC2 at every moment of a cast the line runs from the tip to the float, or to the hooked fish', () => {
    for (const cast of [PLAIN, CATCH]) {
      const gear = new FishingGear(new THREE.Scene());
      gear.start(cast, PLACE, 0);
      for (let t = 0; t < CAST_SECONDS; t += 0.05) {
        gear.update(0.05);
        const frame = castAt(cast, t + 0.05, PLACE);
        const [a, b] = gear.lineEnds();
        expect(a.distanceTo(v(frame.tip)), `t=${t.toFixed(2)}`).toBeLessThan(1e-6);
        const end = frame.float ?? frame.fish!.at;
        expect(b.distanceTo(v(end)), `t=${t.toFixed(2)}`).toBeLessThan(1e-6);
        expect(gear.line.visible).toBe(true);
        if (frame.float) expect(gear.float.position.distanceTo(v(frame.float))).toBeLessThan(1e-6);
        else expect(frame.fish, 'hooked').not.toBeNull();
      }
    }
  });
});

describe('#58 AC3 the cast', () => {
  it('#58 AC3 the rod swings back, then forward', () => {
    const pitches = Array.from({ length: 50 }, (_, i) => rodPitch(PLAIN, (i / 50) * T.forward));
    const top = pitches.indexOf(Math.max(...pitches));
    expect(pitches[top]).toBeGreaterThan(Math.PI / 2); // back over the shoulder
    expect(top).toBeGreaterThan(5);
    expect(rodPitch(PLAIN, T.forward)).toBeLessThan(pitches[top] - 1);
  });

  it('#58 AC3 the float flies in an arc from the rod tip to the landing point in the pond', () => {
    const start = castAt(PLAIN, T.release, PLACE), end = castAt(PLAIN, T.landed - 1e-6, PLACE);
    expect(v(start.float!).distanceTo(v(start.tip))).toBeLessThan(0.6);
    expect(Math.hypot(end.float!.x - PLAIN.landing.x, end.float!.z - PLAIN.landing.z)).toBeLessThan(0.01);
    const mid = castAt(PLAIN, (T.release + T.landed) / 2, PLACE).float!;
    expect(mid.y).toBeGreaterThan((start.float!.y + end.float!.y) / 2 + 0.1);
    expect(inPond(PLAIN.landing)).toBe(true);
  });
});

describe('#58 AC4 a ripple where it lands', () => {
  it('#58 AC4 a ring appears at the landing point, grows and fades out within about 1.5 s', () => {
    expect(castAt(PLAIN, T.landed - 0.01, PLACE).ripple).toBeNull();
    const frames = Array.from({ length: 30 }, (_, i) => castAt(PLAIN, T.landed + i * 0.05, PLACE).ripple);
    expect(frames[0]).not.toBeNull();
    for (const r of frames.filter((f) => f)) expect(Math.hypot(r!.x - PLAIN.landing.x, r!.z - PLAIN.landing.z)).toBeLessThan(1e-9);
    const live = frames.filter((f) => f) as NonNullable<(typeof frames)[number]>[];
    live.forEach((r, i) => { if (i) { expect(r.radius).toBeGreaterThan(live[i - 1].radius); expect(r.opacity).toBeLessThan(live[i - 1].opacity); } });
    expect(castAt(PLAIN, T.landed + 1.7, PLACE).ripple).toBeNull();
  });
});

describe('#58 AC5 the float bobs where it landed', () => {
  it('#58 AC5 while waiting the float stays at the landing point, bobbing on the surface', () => {
    const ys: number[] = [];
    for (let t = T.landed + 0.1; t < T.reel; t += 0.05) {
      const f = castAt(PLAIN, t, PLACE).float!;
      expect(Math.hypot(f.x - PLAIN.landing.x, f.z - PLAIN.landing.z)).toBeLessThan(1e-9);
      expect(Math.abs(f.y - 0.03)).toBeLessThan(0.03);
      ys.push(f.y);
    }
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.01);
  });
});

describe('#58 AC6 sometimes, a catch', () => {
  it('#58 AC6 the fish shows "!!", swims to the float, bites; the rod lifts it out over the jetty; it goes back before the next cast', () => {
    const at = (t: number) => castAt(CATCH, t, PLACE, 40);
    expect(at(T.alert - 0.1).fish, 'not yet').toBeNull();
    expect(at(T.alert).fish!.alert).toBe(true);
    expect(v(at(T.alert).fish!.at).distanceTo(v({ ...fishAt(1, 40 + T.alert) })), 'it starts from where it was swimming').toBeLessThan(1e-6);
    const atFloat = at(T.reached + 0.1);
    expect(Math.hypot(atFloat.fish!.at.x - CATCH.landing.x, atFloat.fish!.at.z - CATCH.landing.z)).toBeLessThan(0.05);
    expect(atFloat.fish!.alert).toBe(false);
    expect(atFloat.float!.y, 'the float dips').toBeLessThan(0.0);
    expect(rodPitch(CATCH, T.lifted + 0.2)).toBeGreaterThan(rodPitch(CATCH, T.lift - 0.1) + 0.8);
    const hung = at((T.lifted + T.drop) / 2);
    expect(hung.fish!.at.x).toBeGreaterThan(JETTY_END);
    expect(hung.fish!.at.x).toBeLessThan(jetty.x + jetty.w / 2);
    expect(hung.fish!.at.y).toBeGreaterThan(0.6);
    expect(v(hung.lineEnd).distanceTo(v(hung.fish!.at))).toBeLessThan(1e-9);
    const back = at(CAST_SECONDS - 0.05);
    expect(inPond(back.fish!.at, 0.85)).toBe(true);
    expect(back.fish!.at.y).toBeLessThan(0);
    expect(v(back.fish!.at).distanceTo(v(fishAt(1, 40 + CAST_SECONDS - 0.05)))).toBeLessThan(1e-6);
    for (let t = T.alert; t < CAST_SECONDS; t += 0.1) expect(at(t).fish!.index, 'the same fish').toBe(1);
  });

  it('#58 AC6 the pond\'s fish follow the catch', () => {
    const fish = new PondFish(new THREE.Scene());
    const frame = castAt(CATCH, 6.5, PLACE, 40);
    fish.update(46.5, frame.fish);
    expect(fish.fish[1].position.distanceTo(v(frame.fish!.at))).toBeLessThan(1e-9);
    const other = fishAt(0, 46.5);
    expect(fish.fish[0].position.distanceTo(v(other))).toBeLessThan(1e-9);
    expect(fish.alerts[1].visible).toBe(false);
    fish.update(43.1, castAt(CATCH, 3.1, PLACE, 40).fish);
    expect(fish.alerts[1].visible).toBe(true);
  });
});

describe('#58 AC7 the same seed and clock give the same fishing', () => {
  /** The casts in a fishing-heavy simulation. */
  function casts(seed: number) {
    const o = office(1, seed);
    o.set(1, 'done');
    o.run(3 * 60 * 60, 0.25);
    return ofType(o.log.map((l) => l.event), 'cast').map((c) => ({ ...c, t: o.log.find((l) => l.event === c)!.t }));
  }

  it('#58 AC7 casts, landing points and catches repeat exactly for a seed', () => {
    const a = casts(4), b = casts(4);
    expect(a.length).toBeGreaterThan(10);
    expect(a).toEqual(b);
    const catches = a.filter((c) => c.cast.fish != null).length;
    expect(catches).toBeGreaterThan(0);
    expect(catches).toBeLessThan(a.length);
    for (const c of a) expect(inPond(c.cast.landing, 0.7)).toBe(true);
  });

  it('#58 AC7 casts follow each other every CAST_SECONDS while the angler stays', () => {
    const a = casts(4);
    let steady = 0;
    a.forEach((c, i) => { if (i && c.key === a[i - 1].key && c.t - a[i - 1].t < CAST_SECONDS + 1) { expect(c.t - a[i - 1].t).toBeCloseTo(CAST_SECONDS, 0); steady++; } });
    expect(steady).toBeGreaterThan(3);
  });
});

describe('#84 the float flies like a thrown object', () => {
  const DT = 1e-3;
  const y = (t: number) => castAt(PLAIN, t, PLACE).float!.y;

  it('#84 AC1 at release the float moves vertically the same way as the rod tip', () => {
    const tipVy = (castAt(PLAIN, T.release, PLACE).tip.y - castAt(PLAIN, T.release - DT, PLACE).tip.y) / DT;
    const floatVy = (y(T.release + DT) - y(T.release)) / DT;
    expect(Math.abs(tipVy)).toBeGreaterThan(0.1);
    expect(Math.sign(floatVy)).toBe(Math.sign(tipVy));
    expect(floatVy).toBeCloseTo(tipVy, 0);
  });

  it('#84 AC2 from release to landing the downward acceleration is constant, with at most one high point', () => {
    const ts = Array.from({ length: 40 }, (_, i) => T.release + 0.02 + (i / 40) * (T.landed - T.release - 0.04));
    const accel = ts.map((t) => (y(t + 0.01) - 2 * y(t) + y(t - 0.01)) / 1e-4);
    for (const a of accel) {
      expect(a).toBeLessThan(-1);
      expect(a).toBeCloseTo(accel[0], 1);
    }
    const ys = ts.map(y);
    const highs = ys.slice(1, -1).filter((v, i) => v > ys[i] && v >= ys[i + 2]).length;
    expect(highs).toBeLessThanOrEqual(1);
  });

  it('#84 AC3 the float lands on the landing point at the landing time', () => {
    for (const cast of [PLAIN, CATCH]) {
      const f = castAt(cast, T.landed - 1e-6, PLACE).float!;
      expect(Math.hypot(f.x - cast.landing.x, f.z - cast.landing.z)).toBeLessThan(0.01);
      expect(Math.abs(f.y - 0.03)).toBeLessThan(0.01);
    }
  });

  it('#84 AC4 after landing the float never rises more than 2 cm above the water until reeled in', () => {
    for (const [cast, until] of [[PLAIN, T.reel], [CATCH, T.lift]] as const)
      for (let t = T.landed; t < until; t += 0.01) {
        const f = castAt(cast, t, PLACE).float!;
        expect(f.y, `t=${t.toFixed(2)}`).toBeLessThanOrEqual(0.03 + 0.02);
      }
  });
});
