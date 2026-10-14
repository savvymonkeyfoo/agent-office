import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { INITIAL_ROWS, officeLayout } from '../src/client/layout.ts';
import { Character } from '../src/client/character.ts';
import { lookFor } from '../src/client/look.ts';
import { BALL_R, SHOT_COUNT, SHOT_SECONDS, STRIKE_AT, ballsAt } from '../src/client/pool.ts';
import { ofType, office } from './office-sim.ts';

const START = officeLayout(INITIAL_ROWS);
const TURNS = START.poolTurns;
const FRAME = 1 / 60;

const inCue = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.userData.kind === 'cue') return true; return false; };
function cueMesh(root: THREE.Object3D) {
  let found: THREE.Mesh | null = null;
  root.traverse((o) => { if (!found && o instanceof THREE.Mesh && inCue(o)) found = o; });
  return found!;
}
/** A mesh's own world box, from its vertices. */
function ownBox(mesh: THREE.Mesh) {
  const box = new THREE.Box3(), v = new THREE.Vector3(), position = mesh.geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) box.expandByPoint(v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld));
  return box;
}

/** Shot `k`'s shooter, standing at its spot; `turn` says whether its turn starts as it gets there. Samples every frame. */
function strokeOf(k: number, turn = true, seconds = SHOT_SECONDS) {
  const character = new Character(lookFor('session-1'));
  character.placeAt(START.seats[0], 'done', TURNS[k].shoot);
  if (turn) character.takeShot();
  const cueBall = ballsAt(k * SHOT_SECONDS)[0];
  const ball = { x: cueBall.x + 7.4, z: cueBall.z + 1.6 };
  const forward = TURNS[k].shoot.yaw === 0 ? 1 : -1;
  const cue = cueMesh(character.root);
  const frames: { t: number; hand: THREE.Vector3; gap: number }[] = [];
  for (let t = 0; t < seconds; t += FRAME) {
    character.update(t, t ? FRAME : 0);
    character.root.updateMatrixWorld(true);
    const tip = ownBox(cue);
    const front = forward > 0 ? tip.max.z : -tip.min.z;
    frames.push({ t, hand: character.hands[1].getWorldPosition(new THREE.Vector3()), gap: forward * ball.z - BALL_R - front });
  }
  return frames;
}

describe('#76 AC1 the cue strikes the cue ball at STRIKE_AT', () => {
  for (let k = 0; k < SHOT_COUNT; k++) {
    it(`#76 AC1 shot ${k + 1}: drawn back before the strike, the tip at the ball within 0.05 s of STRIKE_AT`, () => {
      const frames = strokeOf(k);
      const rest = frames[0].gap;
      const before = frames.filter((f) => f.t < STRIKE_AT - 0.05);
      expect(Math.max(...before.map((f) => f.gap)), 'drawn back').toBeGreaterThan(rest + 0.1);
      const closest = frames.reduce((a, b) => (b.gap < a.gap ? b : a));
      expect(Math.abs(closest.t - STRIKE_AT), `closest at ${closest.t.toFixed(3)}`).toBeLessThanOrEqual(0.05);
      expect(closest.gap, 'the tip reaches the ball').toBeLessThan(0.02);
      expect(closest.gap, 'without going through it').toBeGreaterThan(-0.01);
      for (const f of frames.filter((f) => Math.abs(f.t - STRIKE_AT) > 0.05)) expect(f.gap, `t=${f.t.toFixed(3)}`).toBeGreaterThan(closest.gap);
    });
  }
});

describe('#76 AC2 the cue hand holds still outside the stroke', () => {
  const still = (frames: { hand: THREE.Vector3 }[]) => {
    expect(frames.length).toBeGreaterThan(10);
    for (const f of frames) expect(f.hand.distanceTo(frames[0].hand)).toBeLessThan(1e-9);
  };
  for (let k = 0; k < SHOT_COUNT; k++) {
    it(`#76 AC2 shot ${k + 1}: still before the stroke and after the follow-through`, () => {
      const frames = strokeOf(k);
      still(frames.filter((f) => f.t < STRIKE_AT - 1));
      still(frames.filter((f) => f.t > STRIKE_AT + 1));
    });
  }

  it('#76 AC2 a shooter whose turn hasn\'t started holds the cue still', () => {
    still(strokeOf(0, false, 8));
  });
});

describe('#76 AC3 no snapping', () => {
  for (let k = 0; k < SHOT_COUNT; k++) {
    it(`#76 AC3 shot ${k + 1}: the cue hand moves at most 0.12 m a frame`, () => {
      const frames = strokeOf(k);
      frames.slice(1).forEach((f, i) => expect(f.hand.distanceTo(frames[i].hand), `t=${f.t.toFixed(3)}`).toBeLessThanOrEqual(0.12));
    });
  }
});

describe('#76 the controller says who shoots each turn', () => {
  it('#76 each pool turn names its shooter: the player stepping up to that shot\'s spot', () => {
    const o = office(2, 4);
    o.set(1, 'done');
    o.set(2, 'done');
    for (let i = 0; i < 4 * 4 * 60 * 60 && ![...o.c.agents.values()].every((a) => a.place?.spot === 'pool-table'); i++) o.run(0.25);
    for (const a of o.c.agents.values()) a.nextAt = 1e9;
    const from = o.log.length;
    o.run(3 * SHOT_COUNT * SHOT_SECONDS);
    const log = o.log.slice(from);
    const turns = log.filter((l) => l.event.type === 'pool');
    expect(turns.length).toBeGreaterThan(SHOT_COUNT);
    for (const turn of turns) {
      const event = turn.event as { shot: number; shooter: string };
      const walk = ofType(log.filter((l) => l.t === turn.t).map((l) => l.event), 'walk').find((w) => w.place === TURNS[event.shot].shoot);
      // The break is played from where the shooter arrived: the last walk onto a shooting place before it (#89 staggers arrivals).
      const arrival = ofType(o.log.filter((l) => l.t <= turn.t).map((l) => l.event), 'walk').filter((w) => w.place?.pose === 'cue-shot').at(-1);
      const shooter = walk?.key ?? arrival!.key;
      expect(event.shooter).toBe(shooter);
    }
  });
});
