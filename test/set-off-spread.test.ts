import { describe, expect, it } from 'vitest';
import { INITIAL_ROWS, officeLayout } from '../src/client/layout.ts';
import { OfficeController, type OfficeEvent } from '../src/client/controller.ts';
import { ofType, office, rec, seeded } from './office-sim.ts';

// #89: agents don't all move at once.

const SPOTS = officeLayout(INITIAL_ROWS).hangouts;
const together = (spot: string | undefined) => !!spot && SPOTS.some((s) => s.name === spot && (s.game || s.chat));
const STEP = 0.05;
const REACTIONS = ['high-five', 'coffee-delivery', 'over-the-shoulder'];

interface SetOff { t: number; key: string; from?: string; to?: string; kind: 'solo' | 'join' | 'leave' }

/** Every walk that sets an agent off, by kind: on its own, into a chat or game, or out of one. */
function setOffs(log: { t: number; event: OfficeEvent }[]): SetOff[] {
  const at = new Map<string, string | undefined>();
  return log.flatMap(({ t, event }) => {
    if (event.type === 'arrive') at.set(event.key, event.place?.spot);
    if (event.type !== 'walk') return [];
    const from = at.get(event.key), to = event.place?.spot;
    at.set(event.key, to);
    if (from && from === to) return []; // a step at the same table (#53)
    const kind = together(to) ? 'join' : together(from) ? 'leave' : 'solo';
    return [{ t, key: event.key, from, to, kind }];
  });
}

/** Each chat or game, from its first player setting off for it until its last player has left: the join and leave times. */
function episodes(offs: SetOff[]) {
  const players = new Map<string, Set<string>>();
  const open = new Map<string, { spot: string; joins: number[]; leaves: number[] }>();
  const done: { spot: string; joins: number[]; leaves: number[] }[] = [];
  for (const o of offs) {
    if (o.from && together(o.from)) {
      players.get(o.from)?.delete(o.key);
      const ep = open.get(o.from);
      if (ep) {
        ep.leaves.push(o.t);
        if (!players.get(o.from)!.size) { done.push(ep); open.delete(o.from); }
      }
    }
    if (o.to && together(o.to)) {
      if (!open.has(o.to)) open.set(o.to, { spot: o.to, joins: [], leaves: [] });
      open.get(o.to)!.joins.push(o.t);
      players.set(o.to, (players.get(o.to) ?? new Set()).add(o.key));
    }
  }
  return done;
}

/** `count` agents idle since the page opened, for `minutes`, ticking every STEP; `each` runs after every tick. */
function idle(count: number, seed: number, minutes: number, each?: (o: ReturnType<typeof office>) => void) {
  const o = office(count, seed, 'done');
  // Where each was found when the page opened.
  for (const [key, a] of o.c.agents) o.log.push({ t: 0, event: { type: 'arrive', key, record: a.record, seat: a.seat, path: [], walk: false, place: a.place } });
  o.run(minutes * 60, STEP, () => each?.(o));
  return o;
}

const gaps = (ts: number[]) => ts.slice(1).map((t, i) => t - ts[i]);
const SEEDS = [1, 2, 3];
const runs = new Map(SEEDS.map((seed) => [seed, idle(15, seed, 10)]));

describe('#89 AC1 agents setting off on their own are at least 2 s apart', () => {
  it('#89 AC1 over 10 minutes with 15 idle agents, solo set-offs never come within 2 s of each other', () => {
    for (const [seed, o] of runs) {
      // Reactions to another agent's state change (#33) are sent at once, not on the agent's own time.
      const solo = setOffs(o.log).filter((s) => s.kind === 'solo' && !REACTIONS.includes(s.to!));
      expect(solo.length, `seed ${seed}`).toBeGreaterThan(50);
      gaps(solo.map((s) => s.t)).forEach((g, i) => expect(g, `seed ${seed}: ${solo[i].key} then ${solo[i + 1].key} at ${solo[i + 1].t.toFixed(2)}`).toBeGreaterThanOrEqual(2 - 1e-6));
    }
  });
});

describe('#89 AC2 partners set off one at a time and the activity starts once all have arrived', () => {
  it('#89 AC2 players of a chat or game set off for it 1–4 s apart', () => {
    for (const [seed, o] of runs) {
      const eps = episodes(setOffs(o.log)).filter((e) => e.joins.length >= 2);
      expect(eps.length, `seed ${seed}`).toBeGreaterThan(3);
      for (const e of eps) for (const g of gaps(e.joins)) {
        expect(g, `seed ${seed} ${e.spot} ${e.joins.map((t) => t.toFixed(2))}`).toBeGreaterThanOrEqual(1);
        expect(g, `seed ${seed} ${e.spot} ${e.joins.map((t) => t.toFixed(2))}`).toBeLessThanOrEqual(4 + STEP);
      }
    }
  });

  it('#89 AC2 a chat or game runs its stay from when its last player arrives', () => {
    let checked = 0;
    idle(15, 4, 10, (o) => {
      const bySpot = new Map<string, { arrivesAt: number; nextAt: number | null }[]>();
      for (const a of o.c.agents.values()) if (together(a.place?.spot)) bySpot.set(a.place!.spot, [...(bySpot.get(a.place!.spot) ?? []), a]);
      for (const [spot, players] of bySpot) {
        // Pool players walk to each turn's spot at the table (#53): those are steps, not arrivals.
        if (players.length < 2 || spot === 'pool-table') continue;
        const last = Math.max(...players.map((a) => a.arrivesAt));
        for (const a of players) if (a.nextAt != null) { checked++; expect(a.nextAt, spot).toBeGreaterThanOrEqual(last + 10 - 1e-6); }
      }
    });
    expect(checked).toBeGreaterThan(0);
  });

  it('#89 AC2 pool and table tennis only start once both players have arrived', () => {
    let starts = 0, seen = 0;
    const playing = new Set<string>();
    idle(15, 5, 10, (o) => {
      for (const { event } of o.log.slice(seen)) {
        if (event.type !== 'pool' && event.type !== 'pong') continue;
        const spot = event.type === 'pool' ? 'pool-table' : 'ping-pong';
        const on = event.type === 'pool' ? event.shot != null : event.rally != null;
        if (!on) { playing.delete(spot); continue; }
        if (playing.has(spot)) continue;
        playing.add(spot);
        starts++;
        for (const a of o.c.agents.values()) if (a.place?.spot === spot) expect(a.arrivesAt, spot).toBeLessThanOrEqual(o.clock.t);
      }
      seen = o.log.length;
    });
    expect(starts).toBeGreaterThan(0);
  });
});

describe('#89 AC3 players leave an ended chat or game 1–4 s apart', () => {
  it('#89 AC3 the players of each chat or game leave one at a time, 1–4 s apart', () => {
    for (const [seed, o] of runs) {
      const eps = episodes(setOffs(o.log)).filter((e) => e.leaves.length >= 2);
      expect(eps.length, `seed ${seed}`).toBeGreaterThan(3);
      for (const e of eps) for (const g of gaps(e.leaves)) {
        expect(g, `seed ${seed} ${e.spot} ${e.leaves.map((t) => t.toFixed(2))}`).toBeGreaterThanOrEqual(1);
        expect(g, `seed ${seed} ${e.spot} ${e.leaves.map((t) => t.toFixed(2))}`).toBeLessThanOrEqual(4 + STEP);
      }
    }
  });
});

describe('#89 AC4 no waves of agents setting off', () => {
  it('#89 AC4 in 10 minutes with 15 idle agents, no 2 s window has more than 2 agents setting off', () => {
    for (const [seed, o] of runs) {
      const times = setOffs(o.log).map((s) => s.t);
      for (const t of times) {
        const window = times.filter((u) => u >= t && u <= t + 2);
        expect(window.length, `seed ${seed} at ${t.toFixed(2)}`).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('#89 AC5 stays and waits for a slot', () => {
  it('#89 AC5 stays at a spot average 10–30 s, and nobody waits more than 10 s past its stay to set off', () => {
    for (const seed of SEEDS) {
      let longestWait = 0, seen = 0;
      const stays: number[] = [];
      // Where each agent is headed and when it gets there, as of its latest walk.
      const at = new Map<string, { spot?: string; arrives: number }>();
      idle(15, seed, 10, (sim) => {
        const t = sim.clock.t;
        // Waiting at a spot after its stay is up (not at the desk: the first set-offs after turning idle queue up).
        for (const a of sim.c.agents.values()) if (a.place && a.nextAt != null && a.nextAt <= t) longestWait = Math.max(longestWait, t - a.nextAt);
        for (const { event } of sim.log.slice(seen)) {
          if (event.type !== 'walk') continue;
          const was = at.get(event.key);
          if (was?.spot && was.spot !== event.place?.spot && t > was.arrives) {
            stays.push(t - was.arrives);
            // At a solo place, any wait for a slot shows in the stay itself (a chat or game waits for its last player).
            if (!together(was.spot)) expect(t - was.arrives, `seed ${seed} ${event.key} at ${was.spot}`).toBeLessThanOrEqual(30 + 10);
          }
          at.set(event.key, { spot: event.place?.spot, arrives: sim.c.agents.get(event.key)!.arrivesAt });
        }
        seen = sim.log.length;
      });
      expect(longestWait, `seed ${seed}`).toBeLessThanOrEqual(10);
      expect(stays.length, `seed ${seed}`).toBeGreaterThan(50);
      const mean = stays.reduce((s, x) => s + x, 0) / stays.length;
      expect(mean, `seed ${seed}`).toBeGreaterThanOrEqual(10);
      expect(mean, `seed ${seed}`).toBeLessThanOrEqual(30);
    }
  });
});

describe('#89 AC6 the pool dip is for one', () => {
  it('#89 AC6 the pool dip is not a group game', () => {
    const dip = SPOTS.find((s) => s.name === 'pool-dip')!;
    expect(dip.game).toBeUndefined();
    expect(dip.chat).toBe(false);
  });

  it('#89 AC6 a single idle agent takes a free ring on its own', () => {
    const o = office(1, 3);
    o.set(1, 'done');
    for (let i = 0; i < 4 * 60 * 60 && !ofType(o.log.map((l) => l.event), 'walk').some((w) => w.place?.spot === 'pool-dip'); i++) o.run(1);
    const walk = ofType(o.log.map((l) => l.event), 'walk').find((w) => w.place?.spot === 'pool-dip');
    expect(walk, 'went for a dip').toBeDefined();
  });

  it('#89 AC6 an agent found in a pool dip on first load drifts like any swimmer', () => {
    let found = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const c = new OfficeController({ now: () => 0, random: seeded(seed) });
      const events = c.update(Array.from({ length: 15 }, (_, i) => rec(i + 1, 'done')));
      const swimmers = ofType(events, 'arrive').filter((a) => a.place?.pose === 'floating').map((a) => a.key);
      found += swimmers.length;
      expect(ofType(events, 'drift').map((d) => d.key).sort(), `seed ${seed}`).toEqual(swimmers.sort());
    }
    expect(found).toBeGreaterThan(0);
  });

  it('#89 AC6 each swimmer arrives and leaves on its own timer', () => {
    let together = 0;
    const o = idle(15, 2, 10, (sim) => {
      const swimmers = [...sim.c.agents.values()].filter((a) => a.place?.spot === 'pool-dip');
      if (swimmers.length >= 2) together++;
      for (const a of swimmers) expect(a.chained, 'not led out by another swimmer').toBeFalsy();
      const ends = swimmers.map((a) => a.nextAt).filter((t) => t != null);
      expect(new Set(ends).size, 'own leaving times').toBe(ends.length);
    });
    expect(together, 'swimmers shared the pool').toBeGreaterThan(0);
    const dips = setOffs(o.log).filter((s) => s.to === 'pool-dip' || s.from === 'pool-dip');
    gaps(dips.map((s) => s.t)).forEach((g) => expect(g).toBeGreaterThanOrEqual(1));
  });
});
