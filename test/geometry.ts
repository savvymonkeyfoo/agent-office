// Route-vs-furniture checks against the real 3D office (shared by the #13 and #14 tests).
import * as THREE from 'three';
import type { Area, Point } from '../src/client/layout.ts';
import { heightAt, type ControlRoomLayout } from '../src/client/control-room.ts';

/** Things on the floor you can walk over or on (the angler walks out along the jetty), and zone groups (their pieces are checked one by one). */
const WALKABLE = new Set(['floor', 'rug', 'door', 'glass-door', 'jetty']);
const ZONES = new Set(['desk-row', 'meeting-room', 'lounge', 'kitchen', 'deck', 'glass-front']);
const CLEARANCE = 0.1;
/** Anything whose underside is higher than this is over everyone's head. */
const HEADROOM = 2.0;

export interface Obstacle { kind: string; box: THREE.Box3; object: THREE.Object3D }

/** Footprints of every tagged piece, from the real 3D office; `floor` is the floor's height under a point. */
export function obstaclesIn(group: THREE.Group, floor: (p: Point) => number = () => 0): Obstacle[] {
  group.updateMatrixWorld(true);
  const obstacles: Obstacle[] = [];
  group.traverse((o) => {
    const kind = o.userData.kind as string | undefined;
    if (!kind || WALKABLE.has(kind) || ZONES.has(kind)) return;
    const box = new THREE.Box3().setFromObject(o);
    // Raised clear over the floor (the Control room's wall screens): everyone walks under it.
    const centre = box.getCenter(new THREE.Vector3());
    if (box.min.y - floor({ x: centre.x, z: centre.z }) > HEADROOM) return;
    obstacles.push({ kind, box, object: o });
  });
  return obstacles;
}

export const inside = (p: Point, box: THREE.Box3, margin: number) =>
  p.x > box.min.x - margin && p.x < box.max.x + margin && p.z > box.min.z - margin && p.z < box.max.z + margin;

/** Obstacles a polyline passes through, sampled every 2 cm. `ignore(leg)` skips obstacles for one leg. */
export function collisions(path: Point[], obstacles: Obstacle[], ignore: (legIndex: number) => Set<THREE.Object3D> = () => new Set()) {
  const hits: string[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const skip = ignore(i);
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.02));
    for (let s = 0; s <= steps; s++) {
      const p = { x: a.x + ((b.x - a.x) * s) / steps, z: a.z + ((b.z - a.z) * s) / steps };
      for (const o of obstacles) {
        if (!skip.has(o.object) && inside(p, o.box, CLEARANCE)) hits.push(`leg ${i} (${p.x.toFixed(2)},${p.z.toFixed(2)}) hits ${o.kind}`);
      }
    }
  }
  return [...new Set(hits)];
}

/**
 * Collisions, except that the first leg may leave, and the last leg may enter, the piece the
 * route starts or ends on (an agent hops out of its chair or off the sofa, and back on).
 */
export function routeCollisions(path: Point[], obstacles: Obstacle[]) {
  const under = (p: Point) => new Set(obstacles.filter((o) => inside(p, o.box, 0)).map((o) => o.object));
  const start = under(path[0]), end = under(path.at(-1)!);
  const last = path.length - 2;
  return collisions(path, obstacles, (i) => new Set([...(i === 0 ? start : []), ...(i === last ? end : [])]));
}

const within = (p: Point, a: Area) => p.x >= a.x0 && p.x <= a.x1 && p.z >= a.z0 && p.z <= a.z1;

/** Where a walk breaks the plan: through a console, over the rail or a wall, or up or down a tier edge away from the steps. */
export function problems(layout: ControlRoomLayout, path: Point[]): string[] {
  const found = new Set<string>();
  const consoles = layout.consoles;
  const inConsole = (p: Point) => consoles.some((c) => {
    const dx = p.x - c.x, dz = p.z - c.z;
    const along = Math.abs(dx * Math.cos(c.yaw) - dz * Math.sin(c.yaw)), across = Math.abs(dx * Math.sin(c.yaw) + dz * Math.cos(c.yaw));
    return along < c.w / 2 + 0.05 && across < c.d / 2 + 0.05;
  });
  const onSteps = (p: Point) => layout.steps.some((s) => within(p, s));
  const crosses = (a: Point, b: Point, c: Point, d: Point) => {
    const side = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x));
    return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
  };
  const doorways = [layout.door, layout.sideDoor];
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i], b = path[i + 1];
    for (const rail of layout.rail) if (crosses(a, b, rail[0], rail[1])) found.add(`leg ${i} crosses the rail`);
    for (const wallX of [layout.room.left, layout.room.right]) {
      if ((a.x - wallX) * (b.x - wallX) < 0) {
        const z = a.z + ((wallX - a.x) / (b.x - a.x)) * (b.z - a.z);
        if (!doorways.some((d) => Math.abs(z - d.z) < 0.6)) found.add(`leg ${i} goes through the wall at z ${z.toFixed(2)}`);
      }
    }
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.02));
    let prev = a;
    for (let s = 0; s <= n; s++) {
      const p = { x: a.x + ((b.x - a.x) * s) / n, z: a.z + ((b.z - a.z) * s) / n };
      if (inConsole(p)) found.add(`leg ${i} through a console at (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
      if (heightAt(layout, p) !== heightAt(layout, prev) && !(onSteps(p) && onSteps(prev))) {
        found.add(`leg ${i} goes over a tier edge at (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
      }
      prev = p;
    }
  }
  return [...found];
}

