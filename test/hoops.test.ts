import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BREAK_ROOM, INITIAL_ROWS, officeLayout } from '../src/client/layout.ts';
import { Character } from '../src/client/character.ts';
import { lookFor } from '../src/client/look.ts';
import { BinBall } from '../src/client/break-room.ts';
import { BIN, FLIGHT, RELEASE_AT, SHOT_EVERY, ballFlight, shotAt } from '../src/client/hoops.ts';

const START = officeLayout(INITIAL_ROWS);
const PLACE = START.hangouts.find((s) => s.name === 'hoops')!.places[0];
const FRAME = 1 / 60;
const world = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
const shown = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false; return true; };
const vec = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.y, p.z);

/** A shooter at the line, stepped frame by frame; `at(t)` advances it to `t` seconds after arriving. */
function shooter() {
  const character = new Character(lookFor('session-1'));
  character.placeAt(START.seats[0], 'done', PLACE);
  let now = 0;
  const at = (t: number) => {
    while (now < t - 1e-9) { const dt = Math.min(FRAME, t - now); character.update(now, dt); now += dt; }
    character.root.updateMatrixWorld(true);
    return character;
  };
  return { character, at };
}

/** The ball in the shooter's hands, if one is shown. */
function heldBall(character: Character) {
  let found: THREE.Object3D | null = null;
  character.hands[1].traverse((o) => { if (o.userData.part === 'hoops-ball' && shown(o)) found = o; });
  return found as THREE.Object3D | null;
}

describe('#73 AC1 the hands rise smoothly and the ball leaves from between them at the top of the jump', () => {
  it('#73 AC1 no hand or foot moves more than 0.12 m in a frame, over several shots', () => {
    const { character, at } = shooter();
    at(1);
    const limbs = () => [...character.hands, ...character.feet].map(world);
    let before = limbs();
    for (let t = 1 + FRAME; t < 1 + 3 * SHOT_EVERY; t += FRAME) {
      const now = limbs();
      now.forEach((p, i) => expect(p.distanceTo(before[i]), `limb ${i} at ${t.toFixed(3)}`).toBeLessThanOrEqual(0.12));
      before = now;
    }
  });

  it('#73 AC1 the hands go up for the shot: low while holding, high at the release', () => {
    expect(shotAt(RELEASE_AT - 0.001).hands - shotAt(0.2).hands).toBeGreaterThan(0.6);
  });

  it('#73 AC1 at release the ball is between the hands, at the top of the jump, where the flight starts', () => {
    for (const shot of [1, 2]) {
      const { character, at } = shooter();
      const release = shot * SHOT_EVERY + RELEASE_AT;
      at(release - 0.001);
      const ball = heldBall(character)!;
      expect(ball, `shot ${shot}`).not.toBeNull();
      const [l, r] = character.hands.map(world), b = world(ball);
      const mid = l.clone().add(r).multiplyScalar(0.5);
      expect(Math.hypot(b.x - mid.x, b.z - mid.z), 'between the hands').toBeLessThan(0.1);
      expect(b.y).toBeGreaterThan(Math.max(l.y, r.y));
      expect(b.distanceTo(vec(ballFlight(PLACE, 0))), 'the flight starts from the hands').toBeLessThan(0.05);
      let top = 0;
      for (let u = 0; u < SHOT_EVERY; u += 0.01) top = Math.max(top, shotAt(u).jump);
      expect(shotAt(RELEASE_AT).jump, 'top of the jump').toBeCloseTo(top, 3);
      expect(top).toBeGreaterThan(0.1);
      at(release + 0.05);
      expect(heldBall(character), 'the hands are empty once it\'s thrown').toBeNull();
    }
  });
});

describe('#73 AC2 the ball arcs into the bin', () => {
  it('#73 AC2 the arc peaks above the release point and the rim, and ends inside the bin', () => {
    const start = ballFlight(PLACE, 0), end = ballFlight(PLACE, 1);
    let peak = -Infinity;
    for (let k = 0; k <= 1; k += 0.01) peak = Math.max(peak, ballFlight(PLACE, k).y);
    expect(peak).toBeGreaterThan(start.y + 0.1);
    expect(peak).toBeGreaterThan(BIN.rim + 0.1);
    expect(Math.hypot(end.x - BREAK_ROOM.bin.x, end.z - BREAK_ROOM.bin.z)).toBeLessThan(BIN.r - 0.13);
    expect(end.y).toBeLessThan(BIN.rim);
    expect(end.y).toBeGreaterThan(0);
  });

  it('#73 AC2 the ball drops in from above: it is over the bin\'s mouth whenever it is at rim height or below', () => {
    for (let k = 0; k <= 1; k += 0.005) {
      const p = ballFlight(PLACE, k);
      if (p.y < BIN.rim + 0.13) expect(Math.hypot(p.x - BREAK_ROOM.bin.x, p.z - BREAK_ROOM.bin.z), `k ${k.toFixed(3)}`).toBeLessThan(BIN.r);
    }
  });

  it('#73 AC2 the scene\'s ball is where the flight says', () => {
    const ball = new BinBall(new THREE.Scene());
    ball.update({ place: PLACE, t: SHOT_EVERY + RELEASE_AT + FLIGHT / 2 });
    expect(ball.mesh.visible).toBe(true);
    expect(ball.mesh.position.distanceTo(vec(ballFlight(PLACE, 0.5)))).toBeLessThan(1e-6);
  });
});

describe('#73 AC3 the ball is always somewhere to be seen', () => {
  it('#73 AC3 every frame of a shot, the ball is in the hands, in the air or in the bin; back in the hands before the next shot', () => {
    const { character, at } = shooter();
    const ball = new BinBall(new THREE.Scene());
    for (let t = 0; t < 3 * SHOT_EVERY; t += FRAME) {
      at(t);
      ball.update(character.hoopsShooter());
      const inHands = !!heldBall(character), elsewhere = ball.mesh.visible;
      expect(inHands || elsewhere, `at ${t.toFixed(3)}`).toBe(true);
      const u = t % SHOT_EVERY;
      if (u > RELEASE_AT + FLIGHT) {
        expect(elsewhere, `in the bin at ${t.toFixed(3)}`).toBe(true);
        expect(Math.hypot(ball.mesh.position.x - BREAK_ROOM.bin.x, ball.mesh.position.z - BREAK_ROOM.bin.z)).toBeLessThan(BIN.r);
      }
    }
    expect(heldBall(at(2 * SHOT_EVERY - FRAME)), 'back in the hands before the next shot').not.toBeNull();
  });

  it('#73 AC3 no shooter, no ball by the bin', () => {
    const ball = new BinBall(new THREE.Scene());
    ball.update({ place: PLACE, t: RELEASE_AT + 0.1 });
    expect(ball.mesh.visible).toBe(true);
    ball.update(null);
    expect(ball.mesh.visible).toBe(false);
  });
});
