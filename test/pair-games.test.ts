import { describe, expect, it } from 'vitest';
import { INITIAL_ROWS, officeLayout } from '../src/client/layout.ts';
import { buildOffice } from '../src/client/office.ts';
import { centre, distance, find, ofType, office, plan, rec, seeded } from './office-sim.ts';

const START = officeLayout(INITIAL_ROWS);
const spot = (name: string) => START.hangouts.find((s) => s.name === name)!;

const GAMES = [
  { spot: 'pool-table', prop: 'pool-table', at: plan(16.4, 6.6), poses: ['cue-shot', 'cue-wait'] },
  { spot: 'ping-pong', prop: 'ping-pong-table', at: plan(15.3, 13.7), poses: ['paddle', 'paddle'] },
] as const;
const isGame = (name: string | undefined) => GAMES.some((g) => g.spot === name);

/** `count` idle agents wandering for `minutes`; returns each update's events. */
function busyBreakRoom(count: number, seed: number, minutes = 60) {
  const o = office(count, seed);
  for (let n = 1; n <= count; n++) o.set(n, n % 2 ? 'done' : 'finished');
  o.run(minutes * 60);
  const updates = new Map<number, ReturnType<typeof o.c.update>>();
  for (const { t, event } of o.log) updates.set(t, [...(updates.get(t) ?? []), event]);
  return { o, updates: [...updates.values()] };
}

/** Runs until both players of a game at `spotName` have arrived; returns their keys. */
function untilGame(o: ReturnType<typeof office>, spotName: string) {
  for (let i = 0; i < 4 * 60 * 60 * 4; i++) {
    o.run(0.25);
    const at = [...o.c.agents].filter(([, a]) => a.place?.spot === spotName && a.arrivesAt <= o.clock.t);
    if (at.length === 2) return at.map(([k]) => k);
  }
  return [];
}

describe('#31 AC1 pair games start with two free idle agents', () => {
  it('#31 AC1 both players are sent to the two ends of the table (#89: the second 1–4 s after the first), and both games get played', () => {
    const { o } = busyBreakRoom(6, 8);
    const started = new Set<string>();
    const at = new Map<string, string | undefined>();
    const joins = new Map<string, { t: number; key: string; place: unknown }[]>();
    for (const { t, event: w } of o.log) {
      if (w.type !== 'walk') continue;
      // #53: pool players change places at the table every turn; only walks from elsewhere start a game.
      if (isGame(w.place?.spot) && at.get(w.key) !== w.place!.spot) joins.set(w.place!.spot, [...(joins.get(w.place!.spot) ?? []), { t, key: w.key, place: w.place }]);
      at.set(w.key, w.place?.spot);
    }
    for (const g of GAMES) {
      const all = joins.get(g.spot) ?? [];
      for (let i = 0; i + 1 < all.length; i += 2) {
        const [a, b] = [all[i], all[i + 1]];
        expect(b.t - a.t, g.spot).toBeGreaterThanOrEqual(1);
        expect(b.t - a.t, g.spot).toBeLessThanOrEqual(4);
        expect(a.key).not.toBe(b.key);
        expect(new Set([a.place, b.place])).toEqual(new Set(spot(g.spot).places));
        started.add(g.spot);
      }
    }
    expect([...started].sort()).toEqual(GAMES.map((g) => g.spot).sort());
  });
});

describe('#31 AC2 no game with one agent', () => {
  it('#31 AC2 a lone idle agent never goes to a game table', () => {
    const { o } = busyBreakRoom(1, 3, 120);
    const walks = ofType(o.log.map((l) => l.event), 'walk');
    expect(walks.length).toBeGreaterThan(100);
    expect(walks.filter((w) => isGame(w.place?.spot))).toEqual([]);
  });

  it('#31 AC2 agents already idle when the page opens are never placed at a table', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const o = office(0, seed);
      const events = o.c.update([1, 2, 3, 4, 5].map((n) => rec(n, 'done')));
      expect(ofType(events, 'arrive').filter((a) => isGame(a.place?.spot)), `seed ${seed}`).toEqual([]);
    }
  });

  it('#31 AC2 at every moment, each table has 0 or 2 players (#89: or 1 just leaving after the other)', () => {
    const o = office(5, 12);
    for (let n = 1; n <= 5; n++) o.set(n, 'done');
    const random = seeded(5);
    let played = 0;
    o.run(60 * 60, 0.25, () => {
      if (random() < 0.01) o.set(1 + Math.floor(random() * 5), random() < 0.5 ? 'working' : 'done');
      for (const g of GAMES) {
        const players = [...o.c.agents.values()].filter((a) => a.place?.spot === g.spot), n = players.length;
        expect([0, 1, 2], g.spot).toContain(n);
        if (n === 1) expect(players[0].chained, `${g.spot}: a lone player is on its way out`).toBe(true);
        if (n) played++;
      }
    });
    expect(played).toBeGreaterThan(0);
  });
});

describe('#31 AC3 when one player goes back to work, the game ends', () => {
  for (const g of GAMES) {
    it(`#31 AC3 ${g.spot}: the other player leaves 1–4 s later (#89) and goes on wandering`, () => {
      const o = office(6, 8);
      for (let n = 1; n <= 6; n++) o.set(n, 'done');
      const [first, second] = untilGame(o, g.spot);
      expect(second, 'a game was played').toBeDefined();
      const events = o.set(Number(first.replace('session-', '')), 'working');
      expect(ofType(events, 'walk').find((w) => w.key === first)!.place).toBeNull();
      expect(ofType(events, 'walk').find((w) => w.key === second), 'not at once').toBeUndefined();
      expect(ofType(o.run(0.95, 0.05), 'walk').find((w) => w.key === second), 'not within 1 s').toBeUndefined();
      const other = ofType(o.run(3.05, 0.05), 'walk').find((w) => w.key === second)!;
      expect(other.place).not.toBeNull();
      expect(other.place!.spot).not.toBe(g.spot);
      expect(o.c.agents.get(second)!.nextAt).not.toBeNull();
    });
  }
});

describe('#31 AC4 tables and poses', () => {
  const { group } = buildOffice(INITIAL_ROWS);
  for (const g of GAMES) {
    it(`#31 AC4 ${g.spot}: a tagged ${g.prop} at its plan C position, and a pose per player`, () => {
      const [table, ...more] = find(group, g.prop);
      expect(more).toEqual([]);
      expect(distance(centre(table), g.at)).toBeLessThan(0.35);
      expect(spot(g.spot).places.map((p) => p.pose)).toEqual(g.poses);
    });
  }
});
