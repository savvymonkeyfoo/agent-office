import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BREAK_ROOM, INITIAL_ROWS, officeLayout } from '../src/client/layout.ts';
import { Character } from '../src/client/character.ts';
import { lookFor } from '../src/client/look.ts';
import { PongBallMesh } from '../src/client/break-room.ts';
import { CROSS_SECONDS, TOSS_SECONDS, hitPoint, hitTimes, hitter, pongBallAt, rallySeconds, type Rally, type Side } from '../src/client/pong.ts';

const START = officeLayout(INITIAL_ROWS);
const PLACES = START.hangouts.find((s) => s.name === 'ping-pong')!.places;
const T = BREAK_ROOM.pingPong;
const STEP = 0.01;
const DEG15 = (15 * Math.PI) / 180;

interface Sample { t: number; root: THREE.Vector3; yaw: number; twist: number; free: THREE.Vector3; head: THREE.Vector3; ball: THREE.Vector3 | null }

/** Side `side` playing `rally` the way the office scene starts it (the toss first); samples every STEP seconds of rally time. */
function play(side: Side, rally: Rally | null, seconds = rally ? rallySeconds(rally) : 2) {
  const character = new Character(lookFor(`s${side}`));
  character.placeAt(START.seats[0], 'done', PLACES[side < 0 ? 0 : 1]);
  for (let t = 0; t < 1; t += 0.05) character.update(t, 0.05);
  const ball = new PongBallMesh(new THREE.Scene());
  if (rally) {
    character.playRally(rally, side, -TOSS_SECONDS);
    ball.play(rally, -TOSS_SECONDS);
  }
  const samples: Sample[] = [];
  const world = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
  for (let k = 0; k * STEP < seconds; k++) {
    character.update(10 + k * STEP, STEP);
    ball.update(STEP);
    character.root.updateMatrixWorld(true);
    samples.push({
      t: (rally ? -TOSS_SECONDS : 0) + (k + 1) * STEP,
      root: character.root.position.clone(),
      yaw: character.root.rotation.y,
      twist: character.pivot.rotation.y,
      free: world(character.hands[0]),
      head: world(character.head),
      ball: ball.mesh.visible ? ball.mesh.position.clone() : null,
    });
  }
  const at = (t: number) => samples.reduce((best, s) => (Math.abs(s.t - t) < Math.abs(best.t - t) ? s : best));
  const between = (a: number, b: number) => samples.filter((s) => s.t >= a && s.t < b);
  return { samples, at, between, place: PLACES[side < 0 ? 0 : 1] };
}

const RALLIES: Rally[] = [{ server: -1, hits: 5 }, { server: 1, hits: 2 }, { server: 1, hits: 0 }];
const range = (xs: number[]) => Math.max(...xs) - Math.min(...xs);

describe('#115 AC1 players shuffle sideways during a rally', () => {
  for (const rally of RALLIES) for (const side of [-1, 1] as Side[]) {
    it(`#115 AC1 server ${rally.server}, ${rally.hits} hits, side ${side}: moves 10 cm across over each opponent shot, back at the spot to hit`, () => {
      const { at, between, place } = play(side, rally);
      for (const h of hitTimes(rally, -side as Side)) {
        expect(range(between(h, h + CROSS_SECONDS).map((s) => s.root.z)), `opponent shot at ${h}`).toBeGreaterThanOrEqual(0.1);
      }
      for (const h of hitTimes(rally, side)) {
        expect(Math.abs(at(h).root.z - place.z), `own hit at ${h}`).toBeLessThan(0.01);
        expect(Math.abs(at(h).root.x - place.x)).toBeLessThan(0.01);
      }
    });
  }
});

describe('#115 AC2 the upper body twists back before each hit and through it after', () => {
  for (const side of [-1, 1] as Side[]) {
    it(`#115 AC2 side ${side}: back before, through after, over at least 15°`, () => {
      const rally: Rally = { server: -1, hits: 5 };
      const { at } = play(side, rally);
      for (const h of hitTimes(rally, side)) {
        // Right-handed: twisting back takes the bat shoulder back (positive turn about y), through takes it forward.
        expect(at(h - 0.12).twist - at(h + 0.12).twist, `hit at ${h}`).toBeGreaterThanOrEqual(DEG15);
      }
    });
  }
});

describe('#115 AC3 the server tosses the ball up before serving', () => {
  for (const server of [-1, 1] as Side[]) {
    it(`#115 AC3 server ${server}: the ball starts in the free hand and is seen rising above it before the serve`, () => {
      const rally: Rally = { server, hits: 3 };
      const { samples, between } = play(server, rally);
      const first = samples[0];
      expect(first.ball, 'the ball shows from the start of the toss').not.toBeNull();
      expect(first.ball!.distanceTo(first.free)).toBeLessThan(0.2);
      const toss = between(-TOSS_SECONDS, 0);
      const rising = toss.filter((s, i) => i > 0 && s.ball && toss[i - 1].ball && s.ball.y > toss[i - 1].ball!.y && s.ball.y > s.free.y + 0.15);
      expect(rising.length).toBeGreaterThan(5);
      for (const s of rising) expect(Math.hypot(s.ball!.x - s.free.x, s.ball!.z - s.free.z)).toBeLessThan(0.35);
      // ...and the serve still meets the bat where the rally starts.
      const serve = pongBallAt(rally, -1e-6), hit = hitPoint(server);
      expect(Math.hypot(serve.x - hit.x, serve.y - hit.y, serve.z - hit.z)).toBeLessThan(0.01);
    });
  }
});

describe('#115 AC4 when a point ends, the winner pumps a fist and the loser looks after the ball', () => {
  for (const rally of [{ server: -1, hits: 3 }, { server: 1, hits: 0 }, { server: -1, hits: 4 }] as Rally[]) {
    it(`#115 AC4 server ${rally.server}, ${rally.hits} hits: both react within the pause before the next serve`, () => {
      const winner = hitter(rally, rally.hits), loser = -winner as Side;
      const missed = (rally.hits + 1) * CROSS_SECONDS, nextToss = rallySeconds(rally) - TOSS_SECONDS;

      const w = play(winner, rally);
      const up = w.between(missed, nextToss).filter((s) => s.free.y > s.head.y);
      expect(up.length, 'free fist up above the head').toBeGreaterThan(10);
      expect(range(up.map((s) => s.free.y)), 'pumping').toBeGreaterThan(0.06);
      expect(w.at(rally.hits * CROSS_SECONDS).free.y).toBeLessThan(w.at(rally.hits * CROSS_SECONDS).head.y);
      expect(w.at(nextToss).free.y, 'down again before the next serve').toBeLessThan(w.at(nextToss).head.y);

      const l = play(loser, rally);
      const rest = pongBallAt(rally, rally.hits * CROSS_SECONDS + 2.05);
      const ballWorld = new THREE.Vector3(T.x + rest.x, 0, T.z + rest.z);
      const facing = (s: Sample) => {
        const to = ballWorld.clone().sub(s.root).setY(0).normalize();
        return Math.acos(THREE.MathUtils.clamp(to.dot(new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw))), -1, 1));
      };
      expect(facing(l.at(0)), 'faces the table, away from the ball, while playing').toBeGreaterThan(Math.PI / 3);
      expect(Math.min(...l.between(missed, nextToss).map(facing)), 'turns toward the ball').toBeLessThan(Math.PI / 6);
      expect(Math.abs(l.at(nextToss).yaw - l.place.yaw), 'back to the table before the next serve').toBeLessThan(0.1);
    });
  }
});

describe('#115 AC5 waiting players bounce on their toes', () => {
  it('#115 AC5 with no rally running, the head rises and falls by at least 2 cm', () => {
    const { samples } = play(-1, null);
    expect(range(samples.map((s) => s.head.y))).toBeGreaterThanOrEqual(0.02);
  });
});
