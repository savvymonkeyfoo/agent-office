import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BREAK_ROOM, FLOOR, INITIAL_ROWS, MEETING_ROOM, officeLayout } from '../src/client/layout.ts';
import { buildOffice } from '../src/client/office.ts';
import { BOARD, DART, THROWS, dartFlight } from '../src/client/darts.ts';
import { find } from './office-sim.ts';

for (const rows of [INITIAL_ROWS, INITIAL_ROWS + 2]) {
  const { group } = buildOffice(rows);
  const layout = officeLayout(rows);
  /** The real shape, without the inverted-hull outlines (back-faced, scaled-up copies). */
  const boxOf = (o: THREE.Object3D) => {
    const box = new THREE.Box3();
    o.traverse((m) => {
      if (m instanceof THREE.Mesh && (m.material as THREE.Material).side !== THREE.BackSide) {
        m.geometry.computeBoundingBox();
        box.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld));
      }
    });
    return box;
  };
  const [wall] = find(group, 'wall').map(boxOf).filter((b) => b.max.x <= FLOOR.left);
  const hung = [...find(group, 'wall-art'), ...find(group, 'dartboard'), ...find(group, 'whiteboard')];

  describe(`#83 left wall and what hangs on it (${rows} rows)`, () => {
    it('#83 AC1 the left wall is 2.2 m tall', () => {
      expect(wall.max.y - wall.min.y).toBeCloseTo(2.2, 6);
      expect(wall.min.y).toBeCloseTo(0, 6);
    });

    it('#83 AC2 every frame, the dart board and the whiteboard have their back within 1 cm of the wall\'s inner face', () => {
      expect(hung.map((o) => o.userData.kind).sort()).toEqual(['dartboard', 'wall-art', 'wall-art', 'whiteboard']);
      for (const o of hung) {
        const back = boxOf(o).min.x;
        expect(back - wall.max.x, o.userData.kind).toBeGreaterThanOrEqual(-0.001);
        expect(back - wall.max.x, o.userData.kind).toBeLessThanOrEqual(0.01);
      }
    });

    it('#83 AC3 each lies fully within the wall\'s height and length', () => {
      for (const o of hung) {
        const b = boxOf(o);
        expect(b.min.y, o.userData.kind).toBeGreaterThanOrEqual(wall.min.y);
        expect(b.max.y, o.userData.kind).toBeLessThanOrEqual(wall.max.y);
        expect(b.min.z, o.userData.kind).toBeGreaterThanOrEqual(wall.min.z);
        expect(b.max.z, o.userData.kind).toBeLessThanOrEqual(wall.max.z);
      }
    });

    it('#83 AC4 the frame that was at z 0.5 hangs at z ≈ -1.4; no frame overlaps the meeting room, bookshelf or dart board', () => {
      const frames = find(group, 'wall-art').map(boxOf);
      const zs = frames.map((b) => b.getCenter(new THREE.Vector3()).z).sort((a, b) => a - b);
      expect(zs[0]).toBeCloseTo(-1.4, 1);
      expect(zs[1]).toBeCloseTo(3.0, 6);
      const shelf = boxOf(find(group, 'bookshelf')[0]), board = boxOf(find(group, 'dartboard')[0]);
      for (const f of frames) {
        expect(f.max.z <= MEETING_ROOM.z0 || f.min.z >= MEETING_ROOM.z1, 'meeting room').toBe(true);
        expect(f.min.z >= shelf.max.z || f.max.z <= shelf.min.z, 'bookshelf').toBe(true);
        expect(f.intersectsBox(board), 'dart board').toBe(false);
      }
    });

    it('#83 AC5 thrown darts land on the board\'s face', () => {
      const face = boxOf(find(group, 'dartboard')[0]);
      const place = layout.hangouts.find((s) => s.name === 'darts')!.places[0];
      for (let i = 0; i < THROWS; i++) {
        const { origin, dir } = dartFlight(place, i, 1);
        const tip = new THREE.Vector3(origin.x, origin.y, origin.z).addScaledVector(new THREE.Vector3(dir.x, dir.y, dir.z), DART.tip);
        expect(tip.x, `throw ${i + 1}`).toBeGreaterThan(face.min.x);
        expect(tip.x, `throw ${i + 1}`).toBeLessThan(face.max.x + 0.01);
        expect(Math.hypot(tip.y - BOARD.y, tip.z - BOARD.z), `throw ${i + 1}`).toBeLessThan(BOARD.r);
      }
    });

    it('#83 AC6 the bin has no backboard: nothing of it rises above its rim', () => {
      const [bin] = find(group, 'bin');
      expect(boxOf(bin).max.y).toBeLessThan(0.6);
    });

    it('#83 AC7 there is no paper stack, and the paper-plane spot still has its place', () => {
      expect(find(group, 'paper-stack')).toEqual([]);
      expect('paperStack' in BREAK_ROOM).toBe(false);
      expect(layout.hangouts.find((s) => s.name === 'planes')!.places.length).toBeGreaterThan(0);
    });
  });
}
