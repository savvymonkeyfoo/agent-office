import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { INITIAL_ROWS, LEFT_WALL_FACE, MEETING_ROOM, MEETING_TABLE, officeLayout } from '../src/client/layout.ts';
import { buildOffice } from '../src/client/office.ts';
import { frameFloor, initialOrbit } from '../src/client/camera.ts';
import { find } from './office-sim.ts';

const { group } = buildOffice(INITIAL_ROWS);
const [board] = find(group, 'whiteboard');
const box = new THREE.Box3().setFromObject(board);

describe('#62 whiteboard on the meeting room\'s solid wall', () => {
  // #83 moved it from the meeting room's x0 to the office's left wall, which is the room's solid side.
  it('#62 AC1 it hangs on the left wall, its back within 0.1 m of it, facing into the room (+x)', () => {
    expect(box.min.x - LEFT_WALL_FACE).toBeGreaterThanOrEqual(-0.01);
    expect(box.min.x - LEFT_WALL_FACE).toBeLessThan(0.1);
    expect(box.max.x - box.min.x, 'flat on the wall').toBeLessThan(0.2);
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(board.getWorldQuaternion(new THREE.Quaternion()));
    expect(facing.x).toBeCloseTo(1, 6);
  });

  it('#62 AC2 it sits within the room\'s depth, clear of the meeting table and chairs', () => {
    expect(box.min.z).toBeGreaterThanOrEqual(MEETING_ROOM.z0);
    expect(box.max.z).toBeLessThanOrEqual(MEETING_ROOM.z1);
    expect(box.max.x).toBeLessThan(MEETING_TABLE.x - MEETING_TABLE.w / 2);
    for (const piece of [...find(group, 'meeting-table'), ...find(group, 'meeting-chair')]) {
      expect(box.intersectsBox(new THREE.Box3().setFromObject(piece)), piece.userData.kind).toBe(false);
    }
  });

  it('#62 AC3 nothing opaque stands against the meeting room\'s glass walls', () => {
    const [room] = find(group, 'meeting-room');
    const glassZ = [MEETING_ROOM.z0, MEETING_ROOM.z1];
    room.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || (o.material as THREE.Material).transparent || (o.material as THREE.Material).side === THREE.BackSide) return;
      let glass = false;
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.userData.kind === 'glass' || p.userData.kind === 'glass-wall') glass = true;
      if (glass) return;
      const b = new THREE.Box3().setFromObject(o);
      if (b.max.y < 0.1) return; // floor-level trim
      for (const z of glassZ) {
        const near = b.min.z < z + 0.2 && b.max.z > z - 0.2 && b.max.x > MEETING_ROOM.x0 + 0.2 && b.min.x < MEETING_ROOM.x1 - 0.1;
        expect(near, `${o.parent?.userData.kind ?? o.userData.kind} against the glass at z ${z}`).toBe(false);
      }
    });
  });

  it('#62 AC3 from the reset view, rays to the kitchen places miss the whiteboard', () => {
    const layout = officeLayout(INITIAL_ROWS);
    const kitchen = layout.hangouts.find((s) => s.name === 'kitchen')!.places;
    group.updateMatrixWorld(true);
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const camera = new THREE.PerspectiveCamera(34, w / h, 0.1, 150);
      frameFloor(camera, initialOrbit(), INITIAL_ROWS);
      for (const p of kitchen) {
        for (const y of [0.5, 1.2, 1.9]) {
          const target = new THREE.Vector3(p.x, y, p.z);
          const dir = target.clone().sub(camera.position);
          const ray = new THREE.Raycaster(camera.position, dir.clone().normalize(), 0, dir.length());
          expect(ray.intersectObject(board, true), `${w}×${h} to (${p.x}, ${y}, ${p.z})`).toEqual([]);
        }
      }
    }
  });
});
