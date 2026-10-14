import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { INITIAL_ROWS, officeLayout, overTheShoulder } from '../src/client/layout.ts';
import { buildOffice } from '../src/client/office.ts';
import { Character } from '../src/client/character.ts';
import { lookFor } from '../src/client/look.ts';
import { key, ofType, office } from './office-sim.ts';

/** The radius of a character's head ball. */
const HEAD_RADIUS = 0.38;
const world = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());

/** At each desk of a `rows`-row office: the sitter (needing you) and its onlooker, posed over 5 s from 1 s after arriving. */
function eachView(rows: number, look: (seat: number, onlooker: Character, sitter: Character, monitor: THREE.Vector3) => void) {
  const layout = officeLayout(rows);
  const { seats, group } = buildOffice(rows);
  group.updateMatrixWorld(true);
  for (const seat of layout.seats) {
    const monitor = world(seats[seat.index].screen.display);
    const onlooker = new Character(lookFor(key(1))), sitter = new Character(lookFor(key(2)));
    onlooker.placeAt(seat, 'done', overTheShoulder(layout, seat));
    sitter.sitAt(seat, 'needs');
    for (let t = 1; t < 6; t += 0.1) {
      onlooker.update(t, 0.1);
      sitter.update(t, 0.1);
      onlooker.root.updateMatrixWorld(true);
      sitter.root.updateMatrixWorld(true);
      look(seat.index, onlooker, sitter, monitor);
    }
  }
}
const eyes = (c: Character) => world(c.head).add(new THREE.Vector3(0, 0.04, 0.345).applyQuaternion(c.head.getWorldQuaternion(new THREE.Quaternion())));

describe('#78 onlookers can see the screen', () => {
  for (const rows of [INITIAL_ROWS, INITIAL_ROWS + 1]) {
    it(`#78 AC1 with ${rows} rows, the onlooker's eye line to each monitor misses the sitter's head by 0.05 m`, () => {
      eachView(rows, (seat, onlooker, sitter, monitor) => {
        const gap = new THREE.Line3(eyes(onlooker), monitor).closestPointToPoint(world(sitter.head), true, new THREE.Vector3()).distanceTo(world(sitter.head)) - HEAD_RADIUS;
        expect(gap, `seat ${seat}`).toBeGreaterThanOrEqual(0.05);
      });
    });

    it(`#78 AC2 with ${rows} rows, the onlooker's head faces the monitor to within 15 degrees`, () => {
      eachView(rows, (seat, onlooker, _sitter, monitor) => {
        const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(onlooker.head.getWorldQuaternion(new THREE.Quaternion()));
        const angle = THREE.MathUtils.radToDeg(facing.angleTo(monitor.clone().sub(eyes(onlooker))));
        expect(angle, `seat ${seat}`).toBeLessThanOrEqual(15);
      });
    });

    it(`#78 AC3 with ${rows} rows, the onlooker keeps #67's place, and in its new pose stays clear of the sitter`, () => {
      const layout = officeLayout(rows);
      for (const seat of layout.seats) {
        const p = overTheShoulder(layout, seat);
        const back = { x: -Math.sin(seat.yaw), z: -Math.cos(seat.yaw) }, side = { x: Math.cos(seat.yaw), z: -Math.sin(seat.yaw) };
        const rel = { x: p.x - seat.chair.x, z: p.z - seat.chair.z };
        expect(rel.x * back.x + rel.z * back.z, `seat ${seat.index}: behind`).toBeGreaterThan(0.3);
        expect(Math.abs(Math.abs(rel.x * side.x + rel.z * side.z) - 0.5), `seat ${seat.index}: about 0.5 m to the side`).toBeLessThan(0.1);
      }
      const parts = (c: Character) => [new THREE.Sphere(world(c.head), HEAD_RADIUS + 0.1), ...c.hands.map((h) => new THREE.Sphere(world(h), 0.13))];
      eachView(rows, (seat, onlooker, sitter) => {
        const a = parts(onlooker), b = parts(sitter);
        expect(a.some((x) => b.some((y) => x.intersectsSphere(y))), `seat ${seat}`).toBe(false);
      });
    });
  }

  it('#78 AC3 the controller sends the onlooker to that place', () => {
    const o = office(3, 3);
    o.set(1, 'done');
    o.run(15);
    const [walk] = ofType(o.set(3, 'needs'), 'walk').filter((w) => w.place?.spot === 'over-the-shoulder');
    const seat = o.c.agents.get(key(3))!.seat;
    expect(walk.place).toEqual(overTheShoulder(officeLayout(o.c.rows), seat));
  });
});
