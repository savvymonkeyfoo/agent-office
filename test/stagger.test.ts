import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { OfficeController, type OfficeEvent } from '../src/client/controller.ts';
import { INITIAL_ROWS, officeLayout } from '../src/client/layout.ts';
import { ofType, office, rec, seeded } from './office-sim.ts';

const SPOTS = officeLayout(INITIAL_ROWS).hangouts;
const together = (spot: string | undefined) => !!spot && SPOTS.some((s) => s.name === spot && (s.game || s.chat));

/**
 * Walk events by time, each with the pair or group (a game or chat) it starts or leaves. Steps within
 * an activity (pool players changing places at the table, #53) aren't setting off, and are left out.
 */
function walksWithGroups(log: { t: number; event: OfficeEvent }[]) {
  const at = new Map<string, string | undefined>();
  return log.flatMap(({ t, event }) => {
    if (event.type !== 'walk') return [];
    const from = at.get(event.key), to = event.place?.spot;
    at.set(event.key, to);
    if (from && from === to) return [];
    const groups = [together(from) && `${from}@${t}`, together(to) && `${to}@${t}`].filter((g): g is string => !!g);
    return [{ t, key: event.key, groups: groups.length ? groups : [event.key] }];
  });
}

/** How many separate pairs, groups or lone agents a set of walks comes from (walks sharing a group are one). */
function setOffs(walks: { groups: string[] }[]) {
  const parent = new Map<string, string>();
  const find = (g: string): string => { const p = parent.get(g) ?? g; return p === g ? g : find(p); };
  for (const w of walks) for (const g of w.groups) { if (!parent.has(g)) parent.set(g, g); parent.set(find(g), find(w.groups[0])); }
  return new Set(walks.map((w) => find(w.groups[0]))).size;
}

describe('#59 AC1 no fixed idle delays', () => {
  it('#59 AC1 retries, errands and first throws use random ranges, not fixed seconds', () => {
    const source = readFileSync('src/client/controller.ts', 'utf8');
    for (const name of ['RETRY', 'ERRAND_STAY', 'PLANE_FIRST']) {
      expect(source, name).toMatch(new RegExp(`const ${name} = \\{ min: [\\d.]+, max: [\\d.]+ \\};`));
    }
    expect(source).toMatch(/const RETRY = \{ min: 3, max: 8 \};/);
  });

  it('#59 AC1 agents that find every spot full together don\'t retry together', () => {
    // More idle agents than there are places: some find nothing free and retry.
    const o = office(40, 3);
    for (let n = 1; n <= 40; n++) o.set(n, 'done');
    o.run(120, 0.05);
    const retried = [...o.c.agents.values()].filter((a) => !a.place && a.nextAt != null).map((a) => a.nextAt!).sort((a, b) => a - b);
    expect(retried.length).toBeGreaterThan(2);
    retried.forEach((t, i) => { if (i) expect(t - retried[i - 1]).toBeGreaterThanOrEqual(0.3); });
  });
});

describe('#59 AC2 agents idle in the same update set off spread out', () => {
  it('#59 AC2 12 agents turning idle together set off over at least 6 s, never within 0.3 s of each other', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const o = office(12, seed);
      const from = o.log.length;
      const start = o.clock.t;
      // All twelve in one update.
      o.log.push(...o.c.update(Array.from({ length: 12 }, (_, i) => rec(i + 1, i % 2 ? 'done' : 'finished'))).map((event) => ({ t: start, event })));
      o.run(40, 0.01);
      const firstWalk = new Map<string, number>();
      for (const { t, event } of o.log.slice(from)) if (event.type === 'walk' && !firstWalk.has(event.key)) firstWalk.set(event.key, t);
      const times = [...firstWalk.values()].sort((a, b) => a - b);
      expect(times.length, `seed ${seed}`).toBe(12);
      expect(times.at(-1)! - times[0], `seed ${seed}`).toBeGreaterThanOrEqual(6);
      times.forEach((t, i) => { if (i) expect(t - times[i - 1], `seed ${seed}: ${times.map((x) => x.toFixed(2))}`).toBeGreaterThanOrEqual(0.3); });
    }
  });


  it('#59 AC2 on first load, 12 idle agents\' first moves are spread over at least 6 s, never within 0.3 s', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const c = new OfficeController({ now: () => 0, random: seeded(seed) });
      c.update(Array.from({ length: 12 }, (_, i) => rec(i + 1, 'done')));
      const times = [...c.agents.values()].map((a) => a.nextAt).filter((t): t is number => t != null).sort((a, b) => a - b);
      expect(times.length, `seed ${seed}`).toBeGreaterThanOrEqual(10);
      expect(times.at(-1)! - times[0]).toBeGreaterThanOrEqual(6);
      times.forEach((t, i) => { if (i) expect(t - times[i - 1], `seed ${seed}`).toBeGreaterThanOrEqual(0.3); });
    }
  });
});

describe('#59 AC3 no crowds setting off at once', () => {
  it('#59 AC3 over 10 minutes with 20 idle agents, at most 2 unrelated agents start walking in any 0.3 s', () => {
    for (const seed of [7, 8]) {
      const o = office(20, seed);
      for (let n = 1; n <= 20; n++) o.set(n, n % 3 ? 'done' : 'finished');
      const from = o.log.length;
      o.run(10 * 60, 0.05);
      const walks = walksWithGroups(o.log);
      const later = walks.filter((w) => w.t > o.log[from - 1].t + 15); // after the first set-offs
      expect(later.length).toBeGreaterThan(100);
      for (const w of later) {
        const window = later.filter((v) => v.t >= w.t && v.t < w.t + 0.3);
        expect(setOffs(window), `seed ${seed} at ${w.t.toFixed(2)}: ${window.map((v) => `${v.key}:${v.groups}`).join(', ')}`).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('#59 AC4 pairs and groups still end together', () => {
  it('#59 AC4 the players of a game all get the same end time, then leave one after another (#89)', () => {
    const o = office(8, 2);
    for (let n = 1; n <= 8; n++) o.set(n, 'done');
    let games = 0;
    o.run(30 * 60, 0.25, () => {
      const bySpot = new Map<string, number[]>();
      for (const a of o.c.agents.values()) {
        const spot = SPOTS.find((s) => s.name === a.place?.spot);
        // #89: once the first has gone, the rest follow 1–4 s apart (see set-off-spread.test.ts).
        if (spot?.game && a.nextAt != null && !a.chained) bySpot.set(spot.name, [...(bySpot.get(spot.name) ?? []), a.nextAt]);
      }
      for (const [, ends] of bySpot) {
        if (ends.length < 2) continue;
        games++;
        expect(new Set(ends).size).toBe(1);
      }
    });
    expect(games).toBeGreaterThan(0);
    expect(ofType(o.log.map((l) => l.event), 'walk').length).toBeGreaterThan(0);
  });
});
