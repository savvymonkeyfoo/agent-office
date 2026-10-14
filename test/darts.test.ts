import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { INITIAL_ROWS, officeLayout } from '../src/client/layout.ts';
import { Character, dartModel } from '../src/client/character.ts';
import { lookFor } from '../src/client/look.ts';
import { BoardDarts } from '../src/client/break-room.ts';
import { BOARD, COLLECT_FROM, DART, FLIGHT, QUIVER, RELEASE_AT, ROUND, THROWS, THROW_EVERY, dartFlight, dartsAt } from '../src/client/darts.ts';

const START = officeLayout(INITIAL_ROWS);
const PLACE = START.hangouts.find((s) => s.name === 'darts')!.places[0];
const board = new THREE.Vector3(BOARD.x, BOARD.y, BOARD.z);

const parts = (root: THREE.Object3D, part: string) => {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => { if (o.userData.part === part) out.push(o); });
  return out;
};
const shown = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false; return true; };
const world = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());

/** A thrower at the line, `t` seconds after arriving. */
function thrower(t: number) {
  const character = new Character(lookFor('session-1'));
  character.placeAt(START.seats[0], 'done', PLACE);
  const step = 0.02;
  for (let s = 0; s < t - 1e-9; s += step) character.update(s, Math.min(step, t - s));
  character.root.updateMatrixWorld(true);
  return character;
}

/** The dart in the thrower's hand, if one is shown: its tip, tail and direction. */
function heldDart(character: Character) {
  const [point] = parts(character.root, 'dart-point').filter(shown);
  if (!point) return null;
  const dart = point.parent!;
  const tip = world(point), tail = world(parts(dart, 'dart-flights')[0]);
  return { dart, tip, tail, dir: tip.clone().sub(tail).normalize() };
}

describe('#54 AC1 a recognisable dart in hand, pointing at the board', () => {
  it('#54 AC1 before each throw the hand holds a dart with a point, barrel and flights, aimed at the board', () => {
    for (let i = 0; i < THROWS; i++) {
      for (const u of [0.2, 0.7, RELEASE_AT - 0.35]) {
        const held = heldDart(thrower(i * THROW_EVERY + u));
        expect(held, `throw ${i + 1} at ${u}`).not.toBeNull();
        for (const part of ['dart-point', 'dart-barrel', 'dart-flights']) expect(parts(held!.dart, part).length, part).toBeGreaterThan(0);
        const toBoard = board.clone().sub(held!.tip).normalize();
        expect(held!.dir.dot(toBoard), `throw ${i + 1} at ${u}`).toBeGreaterThan(0.95);
      }
    }
  });
});

describe('#54 AC2 the dart flies to the board, point first', () => {
  it('#54 AC2 (#107 AC4) on release the dart leaves the hand and ends with its tip on the board face', () => {
    for (let i = 0; i < THROWS; i++) {
      const before = heldDart(thrower(i * THROW_EVERY + RELEASE_AT - 0.001))!;
      const start = dartFlight(PLACE, i, 0);
      expect(new THREE.Vector3(start.origin.x, start.origin.y, start.origin.z).distanceTo(world(before.dart)), 'leaves from the hand').toBeLessThan(0.08);
      expect(heldDart(thrower(i * THROW_EVERY + RELEASE_AT + 0.05)), 'the hand is empty once it\'s thrown').toBeNull();
      const end = dartFlight(PLACE, i, 1);
      const tip = { x: end.origin.x + end.dir.x * DART.tip };
      expect(tip.x).toBeCloseTo(BOARD.x, 3);
    }
  });

  it('#54 AC2 in the air the dart points the way it is moving', () => {
    for (let i = 0; i < THROWS; i++) {
      for (let k = 0.05; k < 1; k += 0.05) {
        const a = dartFlight(PLACE, i, k - 0.02).origin, b = dartFlight(PLACE, i, k + 0.02).origin;
        const v = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
        const { dir } = dartFlight(PLACE, i, k);
        expect(v.dot(new THREE.Vector3(dir.x, dir.y, dir.z)), `throw ${i + 1}, k ${k.toFixed(2)}`).toBeGreaterThan(0.98);
      }
    }
  });

  it('#54 AC2 the board shows the dart in flight where the script says', () => {
    const darts = new BoardDarts(new THREE.Scene());
    const t = 1 * THROW_EVERY + RELEASE_AT + FLIGHT / 2;
    darts.update({ place: PLACE, t });
    const flying = darts.darts.filter((d) => d.visible && Math.abs(d.position.x - BOARD.x) > 0.3);
    expect(flying).toHaveLength(1);
    const want = dartFlight(PLACE, 1, 0.5).origin;
    expect(flying[0].position.distanceTo(new THREE.Vector3(want.x, want.y, want.z))).toBeLessThan(1e-6);
  });
});

describe('#54 AC3 thrown darts stick in the board', () => {
  it('#54 AC3 a landed dart stays in the board face, inside its circle, until collected', () => {
    const darts = new BoardDarts(new THREE.Scene());
    for (let t = 0; t < ROUND; t += 0.05) {
      darts.update({ place: PLACE, t });
      darts.darts[0].updateMatrixWorld(true);
      const { stuck, flying } = dartsAt(t);
      expect(darts.darts.filter((d) => d.visible).length).toBe(stuck + (flying ? 1 : 0));
      for (const d of darts.darts.slice(0, stuck)) {
        const tip = world(parts(d, 'dart-point')[0]);
        expect(Math.abs(tip.x - BOARD.x), 'in the face').toBeLessThan(0.03);
        expect(Math.hypot(tip.y - BOARD.y, tip.z - BOARD.z), 'inside the circle').toBeLessThan(BOARD.r - 0.02);
      }
    }
  });
});

describe('#54 AC4 a new dart each throw; three per round, then collected', () => {
  it('#54 AC4 the board fills 0, 1, 2, 3, then is empty before the next round\'s first throw lands', () => {
    const seen: number[] = [];
    for (let t = 0; t < 2 * ROUND; t += 0.02) {
      const n = dartsAt(t).stuck;
      if (seen.at(-1) !== n) seen.push(n);
    }
    expect(seen).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0]);
  });

  it('#54 AC4 after each release a new dart is in hand for the next throw', () => {
    for (let i = 0; i + 1 < THROWS; i++) expect(heldDart(thrower((i + 1) * THROW_EVERY + 0.1)), `before throw ${i + 2}`).not.toBeNull();
    expect(heldDart(thrower(ROUND + 0.1)), 'first throw of the next round').not.toBeNull();
  });

  it('#54 AC4 to collect, the thrower walks up to the board and back to the line', () => {
    let closest = Infinity;
    const character = thrower(THROWS * THROW_EVERY);
    for (let t = THROWS * THROW_EVERY; t < ROUND; t += 0.02) {
      character.update(t, 0.02);
      closest = Math.min(closest, Math.abs(character.root.position.x - BOARD.x));
    }
    expect(closest).toBeLessThan(COLLECT_FROM + 0.1);
    character.update(ROUND + 0.1, 0.1);
    expect(character.root.position.x).toBeCloseTo(PLACE.x, 1);
  });
});

describe('#54 AC5 leaving clears the board', () => {
  it('#54 AC5 with no thrower, no darts are shown', () => {
    const darts = new BoardDarts(new THREE.Scene());
    darts.update({ place: PLACE, t: 2 * THROW_EVERY + 0.1 });
    expect(darts.darts.filter((d) => d.visible).length).toBe(2);
    darts.update(null);
    expect(darts.darts.filter((d) => d.visible)).toEqual([]);
  });

  it('#54 AC5 a thrower walking away is no longer at the darts', () => {
    const character = thrower(2 * THROW_EVERY);
    expect(character.dartsThrower()).not.toBeNull();
    character.go([{ x: PLACE.x, z: PLACE.z }, { x: -5.8, z: PLACE.z }], null);
    expect(character.dartsThrower()).toBeNull();
  });
});

/** The toon head's ball, with room for a hat's dome over it, and the hand's ball (#87). */
const HEAD_R = 0.42, HAND_R = 0.12;
const headCentre = (character: Character) => world(character.head);
const throwingHand = (character: Character) => world(character.hands[1]);

describe('#87 a visible, bigger dart and a hand clear of the head', () => {
  it('#87 AC1 the dart is at least 0.35 m long', () => {
    const box = new THREE.Box3().setFromObject(dartModel());
    expect(box.max.z - box.min.z).toBeGreaterThanOrEqual(0.35);
  });

  it('#87 AC2 throughout a throw (aim, draw back, release, follow-through) the throwing hand never overlaps the head', () => {
    for (let t = 0; t < THROWS * THROW_EVERY; t += 0.05) {
      const character = thrower(t);
      expect(throwingHand(character).distanceTo(headCentre(character)), `at ${t.toFixed(2)} s`).toBeGreaterThan(HEAD_R + HAND_R);
    }
  });

  it('#87 AC3 while aiming, the held dart\'s tip and flights stick out of the hand and neither is inside the head', () => {
    for (const u of [0.2, 0.7, RELEASE_AT - 0.35]) {
      const character = thrower(u);
      const held = heldDart(character)!;
      const hand = throwingHand(character), head = headCentre(character);
      for (const [name, p] of [['tip', held.tip], ['flights', held.tail]] as const) {
        expect(p.distanceTo(hand), `${name} out of the hand at ${u}`).toBeGreaterThan(HAND_R + 0.02);
        expect(p.distanceTo(head), `${name} clear of the head at ${u}`).toBeGreaterThan(HEAD_R);
      }
    }
  });

  it('#87 AC4 darts in the board stick in with their tip at the face', () => {
    const darts = new BoardDarts(new THREE.Scene());
    darts.update({ place: PLACE, t: THROWS * THROW_EVERY });
    for (const d of darts.darts) {
      d.updateMatrixWorld(true);
      const point = new THREE.Box3().setFromObject(parts(d, 'dart-point')[0]);
      expect(Math.abs(point.min.x - BOARD.x), 'the very tip is at the face').toBeLessThan(0.01);
    }
  });
});

describe('#107 a fast, flat throw that sticks with a wobble', () => {
  const v = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.y, p.z);
  /** The pointing direction of throw `i`'s dart as the board shows it at `t`. */
  const shownDir = (i: number, t: number) => {
    const darts = new BoardDarts(new THREE.Scene());
    darts.update({ place: PLACE, t });
    const d = darts.darts[i];
    d.updateMatrixWorld(true);
    return world(parts(d, 'dart-point')[0]).sub(world(parts(d, 'dart-flights')[0])).normalize();
  };
  const hitAt = (i: number) => i * THROW_EVERY + RELEASE_AT + FLIGHT;

  it('#107 AC1 each dart reaches the board 0.12–0.2 s after release', () => {
    expect(FLIGHT).toBeGreaterThanOrEqual(0.12);
    expect(FLIGHT).toBeLessThanOrEqual(0.2);
    for (let i = 0; i < THROWS; i++) {
      expect(dartsAt(hitAt(i) - 0.005).stuck, `throw ${i + 1} still flying`).toBe(i);
      expect(dartsAt(hitAt(i) + 0.005).stuck, `throw ${i + 1} stuck`).toBe(i + 1);
    }
  });

  it('#107 AC2 the dart\'s origin never rises more than 3 cm above the straight line from hand to board', () => {
    for (let i = 0; i < THROWS; i++) {
      const a = v(dartFlight(PLACE, i, 0).origin), b = v(dartFlight(PLACE, i, 1).origin);
      for (let k = 0; k <= 1; k += 0.02) {
        const p = v(dartFlight(PLACE, i, k).origin);
        const s = p.clone().sub(a).dot(b.clone().sub(a)) / b.distanceToSquared(a);
        const onLine = a.clone().lerp(b, s);
        expect(p.y - onLine.y, `throw ${i + 1}, k ${k.toFixed(2)}`).toBeLessThanOrEqual(0.03);
      }
    }
  });

  it('#107 AC3 in its first 0.3 s in the board the dart quivers 0.5°–5° off its stuck direction, then rests', () => {
    expect(QUIVER).toBeLessThanOrEqual(0.3);
    for (let i = 0; i < THROWS; i++) {
      const rest = shownDir(i, hitAt(i) + 1);
      let most = 0;
      for (let s = 0.005; s < 0.3; s += 0.005) most = Math.max(most, THREE.MathUtils.radToDeg(shownDir(i, hitAt(i) + s).angleTo(rest)));
      expect(most, `throw ${i + 1} quivers`).toBeGreaterThan(0.5);
      expect(most, `throw ${i + 1} only a little`).toBeLessThanOrEqual(5);
      for (const s of [0.3, 0.35, 0.6]) expect(shownDir(i, hitAt(i) + s).angleTo(rest), `throw ${i + 1} at rest ${s} s in`).toBeLessThan(1e-6);
    }
  });
});
