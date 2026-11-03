// Control 1 for the Innovation lab: the two existing layouts must not change while it's built.
// Each is summarised (floor plan numbers and the built scene's parts and where they stand) and
// compared with a saved snapshot, so any change to Classic or the Control room fails here.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { officeLayout } from '../src/client/layout.ts';
import { buildOffice } from '../src/client/office.ts';

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Every tagged part of the built office: its kind and where it stands in the world. */
function sceneSummary(group: THREE.Object3D) {
  group.updateMatrixWorld(true);
  const parts: string[] = [];
  group.traverse((o) => {
    if (!o.userData.kind) return;
    const p = o.getWorldPosition(new THREE.Vector3());
    parts.push(`${o.userData.kind}@${round(p.x)},${round(p.y)},${round(p.z)}`);
  });
  let meshes = 0;
  group.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes++; });
  return { meshes, parts };
}

describe('Classic and Control room stay as they are', () => {
  for (const preset of ['classic', 'control-room']) {
    for (const rows of [2, 3, 4]) {
      it(`${preset} with ${rows} rows: same floor plan and same scene`, () => {
        const layout = JSON.parse(JSON.stringify(officeLayout(rows, preset), (_, v) => (typeof v === 'number' ? round(v) : v)));
        expect(layout).toMatchSnapshot();
        expect(sceneSummary(buildOffice(rows, preset).group)).toMatchSnapshot();
      });
    }
  }
});
