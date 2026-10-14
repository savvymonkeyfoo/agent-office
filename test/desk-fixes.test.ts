import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildOffice } from '../src/client/office.ts';
import { PaperPlanes } from '../src/client/paper-planes.ts';

const office = buildOffice(3);
office.group.updateMatrixWorld(true);
const desks: THREE.Object3D[] = [];
office.group.traverse((o) => { if (o.userData.kind === 'desk') desks.push(o); });

const partOf = (desk: THREE.Object3D, name: string) => {
  let found: THREE.Object3D | undefined;
  desk.traverse((o) => { if (o.userData.part === name) found = o; });
  return found!.getWorldPosition(new THREE.Vector3());
};

/** Each desk with its sitter's facing and right-hand directions (from chair to desk). */
const sittings = office.seats.map((seat, i) => {
  const forward = new THREE.Vector3(seat.desk.x - seat.chair.x, 0, seat.desk.z - seat.chair.z).normalize();
  const right = forward.clone().cross(new THREE.Vector3(0, 1, 0));
  const chair = new THREE.Vector3(seat.chair.x, 0, seat.chair.z);
  return { desk: desks[i], forward, right, chair };
});

describe('#85 desk fixes', () => {
  it('#85 AC1 the mouse is on the sitter\'s right of the keyboard at every desk', () => {
    expect(sittings.length).toBeGreaterThan(16);
    for (const { desk, right } of sittings) {
      const offset = partOf(desk, 'mouse').sub(partOf(desk, 'keyboard')).dot(right);
      expect(offset).toBeGreaterThan(0.2);
    }
  });

  it('#85 AC2 the keyboard is centred in front of the sitter', () => {
    for (const { desk, forward, right, chair } of sittings) {
      const keyboard = partOf(desk, 'keyboard').sub(chair);
      expect(Math.abs(keyboard.dot(right))).toBeLessThan(0.01);
      expect(keyboard.dot(forward)).toBeGreaterThan(0);
    }
  });

  it('#85 AC3 a landed plane\'s lowest point is within 1 cm of the desk top', () => {
    const seat = office.seats[0];
    const top = new THREE.Box3().setFromObject(desks[0].children[0]).max.y;
    const planes = new PaperPlanes(new THREE.Scene());
    planes.throw(new THREE.Vector3(seat.chair.x + 3, 1.4, seat.chair.z), seat.desk);
    for (let i = 0; i < 120; i++) planes.update(1 / 60);
    const [plane] = planes.planes();
    plane.updateMatrixWorld(true);
    expect(Math.abs(new THREE.Box3().setFromObject(plane).min.y - top)).toBeLessThan(0.01);
  });
});
