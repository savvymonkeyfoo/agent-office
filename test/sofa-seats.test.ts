import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { INITIAL_ROWS, officeLayout, type HangoutPlace } from '../src/client/layout.ts';
import { buildOffice } from '../src/client/office.ts';
import { Character } from '../src/client/character.ts';
import { find, office } from './office-sim.ts';

const SOFA = ['lounge', 'couch-co-op'];
const LAYOUTS = ['classic', 'control-room'] as const;
const look = { shirt: '#5B7DB1', hat: 'cap' as const, hatColor: '#3A3150', skin: '#F6CFA8' };

function sofaOf(kind: (typeof LAYOUTS)[number]) {
  const layout = officeLayout(INITIAL_ROWS, kind);
  const { group } = buildOffice(INITIAL_ROWS, kind);
  group.updateMatrixWorld(true);
  const [sofa] = find(group, 'sofa');
  const spot = (name: string) => layout.hangouts.find((s) => s.name === name)!;
  return { layout, sofa, spot };
}

/**
 * World boxes of each visible mesh on `c` (body, head, hat, hands, a held mug or controller), each of its
 * own geometry only: setFromObject would also take in hidden props parented to a hand.
 */
function meshBoxes(c: Character) {
  const boxes: THREE.Box3[] = [];
  c.root.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    boxes.push(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld));
  });
  return boxes;
}

describe('#112 three roomy seats on the sofa', () => {
  for (const kind of LAYOUTS) {
    it(`#112 AC1 ${kind}: the sofa has three seats, shared by lounging and co-op; co-op needs 2`, () => {
      const { spot } = sofaOf(kind);
      expect(spot('lounge').places).toHaveLength(3);
      expect(spot('couch-co-op').places).toHaveLength(3);
      expect(spot('couch-co-op').game).toEqual({ min: 2 });
      const seats = (name: string) => spot(name).places.map((p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`);
      expect(seats('couch-co-op')).toEqual(seats('lounge'));
    });

    it(`#112 AC2 ${kind}: seats are at least 0.8 m apart and on the sofa`, () => {
      const { layout, sofa, spot } = sofaOf(kind);
      const box = new THREE.Box3().setFromObject(sofa);
      for (const name of SOFA) {
        const places = spot(name).places;
        places.forEach((p, i) => {
          expect(p.x >= box.min.x && p.x <= box.max.x && p.z >= box.min.z && p.z <= box.max.z, `${name} ${p.x}, ${p.z}`).toBe(true);
          for (const q of places.slice(i + 1)) expect(Math.hypot(p.x - q.x, p.z - q.z), `${name}`).toBeGreaterThanOrEqual(0.8 - 1e-9);
        });
      }
      expect(layout.lounge.sofa.w).toBe(2.8);
    });

    it(`#112 AC3 ${kind}: neighbours never overlap, lounging, gaming or cheering`, () => {
      const { spot } = sofaOf(kind);
      for (const name of SOFA) {
        const seats = [...spot(name).places].sort((a, b) => a.x - b.x) as HangoutPlace[];
        const sitters = seats.map((place) => {
          const c = new Character(look);
          c.placeAt(officeLayout(INITIAL_ROWS, kind).seats[0], 'done', place);
          return c;
        });
        for (let f = 0; f < 60 * 8; f++) {
          for (const c of sitters) {
            if (f % 90 === 30) c.cheer();
            c.update(f / 60, 1 / 60);
            c.root.updateMatrixWorld(true);
          }
          // Boxes are a little bigger than the round parts inside them, so apart boxes means apart bodies.
          const boxes = sitters.map(meshBoxes);
          for (let i = 0; i + 1 < boxes.length; i++) {
            const touching = boxes[i].some((a) => boxes[i + 1].some((b) => a.intersectsBox(b)));
            if (touching) expect(touching, `${name} t=${(f / 60).toFixed(2)}: sitters ${i} and ${i + 1} overlap`).toBe(false);
          }
        }
      }
    }, 30_000);
  }

  it('#112 AC1 with plenty of idle agents, never more than 3 on the sofa; co-op is 2–3 players', () => {
    const o = office(10, 3);
    for (let n = 1; n <= 10; n++) o.set(n, 'done');
    let games = 0;
    o.run(120 * 60, 0.25, () => {
      const on = (name: string) => [...o.c.agents.values()].filter((a) => a.place?.spot === name).length;
      expect(on('lounge') + on('couch-co-op')).toBeLessThanOrEqual(3);
      if (on('couch-co-op') >= 2) games++;
    });
    expect(games).toBeGreaterThan(0);
  }, 60_000);
});
