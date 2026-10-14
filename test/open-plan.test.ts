import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { AgentRecord, OfficeState } from '../src/shared/agent.ts';
import { OfficeController, type OfficeEvent } from '../src/client/controller.ts';
import { DESKS_PER_ROW, INITIAL_ROWS, arrivalPath, departurePath, officeLayout, type SeatSpot } from '../src/client/layout.ts';
import { buildOffice } from '../src/client/office.ts';
import { Character } from '../src/client/character.ts';
import { lookFor } from '../src/client/look.ts';
import { POSES } from '../src/client/poses.ts';
import { collisions, inside, obstaclesIn, type Obstacle } from './geometry.ts';

const rec = (n: number, state: OfficeState = 'working'): AgentRecord => ({
  id: `a${n}`, sessionId: `session-${n}`, name: `agent ${n}`, project: 'demo-app',
  cwd: '/home/alex/projects/demo-app', state, lastMessage: null, branch: null, activity: [],
});
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => rec(from + i));
const ofType = <T extends OfficeEvent['type']>(events: OfficeEvent[], type: T) =>
  events.filter((e): e is Extract<OfficeEvent, { type: T }> => e.type === type);

/** The agent's own chair: the last hop into it (and the first hop out) lands inside its footprint. */
function ownChair(seat: SeatSpot, obstacles: Obstacle[]) {
  return obstacles.find((o) => o.kind === 'chair' && inside(seat.sit, o.box, 0))!.object;
}

// #25 replaced the pod grid with plan C's curved rows: the pod-shape tests went, the rest follow the rows.
describe('#13 AC1 desks', () => {
  it('#13 AC1 seats at least 16 agents before growing, then grows by a whole pod row', () => {
    const c = new OfficeController();
    c.update(range(1, 16));
    expect(c.rows).toBe(INITIAL_ROWS);
    expect(INITIAL_ROWS * DESKS_PER_ROW).toBeGreaterThanOrEqual(16);
    const events = c.update(range(1, 17));
    expect(c.rows).toBe(INITIAL_ROWS + 1);
    expect(ofType(events, 'rows')).toEqual([{ type: 'rows', count: INITIAL_ROWS + 1 }]);
    expect(c.agents.get('session-17')!.seat.index).toBe(16);
    const seats = officeLayout(INITIAL_ROWS + 1).seats;
    expect(seats[16].desk.z).toBeLessThan(Math.min(...officeLayout(INITIAL_ROWS).seats.map((s) => s.desk.z)));
  });
});

describe('#13 AC2 routes avoid furniture', () => {
  for (const rows of [INITIAL_ROWS, INITIAL_ROWS + 1]) {
    it(`#13 AC2 every seat's arrival and departure routes miss every desk, chair and decor piece (${rows} rows)`, () => {
      const { group, seats, layout } = buildOffice(rows);
      const obstacles = obstaclesIn(group);
      expect(obstacles.filter((o) => o.kind === 'desk')).toHaveLength(rows * DESKS_PER_ROW);
      for (const seat of seats) {
        const chair = ownChair(seat, obstacles);
        const arrive = arrivalPath(layout, seat), depart = departurePath(layout, seat);
        // Only the hop between the approach spot and the seat may enter the agent's own chair.
        expect(collisions(arrive, obstacles, (i) => new Set(i === arrive.length - 2 ? [chair] : [])), `arrive seat ${seat.index}`).toEqual([]);
        expect(collisions(depart, obstacles, (i) => new Set(i === 0 ? [chair] : [])), `depart seat ${seat.index}`).toEqual([]);
      }
    });
  }

  it('#13 AC2 the checker does catch a route through a desk', () => {
    const { group, seats } = buildOffice(INITIAL_ROWS);
    const { desk } = seats[0];
    expect(collisions([{ x: desk.x, z: desk.z - 2 }, { x: desk.x, z: desk.z + 2 }], obstaclesIn(group))).not.toEqual([]);
  });
});

describe('#13 AC3 zones and props', () => {
  const kindsUnder = (root: THREE.Object3D) => {
    const kinds: string[] = [];
    root.traverse((o) => { if (o.userData.kind) kinds.push(o.userData.kind); });
    return kinds;
  };
  const find = (root: THREE.Object3D, kind: string) => {
    const found: THREE.Object3D[] = [];
    root.traverse((o) => { if (o.userData.kind === kind) found.push(o); });
    return found;
  };

  it('#13 AC3 has a glass-walled meeting room with a table, a lounge with sofa and rug, and a kitchen', () => {
    const { group } = buildOffice(INITIAL_ROWS);
    const [meeting] = find(group, 'meeting-room');
    expect(kindsUnder(meeting)).toEqual(expect.arrayContaining(['glass-wall', 'meeting-table']));
    const glass = find(meeting, 'glass-wall')[0] as THREE.Mesh;
    expect((glass.material as THREE.Material).transparent).toBe(true);
    const [lounge] = find(group, 'lounge');
    expect(kindsUnder(lounge)).toEqual(expect.arrayContaining(['sofa', 'rug']));
    expect(find(group, 'kitchen')).toHaveLength(1);
  });

  it('#13 AC3 has a whiteboard, a bookshelf, wall art and at least 8 plants', () => {
    const { group } = buildOffice(INITIAL_ROWS);
    for (const kind of ['whiteboard', 'bookshelf', 'wall-art']) expect(find(group, kind).length, kind).toBeGreaterThan(0);
    expect(find(group, 'plant').length).toBeGreaterThanOrEqual(8);
  });

  it('#13 AC3 decor pieces stay on the floor and do not overlap desks or each other', () => {
    const { group } = buildOffice(INITIAL_ROWS + 1);
    group.updateMatrixWorld(true);
    // #25: the floor is the indoor tiles plus the deck; the board and TV hang above it. #38: monitors stand on desks.
    // #83: the whiteboard and dart board hang flat on the left wall, just past the floor's edge.
    const floor = find(group, 'floor').reduce((box, f) => box.union(new THREE.Box3().setFromObject(f)), new THREE.Box3());
    const standing = obstaclesIn(group).filter((o) => !['wall', 'window', 'wall-art', 'whiteboard', 'dartboard', 'glass-wall', 'big-board', 'tv'].includes(o.kind));
    for (const o of standing) {
      expect(o.box.min.x >= floor.min.x - 0.01 && o.box.max.x <= floor.max.x + 0.01, `${o.kind} x`).toBe(true);
      expect(o.box.min.z >= floor.min.z - 0.01 && o.box.max.z <= floor.max.z + 0.01, `${o.kind} z`).toBe(true);
    }
    const deskParts = ['desk', 'chair', 'monitor'];
    const desks = standing.filter((o) => deskParts.includes(o.kind));
    const decor = standing.filter((o) => !deskParts.includes(o.kind));
    for (const d of decor) for (const k of desks) expect(d.box.intersectsBox(k.box), `${d.kind} vs ${k.kind}`).toBe(false);
  });
});

describe('#13 AC4 agents in the new layout', () => {
  const run = (character: Character, until: () => boolean) => {
    for (let t = 0; t < 60 && !until(); t += 0.05) character.update(t, 0.05);
  };

  it('#13 AC4 walk in from the door, sit, change pose and bubble, and walk out on Got it, at any desk', () => {
    const c = new OfficeController();
    c.update([]);
    const events = c.update(range(1, 16));
    const DOOR = c.layout.door;
    for (const arrive of ofType(events, 'arrive').filter((_, i) => [0, 7, 8, 15].includes(i))) {
      expect(arrive.walk).toBe(true);
      expect(arrive.path[0]).toEqual(DOOR);
      const character = new Character(lookFor(arrive.key));
      character.arrive(arrive.seat, 'working', arrive.path);
      run(character, () => character.mode === 'seated');
      expect(character.mode).toBe('seated');
      expect(character.root.position.x).toBeCloseTo(arrive.seat.sit.x);
      expect(character.root.position.z).toBeCloseTo(arrive.seat.sit.z);

      character.setState('needs');
      character.update(100, 0.016);
      expect([character.pose, character.bubbleKind]).toEqual([POSES.needs.pose, POSES.needs.bubble]);
      character.setState('finished');
      run(character, () => character.mode === 'standing');
      expect([character.pose, character.bubbleKind]).toEqual(['standing', 'finished']);

      character.leave(departurePath(c.layout, arrive.seat));
      run(character, () => character.mode === 'gone');
      expect(character.mode).toBe('gone');
      expect(Math.hypot(character.root.position.x - DOOR.x, character.root.position.z - DOOR.z)).toBeLessThan(0.6);
    }
  });
});
