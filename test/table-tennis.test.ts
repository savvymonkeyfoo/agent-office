import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BREAK_ROOM, INITIAL_ROWS, officeLayout } from '../src/client/layout.ts';
import { buildOffice } from '../src/client/office.ts';
import { Character } from '../src/client/character.ts';
import { lookFor } from '../src/client/look.ts';
import { PongBallMesh } from '../src/client/break-room.ts';
import {
  BALL_R, CROSS_SECONDS, NET_TOP, TABLE, hitPoint, hitTimes, hitter, pongBallAt, rallySeconds, type Rally, type Side,
} from '../src/client/pong.ts';
import { find, ofType, office } from './office-sim.ts';

const START = officeLayout(INITIAL_ROWS);
const PLACES = START.hangouts.find((s) => s.name === 'ping-pong')!.places;
const T = BREAK_ROOM.pingPong;
const RALLIES: Rally[] = [{ server: -1, hits: 0 }, { server: 1, hits: 1 }, { server: -1, hits: 4 }, { server: 1, hits: 7 }];
const ON_TABLE = TABLE.top + BALL_R;
const samples = (from: number, to: number, step = 0.002) => Array.from({ length: Math.round((to - from) / step) }, (_, i) => from + i * step);

describe('#70 AC1 the ball goes back and forth, bouncing once on the receiver\'s half', () => {
  for (const rally of RALLIES) {
    it(`#70 AC1 server ${rally.server}, ${rally.hits} hits: each crossing bounces once on the far half, then reaches the bat`, () => {
      for (let i = 0; i < rally.hits; i++) {
        const s = hitter(rally, i), receiver = -s as Side;
        const start = pongBallAt(rally, i * CROSS_SECONDS);
        expect(start.x).toBeCloseTo(hitPoint(s).x, 6);
        const bounces = samples(i * CROSS_SECONDS, (i + 1) * CROSS_SECONDS).map((t) => pongBallAt(rally, t)).filter((b) => b.y <= ON_TABLE + 1e-6);
        expect(bounces.length, `crossing ${i}`).toBeGreaterThan(0);
        for (const b of bounces) {
          expect(Math.sign(b.x)).toBe(receiver);
          expect(Math.abs(b.x)).toBeLessThan(TABLE.hx);
          expect(Math.abs(b.z)).toBeLessThan(TABLE.hz);
          expect(Math.abs(b.x - bounces[0].x), 'a single bounce').toBeLessThan(0.02);
        }
        const end = pongBallAt(rally, (i + 1) * CROSS_SECONDS - 1e-9);
        const bat = hitPoint(receiver);
        expect(Math.hypot(end.x - bat.x, end.y - bat.y, end.z - bat.z), `crossing ${i} reaches the bat`).toBeLessThan(0.01);
      }
    });
  }

  it('#70 AC1 the ball never dips into the table', () => {
    for (const rally of RALLIES) {
      for (const t of samples(0, rallySeconds(rally), 0.005)) {
        const b = pongBallAt(rally, t);
        if (Math.abs(b.x) < TABLE.hx && Math.abs(b.z) < TABLE.hz) expect(b.y).toBeGreaterThanOrEqual(ON_TABLE - 1e-9);
      }
    }
  });
});

describe('#70 AC2 the ball clears a low net', () => {
  it('#70 AC2 at the middle of the table the ball is always above the net', () => {
    for (const rally of RALLIES) {
      for (const t of samples(0, rallySeconds(rally), 0.001)) {
        const b = pongBallAt(rally, t);
        if (Math.abs(b.x) < 0.03 && Math.abs(b.z) < TABLE.hz + 0.05) expect(b.y - BALL_R, `t=${t}`).toBeGreaterThan(NET_TOP);
      }
    }
  });

  it('#70 AC2 a low net stands across the middle of the table', () => {
    const { group } = buildOffice(INITIAL_ROWS);
    const [table] = find(group, 'ping-pong-table');
    let net: THREE.Object3D | undefined;
    table.traverse((o) => { if (o.userData.part === 'net') net = o; });
    const box = new THREE.Box3().setFromObject(net!);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(T.x, 2);
    expect(box.max.x - box.min.x).toBeLessThan(0.1);
    expect(box.min.z).toBeLessThanOrEqual(T.z - TABLE.hz);
    expect(box.max.z).toBeGreaterThanOrEqual(T.z + TABLE.hz);
    expect(box.min.y).toBeLessThanOrEqual(TABLE.top + 0.01);
    expect(box.max.y).toBeCloseTo(NET_TOP, 1);
    expect(NET_TOP - TABLE.top).toBeLessThan(0.2);
  });
});

/** A player at its end of the table, playing `rally`; its bat blade's centre in world space. */
function player(side: Side, rally: Rally) {
  const character = new Character(lookFor(`s${side}`));
  character.placeAt(START.seats[0], 'done', PLACES[side < 0 ? 0 : 1]);
  for (let t = 0; t < 1; t += 0.05) character.update(t, 0.05);
  character.playRally(rally, side);
  const blade = () => {
    let found: THREE.Object3D | undefined;
    character.root.traverse((o) => { if (o.userData.part === 'bat-blade') found = o; });
    character.root.updateMatrixWorld(true);
    return found!.getWorldPosition(new THREE.Vector3());
  };
  return { character, blade };
}

describe('#70 AC3 each player swings through the ball', () => {
  for (const side of [-1, 1] as Side[]) {
    it(`#70 AC3 side ${side}: at each hit the bat moves forward through where the ball is; between hits it waits ready`, () => {
      const rally: Rally = { server: -1, hits: 5 };
      const { character, blade } = player(side, rally);
      const towardsTable = new THREE.Vector3(-side, 0, 0);
      const times = hitTimes(rally, side);
      expect(times.length).toBeGreaterThan(1);
      const step = 0.01;
      let t = 0;
      const at: { t: number; p: THREE.Vector3 }[] = [];
      for (; t < rallySeconds(rally); t += step) {
        character.update(10 + t, step);
        at.push({ t: t + step, p: blade() });
      }
      for (const hit of times) {
        const near = at.reduce((best, s) => (Math.abs(s.t - hit) < Math.abs(best.t - hit) ? s : best));
        const ball = pongBallAt(rally, hit);
        const world = new THREE.Vector3(T.x + ball.x, ball.y, T.z + ball.z);
        expect(near.p.distanceTo(world), `hit at ${hit}`).toBeLessThan(0.06);
        const before = at.find((s) => Math.abs(s.t - (hit - 0.08)) < step / 2)?.p ?? near.p;
        const after = at.find((s) => Math.abs(s.t - (hit + 0.08)) < step / 2)!.p;
        expect(after.clone().sub(before).dot(towardsTable), `swings forward at ${hit}`).toBeGreaterThan(0.05);
      }
      // Ready stance: halfway between this player's hits, the bat holds still.
      const [a, b] = [times[1], times[2]];
      const mid = (a + b) / 2;
      const p1 = at.find((s) => Math.abs(s.t - (mid - 0.1)) < step / 2)!.p, p2 = at.find((s) => Math.abs(s.t - (mid + 0.1)) < step / 2)!.p;
      expect(p1.distanceTo(p2)).toBeLessThan(0.01);
    });
  }
});

describe('#70 AC4 the ball\'s path is a function of time into the rally', () => {
  it('#70 AC4 the same rally and time always give the same place', () => {
    for (const rally of RALLIES) for (const t of samples(0, rallySeconds(rally), 0.13)) expect(pongBallAt(rally, t)).toEqual(pongBallAt({ ...rally }, t));
  });
});

/** Two idle agents at the ping-pong table, held there; the log from when play started. */
function pong(seed = 4) {
  const o = office(2, seed);
  o.set(1, 'done');
  o.set(2, 'done');
  for (let i = 0; i < 4 * 60 * 60 && !ofType(o.log.map((l) => l.event), 'pong').length; i++) {
    o.run(0.25);
    for (const a of o.c.agents.values()) if (a.place?.spot === 'ping-pong') a.nextAt = 1e9;
  }
  const from = o.log.length - 1;
  o.run(120);
  return { o, log: o.log.slice(from) };
}

describe('#70 AC5 rallies end with a miss, then a new serve', () => {
  it('#70 AC5 a missed ball rolls off the end of the table onto the floor, then is gone', () => {
    for (const rally of RALLIES) {
      const s = hitter(rally, rally.hits);
      const off = samples(rally.hits * CROSS_SECONDS, rallySeconds(rally), 0.01).map((t) => pongBallAt(rally, t));
      const onFloor = off.filter((b) => b.visible && b.y <= BALL_R + 1e-9);
      expect(onFloor.length).toBeGreaterThan(10);
      for (const b of onFloor) expect(-s * b.x).toBeGreaterThan(TABLE.hx);
      expect(onFloor.at(-1)!.x).not.toBeCloseTo(onFloor[0].x, 1); // it rolls
      expect(pongBallAt(rally, rallySeconds(rally) - 0.01).visible).toBe(false);
    }
  });

  it('#70 AC5 rally lengths come from the injectable random; play goes on with new serves while both stay', () => {
    const lengths = new Set<number>();
    for (const seed of [3, 4, 5]) {
      const { log } = pong(seed);
      const rallies = log.filter((l) => l.event.type === 'pong').map((l) => ({ t: l.t, ...(l.event as { rally: Rally }) }));
      expect(rallies.length, `seed ${seed}`).toBeGreaterThan(5);
      rallies.forEach((r, i) => {
        expect(r.rally).not.toBeNull();
        lengths.add(r.rally.hits);
        if (!i) return;
        const last = rallies[i - 1].rally;
        expect(r.t - rallies[i - 1].t).toBeCloseTo(rallySeconds(last), 0);
        expect(r.rally.server, 'the player who missed serves').toBe(-hitter(last, last.hits));
      });
    }
    expect(lengths.size).toBeGreaterThan(2);
  });

  it('#70 AC5 the same seed gives the same rallies', () => {
    const a = pong(7).log.filter((l) => l.event.type === 'pong').map((l) => l.event);
    const b = pong(7).log.filter((l) => l.event.type === 'pong').map((l) => l.event);
    expect(a).toEqual(b);
  });
});

describe('#70 AC6 a player leaving ends the game', () => {
  it('#70 AC6 the ball disappears and the other player leaves too', () => {
    const { o, log } = pong();
    const players = (log.find((l) => l.event.type === 'pong')!.event as { players: string[] }).players;
    expect(players.map((k) => o.c.agents.get(k)!.place?.spot)).toEqual(['ping-pong', 'ping-pong']);
    const events = o.set(Number(players[0].replace('session-', '')), 'working');
    expect(ofType(events, 'pong')).toEqual([{ type: 'pong', rally: null, players }]);
    // #89: the other follows 1–4 s later.
    expect(ofType(o.run(4.05, 0.05), 'walk').find((w) => w.key === players[1])!.place?.spot).not.toBe('ping-pong');

    const ball = new PongBallMesh(new THREE.Scene());
    ball.play({ server: 1, hits: 3 });
    ball.update(0.5);
    expect(ball.mesh.visible).toBe(true);
    const at = pongBallAt({ server: 1, hits: 3 }, 0.5);
    expect(ball.mesh.position.x).toBeCloseTo(T.x + at.x, 6);
    expect(ball.mesh.position.y).toBeCloseTo(at.y, 6);
    ball.play(null);
    ball.update(0.5);
    expect(ball.mesh.visible).toBe(false);
  });
});
