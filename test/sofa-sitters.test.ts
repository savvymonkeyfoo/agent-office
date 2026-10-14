import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { INITIAL_ROWS, officeLayout } from '../src/client/layout.ts';
import { buildOffice } from '../src/client/office.ts';
import { Character } from '../src/client/character.ts';
import type { HatKind } from '../src/client/look.ts';
import { find } from './office-sim.ts';

const layout = officeLayout(INITIAL_ROWS);
const { group } = buildOffice(INITIAL_ROWS);
group.updateMatrixWorld(true);
const [sofa] = find(group, 'sofa');
const toSofa = sofa.matrixWorld.clone().invert();
const parts = (name: string) => { const found: THREE.Mesh[] = []; sofa.traverse((o) => { if (o.userData.part === name) found.push(o as THREE.Mesh); }); return found; };
/** A part's box in the sofa's own frame (the sofa faces +z there; its backrest is at -z). */
const localBox = (m: THREE.Object3D) => new THREE.Box3().setFromObject(m).applyMatrix4(toSofa);
const backrest = localBox(parts('backrest')[0]);
const cushions = parts('cushion').map(localBox);
const outline = localBox(sofa);
const cushionTop = Math.max(...cushions.map((c) => c.max.y));

const HATS: HatKind[] = ['headphones', 'cap', 'beanie', 'chef', 'tuft', 'bun'];
const sofaPlaces = layout.hangouts.filter((s) => s.name === 'lounge' || s.name === 'couch-co-op').flatMap((s) => s.places);
const FPS = 60, SECONDS = 20;

/** Every visible mesh of the character (body, head, hat, hands, feet, what it holds, outlines). */
function visibleMeshes(root: THREE.Object3D) {
  const out: THREE.Mesh[] = [];
  const walk = (o: THREE.Object3D) => {
    if (!o.visible) return;
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
    o.children.forEach(walk);
  };
  walk(root);
  return out;
}

/** A mesh's vertices in the sofa's frame. */
function* vertices(m: THREE.Mesh) {
  const pos = m.geometry.attributes.position;
  const toLocal = toSofa.clone().multiply(m.matrixWorld);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) yield v.fromBufferAttribute(pos, i).applyMatrix4(toLocal);
}

/** Sit someone in each sofa place (cheering throughout, if `cheer`) and call `check` every frame for 20 s. */
function sitThrough(cheer: boolean, check: (c: Character, label: () => string) => void) {
  sofaPlaces.forEach((place, i) => {
    const c = new Character({ shirt: '#5B7DB1', hat: HATS[i % HATS.length], hatColor: '#3A3150', skin: '#F6CFA8' });
    c.placeAt(layout.seats[0], 'done', place);
    for (let f = 0; f < FPS * SECONDS; f++) {
      if (cheer && f % 60 === 0) c.cheer();
      c.update(f / FPS, 1 / FPS);
      c.root.updateMatrixWorld(true);
      check(c, () => `${place.spot} ${place.pose}${cheer ? ' cheering' : ''} at x ${place.x}, t=${(f / FPS).toFixed(2)}`);
    }
  });
}

describe('#77 sofa sitters stay in front of the backrest', () => {
  it('#77 AC1 sofa parts are tagged, so the checks below measure the real sofa', () => {
    expect(sofaPlaces.map((p) => p.pose).sort()).toEqual(['gaming', 'gaming', 'gaming', 'lounging', 'lounging', 'lounging']); // 3 seats each (#112)
    expect(cushions).toHaveLength(3);
    expect(backrest.max.z).toBeLessThan(0); // the backrest is behind the seat's middle
  });

  for (const cheer of [false, true]) {
    it(`#77 AC1 ${cheer ? 'the cheer' : 'lounging and gaming'}: nothing crosses the backrest's front face or comes out of the sofa's back or sides`, () => {
      sitThrough(cheer, (c, label) => {
        const worst = { into: -Infinity, back: Infinity, side: -Infinity };
        for (const m of visibleMeshes(c.root)) {
          for (const v of vertices(m)) {
            if (v.y <= backrest.max.y) worst.into = Math.max(worst.into, backrest.max.z - v.z);
            worst.back = Math.min(worst.back, v.z);
            worst.side = Math.max(worst.side, Math.abs(v.x) - outline.max.x);
          }
        }
        if (worst.into > 0 || worst.back < outline.min.z || worst.side > 0) {
          expect(worst.into, `${label()}: into the backrest`).toBeLessThanOrEqual(0);
          expect(worst.back, `${label()}: out of the back`).toBeGreaterThanOrEqual(outline.min.z);
          expect(worst.side, `${label()}: out of the side`).toBeLessThanOrEqual(0);
        }
      });
    }, 30_000);
  }

  for (const cheer of [false, true]) {
    it(`#77 AC2 ${cheer ? 'the cheer' : 'lounging and gaming'}: the body's lowest point is on a cushion, within 0.05 m of its top`, () => {
      sitThrough(cheer, (c, label) => {
        const body = c.pivot.children[0] as THREE.Mesh;
        let low = new THREE.Vector3(0, Infinity, 0);
        for (const v of vertices(body)) if (v.y < low.y) low = v.clone();
        const over = cushions.some((k) => low.x >= k.min.x && low.x <= k.max.x && low.z >= k.min.z && low.z <= k.max.z);
        if (Math.abs(low.y - cushionTop) > 0.05 || !over) {
          expect(Math.abs(low.y - cushionTop), `${label()}: ${low.y.toFixed(3)} vs cushion top ${cushionTop.toFixed(3)}`).toBeLessThanOrEqual(0.05);
          expect(over, `${label()}: over a cushion`).toBe(true);
        }
      });
    }, 30_000);
  }
});
