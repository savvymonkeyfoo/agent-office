// Innovation lab (#lab): agents walk the lanes, aisles and front walkway, never through a desk,
// a chair, a prop or a wall, across five projects, with new pods and rows opening as sessions arrive.
import { describe, expect, it } from 'vitest';
import { OfficeController, type OfficeEvent } from '../src/client/controller.ts';
import { floorAt, type Point } from '../src/client/layout.ts';
import type { LabLayout } from '../src/client/lab.ts';
import { Character } from '../src/client/character.ts';
import { lookFor } from '../src/client/look.ts';
import type { OfficeState } from '../src/shared/agent.ts';
import { buildOffice } from '../src/client/office.ts';
import { collisions, inside, obstaclesIn, type Obstacle } from './geometry.ts';
import { rec, seeded } from './office-sim.ts';

const PROJECTS = ['agent-office', 'hub', 'budget-app', 'garden-planner', 'pitch-deck'];
const labRec = (n: number, state: OfficeState) => ({ ...rec(n, state), project: PROJECTS[n % PROJECTS.length] });

function walkedStretches(seed: number, pace: number, agents: number, more: number) {
  const clock = { t: 0 };
  const c = new OfficeController({ now: () => clock.t, random: seeded(seed) }, 'lab');
  const characters = new Map<string, Character>();
  const stretches: { from: Point; to: Point; layout: LabLayout; ends: Point[] }[] = [];
  const ends = new Map<Character, Point[]>();
  const setsOff = (ch: Character | undefined, path: Point[]) => ch && ends.set(ch, [{ x: ch.root.position.x, z: ch.root.position.z }, path[0], path.at(-1)!]);
  const states = new Map<number, OfficeState>(Array.from({ length: agents }, (_, i) => [i + 1, 'working']));
  const records = () => [...states].map(([n, s]) => labRec(n, s));
  const apply = (events: OfficeEvent[]) => {
    for (const e of events) {
      if (e.type === 'arrive') {
        const ch = new Character(lookFor(e.key), { bot: true });
        ch.ground = (p) => floorAt(c.layout, p);
        characters.set(e.key, ch);
        if (e.walk) ch.arrive(e.seat, e.record.state, e.path);
        else ch.sitAt(e.seat, e.record.state);
        setsOff(ch, e.path);
      } else if (e.type === 'walk') {
        setsOff(characters.get(e.key), e.path);
        characters.get(e.key)?.go(e.path, e.place);
      } else if (e.type === 'state') characters.get(e.key)?.setState(e.state);
      else if (e.type === 'leave') {
        setsOff(characters.get(e.key), e.path);
        characters.get(e.key)?.leave(e.path);
      } else if (e.type === 'place') {
        const ch = characters.get(e.key)!;
        if (e.place) ch.placeAt(e.seat, e.state, e.place);
        else ch.sitAt(e.seat, e.state);
      }
    }
  };
  apply(c.update(records()));
  const random = seeded(seed + 100);
  const step = 0.1;
  for (let i = 0; clock.t < 600; i++) {
    clock.t += step;
    if (i % 40 === 0) {
      const n = 1 + Math.floor(random() * agents);
      states.set(n, (['working', 'done', 'stale', 'needs'] as const)[Math.floor(random() * 4)]);
      // Halfway through, more sessions open: new pods, then a new row.
      if (clock.t > 300 && !states.has(agents + 1)) for (let k = agents + 1; k <= agents + more; k++) states.set(k, 'working');
      apply(c.update(records()));
    }
    apply(c.tick());
    for (const ch of characters.values()) {
      const before = { x: ch.root.position.x, z: ch.root.position.z }, walking = ch.mode === 'walking';
      ch.update(clock.t, step * pace);
      if (walking && ch.mode === 'walking') {
        stretches.push({ from: before, to: { x: ch.root.position.x, z: ch.root.position.z }, layout: c.layout as LabLayout, ends: ends.get(ch)! });
      }
    }
  }
  return { stretches, rows: c.layout.rows };
}

const furniture = new Map<number, Obstacle[]>();
const furnitureFor = (layout: LabLayout) => {
  if (!furniture.has(layout.rows)) furniture.set(layout.rows, obstaclesIn(buildOffice(layout.rows, 'lab').group, (p) => floorAt(layout, p)));
  return furniture.get(layout.rows)!;
};

/** Through a side wall away from a doorway, or the back wall. */
function wallCrossings(layout: LabLayout, a: Point, b: Point) {
  const found: string[] = [];
  for (const wallX of [layout.room.left, layout.room.right]) {
    if ((a.x - wallX) * (b.x - wallX) < 0) {
      const z = a.z + ((wallX - a.x) / (b.x - a.x)) * (b.z - a.z);
      if (Math.abs(z - layout.door.z) > 0.6) found.push(`goes through the wall at z ${z.toFixed(2)}`);
    }
  }
  if (Math.min(a.z, b.z) < layout.room.back) found.push('goes through the back wall');
  return found;
}

describe('#lab agents walk around the desks, not through them', () => {
  for (const pace of [1, 0.5]) {
    it(`#lab agents drawn ${pace === 1 ? 'in step with' : 'falling behind'} the controller, 9 sessions then 21`, { timeout: 180_000 }, () => {
      for (const seed of [1, 2, 3]) {
        const found = new Set<string>();
        const { stretches, rows } = walkedStretches(seed, pace, 9, 12);
        expect(rows, 'a new row opened').toBeGreaterThan(2);
        for (const { from, to, layout, ends } of stretches) {
          const pieces = furnitureFor(layout);
          const onEnds = new Set(pieces.filter((o) => ends.some((p) => inside(p, o.box, 0))).map((o) => o.object));
          for (const p of [...wallCrossings(layout, from, to), ...collisions([from, to], pieces, () => onEnds)]) {
            found.add(`${p.replace(/leg \d+ /, '')} (from ${from.x.toFixed(2)}, ${from.z.toFixed(2)})`);
          }
        }
        expect([...found].slice(0, 8), `seed ${seed}`).toEqual([]);
      }
    });
  }
});
