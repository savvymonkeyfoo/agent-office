import * as THREE from 'three';
import { at, ball, cyl, mesh, tag } from './toon.ts';
import { DOG_SPEED, rejoin, type Point } from './layout.ts';

const FUR = '#D9A066';
const DARK = '#8C5A3A';
const UP = new THREE.Vector3(0, 1, 0);
/** Radians per second. */
const TURN_SPEED = 10;

/** The office dog (#34). It runs along the paths the controller gives it, then stands wagging or lies down. */
export class Dog {
  readonly root = tag(new THREE.Group(), 'dog');
  lying = false;
  /** Trots on the spot (the desktop pet, while work runs) instead of standing still. */
  trotting = false;
  private body = new THREE.Group();
  private tail: THREE.Object3D;
  private legs: THREE.Object3D[];
  private path: THREE.Vector3[] = [];
  /** Where the current run started and the points it has passed since. */
  private trail: Point[] = [];
  private lieOnArrival = false;
  /** Seconds left before it sets off along `path`. */
  private wait = 0;
  private phase = 0;

  constructor() {
    this.root.add(this.body);
    const torso = mesh(new THREE.CapsuleGeometry(0.14, 0.32, 6, 12), FUR, { outline: 0.06 });
    torso.rotation.x = Math.PI / 2;
    this.body.add(at(torso, 0, 0.32, 0));
    const head = new THREE.Group();
    head.add(ball(0.14, FUR, { outline: 0.06 }));
    head.add(at(ball(0.07, DARK, { outline: 0.08 }), 0, -0.03, 0.13)); // snout
    head.add(at(ball(0.025, '#241C2F', { outline: 0, shadow: false }), 0, 0.0, 0.2)); // nose
    for (const side of [-1, 1]) {
      const ear = at(ball(0.06, DARK, { outline: 0.08 }), side * 0.11, 0.05, -0.02);
      ear.scale.set(0.6, 1.4, 0.8);
      head.add(ear);
    }
    this.body.add(at(head, 0, 0.5, 0.27));
    this.tail = at(cyl(0.025, 0.02, 0.2, FUR, { outline: 0.08 }), 0, 0.42, -0.3);
    this.tail.rotation.x = -0.7;
    this.body.add(this.tail);
    this.legs = [[-0.08, 0.15], [0.08, 0.15], [-0.08, -0.15], [0.08, -0.15]].map(([x, z]) => {
      const leg = at(cyl(0.04, 0.035, 0.2, FUR, { outline: 0.06 }), x, 0.1, z);
      this.body.add(leg);
      return leg;
    });
  }

  /** The floor's height under a point (#103). */
  ground: (p: Point) => number = () => 0;

  /** Put straight at `p`. */
  placeAt(p: Point, lie: boolean) {
    this.root.position.set(p.x, this.ground(p), p.z);
    this.path = [];
    this.trail = [];
    this.lying = lie;
  }

  /** After `wait` seconds, run along `path` (from where it is), then lie down or stand. */
  go(path: Point[], lie: boolean, wait = 0) {
    // Still running: it keeps to the way it knows is clear (see rejoin).
    const way = this.path.length ? rejoin(this.root.position, this.trail, this.path, path) : path;
    this.trail = [{ x: this.root.position.x, z: this.root.position.z }];
    this.path = way.map((p) => new THREE.Vector3(p.x, 0, p.z));
    this.lieOnArrival = lie;
    this.lying = false;
    this.wait = wait;
  }

  /** On its way somewhere (or about to set off). */
  get running() {
    return this.path.length > 0;
  }

  /** Where it carries a ball (#75), in the world. */
  mouth() {
    return new THREE.Vector3(0, 0.42 + this.body.position.y, 0.47).applyAxisAngle(UP, this.root.rotation.y).add(this.root.position);
  }

  /** Turns at most TURN_SPEED, so whatever it carries in its mouth swings round rather than jumping (#75). */
  private turnTowards(heading: number, dt: number) {
    const d = Math.atan2(Math.sin(heading - this.root.rotation.y), Math.cos(heading - this.root.rotation.y));
    this.root.rotation.y += Math.sign(d) * Math.min(Math.abs(d), TURN_SPEED * dt);
  }

  update(t: number, dt: number) {
    this.wait = Math.max(0, this.wait - dt);
    const pos = this.root.position, target = this.wait ? undefined : this.path[0];
    this.body.position.y = 0;
    this.body.rotation.z = 0;
    if (target) {
      const dx = target.x - pos.x, dz = target.z - pos.z, dist = Math.hypot(dx, dz);
      if (dist < 0.03) this.trail.push(this.path.shift()!);
      else {
        const step = Math.min(dist, DOG_SPEED * dt);
        pos.x += (dx / dist) * step;
        pos.z += (dz / dist) * step;
        pos.y = this.ground(pos);
        this.turnTowards(Math.atan2(dx, dz), dt);
      }
      this.phase += dt * 16;
      this.body.position.y = Math.abs(Math.sin(this.phase)) * 0.05;
      this.legs.forEach((leg, i) => { leg.rotation.x = Math.sin(this.phase + (i % 2 ? Math.PI : 0)) * 0.6; });
      if (!this.path.length) this.lying = this.lieOnArrival;
    } else if (this.trotting && !this.lying) {
      this.phase += dt * 11;
      this.body.position.y = Math.abs(Math.sin(this.phase)) * 0.035;
      this.legs.forEach((leg, i) => { leg.rotation.x = Math.sin(this.phase + (i % 2 ? Math.PI : 0)) * 0.45; });
    } else if (this.lying) {
      this.body.position.y = -0.17;
      this.legs.forEach((leg) => { leg.rotation.x = Math.PI / 2; });
      this.body.rotation.z = 0.15;
    } else {
      this.legs.forEach((leg) => { leg.rotation.x = 0; });
    }
    this.tail.rotation.z = Math.sin(t * (this.lying ? 3 : 14)) * 0.6;
  }
}
