// Dog fetch (#75): on each fetch the thrower throws a ball that arcs to the fetch spot; it waits
// there for the dog, rides back in its mouth, and is handed back to the thrower.
import * as THREE from 'three';
import { mesh } from './toon.ts';
import type { Point } from './layout.ts';
import type { Character } from './character.ts';
import type { Dog } from './dog.ts';

/** Seconds from the fetch to the ball leaving the hand (the dog sets off then), and in the air. */
export const RELEASE_AT = 0.5;
export const FLIGHT = 0.7;
export const BALL_R = 0.08;
const ARC = 0.6;
/** How close the dog gets before it picks the ball up, and how long picking up and handing back take. */
const REACH = 0.45;
const PICK_UP = 0.25;
const HAND_BACK = 0.5;
/** The ball, held in the right hand, in the hand's frame. */
const GRIP = new THREE.Vector3(0, 0.12, 0.08);

/** Where the ball sits in `thrower`'s right hand, in the world. */
export function ballInHand(thrower: Character) {
  thrower.root.updateMatrixWorld(true);
  return thrower.hands[1].localToWorld(GRIP.clone());
}

const smooth = (k: number) => { const c = Math.min(1, Math.max(0, k)); return c * c * (3 - 2 * c); };

type Phase =
  | { kind: 'hand' }
  | { kind: 'throw'; t: number; to: THREE.Vector3; from: THREE.Vector3 | null }
  | { kind: 'ground' }
  | { kind: 'pick-up' | 'hand-back'; t: number; from: THREE.Vector3 }
  | { kind: 'mouth' };

/** The fetch ball: in the thrower's hand, in the air, on the ground, or in the dog's mouth. */
export class FetchBall {
  readonly mesh = mesh(new THREE.SphereGeometry(BALL_R, 12, 10), '#C8E04A', { outline: 0.08 });
  private phase: Phase = { kind: 'hand' };

  /** `floor`: the floor's height under a point (#103). */
  constructor(parent: THREE.Object3D, private floor: (p: Point) => number = () => 0) {
    this.mesh.visible = false;
    parent.add(this.mesh);
  }

  /** A fetch starts now: the ball will be thrown to `to`. */
  throw(to: Point) {
    this.phase = { kind: 'throw', t: 0, to: new THREE.Vector3(to.x, this.floor(to) + BALL_R, to.z), from: null };
  }

  /** `thrower`: whoever is playing fetch, if anyone. */
  update(dt: number, thrower: Character | null, dog: Dog) {
    const p = this.phase, pos = this.mesh.position;
    this.mesh.visible = true;
    if (p.kind === 'hand' || (p.kind === 'throw' && p.t + dt < RELEASE_AT)) {
      if (p.kind === 'throw') p.t += dt;
      if (!thrower) return this.drop();
      pos.copy(ballInHand(thrower));
    } else if (p.kind === 'throw') {
      p.t += dt;
      p.from ??= pos.clone();
      const s = Math.min(1, (p.t - RELEASE_AT) / FLIGHT);
      pos.lerpVectors(p.from, p.to, s).y += 4 * ARC * s * (1 - s);
      if (s >= 1) this.phase = { kind: 'ground' };
    } else if (p.kind === 'ground') {
      if (Math.hypot(dog.root.position.x - pos.x, dog.root.position.z - pos.z) <= REACH) this.phase = { kind: 'pick-up', t: 0, from: pos.clone() };
    } else if (p.kind === 'pick-up') {
      p.t += dt;
      pos.lerpVectors(p.from, dog.mouth(), smooth(p.t / PICK_UP));
      if (p.t >= PICK_UP) this.phase = { kind: 'mouth' };
    } else if (p.kind === 'mouth') {
      pos.copy(dog.mouth());
      if (!dog.running) this.phase = { kind: 'hand-back', t: 0, from: pos.clone() };
    } else {
      if (!thrower) return this.drop();
      p.t += dt;
      pos.lerpVectors(p.from, ballInHand(thrower), smooth(p.t / HAND_BACK));
      if (p.t >= HAND_BACK) this.phase = { kind: 'hand' };
    }
  }

  /** Nobody to hold it: it's put away until someone plays fetch again. */
  private drop() {
    this.phase = { kind: 'hand' };
    this.mesh.visible = false;
  }
}
