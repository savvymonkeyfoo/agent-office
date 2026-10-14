// A controller on a fake clock and seeded random, for the break-room tests (#29).
import * as THREE from 'three';
import type { AgentRecord, OfficeState } from '../src/shared/agent.ts';
import { OfficeController, type OfficeEvent } from '../src/client/controller.ts';
import type { Point } from '../src/client/layout.ts';

export const rec = (n: number, state: OfficeState = 'working'): AgentRecord => ({
  id: `a${n}`, sessionId: `session-${n}`, name: `agent ${n}`, project: 'demo-app',
  cwd: '/home/alex/projects/demo-app', state, lastMessage: null, branch: null, activity: [],
});
export const key = (n: number) => `session-${n}`;

export const ofType = <T extends OfficeEvent['type']>(events: OfficeEvent[], type: T) =>
  events.filter((e): e is Extract<OfficeEvent, { type: T }> => e.type === type);

/** Plan C's artifact coordinates (x 0–18, y from the back wall) in layout space. */
export const plan = (x: number, y: number): Point => ({ x: x - 9, z: y - 5 });

/** mulberry32: a small seeded random. */
export function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `count` agents, working at their desks when the page opened; `set` changes one, `run` ticks the clock. */
export function office(count: number, seed = 1, state: OfficeState = 'working') {
  const clock = { t: 0 };
  const c = new OfficeController({ now: () => clock.t, random: seeded(seed) });
  const states = new Map(Array.from({ length: count }, (_, i) => [i + 1, state]));
  const records = () => [...states].map(([n, s]) => rec(n, s));
  const log: { t: number; event: OfficeEvent }[] = [];
  const record = (events: OfficeEvent[]) => { events.forEach((event) => log.push({ t: clock.t, event })); return events; };
  c.update(records());
  return {
    c, clock, log,
    set(n: number, state: OfficeState | null) {
      if (state) states.set(n, state); else states.delete(n);
      return record(c.update(records()));
    },
    run(seconds: number, step = 0.25, each?: () => void) {
      const events: OfficeEvent[] = [];
      for (const end = clock.t + seconds; clock.t < end - 1e-9;) {
        clock.t += step;
        events.push(...record(c.tick()));
        each?.();
      }
      return events;
    },
  };
}

export function find(root: THREE.Object3D, kind: string) {
  const found: THREE.Object3D[] = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => { if (o.userData.kind === kind) found.push(o); });
  return found;
}

export const centre = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
