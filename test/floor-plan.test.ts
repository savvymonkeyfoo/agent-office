import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { AgentRecord, OfficeState } from '../src/shared/agent.ts';
import { OfficeController, type OfficeEvent } from '../src/client/controller.ts';
import {
  DESKS_PER_ROW, INITIAL_ROWS, RESERVED, arrivalPath, departurePath, officeLayout, route, type Point,
} from '../src/client/layout.ts';
import { buildOffice } from '../src/client/office.ts';
import { Character } from '../src/client/character.ts';
import { lookFor } from '../src/client/look.ts';
import { allOnScreen, floorCorners, frameFloor, initialOrbit, placeCamera } from '../src/client/camera.ts';
import { inside, obstaclesIn, routeCollisions } from './geometry.ts';

const rec = (n: number, state: OfficeState = 'working'): AgentRecord => ({
  id: `a${n}`, sessionId: `session-${n}`, name: `agent ${n}`, project: 'demo-app',
  cwd: '/home/alex/projects/demo-app', state, lastMessage: null, branch: null, activity: [],
});
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => rec(from + i));
const ofType = <T extends OfficeEvent['type']>(events: OfficeEvent[], type: T) =>
  events.filter((e): e is Extract<OfficeEvent, { type: T }> => e.type === type);
const deg = (d: number) => (d * Math.PI) / 180;
/** Plan C's artifact coordinates (x 0–18, y from the back wall) in layout space. */
const plan = (x: number, y: number): Point => ({ x: x - 9, z: y - 5 });

function find(root: THREE.Object3D, kind: string) {
  const found: THREE.Object3D[] = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => { if (o.userData.kind === kind) found.push(o); });
  return found;
}
/** Within 12 cm: frames and outlines make pieces a little bigger than their plan footprint. */
const about = (actual: number, expected: number) => expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThan(0.12);
const boxOf = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o);
const centre = (o: THREE.Object3D) => boxOf(o).getCenter(new THREE.Vector3());

describe('#25 AC1 two curved rows facing the camera', () => {
  it('#25 AC1 16 desks in two rows of 8', () => {
    const { seats, group } = buildOffice(INITIAL_ROWS);
    expect(seats).toHaveLength(16);
    expect([0, 1].map((row) => seats.filter((s) => s.row === row).length)).toEqual([8, 8]);
    expect(find(group, 'desk')).toHaveLength(16);
    expect(find(group, 'chair')).toHaveLength(16);
  });

  it('#25 AC1 each row curves round one point on the camera side, and every desk faces it', () => {
    const { seats } = officeLayout(INITIAL_ROWS);
    const forward = (yaw: number) => ({ x: Math.sin(yaw), z: Math.cos(yaw) });
    // Where the first and last desks' facing lines cross.
    const a = seats[0], b = seats[7], fa = forward(a.yaw), fb = forward(b.yaw);
    const t = ((b.desk.x - a.desk.x) * fb.z - (b.desk.z - a.desk.z) * fb.x) / (fa.x * fb.z - fa.z * fb.x);
    const focus = { x: a.desk.x + fa.x * t, z: a.desk.z + fa.z * t };
    expect(focus.z).toBeGreaterThan(Math.max(...seats.map((s) => s.desk.z)));
    for (const row of [0, 1]) {
      const desks = seats.filter((s) => s.row === row);
      const radii = desks.map((s) => Math.hypot(s.desk.x - focus.x, s.desk.z - focus.z));
      for (const r of radii) expect(r).toBeCloseTo(radii[0], 6);
      for (const s of desks) {
        const f = forward(s.yaw), d = Math.hypot(focus.x - s.desk.x, focus.z - s.desk.z);
        expect((f.x * (focus.x - s.desk.x) + f.z * (focus.z - s.desk.z)) / d).toBeCloseTo(1, 6);
      }
    }
    // Ends curve forward: the middle desks are furthest back.
    expect(seats[0].desk.z).toBeGreaterThan(seats[3].desk.z);
    expect(seats[8].desk.z).toBeLessThan(Math.min(...seats.slice(0, 8).map((s) => s.desk.z)));
  });

  it('#25 AC1 every seated agent faces within ±40° of +z', () => {
    for (const rows of [INITIAL_ROWS, INITIAL_ROWS + 1]) {
      for (const seat of officeLayout(rows).seats) {
        const character = new Character(lookFor(`s${seat.index}`));
        character.sitAt(seat, 'working');
        expect(Math.abs(character.root.rotation.y), `seat ${seat.index}`).toBeLessThanOrEqual(deg(40));
        // The chair is behind the desk: the agent faces its desk.
        expect(Math.cos(seat.yaw) * (seat.desk.z - seat.chair.z) + Math.sin(seat.yaw) * (seat.desk.x - seat.chair.x)).toBeCloseTo(1.2, 6);
      }
    }
  });

  it('#25 AC1 a 17th agent adds a wider row of 8 behind the last; whole rows only', () => {
    const c = new OfficeController();
    c.update(range(1, 16));
    expect(c.rows).toBe(INITIAL_ROWS);
    const events = c.update(range(1, 17));
    expect(ofType(events, 'rows')).toEqual([{ type: 'rows', count: INITIAL_ROWS + 1 }]);
    const seats = c.layout.seats;
    expect(seats).toHaveLength(3 * DESKS_PER_ROW);
    const newRow = seats.filter((s) => s.row === 2), lastRow = seats.filter((s) => s.row === 1);
    expect(c.agents.get('session-17')!.seat).toBe(newRow[0]);
    expect(Math.max(...newRow.map((s) => s.desk.z))).toBeLessThan(Math.min(...lastRow.map((s) => s.chair.z)));
    const span = (row: typeof seats) => row.at(-1)!.desk.x - row[0].desk.x;
    expect(span(newRow)).toBeGreaterThan(span(lastRow));
    // The existing desks don't move.
    expect(seats.slice(0, 16)).toEqual(officeLayout(INITIAL_ROWS).seats);
  });
});

describe('#25 AC2 plan C zones', () => {
  const { group, layout } = buildOffice(INITIAL_ROWS);
  const near = (o: THREE.Object3D, p: Point, tolerance = 0.35) => {
    const c = centre(o);
    expect(Math.hypot(c.x - p.x, c.z - p.z), `${o.userData.kind} at (${c.x.toFixed(2)}, ${c.z.toFixed(2)})`).toBeLessThan(tolerance);
  };

  it('#25 AC2 kitchen counter along the back wall at x 0.3–3.9 with a coffee machine, and a small table at (2.1, 2.3)', () => {
    const [kitchen] = find(group, 'kitchen');
    const counter = boxOf(find(kitchen, 'kitchen-counter')[0]);
    about(counter.min.x, plan(0.3, 0).x);
    about(counter.max.x, plan(3.9, 0).x);
    expect(counter.min.z).toBeLessThan(layout.bounds.back + 0.3);
    expect(find(kitchen, 'coffee-machine')).toHaveLength(1);
    near(find(kitchen, 'kitchen-table')[0], plan(2.1, 2.3));
  });

  it('#25 AC2 big board on the back wall at x 4.6–13.4', () => {
    const [board] = find(group, 'big-board');
    const box = boxOf(board);
    about(box.min.x, plan(4.6, 0).x);
    about(box.max.x, plan(13.4, 0).x);
    expect(box.min.z).toBeLessThan(layout.bounds.back + 0.2);
  });

  it('#25 AC2 TV on the back wall at x 14.1–16.7 with a sofa in front of it, facing it', () => {
    const tv = boxOf(find(group, 'tv')[0]);
    about(tv.min.x, plan(14.1, 0).x);
    about(tv.max.x, plan(16.7, 0).x);
    expect(tv.min.z).toBeLessThan(layout.bounds.back + 0.3);
    const [sofa] = find(group, 'sofa');
    near(sofa, plan(15.4, 2.75));
    expect(Math.cos(sofa.rotation.y)).toBeCloseTo(-1); // faces -z, the TV
  });

  it('#25 AC2 glass meeting room at x 0.3–3.0, y 4.2–7.2 with a table and whiteboard', () => {
    const [room] = find(group, 'meeting-room');
    // #83: the whiteboard hangs on the office's left wall, just past the room's glass.
    const box = room.children.filter((o) => o.userData.kind !== 'whiteboard').reduce((b, o) => b.union(boxOf(o)), new THREE.Box3());
    about(box.min.x, plan(0.3, 0).x);
    about(box.max.x, plan(3.0, 0).x);
    about(box.min.z, plan(0, 4.2).z);
    about(box.max.z, plan(0, 7.2).z);
    for (const kind of ['glass-wall', 'meeting-table', 'whiteboard']) expect(find(room, kind).length, kind).toBeGreaterThan(0);
  });

  it('#25 AC2 a glass wall at y 11.8 with doors at x 2.7–3.7 and 14.3–15.3, then a deck to y 18.4', () => {
    const [front] = find(group, 'glass-front');
    const panes = find(front, 'glass-wall').map(boxOf);
    for (const p of panes) expect((p.min.z + p.max.z) / 2).toBeCloseTo(plan(0, 11.8).z, 2);
    const covered = (x: number) => panes.some((p) => x > p.min.x && x < p.max.x);
    for (const x of [0.5, 2.5, 4, 9, 14, 16, 17.5]) expect(covered(plan(x, 0).x), `glass at x ${x}`).toBe(true);
    for (const x of [2.85, 3.2, 3.55, 14.45, 14.8, 15.15]) expect(covered(plan(x, 0).x), `door at x ${x}`).toBe(false);
    const doors = find(front, 'glass-door');
    expect(doors).toHaveLength(2);
    near(doors[0], plan(3.2, 11.8));
    near(doors[1], plan(14.8, 11.8));
    const deck = boxOf(find(group, 'deck')[0]);
    about(deck.min.z, plan(0, 11.8).z);
    about(deck.max.z, plan(0, 18.4).z);
    // To float precision: since #63 the deck is a shape with holes for the pool and pond.
    expect(deck.min.x).toBeCloseTo(plan(0, 0).x, 6);
    expect(deck.max.x).toBeCloseTo(plan(18, 0).x, 6);
  });

  it('#25 AC2 entrance door in the back wall at x 17.0–17.9, and at least 8 plants', () => {
    near(find(group, 'door')[0], { x: plan(17.45, 0).x, z: layout.bounds.back + 0.4 }, 0.5);
    expect(find(group, 'plant').length).toBeGreaterThanOrEqual(8);
  });
});

describe('#25 AC3 routes stay clear, and the next epic has room', () => {
  for (const rows of [INITIAL_ROWS, INITIAL_ROWS + 1]) {
    it(`#25 AC3 arrival, departure and wander routes for every seat and place miss all furniture and walls (${rows} rows)`, { timeout: 30_000 }, () => {
      const { group, layout } = buildOffice(rows);
      const obstacles = obstaclesIn(group);
      const places = layout.hangouts.flatMap((s) => s.places);
      for (const seat of layout.seats) {
        expect(routeCollisions(arrivalPath(layout, seat), obstacles), `arrive seat ${seat.index}`).toEqual([]);
        expect(routeCollisions(departurePath(layout, seat), obstacles), `depart seat ${seat.index}`).toEqual([]);
      }
      const ends = [
        ...places.map((p) => ({ name: `${p.spot}@${p.x},${p.z}`, link: p.link })),
        ...layout.seats.map((s) => ({ name: `seat ${s.index}`, link: s.link })),
        { name: 'door', link: layout.doorLink },
      ];
      for (const from of ends.slice(0, places.length)) {
        for (const to of ends) {
          if (from === to) continue;
          expect(routeCollisions(route(layout, from.link, to.link), obstacles), `${from.name} → ${to.name}`).toEqual([]);
          expect(routeCollisions(route(layout, to.link, from.link), obstacles), `${to.name} → ${from.name}`).toEqual([]);
        }
      }
    });
  }

  it('#25 AC3 the checker catches a route through the glass wall', () => {
    const { group } = buildOffice(INITIAL_ROWS);
    expect(routeCollisions([{ x: 0, z: 6 }, { x: 0, z: 7.5 }], obstaclesIn(group))).not.toEqual([]);
  });

  // #29 filled these areas with its props and activity places; anything else must still keep out.
  const BREAK_ROOM_PROPS = ['sun-lounger', 'pond', 'jetty', 'tree', 'hammock', 'yoga-mat', 'trampoline', 'dartboard', 'bin', 'pool-table', 'ping-pong-table', 'pool', 'pool-ring', 'pet-bed', 'dog-bowl'];
  const BREAK_ROOM_SPOTS = ['loungers', 'fishing', 'hammock', 'yoga', 'trampoline', 'darts', 'hoops', 'planes', 'pool-table', 'ping-pong', 'pool-dip'];
  it('#25 AC3 the next epic\'s prop areas hold no furniture other than its own props', () => {
    // From the epic: darts lane y 9–10 on the left wall, bin (0.5, 11.3), pool table (16.4, 6.6), pet bed (16.4, 10.4),
    // pool x 6.2–11.8 y 14.0–16.8, ping pong (15.3, 13.7), trampoline (16.6, 15.6), hammock trees (14.4/17.4, 17.6),
    // pond (2.4, 16.0) with a jetty, yoga mat (1.4, 13.5).
    const spots = [plan(0.5, 9.5), plan(0.5, 11.3), plan(16.4, 6.6), plan(16.4, 10.4), plan(9, 15.4), plan(15.3, 13.7), plan(16.6, 15.6),
      plan(14.4, 17.6), plan(17.4, 17.6), plan(2.4, 16.0), plan(1.4, 13.5)];
    for (const p of spots) expect(RESERVED.some((a) => p.x > a.x0 && p.x < a.x1 && p.z > a.z0 && p.z < a.z1), `(${p.x}, ${p.z})`).toBe(true);
    for (const rows of [INITIAL_ROWS, INITIAL_ROWS + 1]) {
      const { group, layout } = buildOffice(rows);
      for (const area of RESERVED) {
        const box = new THREE.Box3(new THREE.Vector3(area.x0, -1, area.z0), new THREE.Vector3(area.x1, 5, area.z1));
        const inArea = obstaclesIn(group).filter((o) => o.kind !== 'wall' && !BREAK_ROOM_PROPS.includes(o.kind) && o.box.intersectsBox(box)).map((o) => o.kind);
        expect(inArea, area.name).toEqual([]);
        const others = layout.hangouts.filter((s) => !BREAK_ROOM_SPOTS.includes(s.name)).flatMap((s) => s.places);
        for (const p of others) expect(inside(p, box, 0), `${p.spot} in ${area.name}`).toBe(false);
      }
    }
  });

  it('#25 AC3 at least 1.5 m clear behind every front-row chair', () => {
    const { group, seats } = buildOffice(INITIAL_ROWS);
    // Exact footprints in each piece's own (rotated) frame; see-through screens float above the floor.
    const pieces = [...find(group, 'desk'), ...find(group, 'chair')].map((o) => {
      const copy = o.clone();
      copy.position.set(0, 0, 0);
      copy.rotation.set(0, 0, 0);
      return { o, box: boxOf(copy) };
    });
    const under = (p: Point) => pieces.filter(({ o, box }) => {
      const local = o.worldToLocal(new THREE.Vector3(p.x, 0, p.z));
      return local.x > box.min.x && local.x < box.max.x && local.z > box.min.z && local.z < box.max.z;
    });
    for (const seat of seats.filter((s) => s.row === 0)) {
      const back = { x: -Math.sin(seat.yaw), z: -Math.cos(seat.yaw) };
      const chairBack = Math.max(...under(seat.chair).map(({ box }) => -box.min.z));
      for (let d = chairBack + 0.01; d <= chairBack + 1.5; d += 0.05) {
        const p = { x: seat.chair.x + back.x * d, z: seat.chair.z + back.z * d };
        expect(under(p).map(({ o }) => o.userData.kind), `seat ${seat.index} at ${d.toFixed(2)} m`).toEqual([]);
      }
    }
  });
});

describe('#25 AC4 agents in the new office', () => {
  const run = (character: Character, until: () => boolean) => {
    for (let t = 0; t < 60 && !until(); t += 0.05) character.update(t, 0.05);
  };

  it('#25 AC4 walk in from the door, sit, change pose, and walk out on Got it, at desks in every row', () => {
    const c = new OfficeController();
    c.update([]);
    const twoRows = ofType(c.update(range(1, 16)), 'arrive').map((arrive) => ({ arrive, layout: c.layout }));
    const [third] = ofType(c.update(range(1, 17)), 'arrive');
    for (const { arrive, layout } of [...twoRows.filter((_, i) => [0, 7, 8, 15].includes(i)), { arrive: third, layout: c.layout }]) {
      expect(arrive.path[0]).toEqual(layout.door);
      const character = new Character(lookFor(arrive.key));
      character.arrive(arrive.seat, 'working', arrive.path);
      run(character, () => character.mode === 'seated');
      expect(character.root.position.x).toBeCloseTo(arrive.seat.sit.x);
      expect(character.root.position.z).toBeCloseTo(arrive.seat.sit.z);
      character.leave(departurePath(layout, arrive.seat));
      run(character, () => character.mode === 'gone');
      expect(Math.hypot(character.root.position.x - layout.door.x, character.root.position.z - layout.door.z)).toBeLessThan(0.6);
    }
  });

  it('#25 AC4 when a row is added, agents away from their desks are moved with the room', () => {
    const c = new OfficeController({ now: () => 0, random: () => 0 });
    c.update(range(1, 16).map((r) => ({ ...r, state: 'done' as const })));
    const away = [...c.agents].filter(([, a]) => a.place);
    expect(away.length).toBeGreaterThan(0);
    const events = c.update([...range(1, 16).map((r) => ({ ...r, state: 'done' as const })), rec(17)]);
    const placed = ofType(events, 'place');
    expect(placed.map((e) => e.key).sort()).toEqual(away.map(([k]) => k).sort());
    const places = c.layout.hangouts.flatMap((s) => s.places);
    for (const e of placed) expect(places).toContain(e.place);
  });
});

describe('#25 AC5 the whole floor fits on first load', () => {
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    for (const rows of [INITIAL_ROWS, INITIAL_ROWS + 1]) {
      it(`#25 AC5 all four floor corners, deck included, project inside a ${w}×${h} screen (${rows} rows)`, () => {
        const camera = new THREE.PerspectiveCamera(34, w / h, 0.1, 150);
        const orbit = initialOrbit();
        frameFloor(camera, orbit, rows);
        placeCamera(camera, orbit);
        camera.updateProjectionMatrix();
        const corners = floorCorners(rows);
        expect(Math.max(...corners.map((p) => p.z))).toBeCloseTo(plan(0, 18.4).z);
        expect(allOnScreen(camera, corners)).toBe(true);
      });
    }
  }
});
