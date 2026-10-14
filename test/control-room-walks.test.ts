import { describe, expect, it } from 'vitest';
import { OfficeController, type OfficeEvent } from '../src/client/controller.ts';
import { floorAt, type Point } from '../src/client/layout.ts';
import type { ControlRoomLayout } from '../src/client/control-room.ts';
import { Character } from '../src/client/character.ts';
import { lookFor } from '../src/client/look.ts';
import type { OfficeState } from '../src/shared/agent.ts';
import { buildOffice } from '../src/client/office.ts';
import { heightAt } from '../src/client/control-room.ts';
import { collisions, inside, obstaclesIn, problems, type Obstacle } from './geometry.ts';
import { rec, seeded } from './office-sim.ts';

/**
 * The office scene in miniature: the controller on its own clock, and characters that only get
 * `pace` of each tick's time (the scene caps a frame's dt, so a slow or hidden page falls behind
 * the controller). Returns every stretch each character walked.
 */
function walkedStretches(seed: number, pace: number, agents: number) {
  const clock = { t: 0 };
  const c = new OfficeController({ now: () => clock.t, random: seeded(seed) }, 'control-room');
  const characters = new Map<string, Character>();
  const stretches: { from: Point; to: Point; layout: ControlRoomLayout; ends: Point[] }[] = [];
  /** Where each character's walk set off from and where it ends: it may step off, or onto, a piece there. */
  const ends = new Map<Character, Point[]>();
  const setsOff = (ch: Character | undefined, path: Point[]) => ch && ends.set(ch, [{ x: ch.root.position.x, z: ch.root.position.z }, path[0], path.at(-1)!]);
  const states = new Map<number, OfficeState>(Array.from({ length: agents }, (_, i) => [i + 1, 'working']));
  const records = () => [...states].map(([n, s]) => rec(n, s));
  const apply = (events: OfficeEvent[]) => {
    for (const e of events) {
      if (e.type === 'arrive') {
        const ch = new Character(lookFor(e.key));
        ch.ground = (p) => floorAt(c.layout, p);
        characters.set(e.key, ch);
        if (e.walk) ch.arrive(e.seat, e.record.state, e.path);
        else ch.sitAt(e.seat, e.record.state);
        setsOff(ch, e.path);
      } else if (e.type === 'walk') {
        setsOff(characters.get(e.key), e.path);
        characters.get(e.key)?.go(e.path, e.place);
      }
      else if (e.type === 'state') characters.get(e.key)?.setState(e.state);
      else if (e.type === 'leave') {
        setsOff(characters.get(e.key), e.path);
        characters.get(e.key)?.leave(e.path);
      }
      else if (e.type === 'place') {
        // A new tier: everyone is put straight at their moved spot (that's no walk).
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
      // Agents change state now and then; one more arrives later, adding a 4th tier.
      const n = 1 + Math.floor(random() * agents);
      states.set(n, (['working', 'done', 'stale', 'needs'] as const)[Math.floor(random() * 4)]);
      if (clock.t > 300 && !states.has(agents + 1)) {
        for (let k = agents + 1; k <= 19; k++) states.set(k, 'done');
      }
      apply(c.update(records()));
    }
    apply(c.tick());
    for (const ch of characters.values()) {
      const before = { x: ch.root.position.x, z: ch.root.position.z }, walking = ch.mode === 'walking';
      ch.update(clock.t, step * pace);
      if (walking && ch.mode === 'walking') {
        stretches.push({ from: before, to: { x: ch.root.position.x, z: ch.root.position.z }, layout: c.layout as ControlRoomLayout, ends: ends.get(ch)! });
      }
    }
  }
  return { stretches, rows: c.layout.rows };
}

/** The furniture of the office with `tiers` tiers, as built. */
const furniture = new Map<number, Obstacle[]>();
const furnitureFor = (layout: ControlRoomLayout) => {
  if (!furniture.has(layout.rows)) furniture.set(layout.rows, obstaclesIn(buildOffice(layout.rows, 'control-room').group, (p) => heightAt(layout, p)));
  return furniture.get(layout.rows)!;
};

describe('#100 AC3 what agents are seen to walk stays off the rail, the consoles, the furniture and the tier edges', () => {
  for (const pace of [1, 0.5]) {
    it(`#100 AC3 agents drawn ${pace === 1 ? 'in step with' : 'falling behind'} the controller, 3 tiers then 4`, { timeout: 120_000 }, () => {
      for (const seed of [1, 2, 3]) {
        const found = new Set<string>();
        const { stretches, rows } = walkedStretches(seed, pace, 12);
        expect(rows, 'a 4th tier was added').toBe(4);
        for (const { from, to, layout, ends } of stretches) {
          const pieces = furnitureFor(layout);
          // Out on the jetty, it's over the lake.
          const { jetty } = layout.props;
          const onJetty = (p: Point) => Math.abs(p.x - jetty.x) <= jetty.w / 2 && Math.abs(p.z - jetty.z) <= jetty.d / 2;
          const onEnds = new Set(pieces.filter((o) => ends.some((p) => inside(p, o.box, 0)) || (o.kind === 'lake' && onJetty(from) && onJetty(to))).map((o) => o.object));
          for (const p of [...problems(layout, [from, to]), ...collisions([from, to], pieces, () => onEnds)]) {
            found.add(`${p.replace(/leg \d+ /, '')} (from ${from.x.toFixed(2)}, ${from.z.toFixed(2)})`);
          }
        }
        expect([...found].slice(0, 5), `seed ${seed}`).toEqual([]);
      }
    });
  }
});
