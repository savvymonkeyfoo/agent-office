import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { OfficeState } from '../src/shared/agent.ts';
import type { Occupant } from '../src/client/controller.ts';
import { INITIAL_ROWS, WALK_SPEED, behindChair, pathLength, route, type Point } from '../src/client/layout.ts';
import { buildOffice } from '../src/client/office.ts';
import { DeskMugs } from '../src/client/break-room.ts';
import { obstaclesIn, routeCollisions } from './geometry.ts';
import { distance, find, key, ofType, office, seeded } from './office-sim.ts';

const n = (k: string) => Number(k.replace('session-', ''));

/** Agents 1..idle are idle (settled at hangout places); the rest work at their desks. */
function withIdle(idle: number, total: number, seed = 3) {
  const o = office(total, seed);
  for (let i = 1; i <= idle; i++) o.set(i, 'done');
  o.run(5);
  // Settle: everyone has arrived somewhere, nobody is still on an errand or waiting for a slot to set off (#89).
  const unsettled = (a: Occupant) => a.arrivesAt > o.clock.t || !!a.reaction || (a.nextAt != null && a.nextAt <= o.clock.t);
  for (let i = 0; i < 400 && [...o.c.agents.values()].some(unsettled); i++) o.run(0.25);
  return o;
}

/** Who is going where in an update's walk events. */
const walksTo = (events: ReturnType<ReturnType<typeof office>['set']>, spot: string) =>
  ofType(events, 'walk').filter((w) => w.place?.spot === spot);

describe('#33 AC1 over the shoulder', () => {
  it('#33 AC1 / #67 AC1 with 5 idle agents, exactly one walks to a spot behind the chair of an agent that needs you', () => {
    const o = withIdle(5, 6);
    const seat = o.c.agents.get(key(6))!.seat;
    const watchers = walksTo(o.set(6, 'needs'), 'over-the-shoulder');
    expect(watchers).toHaveLength(1);
    const back = { x: -Math.sin(seat.yaw), z: -Math.cos(seat.yaw) };
    for (const w of watchers) {
      expect(n(w.key)).toBeLessThanOrEqual(5);
      const p = w.place!;
      expect((p.x - seat.chair.x) * back.x + (p.z - seat.chair.z) * back.z, 'behind the chair').toBeGreaterThan(0.3);
      expect(distance(p, seat.chair)).toBeLessThan(1.5);
    }
  });

  it('#33 AC1 / #67 AC1 with 2 idle agents, one goes', () => {
    const o = withIdle(2, 3);
    expect(walksTo(o.set(3, 'needs'), 'over-the-shoulder')).toHaveLength(1);
  });

  it('#33 AC1 they stay while it needs you, and leave in the update it stops', () => {
    for (const next of ['working', 'done', null] as const) {
      const o = withIdle(5, 6);
      const watchers = walksTo(o.set(6, 'needs'), 'over-the-shoulder').map((w) => w.key);
      const meanwhile = o.run(5 * 60);
      expect(ofType(meanwhile, 'walk').filter((w) => watchers.includes(w.key)), 'stay put').toEqual([]);
      const events = o.set(6, next);
      for (const k of watchers) {
        const away = ofType(events, 'walk').find((w) => w.key === k);
        expect(away, `${k} leaves when agent 6 turns ${next}`).toBeDefined();
        expect(away!.place?.spot).not.toBe('over-the-shoulder');
      }
    }
  });
});

describe('#33 AC2 high five', () => {
  it('#33 AC2 when an agent turns done, the nearest idle agent by route length walks over and high-fives it', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const o = withIdle(4, 6, seed);
      const target = o.c.agents.get(key(6))!;
      // Players in a game (#31, #32) keep playing; any other idle agent can come.
      const inGame = (spot: string) => !!o.c.layout.hangouts.find((s) => s.name === spot)?.game;
      const from = [1, 2, 3, 4].map((i) => o.c.agents.get(key(i))!)
        .filter((a) => !a.place || !inGame(a.place.spot))
        .map((a) => (a.place ? a.place.link : a.seat.link));
      expect(from.length).toBeGreaterThan(0);
      const events = o.set(6, 'done');
      const [walk, ...more] = walksTo(events, 'high-five');
      expect(more).toEqual([]);
      expect(walk.place!.pose).toBe('high-five');
      expect(distance(walk.place!, target.seat.chair)).toBeLessThan(1.2);
      const lengths = from.map((link) => pathLength(route(o.c.layout, link, walk.place!.link)));
      expect(pathLength(walk.path)).toBeCloseTo(Math.min(...lengths), 6);

      // The done agent waits at its desk for it; the high five happens on arrival.
      const arrival = pathLength(walk.path) / WALK_SPEED;
      const before = o.run(arrival - 0.5);
      expect(ofType(before, 'walk').filter((w) => w.key === key(6)), 'waits at its desk').toEqual([]);
      expect(ofType(before, 'high-five')).toEqual([]);
      expect(ofType(o.run(1.5), 'high-five')).toEqual([{ type: 'high-five', key: walk.key, to: key(6) }]);
    }
  });

  it('#33 AC2 with no idle agents, nothing happens', () => {
    const o = withIdle(0, 3);
    const events = o.set(3, 'done');
    expect(ofType(events, 'walk')).toEqual([]);
    expect(ofType(o.run(60), 'high-five')).toEqual([]);
  });
});

describe('#33 AC3 coffee delivery', () => {
  it('#33 AC3 an idle agent walks via the kitchen to a working agent\'s desk, and leaves a mug that stays until it stops working', () => {
    const o = withIdle(1, 2);
    o.set(2, 'needs');
    o.run(2);
    const seat = o.c.agents.get(key(2))!.seat;
    const [walk, ...more] = walksTo(o.set(2, 'working'), 'coffee-delivery');
    expect(more).toEqual([]);
    expect(walk.key).toBe(key(1));
    const coffee = o.c.layout.hangouts.find((s) => s.name === 'kitchen')!.places[0];
    const viaKitchen = walk.path.findIndex((p) => distance(p, coffee) < 1e-9);
    expect(viaKitchen, 'passes the coffee machine').toBeGreaterThan(0);
    expect(walk.path.at(-1)).toEqual(seat.approach);

    const arrival = pathLength(walk.path) / WALK_SPEED;
    expect(ofType(o.run(arrival - 1), 'mug')).toEqual([]);
    expect(ofType(o.run(3), 'mug')).toEqual([{ type: 'mug', desk: seat.index, on: true }]);
    expect(ofType(o.run(120), 'mug')).toEqual([]);
    expect(ofType(o.set(2, 'needs'), 'mug')).toEqual([{ type: 'mug', desk: seat.index, on: false }]);
  });

  it('#33 AC3 the mug goes when its agent leaves the office', () => {
    const o = withIdle(1, 2);
    o.set(2, 'needs');
    const [walk] = walksTo(o.set(2, 'working'), 'coffee-delivery');
    const [delivered] = ofType(o.run(pathLength(walk.path) / WALK_SPEED + 1), 'mug');
    expect(delivered.on).toBe(true);
    expect(ofType(o.set(2, null), 'mug')).toEqual([{ type: 'mug', desk: delivered.desk, on: false }]);
  });

  it('#33 AC3 no mug if the agent stops working before the coffee arrives', () => {
    const o = withIdle(1, 2);
    o.set(2, 'needs');
    walksTo(o.set(2, 'working'), 'coffee-delivery');
    o.run(1);
    o.set(2, 'needs');
    expect(ofType(o.run(120), 'mug')).toEqual([]);
  });

  it('#33 AC3 a mug prop appears on the desk and goes again', () => {
    const { group, seats } = buildOffice(INITIAL_ROWS);
    const mugs = new DeskMugs(group);
    mugs.set(seats[5], true);
    const [mug, ...more] = find(group, 'mug');
    expect(more).toEqual([]);
    const at = new THREE.Box3().setFromObject(mug).getCenter(new THREE.Vector3());
    expect(distance(at, seats[5].desk)).toBeLessThan(0.6);
    expect(at.y).toBeGreaterThan(0.75);
    mugs.set(seats[5], false);
    expect(find(group, 'mug')).toEqual([]);
  });
});

describe('#33 AC4 reaction routes are clear', () => {
  for (const rows of [INITIAL_ROWS, INITIAL_ROWS + 1]) {
    it(`#33 AC4 routes from every place and desk to every reaction spot miss all furniture and walls (${rows} rows)`, { timeout: 30_000 }, () => {
      const { group, layout } = buildOffice(rows);
      const obstacles = obstaclesIn(group);
      const starts = [...layout.hangouts.flatMap((s) => s.places).map((p) => p.link), ...layout.seats.map((s) => s.link)];
      const coffee = layout.hangouts.find((s) => s.name === 'kitchen')!.places[0];
      for (const seat of layout.seats) {
        const spots: Point[][] = [...behindChair(layout, seat).map((p) => [p]), seat.link.slice(1)];
        for (const spot of spots) {
          for (const start of starts) {
            if (start === seat.link) continue;
            expect(routeCollisions(route(layout, start, spot), obstacles), `to seat ${seat.index}`).toEqual([]);
          }
        }
        expect(routeCollisions(route(layout, coffee.link, seat.link.slice(1)), obstacles), `coffee to seat ${seat.index}`).toEqual([]);
      }
    });
  }

  it('#33 AC4 every reaction walk in a busy simulation misses all furniture', () => {
    const o = office(10, 6);
    const obstacles = obstaclesIn(buildOffice(INITIAL_ROWS).group);
    const random = seeded(17);
    const states: OfficeState[] = ['done', 'finished', 'working', 'needs'];
    o.run(20 * 60, 0.25, () => {
      if (random() < 0.04) o.set(1 + Math.floor(random() * 10), states[Math.floor(random() * states.length)]);
    });
    const walks = ofType(o.log.map((l) => l.event), 'walk').filter((w) => ['over-the-shoulder', 'high-five', 'coffee-delivery'].includes(w.place?.spot ?? ''));
    for (const spot of ['over-the-shoulder', 'high-five', 'coffee-delivery']) expect(walks.some((w) => w.place!.spot === spot), spot).toBe(true);
    for (const w of walks) expect(routeCollisions(w.path, obstacles), w.place!.spot).toEqual([]);
  });
});
