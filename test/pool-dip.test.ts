import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { INITIAL_ROWS, officeLayout, type HangoutPlace } from '../src/client/layout.ts';
import { buildOffice } from '../src/client/office.ts';
import { Character } from '../src/client/character.ts';
import { lookFor } from '../src/client/look.ts';
import { floatRings } from '../src/client/break-room.ts';
import { RETURN_SECONDS, driftAt, driftParams, emptyDriftAt, type Drift } from '../src/client/float.ts';
import { find, ofType, office, seeded } from './office-sim.ts';

const START = officeLayout(INITIAL_ROWS);
const RINGS = START.hangouts.find((s) => s.name === 'pool-dip')!.places;

function rider(place: HangoutPlace, drift: Drift) {
  const character = new Character(lookFor('session-1'));
  character.placeAt(START.seats[0], 'done', place);
  character.float(drift);
  return character;
}

/** A fresh office group and its rings, in the same order as the pool-dip places. */
function rings() {
  const { group } = buildOffice(INITIAL_ROWS);
  return { group, rings: find(group, 'pool-ring') };
}
const ringAt = (ring: THREE.Object3D) => { ring.updateMatrixWorld(true); return ring.getWorldPosition(new THREE.Vector3()); };

describe('#57 AC1 ring and rider drift together around the home spot', () => {
  it('#57 AC1 the rider drifts along a smooth path near home, and its ring stays under it', () => {
    const drift = driftParams(seeded(3));
    const character = rider(RINGS[1], drift);
    const { group, rings: all } = rings();
    let prev: THREE.Vector3 | null = null, farthest = 0;
    for (let t = 0; t < 60; t += 0.05) {
      character.update(t, 0.05);
      floatRings(group, RINGS.map((_, i) => (i === 1 ? character.floatOffset() : null)));
      const at = character.root.position.clone();
      if (prev) expect(at.distanceTo(prev), 'smooth').toBeLessThan(0.02);
      prev = at;
      farthest = Math.max(farthest, Math.hypot(at.x - RINGS[1].x, at.z - RINGS[1].z));
      const ring = ringAt(all[1]);
      expect(Math.hypot(ring.x - at.x, ring.z - at.z), `t=${t.toFixed(2)} together`).toBeLessThan(1e-6);
    }
    expect(farthest).toBeGreaterThan(0.2);
  });
});

describe('#57 AC2 slow spin and bob', () => {
  it('#57 AC2 the ring turns slowly about its vertical axis with the rider, and both bob together', () => {
    const character = rider(RINGS[0], driftParams(seeded(8)));
    const { group, rings: all } = rings();
    const yaws: number[] = [], bobs: number[] = [];
    for (let t = 0; t < 30; t += 0.05) {
      character.update(t, 0.05);
      const offset = character.floatOffset()!;
      floatRings(group, [offset, null, null, null]);
      yaws.push(character.root.rotation.y);
      expect(all[0].rotation.z).toBeCloseTo(offset.spin, 9);
      expect(character.root.rotation.y).toBeCloseTo(RINGS[0].yaw + offset.spin, 9);
      const ringY = ringAt(all[0]).y;
      bobs.push(ringY);
      expect(character.root.position.y - (ringY - 0.1), 'rider bobs with its ring').toBeCloseTo(0.38, 6);
    }
    const turned = Math.abs(yaws.at(-1)! - yaws[0]);
    expect(turned, 'it turns').toBeGreaterThan(1);
    expect(turned / 30, 'slowly').toBeLessThan(0.5);
    expect(Math.max(...bobs) - Math.min(...bobs)).toBeGreaterThan(0.03);
  });
});

describe('#57 AC3 inside the water, never touching another ring', () => {
  it('#57 AC3 for many seeds, every ring stays in the water and apart from the others', () => {
    const { group, rings: all } = rings();
    const [water] = find(group, 'pool');
    const box = new THREE.Box3().setFromObject(water);
    const inner = { x0: box.min.x + 0.125, x1: box.max.x - 0.125, z0: box.min.z + 0.125, z1: box.max.z - 0.125 };
    const outer = new THREE.Box3().setFromObject(all[0]);
    const radius = (outer.max.x - outer.min.x) / 2;
    const problems: string[] = [];
    for (let seed = 1; seed <= 25; seed++) {
      const random = seeded(seed);
      const drifts = RINGS.map(() => driftParams(random));
      for (let t = 0; t < 200; t += 0.25) {
        const at = RINGS.map((home, i) => { const d = driftAt(drifts[i], t); return { x: home.x + d.x, z: home.z + d.z }; });
        at.forEach((p, i) => {
          const inWater = p.x - radius > inner.x0 && p.x + radius < inner.x1 && p.z - radius > inner.z0 && p.z + radius < inner.z1;
          if (!inWater) problems.push(`seed ${seed} t=${t} ring ${i} out of the water`);
          for (let j = i + 1; j < at.length; j++) {
            if (Math.hypot(p.x - at[j].x, p.z - at[j].z) <= 2 * radius) problems.push(`seed ${seed} t=${t} rings ${i}/${j} touch`);
          }
        });
      }
    }
    expect(problems).toEqual([]);
  });
});

/** Agents taking a pool dip (each on its own since #89), from a seeded office, until 3 have; the drift events sent. */
function dip(seed: number) {
  const o = office(4, seed);
  for (let n = 1; n <= 4; n++) o.set(n, 'done');
  for (let i = 0; i < 4 * 60 * 60 && ofType(o.log.map((l) => l.event), 'drift').length < 3; i++) o.run(0.25);
  return { o, drifts: ofType(o.log.map((l) => l.event), 'drift') };
}

describe('#57 AC4 the motion comes from time and the injectable random', () => {
  it('#57 AC4 the same seed gives the same drift; another seed, another', () => {
    const a = dip(2).drifts, b = dip(2).drifts, c = dip(6).drifts;
    expect(a.length).toBeGreaterThanOrEqual(3);
    expect(a).toEqual(b);
    expect(c.map((d) => d.drift)).not.toEqual(a.map((d) => d.drift));
    for (const t of [0, 5, 17.3]) expect(driftAt(a[0].drift, t)).toEqual(driftAt(b[0].drift, t));
  });

  it('#57 AC4 each rider in a dip gets its own drift as it is sent to its ring', () => {
    const { o } = dip(2);
    const events = o.log.map((l) => l.event);
    const walks = ofType(events, 'walk').filter((w) => w.place?.pose === 'floating');
    const drifts = ofType(events, 'drift');
    expect(drifts.map((d) => d.key).sort()).toEqual(walks.map((w) => w.key).sort());
  });
});

describe('#57 AC5 back to the home spot before climbing out', () => {
  it('#57 AC5 a leaving rider paddles back to the ring\'s home spot, then takes the exit route', () => {
    const character = rider(RINGS[2], driftParams(seeded(4)));
    for (let t = 0; t < 20; t += 0.05) character.update(t, 0.05);
    expect(Math.hypot(character.root.position.x - RINGS[2].x, character.root.position.z - RINGS[2].z)).toBeGreaterThan(0.05);
    const exit = RINGS[2].link;
    character.go([...exit], null);
    let t = 20;
    for (; t < 20 + RETURN_SECONDS - 0.05; t += 0.05) {
      character.update(t, 0.05);
      expect(character.mode, 'still afloat').toBe('hanging');
    }
    for (; t < 20 + RETURN_SECONDS + 0.1; t += 0.05) character.update(t, 0.05);
    expect(character.mode).toBe('hopping');
    expect(Math.hypot(character.root.position.x - RINGS[2].x, character.root.position.z - RINGS[2].z), 'set off from home').toBeLessThan(0.15);
  });

  it('#57 AC5 the controller allows for the paddle home in the walk\'s timing', () => {
    const { o } = dip(2);
    for (let i = 0; i < 400 && ![...o.c.agents.values()].some((a) => a.place?.pose === 'floating' && a.arrivesAt < o.clock.t); i++) o.run(0.25);
    const [key, agent] = [...o.c.agents].find(([, a]) => a.place?.pose === 'floating' && a.arrivesAt < o.clock.t)!;
    const t = o.clock.t;
    const events = o.set(Number(key.replace('session-', '')), 'working');
    const walk = ofType(events, 'walk').find((w) => w.key === key)!;
    const length = walk.path.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - walk.path[i].x, p.z - walk.path[i].z), 0);
    expect(agent.arrivesAt).toBeCloseTo(t + RETURN_SECONDS + length / 1.7, 6);
  });

  // Since #110 an empty ring no longer rests at home: it drifts on its own around it.
  it('#57 AC5 (#110) an empty ring drifts on its own around its home spot', () => {
    const { group, rings: all } = rings();
    floatRings(group, [{ x: 0.1, z: 0.3, spin: 1, bob: 0.02 }, null, null, null]);
    floatRings(group, [null, null, null, null], undefined, 12);
    all.forEach((ring, i) => {
      const at = ringAt(ring), own = emptyDriftAt(i, 12);
      expect(at.x).toBeCloseTo(RINGS[i].x + own.x, 9);
      expect(at.z).toBeCloseTo(RINGS[i].z + own.z, 9);
      expect(ring.rotation.z).toBeCloseTo(own.spin, 9);
    });
  });
});
