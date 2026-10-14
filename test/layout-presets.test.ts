import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  BREAK_ROOM, INITIAL_ROWS, LAYOUT_PRESETS, classicLayout, officeLayout, type HangoutPlace, type Point,
} from '../src/client/layout.ts';
import { buildOffice } from '../src/client/office.ts';
import { OfficeController, type OfficeEvent } from '../src/client/controller.ts';
import { Character } from '../src/client/character.ts';
import { lookFor } from '../src/client/look.ts';
import { COLLECT_FROM, DART, ROUND, THROWS, THROW_EVERY, dartFlight } from '../src/client/darts.ts';
import { BIN, ballFlight } from '../src/client/hoops.ts';
import { landingFrom } from '../src/client/fishing.ts';
import { fishAt } from '../src/client/water.ts';
import { find, rec, seeded } from './office-sim.ts';

/** Classic with the dart board, bin, pond and jetty, and loungers moved (same walls, same walkways). */
const MOVED = {
  ...BREAK_ROOM,
  dartboard: { ...BREAK_ROOM.dartboard, z: 3.4 },
  bin: { x: -8.4, z: 5.6 },
  pond: { ...BREAK_ROOM.pond, x: -6.0, z: 11.3 },
  jetty: { ...BREAK_ROOM.jetty, x: -3.6, z: 11.3 },
  loungers: [{ x: 3.2, z: 10.8 }, { x: 4.0, z: 10.8 }],
};
LAYOUT_PRESETS['test-moved'] = (rows) => classicLayout(rows, MOVED);

const placesOf = (layout: ReturnType<typeof officeLayout>, name: string) => layout.hangouts.find((s) => s.name === name)!.places;
const near = (a: Point, b: Point, within: number) => Math.hypot(a.x - b.x, a.z - b.z) < within;
const positionsOf = (root: THREE.Object3D, kind: string) => find(root, kind).map((o) => o.getWorldPosition(new THREE.Vector3()).toArray());
const KINDS = ['dartboard', 'bin', 'pond', 'jetty', 'sun-lounger', 'pool', 'pool-table', 'ping-pong-table', 'pet-bed', 'hammock', 'trampoline', 'yoga-mat'];

describe('#99 AC1 the office is created from a preset id; "classic" is today\'s office', () => {
  it('#99 AC1 the classic floor plan is the default one, for any number of rows', () => {
    for (const rows of [INITIAL_ROWS, 3, 4]) expect(officeLayout(rows, 'classic')).toEqual(officeLayout(rows));
  });

  it('#99 AC1 classic keeps today\'s activity places', () => {
    const layout = officeLayout(INITIAL_ROWS, 'classic');
    expect(placesOf(layout, 'darts')[0]).toMatchObject({ x: -6.6, z: 4.4 });
    expect(placesOf(layout, 'hoops')[0]).toMatchObject({ x: -6.8, z: 6.3 });
    expect(placesOf(layout, 'fishing')[0]).toMatchObject({ x: -4.4, z: 11.0 });
    expect(placesOf(layout, 'loungers').map(({ x, z }) => ({ x, z }))).toEqual(BREAK_ROOM.loungers);
    expect(layout.props).toEqual(BREAK_ROOM);
  });

  it('#99 AC1 the classic 3D build is the default one', () => {
    const [plain, classic] = [buildOffice(INITIAL_ROWS), buildOffice(INITIAL_ROWS, 'classic')];
    for (const kind of KINDS) expect(positionsOf(classic.group, kind), kind).toEqual(positionsOf(plain.group, kind));
    expect(classic.layout).toEqual(plain.layout);
  });
});

describe('#99 AC2 activities take their props from the chosen layout', () => {
  const layout = officeLayout(INITIAL_ROWS, 'test-moved');
  const [darts] = placesOf(layout, 'darts'), [hoops] = placesOf(layout, 'hoops'), [fishing] = placesOf(layout, 'fishing');

  it('#99 AC2 the layout carries the moved props', () => {
    expect(layout.props).toBe(MOVED);
  });

  it('#99 AC2 darts: the thrower stands at the moved board\'s line, facing it, and every dart lands in it', () => {
    expect(darts.z).toBeCloseTo(MOVED.dartboard.z);
    expect(darts.x).toBeCloseTo(-6.6);
    expect(darts.yaw).toBeCloseTo(-Math.PI / 2);
    for (let i = 0; i < THROWS; i++) {
      const { origin, dir } = dartFlight(darts, i, 1, layout.props.dartboard);
      const tip = { x: origin.x + dir.x * DART.tip, y: origin.y + dir.y * DART.tip, z: origin.z + dir.z * DART.tip };
      expect(Math.abs(tip.x - (MOVED.dartboard.x + 0.025)), `throw ${i + 1} in the face`).toBeLessThan(0.03);
      expect(Math.hypot(tip.y - 1.6, tip.z - MOVED.dartboard.z), `throw ${i + 1} on the board`).toBeLessThan(0.3);
    }
  });

  it('#99 AC2 darts: collecting, the thrower walks up to the moved board', () => {
    const character = new Character(lookFor('session-1'));
    character.placeAt(layout.seats[0], 'done', darts);
    let closest = Infinity;
    for (let t = 0; t < ROUND; t += 0.02) {
      character.update(t, 0.02);
      if (t > THROWS * THROW_EVERY) closest = Math.min(closest, Math.hypot(character.root.position.x - MOVED.dartboard.x, character.root.position.z - MOVED.dartboard.z));
    }
    expect(closest).toBeLessThan(COLLECT_FROM + 0.1);
  });

  it('#99 AC2 hoops: the shooter stands by the moved bin and the ball lands in it', () => {
    expect(near(hoops, MOVED.bin, 2)).toBe(true);
    expect(hoops.z).toBeCloseTo(MOVED.bin.z);
    expect(hoops.yaw).toBeCloseTo(-Math.PI / 2);
    const ball = ballFlight(hoops, 1, layout.props.bin);
    expect(Math.hypot(ball.x - MOVED.bin.x, ball.z - MOVED.bin.z)).toBeLessThan(BIN.r);
  });

  it('#99 AC2 fishing: the angler stands on the moved jetty, casts into the moved pond, where its fish swim', () => {
    const { jetty, pond } = MOVED;
    expect(Math.abs(fishing.x - jetty.x)).toBeLessThan(jetty.w / 2);
    expect(Math.abs(fishing.z - jetty.z)).toBeLessThan(jetty.d / 2);
    const inPond = (p: Point) => ((p.x - pond.x) / pond.rx) ** 2 + ((p.z - pond.z) / pond.rz) ** 2 < 1;
    const random = seeded(3);
    for (let i = 0; i < 50; i++) expect(inPond(landingFrom(random, layout.props))).toBe(true);
    for (let t = 0; t < 60; t += 1.7) for (const fish of [0, 1]) expect(inPond(fishAt(fish, t, layout.props.pond))).toBe(true);
  });

  it('#99 AC2 loungers: one place on each moved lounger', () => {
    expect(placesOf(layout, 'loungers').map(({ x, z }) => ({ x, z }))).toEqual(MOVED.loungers);
  });

  it('#99 AC2 the 3D build puts the props where the layout says', () => {
    const office = buildOffice(INITIAL_ROWS, 'test-moved');
    const xz = (kind: string) => positionsOf(office.group, kind).map(([x, , z]) => ({ x: +x.toFixed(3), z: +z.toFixed(3) }));
    expect(xz('dartboard')).toEqual([{ x: MOVED.dartboard.x, z: MOVED.dartboard.z }]);
    expect(xz('bin')).toEqual([MOVED.bin]);
    expect(xz('pond')).toEqual([{ x: MOVED.pond.x, z: MOVED.pond.z }]);
    expect(xz('jetty')).toEqual([{ x: MOVED.jetty.x, z: MOVED.jetty.z }]);
    expect(xz('sun-lounger')).toEqual(MOVED.loungers);
  });

  it('#99 AC2 the controller sends agents to the moved places, and casts into the moved pond', () => {
    const clock = { t: 0 };
    const c = new OfficeController({ now: () => clock.t, random: seeded(7) }, 'test-moved');
    expect(c.layout).toEqual(layout);
    const records = Array.from({ length: 10 }, (_, i) => rec(i + 1, 'done'));
    const events: OfficeEvent[] = [...c.update(records)];
    for (; clock.t < 1200; clock.t += 0.25) events.push(...c.tick());
    const moved = new Set<HangoutPlace>(['darts', 'hoops', 'fishing', 'loungers'].flatMap((n) => placesOf(c.layout, n)));
    const visits = events.flatMap((e) => (e.type === 'walk' && e.place && ['darts', 'hoops', 'fishing', 'loungers'].includes(e.place.spot) ? [e] : []));
    expect(visits.length).toBeGreaterThan(0);
    for (const v of visits) {
      expect(moved.has(v.place!)).toBe(true);
      expect(v.path.at(-1)).toEqual({ x: v.place!.x, z: v.place!.z });
    }
    const { pond } = MOVED;
    for (const e of events) {
      if (e.type !== 'cast') continue;
      expect(((e.cast.landing.x - pond.x) / pond.rx) ** 2 + ((e.cast.landing.z - pond.z) / pond.rz) ** 2).toBeLessThan(1);
    }
  });
});

describe('#99 AC3 an unknown preset id falls back to classic', () => {
  it('#99 AC3 floor plan, 3D build and controller', () => {
    expect(officeLayout(INITIAL_ROWS, 'no-such-preset')).toEqual(officeLayout(INITIAL_ROWS, 'classic'));
    expect(officeLayout(3, 'no-such-preset')).toEqual(officeLayout(3, 'classic'));
    const office = buildOffice(INITIAL_ROWS, 'no-such-preset');
    for (const kind of KINDS) expect(positionsOf(office.group, kind), kind).toEqual(positionsOf(buildOffice(INITIAL_ROWS).group, kind));
    expect(new OfficeController({}, 'no-such-preset').layout).toEqual(officeLayout(INITIAL_ROWS));
  });
});
