import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BREAK_ROOM } from '../src/client/layout.ts';
import { FISH, PondFish, fishAt } from '../src/client/water.ts';

const { pond } = BREAK_ROOM;
const parts = (root: THREE.Object3D, name: string) => {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => { if (o.userData.part === name) out.push(o as THREE.Mesh); });
  return out;
};
/** The meshes under `root` (no outline hulls), boxed in `fish`'s frame (nose along +z). */
function localBox(fish: THREE.Object3D, root: THREE.Object3D = fish) {
  fish.updateMatrixWorld(true);
  const toFish = fish.matrixWorld.clone().invert(), box = new THREE.Box3();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || (o.material as THREE.Material).side === THREE.BackSide) return;
    o.geometry.computeBoundingBox();
    box.union(o.geometry.boundingBox!.clone().applyMatrix4(toFish.clone().multiply(o.matrixWorld)));
  });
  return box;
}
const tailPivot = (fish: THREE.Object3D) => parts(fish, 'fish-tail')[0].parent!;

describe('#108 AC1 a bit bigger, still inside the pond', () => {
  it('#108 AC1 each fish is 0.33–0.4 m from nose to tail tip', () => {
    const { fish } = new PondFish(new THREE.Scene());
    for (const f of fish) {
      tailPivot(f).rotation.y = 0;
      const box = localBox(f);
      expect(box.max.z - box.min.z).toBeGreaterThanOrEqual(0.33);
      expect(box.max.z - box.min.z).toBeLessThanOrEqual(0.4);
    }
  });

  it('#108 AC1 nose and tail tip stay inside the pond as they swim', () => {
    const { fish } = new PondFish(new THREE.Scene());
    for (let i = 0; i < FISH; i++) {
      tailPivot(fish[i]).rotation.y = 0;
      const box = localBox(fish[i]);
      for (let t = 0; t < 300; t += 0.1) {
        const f = fishAt(i, t);
        for (const d of [box.max.z, box.min.z]) {
          const p = { x: f.x + Math.sin(f.heading) * d, z: f.z + Math.cos(f.heading) * d };
          expect(((p.x - pond.x) / pond.rx) ** 2 + ((p.z - pond.z) / pond.rz) ** 2, `fish ${i} t=${t.toFixed(1)}`).toBeLessThan(0.85);
        }
      }
    }
  });
});

describe('#108 AC2 fish-shaped', () => {
  it('#108 AC2 a tapered body, a flat upright tail fin, a back fin and an eye on each side', () => {
    const { fish } = new PondFish(new THREE.Scene());
    for (const f of fish) {
      tailPivot(f).rotation.y = 0;
      const [body] = parts(f, 'fish-body');
      const b = localBox(f, body);
      const len = b.max.z - b.min.z;
      const pos = body.geometry.getAttribute('position');
      /** The body's widest radius between z0 and z1 (its own frame, nose along +z). */
      const girth = (z0: number, z1: number) => {
        let r = 0;
        for (let k = 0; k < pos.count; k++) if (pos.getZ(k) >= z0 && pos.getZ(k) <= z1) r = Math.max(r, Math.hypot(pos.getX(k), pos.getY(k)));
        return r;
      };
      expect(girth(b.min.z, b.min.z + len * 0.15), 'thin at the tail end').toBeLessThan(girth(b.min.z + len * 0.4, b.min.z + len * 0.8) * 0.5);

      const t = localBox(f, parts(f, 'fish-tail')[0]);
      expect(t.max.y - t.min.y, 'tail fin is upright').toBeGreaterThan(0.08);
      expect(t.max.x - t.min.x, 'tail fin is flat').toBeLessThan(0.025);
      expect(t.max.z, 'tail fin is behind the body').toBeLessThan(b.min.z + len * 0.2);

      const d = localBox(f, parts(f, 'fish-dorsal')[0]);
      expect(d.max.y, 'back fin sticks up above the body').toBeGreaterThan(b.max.y + 0.02);
      expect(d.max.x - d.min.x, 'back fin is flat').toBeLessThan(0.025);

      const eyes = parts(f, 'fish-eye').map((e) => localBox(f, e).getCenter(new THREE.Vector3()));
      expect(eyes).toHaveLength(2);
      expect(eyes.map((e) => Math.sign(e.x)).sort()).toEqual([-1, 1]);
      for (const e of eyes) expect(e.z, 'eyes towards the nose').toBeGreaterThan(b.min.z + len * 0.6);
    }
  });
});

describe('#108 AC3 the tail waves', () => {
  it('#108 AC3 the tail fin swings to both sides as the fish swims, in the pond and on the line', () => {
    const pondFish = new PondFish(new THREE.Scene());
    const caught = { index: 1, at: { x: -6, y: 0.8, z: 11 }, heading: 0, alert: false };
    for (const hooked of [null, caught]) {
      pondFish.fish.forEach((f, i) => {
        const [tail] = parts(f, 'fish-tail');
        tailPivot(f).rotation.y = 0;
        const tipAtRest = new THREE.Vector3(0, 0, localBox(tail, tail).min.z);
        const sides = new Set<number>();
        for (let t = 0; t < 2; t += 0.05) {
          pondFish.update(t, hooked);
          f.updateMatrixWorld(true);
          const tip = f.worldToLocal(tail.localToWorld(tipAtRest.clone()));
          if (Math.abs(tip.x) > 0.03) sides.add(Math.sign(tip.x));
        }
        expect([...sides].sort(), `fish ${i}${hooked ? ' (one hooked)' : ''}`).toEqual([-1, 1]);
      });
    }
  });
});
