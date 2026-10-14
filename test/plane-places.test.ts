import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AISLE_X, INITIAL_ROWS, officeLayout, route, shortestWalk, type OfficeLayout, type Point } from '../src/client/layout.ts';
import { buildOffice } from '../src/client/office.ts';
import { Character } from '../src/client/character.ts';
import { lookFor } from '../src/client/look.ts';
import { PaperPlanes } from '../src/client/paper-planes.ts';
import { collisions, obstaclesIn, routeCollisions } from './geometry.ts';
import { office } from './office-sim.ts';

const ROWS = [INITIAL_ROWS, INITIAL_ROWS + 1];
const FRAME = 1 / 60;
const placesOf = (layout: OfficeLayout) => layout.hangouts.find((s) => s.name === 'planes')!.places;
const deskCentre = (layout: OfficeLayout): Point => {
  const desks = layout.seats.map((s) => s.desk);
  return { x: desks.reduce((sum, d) => sum + d.x, 0) / desks.length, z: desks.reduce((sum, d) => sum + d.z, 0) / desks.length };
};
const distanceToSegment = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
};

describe('#86 AC1 four throwing places around the desk area', () => {
  for (const rows of ROWS) {
    it(`#86 AC1 one on each side aisle, one in front of the desks and one behind them (${rows} rows)`, () => {
      const layout = officeLayout(rows);
      const places = placesOf(layout);
      expect(places).toHaveLength(4);
      for (const p of places) expect(p.pose).toBe('throwing-plane');
      const desksZ = layout.seats.map((s) => s.desk.z), chairsZ = layout.seats.map((s) => s.chair.z);
      const alongDesks = (p: Point) => p.z > Math.min(...chairsZ) && p.z < Math.max(...desksZ);
      const left = places.filter((p) => Math.abs(p.x + AISLE_X) < 1.2 && alongDesks(p));
      const right = places.filter((p) => Math.abs(p.x - AISLE_X) < 1.2 && alongDesks(p));
      const front = places.filter((p) => Math.abs(p.x) < AISLE_X - 1 && p.z > Math.max(...desksZ));
      const back = places.filter((p) => Math.abs(p.x) < AISLE_X - 1 && p.z < Math.min(...chairsZ));
      expect([left, right, front, back].map((side) => side.length)).toEqual([1, 1, 1, 1]);
    });
  }

  it('#86 AC1 the existing place on the right aisle is still one of them', () => {
    expect(placesOf(officeLayout(INITIAL_ROWS))).toContainEqual(expect.objectContaining({ x: 6.25, z: 4.4 }));
  });
});

describe('#86 AC2 each place faces the desk area', () => {
  for (const rows of ROWS) {
    it(`#86 AC2 within 45° of the direction to the desks' centre (${rows} rows)`, () => {
      const layout = officeLayout(rows);
      const centre = deskCentre(layout);
      for (const p of placesOf(layout)) {
        const to = Math.atan2(centre.x - p.x, centre.z - p.z);
        const off = Math.abs(Math.atan2(Math.sin(p.yaw - to), Math.cos(p.yaw - to)));
        expect(off * (180 / Math.PI), `(${p.x}, ${p.z})`).toBeLessThanOrEqual(45);
      }
    });
  }
});

describe('#86 AC3 clear of furniture and routes, linked to a walkway', () => {
  for (const rows of ROWS) {
    it(`#86 AC3 no furniture under a place, nor on the way out to its walkway (${rows} rows)`, () => {
      const { group, layout } = buildOffice(rows);
      const obstacles = obstaclesIn(group);
      for (const p of placesOf(layout)) {
        expect(collisions([p, p], obstacles), `(${p.x}, ${p.z})`).toEqual([]);
        expect(collisions(p.link, obstacles), `link from (${p.x}, ${p.z})`).toEqual([]);
        expect(() => shortestWalk(layout.walkways, p.link.at(-1)!, layout.doorLink.at(-1)!)).not.toThrow();
        for (const end of [layout.doorLink, ...layout.seats.map((s) => s.link)]) {
          expect(routeCollisions(route(layout, p.link, end), obstacles), `(${p.x}, ${p.z})`).toEqual([]);
        }
      }
    });

    it(`#86 AC3 a place stands off the walkways and away from every other place (${rows} rows)`, () => {
      const layout = officeLayout(rows);
      const others = [
        ...layout.hangouts.flatMap((s) => s.places).filter((p) => p.spot !== 'planes'),
        ...layout.dogSpots.flatMap((d) => [d.dog, ...d.visitors.map((v) => v.at)]),
      ];
      for (const p of placesOf(layout)) {
        const fromWalkway = Math.min(...layout.walkways.flatMap((w) => w.slice(1).map((b, i) => distanceToSegment(p, w[i], b))));
        expect(fromWalkway, `(${p.x}, ${p.z}) from a walkway`).toBeGreaterThanOrEqual(0.4);
        for (const q of others) expect(Math.hypot(p.x - q.x, p.z - q.z), `(${p.x}, ${p.z}) by ${'spot' in q ? q.spot : 'dog'}`).toBeGreaterThan(0.9);
      }
    });
  }
});

describe('#86 AC4 a plane from any place lands on a desk', () => {
  for (const rows of ROWS) {
    it(`#86 AC4 thrown from each place, a plane ends on the desk top it was aimed at (${rows} rows)`, () => {
      const layout = officeLayout(rows);
      for (const place of placesOf(layout)) {
        for (const seat of [layout.seats[0], layout.seats.at(-1)!]) {
          const character = new Character(lookFor('session-1'));
          character.placeAt(layout.seats[0], 'done', place);
          for (let t = 0; t < 1; t += FRAME) character.update(t, FRAME);
          const planes = new PaperPlanes(new THREE.Scene());
          character.throwPlane((from) => planes.throw(from, seat.desk));
          for (let t = 1; t < 6; t += FRAME) { character.update(t, FRAME); character.root.updateMatrixWorld(true); planes.update(FRAME); }
          const [plane] = planes.planes();
          expect(plane, `thrown from (${place.x}, ${place.z})`).toBeDefined();
          expect(Math.hypot(plane.position.x - seat.desk.x, plane.position.z - seat.desk.z)).toBeLessThan(0.01);
          expect(plane.position.y).toBeGreaterThan(0.79);
          expect(plane.position.y).toBeLessThan(1.0);
        }
      }
    });
  }
});

describe('#86 AC5 one agent per place, several places at once', () => {
  it('#86 AC5 with 12 idle agents for an hour, no place holds two, and two or more are in use together', () => {
    const o = office(12, 4);
    for (let n = 1; n <= 12; n++) o.set(n, n % 2 ? 'done' : 'finished');
    const places = placesOf(o.c.layout);
    let most = 0;
    o.run(60 * 60, 0.25, () => {
      const held = [...o.c.agents.values()].flatMap((a) => (a.place && places.includes(a.place) ? [a.place] : []));
      expect(new Set(held).size).toBe(held.length);
      most = Math.max(most, held.length);
    });
    expect(most).toBeGreaterThanOrEqual(2);
  });
});
