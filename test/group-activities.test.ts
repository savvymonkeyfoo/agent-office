import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { INITIAL_ROWS, officeLayout } from '../src/client/layout.ts';
import { buildOffice } from '../src/client/office.ts';
import { Character } from '../src/client/character.ts';
import { lookFor } from '../src/client/look.ts';
import { find, ofType, office } from './office-sim.ts';

const START = officeLayout(INITIAL_ROWS);
const spot = (name: string) => START.hangouts.find((s) => s.name === name)!;
const GROUPS = ['couch-co-op'];

/** `count` idle agents wandering for `minutes`; returns each update's events. */
function busy(count: number, seed: number, minutes = 90) {
  const o = office(count, seed);
  for (let n = 1; n <= count; n++) o.set(n, 'done');
  o.run(minutes * 60);
  const updates = new Map<number, ReturnType<typeof o.c.update>>();
  for (const { t, event } of o.log) updates.set(t, [...(updates.get(t) ?? []), event]);
  return [...updates.values()];
}

/** Runs until at least `players` agents have arrived at `name`; returns their keys. */
function untilGroup(o: ReturnType<typeof office>, name: string, players: number) {
  for (let i = 0; i < 4 * 60 * 60 * 4; i++) {
    o.run(0.25);
    const at = [...o.c.agents].filter(([, a]) => a.place?.spot === name);
    if (at.length >= players && at.every(([, a]) => a.arrivesAt <= o.clock.t)) return at.map(([k]) => k);
  }
  return [];
}
const n = (key: string) => Number(key.replace('session-', ''));

// #89 reverses #32 here: the pool dip is no longer a group game; each idle agent takes a free ring on its own.
describe('#32 AC1 pool dip', () => {
  it('#32 AC1 (#89) four rings, one agent per ring, each floating, each getting in on its own', () => {
    expect(spot('pool-dip').places).toHaveLength(4);
    expect(spot('pool-dip').places.map((p) => p.pose)).toEqual(['floating', 'floating', 'floating', 'floating']);
    const o = office(8, 2);
    for (let n = 1; n <= 8; n++) o.set(n, 'done');
    let shared = 0;
    o.run(90 * 60, 0.25, () => {
      const swimmers = [...o.c.agents.values()].filter((a) => a.place?.spot === 'pool-dip');
      expect(new Set(swimmers.map((a) => a.place)).size, 'one per ring').toBe(swimmers.length);
      if (swimmers.length >= 2) shared++;
    });
    const dips = ofType(o.log.map((l) => l.event), 'walk').filter((w) => w.place?.spot === 'pool-dip');
    expect(dips.length).toBeGreaterThan(0);
    expect(shared, 'swimmers share the pool now and then').toBeGreaterThan(0);
  });

  it('#32 AC1 (#89) two idle agents can each take a dip on their own', () => {
    const walks = busy(2, 5, 180).flatMap((events) => ofType(events, 'walk'));
    expect(walks.filter((w) => w.place?.spot === 'pool-dip').length).toBeGreaterThan(0);
  });
});

describe('#32 AC2 couch co-op', () => {
  it('#32 AC2 (#112) starts with 2–3 idle agents, seated on the sofa facing the TV', () => {
    const places = spot('couch-co-op').places;
    expect(places).toHaveLength(3);
    const tv = START.lounge.tv;
    for (const p of places) {
      expect(p.sits).toBe(true);
      expect(p.pose).toBe('gaming');
      const toTv = Math.atan2(tv.x - p.x, tv.z - p.z);
      expect(Math.cos(p.yaw - toTv)).toBeGreaterThan(Math.cos(Math.PI / 4));
    }
    // #89: players are called one at a time, so count who's on the sofa rather than walks in one update.
    const o = office(8, 2);
    for (let n = 1; n <= 8; n++) o.set(n, 'done');
    let games = 0;
    o.run(90 * 60, 0.25, () => {
      const players = [...o.c.agents.values()].filter((a) => a.place?.spot === 'couch-co-op');
      if (!players.length) return;
      expect(players.length).toBeLessThanOrEqual(3);
      if (players.length === 1) expect(players[0].chained, 'a lone player is on its way out').toBe(true);
      else games++;
    });
    expect(games).toBeGreaterThan(0);
  });

  it('#32 AC2 a player on the sofa holds a controller', () => {
    const character = new Character(lookFor('session-1'));
    character.placeAt(START.seats[0], 'done', spot('couch-co-op').places[0]);
    character.update(1, 0.016);
    const [controller] = find(character.root, 'controller');
    expect(controller).toBeDefined();
    let visible = true;
    for (let o: THREE.Object3D | null = controller; o; o = o.parent) visible &&= o.visible;
    expect(visible).toBe(true);

    character.placeAt(START.seats[0], 'done', spot('kitchen').places[0]);
    character.update(2, 0.016);
    expect(controller.visible).toBe(false);
  });

  it('#32 AC2 nobody lounges on the sofa during a game, and no game starts while someone lounges there', () => {
    const o = office(8, 2);
    for (let i = 1; i <= 8; i++) o.set(i, 'done');
    let games = 0;
    o.run(90 * 60, 0.25, () => {
      const on = (name: string) => [...o.c.agents.values()].filter((a) => a.place?.spot === name).length;
      if (on('couch-co-op')) games++;
      expect(on('couch-co-op') === 0 || on('lounge') === 0).toBe(true);
    });
    expect(games).toBeGreaterThan(0);
  });
});

describe('#32 AC3 called back to work', () => {
  for (const name of GROUPS) {
    it(`#32 AC3 ${name}: the others keep going while 2 remain, then the last player moves on`, () => {
      const o = office(8, 2);
      for (let i = 1; i <= 8; i++) o.set(i, 'done');
      const players = untilGroup(o, name, 2);
      expect(players.length, 'the activity happened').toBeGreaterThanOrEqual(2);
      const remaining = [...players];
      while (remaining.length > 2) {
        const events = o.set(n(remaining.pop()!), 'working');
        for (const k of remaining) expect(ofType(events, 'walk').filter((w) => w.key === k), `${k} keeps playing`).toEqual([]);
      }
      const [last] = remaining.splice(1, 1);
      const events = o.set(n(remaining[0]), 'working');
      // #89: the last player follows 1–4 s later.
      expect(ofType(events, 'walk').find((w) => w.key === last), 'not at once').toBeUndefined();
      const moveOn = ofType(o.run(4.05, 0.05), 'walk').find((w) => w.key === last)!;
      expect(moveOn, 'the last player moves on').toBeDefined();
      expect(moveOn.place?.spot).not.toBe(name);
      // Only this game's players: others may start a new game on the free sofa straight away (#112).
      expect(players.filter((k) => o.c.agents.get(k)?.place?.spot === name)).toEqual([]);
    });
  }
});

describe('#32 AC4 the pool and the TV', () => {
  const { group } = buildOffice(INITIAL_ROWS);
  const boxOf = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o);
  const within = (p: { x: number; z: number }, box: THREE.Box3) =>
    p.x > box.min.x && p.x < box.max.x && p.z > box.min.z && p.z < box.max.z;

  it('#32 AC4 the pool is tagged and has 4 tagged rings; each pool-dip place is in a ring inside the pool', () => {
    const [pool, ...more] = find(group, 'pool');
    expect(more).toEqual([]);
    const rings = find(group, 'pool-ring');
    expect(rings).toHaveLength(4);
    for (const r of rings) expect(within(boxOf(r).getCenter(new THREE.Vector3()), boxOf(pool))).toBe(true);
    for (const p of spot('pool-dip').places) {
      expect(within(p, boxOf(pool)), `${p.x}, ${p.z}`).toBe(true);
      expect(rings.some((r) => within(p, boxOf(r))), `ring at ${p.x}, ${p.z}`).toBe(true);
    }
  });

  it('#32 AC4 the TV is tagged; each co-op place is on the sofa', () => {
    expect(find(group, 'tv')).toHaveLength(1);
    const sofa = boxOf(find(group, 'sofa')[0]);
    for (const p of spot('couch-co-op').places) expect(within(p, sofa), `${p.x}, ${p.z}`).toBe(true);
  });
});
