import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { INITIAL_ROWS, officeLayout } from '../src/client/layout.ts';
import { Character } from '../src/client/character.ts';
import { lookFor } from '../src/client/look.ts';
import { PaperPlanes } from '../src/client/paper-planes.ts';

const START = officeLayout(INITIAL_ROWS);
const PLACE = START.hangouts.find((s) => s.name === 'planes')!.places[0];
const DESK = START.seats[0].desk;
const FRAME = 1 / 60;

/** A thrower at the paper-plane place, settled in for a second. */
function thrower() {
  const character = new Character(lookFor('session-1'));
  character.placeAt(START.seats[0], 'done', PLACE);
  for (let t = 0; t < 1; t += FRAME) character.update(t, FRAME);
  return character;
}

/** The paper plane in the thrower's hand, if shown, in the world. */
function heldPlane(character: Character) {
  let plane: THREE.Object3D | null = null;
  character.hands[1].traverse((o) => { if (o.userData.part === 'paper-plane') plane = o; });
  const shown = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false; return true; };
  return plane && shown(plane) ? (plane as THREE.Object3D).getWorldPosition(new THREE.Vector3()) : null;
}

const handAt = (character: Character) => character.hands[1].getWorldPosition(new THREE.Vector3());

/** Steps the thrower frame by frame for `seconds`, recording the hand and the held plane. */
function run(character: Character, seconds: number) {
  const frames: { hand: THREE.Vector3; held: THREE.Vector3 | null }[] = [];
  for (let t = 1; t < 1 + seconds; t += FRAME) {
    character.update(t, FRAME);
    character.root.updateMatrixWorld(true);
    frames.push({ hand: handAt(character), held: heldPlane(character) });
  }
  return frames;
}

describe('#74 AC1 the throw is driven by the plane event', () => {
  it('#74 AC1 without a plane event the arm never throws and the plane stays in hand', () => {
    const character = thrower();
    const frames = run(character, 12);
    const hands = frames.map((f) => f.hand);
    for (const f of frames) expect(f.held, 'plane in hand').not.toBeNull();
    const spread = Math.max(...hands.map((h) => h.distanceTo(hands[0])));
    expect(spread, 'the arm stays put').toBeLessThan(0.05);
  });

  it('#74 AC1 a plane event throws the arm once and launches exactly one plane, at the release', () => {
    const character = thrower();
    const launches: THREE.Vector3[] = [];
    character.throwPlane((at) => { launches.push(at.clone()); });
    let releasedAt = -1;
    const hands: THREE.Vector3[] = [];
    for (let i = 0; i < 6 / FRAME; i++) {
      character.update(1 + i * FRAME, FRAME);
      character.root.updateMatrixWorld(true);
      hands.push(handAt(character));
      if (launches.length && releasedAt < 0) releasedAt = i;
    }
    expect(launches).toHaveLength(1);
    expect(releasedAt, 'the release is part-way through the throw, not at once').toBeGreaterThan(10);
    const rest = hands[0];
    const forward = new THREE.Vector3(Math.sin(PLACE.yaw), 0, Math.cos(PLACE.yaw));
    const reach = (h: THREE.Vector3) => h.clone().sub(rest).dot(forward);
    const windUp = Math.min(...hands.slice(0, releasedAt).map(reach));
    expect(windUp, 'the arm draws back before the release').toBeLessThan(-0.15);
    expect(reach(hands[releasedAt]), 'and is forward at the release').toBeGreaterThan(0.15);
    expect(hands.at(-1)!.distanceTo(rest), 'then comes back to rest').toBeLessThan(0.02);
    expect(heldPlane(character), 'with a new plane in hand').not.toBeNull();
  });

  it('#74 AC1 a thrower who walks off mid wind-up launches nothing', () => {
    const character = thrower();
    const launches: THREE.Vector3[] = [];
    character.throwPlane((at) => { launches.push(at); });
    character.update(1, 0.1);
    character.go([{ x: PLACE.x, z: PLACE.z }, { x: PLACE.x + 2, z: PLACE.z }], null);
    for (let t = 1.1; t < 4; t += FRAME) character.update(t, FRAME);
    expect(launches).toEqual([]);
  });
});

describe('#74 AC2 the plane leaves from the hand', () => {
  it('#74 AC2 a launched plane starts within 0.1 m of the held plane on the frame before the release', () => {
    const character = thrower();
    const launches: THREE.Vector3[] = [];
    const planes = new PaperPlanes(new THREE.Scene());
    character.throwPlane((at) => { launches.push(at.clone()); planes.throw(at, DESK); });
    let before: THREE.Vector3 | null = null;
    for (let t = 1; !launches.length && t < 5; t += FRAME) {
      before = heldPlane(character) ?? before;
      character.update(t, FRAME);
      character.root.updateMatrixWorld(true);
    }
    expect(launches).toHaveLength(1);
    expect(heldPlane(character), 'the hand is empty once it\'s thrown').toBeNull();
    const [flying] = planes.planes();
    flying.updateMatrixWorld(true);
    const first = flying.children[0].getWorldPosition(new THREE.Vector3());
    expect(first.distanceTo(before!)).toBeLessThan(0.1);
  });

  it('#74 AC2 the plane still flies to the desk', () => {
    const planes = new PaperPlanes(new THREE.Scene());
    planes.throw(new THREE.Vector3(PLACE.x, 1.4, PLACE.z), DESK);
    for (let i = 0; i < 120; i++) planes.update(FRAME);
    const [plane] = planes.planes();
    expect(Math.hypot(plane.position.x - DESK.x, plane.position.z - DESK.z)).toBeLessThan(0.01);
  });
});

describe('#74 AC3 no snapping between wind-up and release', () => {
  it('#74 AC3 the hands move at most 0.12 m in any 1/60 s frame through a whole throw', () => {
    const character = thrower();
    character.throwPlane(() => {});
    const hands: THREE.Vector3[][] = [];
    for (let i = 0; i < 4 / FRAME; i++) {
      character.update(1 + i * FRAME, FRAME);
      character.root.updateMatrixWorld(true);
      hands.push(character.hands.map((h) => h.getWorldPosition(new THREE.Vector3())));
    }
    for (let i = 1; i < hands.length; i++) {
      for (const side of [0, 1]) expect(hands[i][side].distanceTo(hands[i - 1][side]), `frame ${i}, hand ${side}`).toBeLessThanOrEqual(0.12);
    }
  });
});
