import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { AgentRecord, OfficeState } from '../src/shared/agent.ts';
import { OfficeController, type OfficeEvent } from '../src/client/controller.ts';
import { INITIAL_ROWS, WALK_SPEED, officeLayout, pathLength, route, type HangoutPlace, type Point } from '../src/client/layout.ts';
import { buildOffice } from '../src/client/office.ts';
import { Character } from '../src/client/character.ts';
import { lookFor } from '../src/client/look.ts';
import { POSES } from '../src/client/poses.ts';
import { RETURN_SECONDS } from '../src/client/float.ts';
import { agentKeyOf } from '../src/client/office-scene.ts';
import { obstaclesIn, routeCollisions } from './geometry.ts';

const rec = (n: number, state: OfficeState = 'working'): AgentRecord => ({
  id: `a${n}`, sessionId: `session-${n}`, name: `agent ${n}`, project: 'demo-app',
  cwd: '/home/alex/projects/demo-app', state, lastMessage: null, branch: null, activity: [],
});
const key = (n: number) => `session-${n}`;
// #25 moved the plan into officeLayout(rows); these tests run in the starting office.
const START = officeLayout(INITIAL_ROWS);
const { door: DOOR, hangouts: HANGOUTS } = START;
const HANGOUT_PLACES = HANGOUTS.flatMap((s) => s.places);
const ofType = <T extends OfficeEvent['type']>(events: OfficeEvent[], type: T) =>
  events.filter((e): e is Extract<OfficeEvent, { type: T }> => e.type === type);

/** mulberry32: a small seeded random. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A controller on a fake clock. Agents start working at their desks (already there when the page opened). */
function office(count: number, seed = 1) {
  const clock = { t: 0 };
  const c = new OfficeController({ now: () => clock.t, random: seeded(seed) });
  const states = new Map(Array.from({ length: count }, (_, i) => [i + 1, 'working' as OfficeState]));
  const records = () => [...states].map(([n, s]) => rec(n, s));
  c.update(records());
  const log: { t: number; event: OfficeEvent }[] = [];
  const record = (events: OfficeEvent[]) => { events.forEach((event) => log.push({ t: clock.t, event })); return events; };
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

const samePoint = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z) < 1e-9;
const forward = (yaw: number) => ({ x: Math.sin(yaw), z: Math.cos(yaw) });

function runCharacter(character: Character, until: () => boolean, from = 0) {
  let t = from;
  for (; t < from + 60 && !until(); t += 0.05) character.update(t, 0.05);
  return t;
}

describe('#14 AC1 idle agents leave their desk', () => {
  for (const state of ['done', 'finished'] as const) {
    it(`#14 AC1 within 3 s of turning ${state}, an agent walks from its desk to a hangout spot`, () => {
      const o = office(1);
      o.clock.t = 5;
      const seat = o.c.agents.get(key(1))!.seat;
      const immediate = o.set(1, state);
      const walks = [...ofType(immediate, 'walk'), ...ofType(o.run(3, 0.1), 'walk')];
      expect(walks).toHaveLength(1);
      const [walk] = walks;
      expect(walk.key).toBe(key(1));
      expect(walk.path[0]).toEqual(seat.sit);
      expect(walk.place).not.toBeNull();
      expect(walk.path.at(-1)).toEqual({ x: walk.place!.x, z: walk.place!.z });
      // #30 added solo activities alongside the kitchen, cooler and lounge.
      expect(HANGOUTS.filter((s) => !s.chat && !s.game).map((s) => s.name)).toContain(walk.place!.spot);
    });
  }

  it('#14 AC1 kitchen places have eat or drink poses, the sofa a lounging pose, chat spots a talking pose', () => {
    const poses = (spot: string) => new Set(HANGOUTS.find((s) => s.name === spot)!.places.map((p) => p.pose));
    expect([...poses('kitchen')].sort()).toEqual(['drinking', 'eating']);
    expect(poses('water-cooler')).toEqual(new Set(['drinking']));
    expect(HANGOUTS.find((s) => s.name === 'lounge')!.places.some((p) => p.pose === 'lounging' && p.sits)).toBe(true);
    for (const chat of HANGOUTS.filter((s) => s.chat)) expect(chat.places.map((p) => p.pose)).toEqual(['chatting', 'chatting']);
  });

  it('#14 AC1 the character walks there and takes the place\'s pose, keeping its bubble', () => {
    const o = office(1);
    const seat = o.c.agents.get(key(1))!.seat;
    o.set(1, 'done');
    const [walk] = ofType(o.run(3), 'walk');
    const character = new Character(lookFor(key(1)));
    character.sitAt(seat, 'working');
    character.setState('done');
    character.go(walk.path, walk.place);
    runCharacter(character, () => character.mode === 'hanging');
    expect(character.mode).toBe('hanging');
    expect(character.pose).toBe(walk.place!.pose);
    expect(character.bubbleKind).toBeNull();
    expect(character.root.position.x).toBeCloseTo(walk.place!.x, 1);
    expect(character.root.position.z).toBeCloseTo(walk.place!.z, 1);
  });
});

describe('#14 AC2 chatting', () => {
  it('#14 AC2 chat spots are pairs of places facing each other', () => {
    for (const chat of HANGOUTS.filter((s) => s.chat)) {
      const [a, b] = chat.places;
      for (const [p, q] of [[a, b], [b, a]]) {
        const f = forward(p.yaw), d = Math.hypot(q.x - p.x, q.z - p.z);
        expect(f.x * (q.x - p.x) / d + f.z * (q.z - p.z) / d).toBeCloseTo(1);
      }
    }
  });

  it('#14 AC2 with a seeded random, two idle agents meet at a chat spot and talk', () => {
    const o = office(3, 7);
    for (const n of [1, 2, 3]) o.set(n, 'done');
    let met: [string, string] | null = null;
    o.run(15 * 60, 0.25, () => {
      if (met) return;
      const settled = [...o.c.agents].filter(([, a]) => a.place?.spot.startsWith('chat') && a.arrivesAt <= o.clock.t);
      for (const chat of HANGOUTS.filter((s) => s.chat)) {
        const here = settled.filter(([, a]) => a.place!.spot === chat.name);
        if (here.length === 2) met = [here[0][0], here[1][0]];
      }
    });
    expect(met).not.toBeNull();
  });

  it('#14 AC2 a character at a chat place plays a talking animation', () => {
    const place = HANGOUTS.find((s) => s.chat)!.places[0];
    const character = new Character(lookFor(key(1)));
    character.placeAt(START.seats[0], 'done', place);
    const snapshot = () => {
      character.root.updateMatrixWorld(true);
      const parts: number[] = [];
      character.root.traverse((o) => parts.push(...o.matrixWorld.elements));
      return parts;
    };
    character.update(1, 0.016);
    const a = snapshot();
    character.update(1.3, 0.016);
    expect(character.pose).toBe('chatting');
    expect(character.root.rotation.y).toBeCloseTo(place.yaw);
    expect(snapshot()).not.toEqual(a);
  });
});

describe('#14 AC3 staying and moving on', () => {
  it('#14 AC3 each stay lasts 10–30 s (#89: plus up to 10 s waiting for a slot), then the agent walks to another spot; no place is ever double-booked', () => {
    const o = office(6, 3);
    for (let n = 1; n <= 6; n++) o.set(n, n % 2 ? 'done' : 'finished');
    const capacity = new Map(HANGOUTS.map((s) => [s.name, s.places.length]));
    o.run(20 * 60, 0.25, () => {
      const bySpot = new Map<string, number>();
      const byPlace = new Set<HangoutPlace>();
      for (const a of o.c.agents.values()) {
        if (!a.place) continue;
        expect(byPlace.has(a.place)).toBe(false);
        byPlace.add(a.place);
        bySpot.set(a.place.spot, (bySpot.get(a.place.spot) ?? 0) + 1);
      }
      // #33: errands for other agents (high fives) aren't hangout spots.
      for (const [spot, n] of bySpot) if (capacity.has(spot)) expect(n).toBeLessThanOrEqual(capacity.get(spot)!);
    });

    let stays = 0;
    for (let n = 1; n <= 6; n++) {
      const all = o.log.filter((l) => l.event.type === 'walk' && l.event.key === key(n))
        .map((l) => ({ t: l.t, ...(l.event as Extract<OfficeEvent, { type: 'walk' }>) }));
      // #53: pool players change places at the table every turn; that's all one stay.
      const atTable = (w: (typeof all)[number] | undefined) => w?.place?.spot === 'pool-table';
      const walks = all.filter((w, i) => !(atTable(w) && atTable(all[i - 1])));
      for (let i = 0; i + 1 < walks.length; i++) {
        // #33: an errand (a high five) is short, and may cut a stay short.
        if (![walks[i], walks[i + 1]].every((w) => capacity.has(w.place!.spot))) continue;
        // #57: leaving a pool-dip ring, the agent first paddles home.
        const paddle = walks[i - 1]?.place?.pose === 'floating' ? RETURN_SECONDS : 0;
        const arrived = walks[i].t + paddle + pathLength(walks[i].path) / WALK_SPEED;
        const stay = walks[i + 1].t - arrived;
        expect(stay, `agent ${n} stay ${i}`).toBeGreaterThanOrEqual(10 - 0.3);
        // #89: a stay may run up to 10 s over while the agent waits for a free moment to set off.
        expect(stay, `agent ${n} stay ${i}`).toBeLessThanOrEqual(30 + 10 + 0.3);
        expect(walks[i + 1].place!.spot).not.toBe(walks[i].place!.spot);
        stays++;
      }
    }
    expect(stays).toBeGreaterThan(50);
  });
});

describe('#14 AC4 wander routes stay on walkways', () => {
  for (const rows of [INITIAL_ROWS, INITIAL_ROWS + 1]) {
    it(`#14 AC4 every route between places, desks and the door misses all furniture (${rows} rows)`, { timeout: 30_000 }, () => {
      const { group, seats, layout } = buildOffice(rows);
      const obstacles = obstaclesIn(group);
      const links = [...layout.hangouts.flatMap((s) => s.places).map((p) => ({ name: `${p.spot}@${p.x},${p.z}`, link: p.link }))];
      const ends = [...links, ...seats.map((s) => ({ name: `seat ${s.index}`, link: s.link })), { name: 'door', link: layout.doorLink }];
      for (const from of links) {
        for (const to of ends) {
          if (from === to) continue;
          for (const path of [route(layout, from.link, to.link), route(layout, to.link, from.link)]) {
            expect(routeCollisions(path, obstacles), `${from.name} ↔ ${to.name}`).toEqual([]);
          }
        }
      }
    });
  }

  it('#14 AC4 routes taken during a busy simulation, including turn-backs mid-walk, miss all furniture', () => {
    const o = office(8, 11);
    const obstacles = obstaclesIn(buildOffice(INITIAL_ROWS).group);
    const random = seeded(99);
    const states: OfficeState[] = ['done', 'finished', 'working', 'needs', 'stale'];
    o.run(10 * 60, 0.25, () => {
      if (random() < 0.03) o.set(1 + Math.floor(random() * 8), states[Math.floor(random() * states.length)]);
    });
    const paths = o.log.flatMap(({ event }) => (event.type === 'walk' || event.type === 'leave' ? [event.path] : []));
    expect(paths.length).toBeGreaterThan(30);
    for (const path of paths) expect(routeCollisions(path, obstacles)).toEqual([]);
  });
});

describe('#14 AC5 back to work', () => {
  it('#14 AC5 a wandering agent that turns Working or Needs you walks straight back and sits in the matching pose', () => {
    for (const state of ['working', 'needs'] as const) {
      const o = office(1);
      const seat = o.c.agents.get(key(1))!.seat;
      o.set(1, 'done');
      const [out] = ofType(o.run(3), 'walk');
      o.run(pathLength(out.path) / WALK_SPEED + 2); // arrived, not yet moving on
      const [back] = ofType(o.set(1, state), 'walk');
      expect(back.place).toBeNull();
      expect(back.path[0]).toEqual({ x: out.place!.x, z: out.place!.z });
      expect(back.path.at(-1)).toEqual(seat.sit);

      const character = new Character(lookFor(key(1)));
      character.placeAt(seat, 'done', out.place!);
      character.setState(state);
      character.go(back.path, null);
      runCharacter(character, () => character.mode === 'seated');
      expect(character.mode).toBe('seated');
      expect([character.pose, character.bubbleKind]).toEqual([POSES[state].pose, POSES[state].bubble]);
      expect(character.root.position.x).toBeCloseTo(seat.sit.x);
      expect(character.root.position.z).toBeCloseTo(seat.sit.z);
    }
  });

  it('#14 AC5 turning Working mid-walk turns the agent round on the route it was on', () => {
    const o = office(1);
    const seat = o.c.agents.get(key(1))!.seat;
    o.set(1, 'done');
    const [out] = ofType(o.run(3), 'walk');
    o.run((pathLength(out.path) / WALK_SPEED) / 2); // halfway there
    const [back] = ofType(o.set(1, 'working'), 'walk');
    expect(out.path.some((p) => samePoint(p, back.path[0]))).toBe(true);
    expect(back.path.at(-1)).toEqual(seat.sit);
    expect(pathLength(back.path)).toBeLessThan(pathLength(out.path));
    expect(o.c.agents.get(key(1))!.place).toBeNull();
  });
});

describe('#14 AC6 Got it from anywhere', () => {
  it('#14 AC6 an agent at a hangout spot walks from there to the door', () => {
    const o = office(1);
    const seat = o.c.agents.get(key(1))!.seat;
    o.set(1, 'finished');
    const [out] = ofType(o.run(3), 'walk');
    o.run(pathLength(out.path) / WALK_SPEED + 2);
    const [leave] = ofType(o.set(1, null), 'leave');
    expect(o.c.agents.has(key(1))).toBe(false);
    expect(leave.path[0]).toEqual({ x: out.place!.x, z: out.place!.z });
    expect(leave.path.at(-1)).toEqual(DOOR);

    const character = new Character(lookFor(key(1)));
    character.placeAt(seat, 'finished', out.place!);
    character.leave(leave.path);
    runCharacter(character, () => character.mode === 'gone');
    expect(character.mode).toBe('gone');
    expect(Math.hypot(character.root.position.x - DOOR.x, character.root.position.z - DOOR.z)).toBeLessThan(0.6);
  });

  it('#14 AC6 Got it mid-walk heads for the door from the route the agent was on', () => {
    const o = office(1);
    o.set(1, 'finished');
    const [out] = ofType(o.run(3), 'walk');
    o.run((pathLength(out.path) / WALK_SPEED) / 2);
    const [leave] = ofType(o.set(1, null), 'leave');
    expect(out.path.some((p) => samePoint(p, leave.path[0]))).toBe(true);
    expect(leave.path.at(-1)).toEqual(DOOR);
  });
});

describe('#14 AC7 bubbles and picking while wandering', () => {
  it('#14 AC7 the bubble stays overhead while walking and at a spot', () => {
    for (const state of ['done', 'finished'] as const) {
      const o = office(1);
      const seat = o.c.agents.get(key(1))!.seat;
      o.set(1, state);
      const [walk] = ofType(o.run(3), 'walk');
      const character = new Character(lookFor(key(1)));
      character.sitAt(seat, state);
      character.go(walk.path, walk.place);
      for (let t = 0; t < 1; t += 0.05) character.update(t, 0.05);
      expect(character.mode).toBe('walking');
      expect(character.bubbleKind).toBe(POSES[state].bubble);
      runCharacter(character, () => character.mode === 'hanging', 1);
      expect(character.bubbleKind).toBe(POSES[state].bubble);
    }
  });

  it('#14 AC7 an agent at a hangout spot can still be picked (click and hover use the same pick)', () => {
    const place = HANGOUT_PLACES.find((p) => p.spot === 'lounge' && p.sits)!;
    const character = new Character(lookFor(key(1)));
    character.root.userData.agentKey = key(1);
    character.placeAt(START.seats[0], 'done', place);
    character.update(0, 0.016);
    character.root.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(place.x, 6, place.z), new THREE.Vector3(0, -1, 0));
    ray.camera = new THREE.PerspectiveCamera(); // sprites (the bubble) need one, as with setFromCamera
    const [hit] = ray.intersectObject(character.root, true);
    expect(agentKeyOf(hit.object)).toBe(key(1));
  });
});

describe('#14 AC8 page opens on idle agents', () => {
  it('#14 AC8 agents already Done or Finished start at a hangout spot, with no walk-in', () => {
    const c = new OfficeController({ now: () => 0, random: seeded(5) });
    const events = c.update([rec(1, 'done'), rec(2, 'finished'), rec(3, 'working')]);
    const arrivals = ofType(events, 'arrive');
    expect(arrivals.map((a) => a.walk)).toEqual([false, false, false]);
    expect(arrivals.map((a) => !!a.place)).toEqual([true, true, false]);
    expect(ofType(events, 'walk')).toEqual([]);
    const [first] = arrivals;
    expect(HANGOUT_PLACES).toContainEqual(first.place);

    const character = new Character(lookFor(first.key));
    character.placeAt(first.seat, 'done', first.place!);
    character.update(0, 0.016);
    expect(character.mode).toBe('hanging');
    expect(character.root.position.x).toBeCloseTo(first.place!.x);
    expect(character.root.position.z).toBeCloseTo(first.place!.z);
  });
});
