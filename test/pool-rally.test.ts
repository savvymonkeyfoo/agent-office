import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { INITIAL_ROWS, officeLayout } from '../src/client/layout.ts';
import { buildOffice } from '../src/client/office.ts';
import { Character } from '../src/client/character.ts';
import { lookFor, type HatKind } from '../src/client/look.ts';
import { PoolBalls } from '../src/client/break-room.ts';
import { BALL_R, FELT, POCKETS, POCKET_R, RACK_SECONDS, SHOT_COUNT, SHOT_SECONDS, ballsAt } from '../src/client/pool.ts';
import { find, ofType, office } from './office-sim.ts';

const START = officeLayout(INITIAL_ROWS);
const TURNS = START.poolTurns;
const { group } = buildOffice(INITIAL_ROWS);
const [table] = find(group, 'pool-table');
const footprint = new THREE.Box3().setFromObject(table);
const parts = (name: string) => { const out: THREE.Object3D[] = []; table.traverse((o) => { if (o.userData.part === name) out.push(o); }); return out; };
const surface = new THREE.Box3().setFromObject(parts('felt')[0]).max.y;

/** One session id per hat, so every head shape is checked. */
const HAT_KEYS = (() => {
  const keys = new Map<HatKind, string>();
  for (let n = 0; keys.size < 6; n++) if (!keys.has(lookFor(`s${n}`).hat)) keys.set(lookFor(`s${n}`).hat, `s${n}`);
  return [...keys.values()];
})();

function shooterAt(key: string, k: number) {
  const character = new Character(lookFor(key));
  character.placeAt(START.seats[0], 'done', TURNS[k].shoot);
  for (let t = 0; t < 1; t += 0.05) character.update(t, 0.05);
  return character;
}

const meshes = (root: THREE.Object3D, keep: (o: THREE.Object3D) => boolean) => {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => { if (o instanceof THREE.Mesh && keep(o)) out.push(o); });
  return out;
};
/** A mesh's own world box (not its children's), from its vertices. */
function ownBox(mesh: THREE.Mesh) {
  const box = new THREE.Box3(), v = new THREE.Vector3(), position = mesh.geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) box.expandByPoint(v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld));
  return box;
}
const inCue = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.userData.kind === 'cue') return true; return false; };
const shown = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false; return true; };

describe('#53 AC1 the shooter stays out of the table and the cue above it', () => {
  for (let k = 0; k < SHOT_COUNT; k++) {
    it(`#53 AC1 shot ${k + 1}: whole cue above the playing surface, body outside the table's footprint (every hat)`, () => {
      for (const key of HAT_KEYS) {
        const character = shooterAt(key, k);
        for (let t = 1; t < 4; t += 0.1) {
          character.update(t, 0.1);
          character.root.updateMatrixWorld(true);
          const cue = meshes(character.root, (o) => inCue(o) && shown(o));
          expect(cue.length, 'the cue is held').toBeGreaterThan(0);
          for (const m of cue) expect(ownBox(m).min.y, `${key} t=${t.toFixed(1)}`).toBeGreaterThan(surface);
          for (const m of meshes(character.root, (o) => !inCue(o) && shown(o))) {
            const box = ownBox(m);
            const overlaps = box.max.x > footprint.min.x && box.min.x < footprint.max.x && box.max.z > footprint.min.z && box.min.z < footprint.max.z;
            expect(overlaps, `${key} (${lookFor(key).hat}) t=${t.toFixed(1)} ${m.geometry.type} ${box.min.toArray().map((v) => v.toFixed(2))}..${box.max.toArray().map((v) => v.toFixed(2))} vs ${footprint.min.toArray().map((v) => v.toFixed(2))}..${footprint.max.toArray().map((v) => v.toFixed(2))}`).toBe(false);
          }
        }
      }
    });
  }

  it('#53 AC1 at the strike the cue tip comes up to the cue ball, along the table, without going through it', () => {
    for (let k = 0; k < SHOT_COUNT; k++) {
      const character = shooterAt(HAT_KEYS[0], k);
      const cueBall = ballsAt(k * SHOT_SECONDS)[0];
      const ball = { x: cueBall.x + 7.4, z: cueBall.z + 1.6 };
      const forward = TURNS[k].shoot.yaw === 0 ? 1 : -1;
      let closest = Infinity;
      for (let t = 1; t < 4; t += 0.02) {
        character.update(t, 0.02);
        character.root.updateMatrixWorld(true);
        const tip = ownBox(meshes(character.root, inCue)[0]);
        const front = forward > 0 ? tip.max.z : -tip.min.z;
        const gap = forward * ball.z - BALL_R - front;
        expect(gap, `shot ${k + 1}: the tip stops short of the ball`).toBeGreaterThan(0);
        closest = Math.min(closest, gap);
        expect(tip.min.x - 0.05).toBeLessThan(ball.x);
        expect(tip.max.x + 0.05).toBeGreaterThan(ball.x);
      }
      expect(closest, `shot ${k + 1}`).toBeLessThan(0.1);
    }
  });

});

/** Two idle agents playing pool, with the game held open; returns the log from the first turn. */
function pool(seed = 4) {
  const o = office(2, seed);
  o.set(1, 'done');
  o.set(2, 'done');
  // Both on their way to the table (#89: the second sets off after the first).
  for (let i = 0; i < 4 * 4 * 60 * 60 && ![...o.c.agents.values()].every((a) => a.place?.spot === 'pool-table' && !a.queued); i++) o.run(0.25);
  for (const a of o.c.agents.values()) a.nextAt = 1e9; // both stay
  const from = o.log.length;
  o.run(3 * RACK_SECONDS);
  return { o, log: o.log.slice(from) };
}

describe('#53 AC2 the players take turns', () => {
  it('#53 AC2 after each shot the shooter waits and the waiter steps up to the next shot\'s spot', () => {
    const { o, log } = pool();
    const turns = log.filter((l) => l.event.type === 'pool');
    expect(turns.length).toBeGreaterThan(2 * SHOT_COUNT);
    const shooters: string[] = [];
    for (const [n, turn] of turns.entries()) {
      const shot = (turn.event as { shot: number }).shot;
      expect(shot).toBe(n % SHOT_COUNT);
      const walks = ofType(log.filter((l) => l.t === turn.t).map((l) => l.event), 'walk');
      const shooter = walks.find((w) => w.place === TURNS[shot].shoot);
      if (n === 0) continue; // the break is played from where the shooter arrived
      expect(shooter, `turn ${n}`).toBeDefined();
      shooters.push(shooter!.key);
      const waiter = walks.find((w) => w.key !== shooter!.key)!;
      expect(waiter.place).toBe(TURNS[(shot + SHOT_COUNT - 1) % SHOT_COUNT].wait);
    }
    shooters.forEach((key, i) => { if (i) expect(key).not.toBe(shooters[i - 1]); });
    expect([...o.c.agents.values()].every((a) => a.place?.spot === 'pool-table')).toBe(true);
  });

  it('#53 AC2 each turn starts every SHOT_SECONDS, and the shooter is there before the strike', () => {
    const { o, log } = pool(9);
    const turns = log.filter((l) => l.event.type === 'pool').map((l) => l.t);
    turns.forEach((t, i) => { if (i) expect(t - turns[i - 1]).toBeCloseTo(SHOT_SECONDS, 0); });
    const walks = ofType(log.map((l) => l.event), 'walk');
    for (const w of walks) {
      const length = w.path.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - w.path[i].x, p.z - w.path[i].z), 0);
      expect(length / 1.7).toBeLessThan(1.5);
    }
    expect(o.c.agents.size).toBe(2);
  });
});

describe('#53 AC3 the balls follow a fixed script', () => {
  it('#53 AC3 at a given time into the rack the balls are always in the same place', () => {
    for (let t = 0; t < RACK_SECONDS; t += 0.37) {
      expect(ballsAt(t)).toEqual(ballsAt(t));
      expect(ballsAt(t)).toEqual(ballsAt(t + RACK_SECONDS));
    }
  });

  it('#53 AC3 every shot moves the balls', () => {
    for (let k = 0; k < SHOT_COUNT; k++) {
      expect(ballsAt((k + 1) * SHOT_SECONDS - 0.01), `shot ${k + 1}`).not.toEqual(ballsAt(k * SHOT_SECONDS));
      expect(ballsAt((k + 1) * SHOT_SECONDS - 0.01).filter((b) => b.potted).length).toBe(k + 1);
    }
  });

  it('#53 AC3 the table\'s balls show the script: from each turn\'s start they move as ballsAt says', () => {
    const scene = new THREE.Scene();
    const balls = new PoolBalls(scene);
    for (const shot of [0, 2, 3]) {
      balls.play(shot);
      for (let t = 0; t < SHOT_SECONDS; t += 0.25) {
        const want = ballsAt(shot * SHOT_SECONDS + t);
        balls.meshes.forEach((m, i) => {
          expect(m.visible).toBe(!want[i].potted);
          expect(m.position.x).toBeCloseTo(7.4 + want[i].x, 6);
          expect(m.position.z).toBeCloseTo(1.6 + want[i].z, 6);
          expect(m.position.y).toBeCloseTo(surface + BALL_R, 3);
        });
        balls.update(0.25);
      }
    }
  });
});

describe('#53 AC4 balls stay on the table', () => {
  it('#53 AC4 a ball off the playing surface is only ever going into a pocket', () => {
    for (let t = 0; t < RACK_SECONDS; t += 0.005) {
      ballsAt(t).forEach((b, i) => {
        const onFelt = Math.abs(b.x) <= FELT.hx - BALL_R + 1e-9 && Math.abs(b.z) <= FELT.hz - BALL_R + 1e-9;
        const inPocketMouth = POCKETS.some((p) => Math.hypot(p.x - b.x, p.z - b.z) <= POCKET_R);
        expect(onFelt || inPocketMouth, `ball ${i} at t=${t.toFixed(3)}: ${b.x.toFixed(3)}, ${b.z.toFixed(3)}`).toBe(true);
        if (b.potted) expect(inPocketMouth).toBe(true);
      });
    }
  });

  it('#53 AC4 the table has six pockets where the script pots the balls', () => {
    const pockets = parts('pocket');
    expect(pockets).toHaveLength(6);
    for (const p of POCKETS) expect(pockets.some((m) => Math.hypot(m.position.x - p.x, m.position.z - p.z) < 1e-9)).toBe(true);
  });
});

describe('#53 AC5 the rack resets and play goes on', () => {
  it('#53 AC5 after the last shot the balls are back in the starting rack', () => {
    expect(ballsAt(RACK_SECONDS)).toEqual(ballsAt(0));
    expect(ballsAt(RACK_SECONDS).every((b) => !b.potted)).toBe(true);
    expect(ballsAt(RACK_SECONDS - 0.01).filter((b) => b.potted).length).toBe(SHOT_COUNT);
  });

  it('#53 AC5 after the last shot the next turn is a new break, while both players stay', () => {
    const { log } = pool();
    const shots = log.filter((l) => l.event.type === 'pool').map((l) => (l.event as { shot: number }).shot);
    const last = shots.indexOf(SHOT_COUNT - 1);
    expect(shots[last + 1]).toBe(0);
    expect(shots.lastIndexOf(0)).toBeGreaterThan(last);
  });
});

describe('#53 AC6 a player leaving stops play', () => {
  it('#53 AC6 when one player goes back to work, play stops, the balls are reracked and the other leaves', () => {
    const { o } = pool();
    const [first, second] = [...o.c.agents.keys()];
    const events = o.set(Number(first.replace('session-', '')), 'working');
    expect(ofType(events, 'pool')).toEqual([{ type: 'pool', shot: null }]);
    // #89: the other follows 1–4 s later.
    const later = o.run(4.05, 0.05);
    const other = ofType(later, 'walk').find((w) => w.key === second)!;
    expect(other.place?.spot).not.toBe('pool-table');
    expect(ofType([...later, ...o.run(30)], 'pool')).toEqual([]);

    const balls = new PoolBalls(new THREE.Scene());
    balls.play(2);
    balls.update(3);
    balls.play(null);
    balls.update(10);
    balls.meshes.forEach((m, i) => {
      expect(m.position.x - 7.4).toBeCloseTo(ballsAt(0)[i].x, 9);
      expect(m.position.z - 1.6).toBeCloseTo(ballsAt(0)[i].z, 9);
    });
  });
});
