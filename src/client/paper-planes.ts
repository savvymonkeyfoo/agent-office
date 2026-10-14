import * as THREE from 'three';
import type { Point } from './layout.ts';
import { paperPlane } from './character.ts';

const FLIGHT_SECONDS = 1.4;
/** How high a plane's arc rises: over to a desk, or (higher) over the tiers to the Control room's pit floor (#103). */
const ARC = 0.9;
const FLOOR_ARC = 2.0;
/** How long a landed plane lies on the desk. */
const LANDED_SECONDS = 12;
const DESK_TOP = 0.79;
/** A landed plane's middle is this far above its underside. */
const PLANE_MIDDLE = 0.0285;

/** Where a plane aimed at `to` comes to rest: on the desk there, or the floor there (#103). */
export const landingPoint = (to: Point, onFloor = false) => new THREE.Vector3(to.x, (onFloor ? 0 : DESK_TOP) + PLANE_MIDDLE, to.z);

/** Paper planes flying in an arc from a thrower's hand to a desk, where they lie for a while. */
export class PaperPlanes {
  private flights: { plane: THREE.Object3D; from: THREE.Vector3; to: THREE.Vector3; arc: number; age: number }[] = [];

  constructor(private scene: THREE.Scene) {}

  /**
   * A plane leaving from `from` (the held plane's place in the world, #74) for the desk at `to`, or the floor there (#103).
   * Returns where the plane is while it's in the air, and null once it has landed (#116).
   */
  throw(from: THREE.Vector3, to: Point, onFloor = false) {
    const plane = new THREE.Group().add(paperPlane());
    plane.children[0].position.set(0, 0, 0);
    const start = from.clone(), end = landingPoint(to, onFloor);
    plane.position.copy(start);
    plane.lookAt(end.x, start.y, end.z);
    this.scene.add(plane);
    const flight = { plane, from: start, to: end, arc: onFloor ? FLOOR_ARC : ARC, age: 0 };
    this.flights.push(flight);
    return () => (flight.age < FLIGHT_SECONDS ? plane.position : null);
  }

  /** The planes in the air or lying on desks. */
  planes() {
    return this.flights.map((f) => f.plane);
  }

  update(dt: number) {
    for (const f of this.flights) {
      f.age += dt;
      const k = Math.min(1, f.age / FLIGHT_SECONDS);
      f.plane.position.lerpVectors(f.from, f.to, k);
      f.plane.position.y += Math.sin(k * Math.PI) * f.arc;
      f.plane.rotation.z = Math.sin(k * Math.PI * 2) * 0.3 * (1 - k);
    }
    for (const f of this.flights.filter((f) => f.age > FLIGHT_SECONDS + LANDED_SECONDS)) this.scene.remove(f.plane);
    this.flights = this.flights.filter((f) => f.age <= FLIGHT_SECONDS + LANDED_SECONDS);
  }
}
