import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { INITIAL_ROWS, officeLayout, route } from '../src/client/layout.ts';
import { buildOffice, updateBackWall } from '../src/client/office.ts';
import { collisions, inside, obstaclesIn, routeCollisions } from './geometry.ts';

const WORKTOP = 0.91;
const NEW_PIECES = ['fridge', 'wall-cabinet', 'kettle', 'fruit-bowl', 'toaster', 'vase'];

const where = (root: THREE.Object3D, test: (o: THREE.Object3D) => boolean) => {
  const found: THREE.Object3D[] = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => { if (test(o)) found.push(o); });
  return found;
};
const tagged = (root: THREE.Object3D, kind: string) => where(root, (o) => o.userData.kind === kind);
const parts = (root: THREE.Object3D, name: string) => where(root, (o) => o.userData.part === name);
const boxOf = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o);
const centre = (o: THREE.Object3D) => boxOf(o).getCenter(new THREE.Vector3());

describe('#88 a fuller kitchen', () => {
  const office = buildOffice(INITIAL_ROWS);
  const { group, layout } = office;
  const [kitchen] = tagged(group, 'kitchen');
  const counter = boxOf(tagged(kitchen, 'kitchen-counter')[0]);

  it('#88 AC1 the sink is a basin sunk into the counter, with a tap behind it', () => {
    const [sink] = tagged(kitchen, 'sink');
    const [basin] = parts(sink, 'basin-floor');
    const [tap] = parts(sink, 'tap');
    expect(boxOf(basin).max.y).toBeLessThan(WORKTOP - 0.1);
    // Nothing of the counter covers the basin from above.
    const top = centre(basin);
    const above = new THREE.Raycaster(new THREE.Vector3(top.x, 2, top.z), new THREE.Vector3(0, -1, 0));
    const [firstHit] = above.intersectObject(kitchen, true).filter((h) => (h.object as THREE.Mesh).material instanceof THREE.MeshToonMaterial);
    expect(firstHit.object.userData.part ?? firstHit.object.parent?.userData.part).toBe('basin-floor');
    expect(boxOf(tap).max.y).toBeGreaterThan(WORKTOP + 0.1);
    expect(centre(tap).z).toBeLessThan(top.z);
  });

  it('#88 AC2 the coffee machine has a spout above a drip tray, and its mug sits on the tray under the spout', () => {
    const [machine] = tagged(kitchen, 'coffee-machine');
    const [spout] = parts(machine, 'spout'), [tray] = parts(machine, 'drip-tray'), [mug] = parts(machine, 'mug');
    const s = boxOf(spout), t = boxOf(tray), m = boxOf(mug);
    expect(s.min.y).toBeGreaterThan(m.max.y);
    expect(m.min.y).toBeCloseTo(t.max.y, 2);
    for (const axis of ['x', 'z'] as const) {
      expect(m.min[axis]).toBeGreaterThanOrEqual(t.min[axis]);
      expect(m.max[axis]).toBeLessThanOrEqual(t.max[axis]);
      expect(centre(spout)[axis]).toBeCloseTo(centre(mug)[axis], 2);
    }
  });

  it('#88 AC3 a fridge at one end of the counter', () => {
    const fridge = boxOf(tagged(kitchen, 'fridge')[0]);
    const atEnd = Math.min(Math.abs(fridge.max.x - counter.max.x), Math.abs(fridge.min.x - counter.min.x));
    expect(atEnd).toBeLessThan(0.05);
    expect(fridge.max.y).toBeGreaterThan(1.2);
  });

  it('#88 AC3 wall cabinets with mugs and jars above the counter', () => {
    const cabinets = tagged(group, 'wall-cabinet');
    expect(cabinets.length).toBeGreaterThan(0);
    for (const cabinet of cabinets) {
      const b = boxOf(cabinet);
      expect(b.min.y).toBeGreaterThan(WORKTOP + 0.3);
      expect(b.min.x).toBeGreaterThanOrEqual(counter.min.x);
      expect(b.max.x).toBeLessThanOrEqual(counter.max.x);
    }
    expect(cabinets.flatMap((c) => parts(c, 'mug')).length).toBeGreaterThan(0);
    expect(cabinets.flatMap((c) => parts(c, 'jar')).length).toBeGreaterThan(0);
  });

  it('#88 AC3 a kettle, a fruit bowl and a toaster on the worktop', () => {
    for (const kind of ['kettle', 'fruit-bowl', 'toaster']) {
      const pieces = tagged(kitchen, kind);
      expect(pieces, kind).toHaveLength(1);
      const b = boxOf(pieces[0]);
      expect(Math.abs(b.min.y - WORKTOP), `${kind} stands on the worktop`).toBeLessThan(0.03);
      const c = centre(pieces[0]);
      expect(inside(c, counter, 0), `${kind} over the counter`).toBe(true);
    }
  });

  it('#88 AC3 a vase on the bistro table', () => {
    const table = tagged(kitchen, 'kitchen-table')[0];
    const vase = boxOf(tagged(kitchen, 'vase')[0]);
    expect(Math.abs(vase.min.y - boxOf(table).max.y)).toBeLessThan(0.03);
    const c = centre(table), v = vase.getCenter(new THREE.Vector3());
    expect(Math.hypot(v.x - c.x, v.z - c.z)).toBeLessThan(0.3);
  });

  it('#88 AC4 the wall cabinets keep clear of the windows and hide with the back wall', () => {
    const cabinets = tagged(group, 'wall-cabinet');
    const windows = tagged(group, 'window');
    expect(cabinets.length).toBeGreaterThan(0);
    for (const c of cabinets) for (const w of windows) expect(boxOf(c).intersectsBox(boxOf(w))).toBe(false);

    const shown = (o: THREE.Object3D) => { for (let n: THREE.Object3D | null = o; n; n = n.parent) if (!n.visible) return false; return true; };
    updateBackWall(office, new THREE.Vector3(0, 8, layout.bounds.back - 3));
    expect(windows.some(shown)).toBe(false);
    for (const c of cabinets) expect(shown(c)).toBe(false);
    updateBackWall(office, new THREE.Vector3(0, 8, 20));
    for (const c of cabinets) expect(shown(c)).toBe(true);
  });

  for (const rows of [INITIAL_ROWS, INITIAL_ROWS + 1]) {
    it(`#88 AC5 no new piece blocks a kitchen place or a walking route (${rows} rows)`, () => {
      const { group: g, layout: l } = buildOffice(rows);
      const pieces = obstaclesIn(g).filter((o) => NEW_PIECES.includes(o.kind));
      expect(pieces.length).toBeGreaterThanOrEqual(NEW_PIECES.length);
      const places = l.hangouts.find((s) => s.name === 'kitchen')!.places;
      for (const p of places) for (const o of pieces) expect(inside(p, o.box, 0.25), `${p.pose} place vs ${o.kind}`).toBe(false);
      for (const w of l.walkways) expect(collisions(w, pieces)).toEqual([]);
      const obstacles = obstaclesIn(g);
      const ends = [l.doorLink, ...l.seats.map((s) => s.link), ...l.hangouts.flatMap((s) => s.places).map((p) => p.link)];
      for (const p of places) {
        for (const end of ends) {
          expect(routeCollisions(route(l, p.link, end), obstacles)).toEqual([]);
          expect(routeCollisions(route(l, end, p.link), obstacles)).toEqual([]);
        }
      }
    });
  }

  it('#88 AC6 every kitchen piece moves back with the kitchen when a row of desks is added', () => {
    const pieces = (rows: number) => {
      const g = buildOffice(rows).group;
      const [k] = tagged(g, 'kitchen');
      return [...where(k, (o) => !!o.userData.kind || !!o.userData.part), ...tagged(g, 'wall-cabinet')];
    };
    const before = pieces(INITIAL_ROWS), after = pieces(INITIAL_ROWS + 1);
    const dz = officeLayout(INITIAL_ROWS + 1).bounds.back - officeLayout(INITIAL_ROWS).bounds.back;
    expect(dz).toBeLessThan(0);
    expect(before.map((o) => o.userData.kind)).toEqual(expect.arrayContaining([...NEW_PIECES, 'sink', 'coffee-machine']));
    expect(after.length).toBe(before.length);
    before.forEach((o, i) => {
      const a = centre(o), b = centre(after[i]);
      const name = o.userData.kind ?? o.userData.part;
      expect(b.x - a.x, name).toBeCloseTo(0, 5);
      expect(b.z - a.z, name).toBeCloseTo(dz, 5);
    });
  });
});
