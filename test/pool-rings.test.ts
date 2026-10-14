import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { INITIAL_ROWS, officeLayout } from '../src/client/layout.ts';
import { buildOffice } from '../src/client/office.ts';
import { Character } from '../src/client/character.ts';
import { lookFor } from '../src/client/look.ts';
import { floatRings } from '../src/client/break-room.ts';
import { CLIMBING_IN, driftParams, type Afloat } from '../src/client/float.ts';
import { find, seeded } from './office-sim.ts';

const START = officeLayout(INITIAL_ROWS);
const RINGS = START.hangouts.find((s) => s.name === 'pool-dip')!.places;
const DT = 1 / 60;

function pool() {
  const { group } = buildOffice(INITIAL_ROWS);
  const all = find(group, 'pool-ring');
  const box = new THREE.Box3().setFromObject(find(group, 'pool')[0]);
  const ring = new THREE.Box3().setFromObject(all[0]);
  return { group, all, water: box, radius: (ring.max.x - ring.min.x) / 2 };
}
const worldAt = (ring: THREE.Object3D) => { ring.updateMatrixWorld(true); return ring.getWorldPosition(new THREE.Vector3()); };
const turnApart = (a: number, b: number) => { const d = ((a - b) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); return Math.min(d, 2 * Math.PI - d); };

describe('#110 AC1 empty rings drift, turn and bob, each its own way', () => {
  it('#110 AC1 with nobody in them the rings leave the even row, drift, turn slowly and bob, at different angles', () => {
    const { group, all } = pool();
    const paths = all.map(() => [] as THREE.Vector3[]), spins = all.map(() => [] as number[]);
    for (let t = 0; t < 120; t += DT) {
      floatRings(group, RINGS.map(() => null), undefined, t, DT);
      all.forEach((ring, i) => { paths[i].push(worldAt(ring)); spins[i].push(ring.rotation.z); });
      if (Math.round(t / DT) % 30 !== 0) continue;
      const at = all.map(worldAt);
      const zs = at.map((p) => p.z), gaps = at.slice(1).map((p, i) => p.x - at[i].x);
      const row = Math.max(...zs) - Math.min(...zs) < 0.05 && Math.max(...gaps) - Math.min(...gaps) < 0.05;
      expect(row, `t=${t.toFixed(1)} not an even row`).toBe(false);
      all.forEach((a, i) => all.slice(i + 1).forEach((b, j) => {
        expect(turnApart(a.rotation.z, b.rotation.z), `t=${t.toFixed(1)} rings ${i}/${i + 1 + j} turned alike`).toBeGreaterThan(0.1);
      }));
    }
    all.forEach((_, i) => {
      const xs = paths[i].map((p) => p.x), zs = paths[i].map((p) => p.z), ys = paths[i].map((p) => p.y);
      expect(Math.max(...zs) - Math.min(...zs) + Math.max(...xs) - Math.min(...xs), `ring ${i} drifts`).toBeGreaterThan(0.3);
      expect(Math.max(...ys) - Math.min(...ys), `ring ${i} bobs`).toBeGreaterThan(0.03);
      const turned = Math.abs(spins[i].at(-1)! - spins[i][0]);
      expect(turned, `ring ${i} turns`).toBeGreaterThan(1);
      expect(turned / 120, `ring ${i} slowly`).toBeLessThan(0.5);
    });
  });
});

/**
 * Each ring's visitors over time, from `seed`: empty for a while, someone climbing in, afloat with
 * their own drift, then paddling home and hopping out. `each` sees every frame.
 */
function visits(seed: number, seconds: number, each: (t: number, rings: ReturnType<typeof pool>) => void) {
  const random = seeded(seed);
  const rings = pool();
  type Visit = { phase: 'empty' | 'climbing' | 'afloat' | 'leaving'; until: number; character: Character | null };
  const visit: Visit[] = RINGS.map(() => ({ phase: 'empty', until: random() * 15, character: null }));
  let changes = 0;
  for (let t = 0; t < seconds; t += DT) {
    visit.forEach((v, i) => {
      if (v.phase === 'leaving' && v.character!.mode !== 'hanging') Object.assign(v, { phase: 'empty', until: t + 3 + random() * 15, character: null });
      if (t < v.until) return;
      changes++;
      if (v.phase === 'empty') Object.assign(v, { phase: 'climbing', until: t + 0.5 + random() * 3 });
      else if (v.phase === 'climbing') {
        const character = new Character(lookFor(`session-${i + 1}`));
        character.placeAt(START.seats[i], 'done', RINGS[i]);
        character.float(driftParams(random));
        Object.assign(v, { phase: 'afloat', until: t + 5 + random() * 30, character });
      } else if (v.phase === 'afloat') {
        v.character!.go([...RINGS[i].link], null);
        Object.assign(v, { phase: 'leaving', until: Infinity });
      }
    });
    visit.forEach((v) => v.character?.update(t, DT));
    const afloat: (Afloat | null)[] = visit.map((v) => (v.phase === 'climbing' ? CLIMBING_IN : v.character?.floatOffset() ?? null));
    floatRings(rings.group, afloat, undefined, t, DT);
    each(t, rings);
  }
  return changes;
}

describe('#110 AC2 rings stay apart and inside the pool, ridden or empty', () => {
  it('#110 AC2 over many seeds of people coming and going, no ring overlaps another or crosses the edge', () => {
    const problems: string[] = [];
    for (let seed = 1; seed <= 4; seed++) {
      visits(seed, 120, (t, { all, water, radius }) => {
        if (Math.round(t / DT) % 6 !== 0) return;
        const at = all.map(worldAt);
        at.forEach((p, i) => {
          const inside = p.x - radius > water.min.x + 0.125 && p.x + radius < water.max.x - 0.125 && p.z - radius > water.min.z + 0.125 && p.z + radius < water.max.z - 0.125;
          if (!inside) problems.push(`seed ${seed} t=${t.toFixed(2)} ring ${i} crosses the edge`);
          for (let j = i + 1; j < at.length; j++) if (Math.hypot(p.x - at[j].x, p.z - at[j].z) <= 2 * radius) problems.push(`seed ${seed} t=${t.toFixed(2)} rings ${i}/${j} overlap`);
        });
      });
    }
    expect(problems).toEqual([]);
  }, 60_000);
});

describe('#110 AC3 no jump when someone climbs in or out', () => {
  it('#110 AC3 every ring moves at most 2 cm a frame through people climbing in and out', () => {
    for (let seed = 1; seed <= 4; seed++) {
      let prev: THREE.Vector3[] | null = null, worst = 0;
      const changes = visits(seed, 120, (_, { all }) => {
        const at = all.map(worldAt);
        if (prev) at.forEach((p, i) => { worst = Math.max(worst, p.distanceTo(prev![i])); });
        prev = at;
      });
      expect(changes, 'people came and went').toBeGreaterThan(8);
      expect(worst, `seed ${seed}`).toBeLessThanOrEqual(0.02);
    }
  }, 60_000);
});
