import { describe, expect, it } from 'vitest';
import { OfficeController, type OfficeEvent } from '../src/client/controller.ts';
import {
  arrivalPath, behindChair, departurePath, fetchRun, officeLayout, overTheShoulder, route, type Area, type Point,
} from '../src/client/layout.ts';
import { heightAt, type ControlRoomLayout } from '../src/client/control-room.ts';
import { rec, seeded } from './office-sim.ts';
import { problems } from './geometry.ts';

const plan = (tiers: number) => officeLayout(tiers, 'control-room') as ControlRoomLayout;
const forward = (yaw: number) => ({ x: Math.sin(yaw), z: Math.cos(yaw) });
const within = (p: Point, a: Area) => p.x >= a.x0 && p.x <= a.x1 && p.z >= a.z0 && p.z <= a.z1;

describe('#100 AC1 3 tiers of 6 consoles, every seat facing the screen wall, each tier higher', () => {
  const layout = plan(3);

  it('#100 AC1 it starts with 3 tiers of 6 seats (also from the controller)', () => {
    expect(layout.preset).toBe('control-room');
    expect(layout.tiers).toHaveLength(3);
    expect(layout.seats).toHaveLength(18);
    expect([0, 1, 2].map((t) => layout.seats.filter((s) => s.row === t).length)).toEqual([6, 6, 6]);
    expect(new OfficeController({}, 'control-room').layout.seats).toHaveLength(18);
  });

  it('#100 AC1 every seated agent faces the screen wall, along a line through the tiers\' centre', () => {
    const { focus, z: wallZ } = layout.screenWall;
    for (const seat of layout.seats) {
      const f = forward(seat.yaw);
      const toFocus = { x: focus.x - seat.chair.x, z: focus.z - seat.chair.z };
      expect((f.x * toFocus.x + f.z * toFocus.z) / Math.hypot(toFocus.x, toFocus.z), `seat ${seat.index}`).toBeCloseTo(1, 6);
      // The facing line reaches the screen wall inside the room, and the desk is in front of the chair.
      const t = (wallZ - seat.chair.z) / f.z;
      expect(t).toBeGreaterThan(0);
      expect(Math.abs(seat.chair.x + f.x * t)).toBeLessThan(layout.bounds.right);
      expect(f.x * (seat.desk.x - seat.chair.x) + f.z * (seat.desk.z - seat.chair.z)).toBeGreaterThan(0.5);
    }
  });

  it('#100 AC1 each tier is higher than the one in front of it, and its seats stand on it', () => {
    const heights = layout.tiers.map((t) => t.height);
    expect(heights[0]).toBeGreaterThan(0);
    for (let t = 1; t < heights.length; t++) expect(heights[t]).toBeGreaterThan(heights[t - 1]);
    for (let t = 1; t < layout.tiers.length; t++) expect(layout.tiers[t].radius).toBeGreaterThan(layout.tiers[t - 1].radius);
    for (const seat of layout.seats) {
      for (const p of [seat.desk, seat.chair, seat.approach, seat.link.at(-1)!]) expect(heightAt(layout, p), `seat ${seat.index}`).toBe(heights[seat.row]);
    }
    expect(layout.crewLounge.height).toBeGreaterThan(heights.at(-1)!);
  });

  it('#100 AC1 each tier is one unbroken curve of 6 consoles, with no aisle through the middle', () => {
    for (const tiers of [3, 4]) {
      const { seats, consoles, screenWall: { focus } } = plan(tiers);
      for (let t = 0; t < tiers; t++) {
        const row = seats.filter((s) => s.row === t);
        for (let i = 0; i + 1 < row.length; i++) {
          const gap = Math.hypot(row[i + 1].desk.x - row[i].desk.x, row[i + 1].desk.z - row[i].desk.z) - consoles[0].w;
          expect(gap, `tier ${t}, consoles ${i} and ${i + 1}`).toBeLessThan(0.1);
          expect(gap).toBeGreaterThan(0);
        }
        // Centred on the line through the focus: three consoles either side.
        expect(row.filter((s) => s.desk.x < focus.x)).toHaveLength(3);
      }
    }
  });
});

describe('#100 AC2 a full room adds a 4th tier behind the 3rd and moves the lounge back', () => {
  const [three, four] = [plan(3), plan(4)];

  it('#100 AC2 the 4th tier is behind and above the 3rd; the first 18 seats stay put', () => {
    expect(four.tiers).toHaveLength(4);
    expect(four.seats).toHaveLength(24);
    expect(four.tiers[3].radius).toBeGreaterThan(four.tiers[2].radius);
    expect(four.tiers[3].height).toBeGreaterThan(four.tiers[2].height);
    expect(four.seats.slice(0, 18)).toEqual(three.seats);
  });

  it('#100 AC2 the lounge moves back so no tier overlaps it', () => {
    for (const layout of [three, four]) {
      const { crewLounge, tiers, screenWall: { focus } } = layout;
      expect(crewLounge.z0).toBeGreaterThanOrEqual(focus.z + tiers.at(-1)!.outer - 1e-9);
      for (const seat of layout.seats) for (const p of [seat.desk, seat.chair, ...seat.link]) expect(p.z).toBeLessThan(crewLounge.z0);
    }
    expect(four.crewLounge.z0).toBeGreaterThan(three.crewLounge.z0);
    // Everything in the lounge moves back with it, so the controller can match places by position in the list.
    const shift = four.crewLounge.z0 - three.crewLounge.z0;
    expect(four.hangouts.map((s) => [s.name, s.places.length])).toEqual(three.hangouts.map((s) => [s.name, s.places.length]));
    expect(four.dogSpots.map((s) => s.name)).toEqual(three.dogSpots.map((s) => s.name));
    three.hangouts.forEach((spot, i) => spot.places.forEach((p, j) => {
      const q = four.hangouts[i].places[j];
      expect(q.z - p.z, `${spot.name} ${j}`).toBeCloseTo(within(p, three.crewLounge) ? shift : 0, 6);
    }));
  });

  it('#100 AC2 the controller adds the 4th tier when the 19th agent arrives', () => {
    const c = new OfficeController({ now: () => 0 }, 'control-room');
    const events: OfficeEvent[] = c.update(Array.from({ length: 18 }, (_, i) => rec(i + 1)));
    expect(events.some((e) => e.type === 'rows')).toBe(false);
    const more = c.update(Array.from({ length: 19 }, (_, i) => rec(i + 1)));
    expect(more.filter((e) => e.type === 'rows')).toEqual([{ type: 'rows', count: 4 }]);
    expect(c.layout.seats).toHaveLength(24);
    expect(c.layout).toEqual(four);
  });

  it('#100 AC2 an agent with the dog in the lounge when the tier is added moves back with it, and walks on from there', () => {
    let tried = 0;
    for (let seed = 1; seed < 400 && tried < 2; seed++) {
      const clock = { t: 0 };
      const c = new OfficeController({ now: () => clock.t, random: seeded(seed) }, 'control-room');
      const records = Array.from({ length: 18 }, (_, i) => rec(i + 1, 'done'));
      c.update(records);
      const lounge = () => (c.layout as ControlRoomLayout).crewLounge;
      const withDog = (events: OfficeEvent[]) => events.find((e) => e.type === 'walk' && e.place?.spot === 'dog' && e.place.z > lounge().z0);
      let visit: OfficeEvent | undefined;
      for (; clock.t < 300 && !visit; clock.t += 0.25) visit = withDog(c.tick());
      if (!visit || visit.type !== 'walk') continue;
      tried++;
      clock.t += 30; // there by now
      const events = c.update([...records, rec(19)]);
      const moved = events.find((e) => e.type === 'place' && e.key === visit.key);
      expect(moved && moved.type === 'place' && moved.place, `seed ${seed}`).toBeTruthy();
      if (moved?.type !== 'place' || !moved.place) continue;
      expect(moved.place.z, `seed ${seed}: in the moved lounge`).toBeGreaterThan(lounge().z0);
      for (let i = 0; i < 400; i++, clock.t += 0.25) {
        for (const e of c.tick()) if (e.type === 'walk') expect(problems(c.layout as ControlRoomLayout, e.path), `seed ${seed}`).toEqual([]);
      }
    }
    expect(tried).toBe(2);
  });

  it('#100 AC2 agents in the lounge mid-game when the tier is added carry on there, moved back', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const clock = { t: 0 };
      const c = new OfficeController({ now: () => clock.t, random: seeded(seed) }, 'control-room');
      const records = Array.from({ length: 18 }, (_, i) => rec(i + 1, i < 14 ? 'done' : 'working'));
      c.update(records);
      let shots = 0;
      for (; clock.t < 400 && shots < 3; clock.t += 0.25) shots += c.tick().filter((e) => e.type === 'pool').length;
      const events = c.update([...records, rec(19)]);
      for (; clock.t < 900; clock.t += 0.25) events.push(...c.tick());
      const lounge = c.layout as ControlRoomLayout;
      for (const e of events) {
        if (e.type !== 'walk') continue;
        for (const p of e.path) expect(p.z < lounge.crewLounge.z0 || p.z > lounge.crewLounge.z0 + 0.3 || lounge.steps.some((st) => p.x >= st.x0 && p.x <= st.x1), `seed ${seed}: (${p.x}, ${p.z}) by the rail`).toBe(true);
        expect(problems(lounge, e.path), `seed ${seed}`).toEqual([]);
      }
    }
  });
});

describe('#100 AC3 everything can be reached from the entrance, only over steps', () => {
  for (const tiers of [3, 4]) {
    const layout = plan(tiers);

    it(`#100 AC3 (${tiers} tiers) every seat, and the spot behind it`, () => {
      for (const seat of layout.seats) {
        expect(problems(layout, arrivalPath(layout, seat)), `seat ${seat.index}`).toEqual([]);
        expect(problems(layout, route(layout, layout.doorLink, behindChair(layout, seat))), `behind seat ${seat.index}`).toEqual([]);
      }
    });

    it(`#100 AC3 (${tiers} tiers) every activity spot`, () => {
      for (const spot of layout.hangouts) {
        for (const place of spot.places) expect(problems(layout, route(layout, layout.doorLink, place.link)), spot.name).toEqual([]);
      }
      for (const turn of layout.poolTurns) {
        for (const place of [turn.shoot, turn.wait]) expect(problems(layout, route(layout, layout.doorLink, place.link)), 'pool turn').toEqual([]);
      }
    });

    it(`#100 AC3 (${tiers} tiers) every dog spot, its visitors and its fetch run`, () => {
      for (const spot of layout.dogSpots) {
        expect(problems(layout, route(layout, layout.doorLink, spot.link)), spot.name).toEqual([]);
        expect(problems(layout, fetchRun(layout, spot)), `${spot.name} fetch`).toEqual([]);
        for (const v of spot.visitors) expect(problems(layout, route(layout, layout.doorLink, v.link)), `${spot.name} visitor`).toEqual([]);
      }
    });

    it(`#100 AC3 (${tiers} tiers) every walkway`, () => {
      for (const walkway of layout.walkways) expect(problems(layout, walkway)).toEqual([]);
    });
  }

  for (const tiers of [3, 4]) {
    it(`#100 AC3 (${tiers} tiers) a staircase up each end of the tiers, from the pit to the lounge; every tier's walkway opens onto both`, () => {
      const layout = plan(tiers);
      const { steps, tiers: rows, crewLounge, lanes, rail, room } = layout;
      expect(steps.map((s) => s.name)).toEqual(['left stairs', 'right stairs']);
      for (const s of steps) {
        const x = (s.x0 + s.x1) / 2;
        // Up from the pit floor to the lounge, never down, a half step at a time.
        let last = heightAt(layout, { x, z: s.z0 });
        expect(last).toBe(0);
        const climbed = new Set<number>();
        for (let z = s.z0; z <= s.z1; z += 0.02) {
          const h = heightAt(layout, { x, z });
          expect(h - last, `${s.name} at z ${z.toFixed(2)}`).toBeGreaterThanOrEqual(0);
          expect(h - last, `${s.name} at z ${z.toFixed(2)}`).toBeLessThanOrEqual(rows[0].height / 2 + 1e-9);
          climbed.add(Math.round(h * 100));
          last = h;
        }
        expect(last).toBe(crewLounge.height);
        // A landing at every tier's height (one step more with a 4th tier).
        for (const t of rows) expect(climbed.has(Math.round(t.height * 100)), `${s.name} landing at ${t.height}`).toBe(true);
        expect(climbed.size, "the pit, each tier and the lounge, with a half step up to each").toBe(2 * rows.length + 3);
      }
      // Each tier's walkway runs from the left staircase to the right one, onto it at the tier's height.
      lanes.forEach((lane, t) => {
        for (const [end, s] of [[lane[0], steps[0]], [lane.at(-1)!, steps[1]]] as const) {
          expect(within(end, s), `tier ${t} ${s.name}`).toBe(true);
          expect(heightAt(layout, end), `tier ${t} ${s.name}`).toBe(rows[t].height);
        }
      });
      // The rail runs the full width of the lounge's front but where the staircases meet it.
      const spans = [...rail.map(([a, b]) => [a.x, b.x]), ...steps.map((s) => [s.x0, s.x1])].sort((a, b) => a[0] - b[0]);
      expect(spans[0][0]).toBe(room.left);
      expect(spans.at(-1)![1]).toBe(room.right);
      for (let i = 0; i + 1 < spans.length; i++) expect(spans[i + 1][0]).toBeCloseTo(spans[i][1], 9);
      for (const p of rail.flat()) expect(p.z).toBe(crewLounge.z0);
      // Nobody walks up the middle any more: there are tier edges all the way up.
      expect(problems(layout, [{ x: 0, z: -7 }, { x: 0, z: crewLounge.z0 + 1 }]).some((p) => p.includes('tier edge'))).toBe(true);
    });

    it(`#100 AC3 (${tiers} tiers) every walk between any two of: the entrance, seats (and beside and behind them), activity spots, pool turns and dog spots`, { timeout: 120_000 }, async () => {
      const layout = plan(tiers);
      const ends = [
        { name: 'door', link: layout.doorLink },
        ...layout.seats.flatMap((s) => [
          { name: `seat ${s.index}`, link: s.link },
          { name: `behind seat ${s.index}`, link: behindChair(layout, s) },
          { name: `over seat ${s.index}`, link: overTheShoulder(layout, s).link },
          { name: `beside seat ${s.index}`, link: s.link.slice(1) },
        ]),
        ...layout.hangouts.flatMap((s) => s.places.map((p, i) => ({ name: `${s.name} ${i}`, link: p.link }))),
        ...layout.poolTurns.flatMap((t, i) => [{ name: `pool shot ${i}`, link: t.shoot.link }, { name: `pool wait ${i}`, link: t.wait.link }]),
        ...layout.dogSpots.flatMap((d) => [{ name: `dog ${d.name}`, link: d.link }, ...d.visitors.map((v, i) => ({ name: `dog ${d.name} visitor ${i}`, link: v.link }))]),
      ];
      const found: string[] = [];
      for (const from of ends) {
        for (const to of ends) {
          if (from === to) continue;
          const bad = problems(layout, route(layout, from.link, to.link));
          if (bad.length) found.push(`${from.name} → ${to.name}: ${bad[0]}`);
        }
        // This runs for a minute on a slow machine; yield so vitest's worker can still report back.
        await new Promise((resolve) => setImmediate(resolve));
      }
      for (const seat of layout.seats) found.push(...problems(layout, departurePath(layout, seat)).map((p) => `leaving seat ${seat.index}: ${p}`));
      expect(found.slice(0, 10)).toEqual([]);
    });
  }

  it('#100 AC3 the checks catch a walk through a console, over the rail or off a tier edge', () => {
    const layout = plan(3);
    const [seat] = layout.seats;
    expect(problems(layout, [seat.chair, seat.desk, { x: seat.desk.x, z: -6 }]).length).toBeGreaterThan(0);
    const lounge = { x: 5, z: layout.crewLounge.z0 + 1 };
    expect(problems(layout, [lounge, { x: 5, z: layout.crewLounge.z0 - 4 }]).some((p) => p.includes('rail'))).toBe(true);
    expect(problems(layout, [{ x: -3, z: -6.5 }, { x: -3, z: -2 }]).some((p) => p.includes('tier edge'))).toBe(true);
  });
});

describe('#100 AC4 every Classic activity spot has a counterpart in the lounge or on the deck', () => {
  const classic = officeLayout(2, 'classic');

  for (const tiers of [3, 4]) {
    it(`#100 AC4 (${tiers} tiers) same spots, same games and places, each in the crew lounge or on the deck`, () => {
      const layout = plan(tiers);
      expect(layout.hangouts.map((s) => s.name).sort()).toEqual(classic.hangouts.map((s) => s.name).sort());
      for (const spot of classic.hangouts) {
        const twin = layout.hangouts.find((s) => s.name === spot.name)!;
        expect(twin.places.map((p) => [p.pose, !!p.sits]), spot.name).toEqual(spot.places.map((p) => [p.pose, !!p.sits]));
        expect([twin.game, twin.chat], spot.name).toEqual([spot.game, spot.chat]);
        for (const p of twin.places) expect(within(p, layout.crewLounge) || within(p, layout.deck), `${spot.name} at (${p.x}, ${p.z})`).toBe(true);
      }
      for (const turn of layout.poolTurns) for (const p of [turn.shoot, turn.wait]) expect(within(p, layout.crewLounge), 'pool turn').toBe(true);
    });
  }

  it('#100 AC4 the props are where their spots are: board on the lounge\'s left wall, lake and jetty on the deck', () => {
    const layout = plan(3);
    const { props, crewLounge, deck, room } = layout;
    expect(props.dartboard.x).toBeCloseTo(room.left, 1);
    for (const p of [props.dartboard, props.bin, props.poolTable, props.pingPong]) expect(within(p, crewLounge)).toBe(true);
    for (const p of [props.pond, props.jetty, props.pool, props.trampoline, props.yogaMat, props.hammock, props.petBed, props.bowl, ...props.loungers]) {
      expect(within(p, deck)).toBe(true);
    }
    // The lake fits the deck, so it can be cut off square at the deck's edge.
    expect(props.pond.x - props.pond.rx).toBeGreaterThan(deck.x0);
    expect(props.pond.z - props.pond.rz).toBeGreaterThan(deck.z0);
    expect(within(layout.dogSpots[0].dog, deck)).toBe(true);
  });
});
