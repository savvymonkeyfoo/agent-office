import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { INITIAL_ROWS, fetchRun, officeLayout, yawTowards, type DogSpot, type HangoutPlace } from '../src/client/layout.ts';
import { Character } from '../src/client/character.ts';
import { Dog } from '../src/client/dog.ts';
import { lookFor } from '../src/client/look.ts';
import { BALL_R, FLIGHT, FetchBall, RELEASE_AT, ballInHand } from '../src/client/fetch.ts';
import { ofType, office } from './office-sim.ts';

const LAYOUT = officeLayout(INITIAL_ROWS);
const DT = 1 / 60;
const flat = (a: THREE.Vector3, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/** A thrower with the dog at `spot`; fetch events at `throws` seconds. Every frame: where the ball, hand, mouth and dog are. */
function play(spot: DogSpot, seconds: number, throws: number[], visitor = spot.visitors.find((v) => v.poses.includes('throwing-ball'))!) {
  const place: HangoutPlace = { spot: 'dog', pose: 'throwing-ball', x: visitor.at.x, z: visitor.at.z, yaw: yawTowards(visitor.at, spot.dog), link: visitor.link };
  const thrower = new Character(lookFor('session-1'));
  thrower.placeAt(LAYOUT.seats[0], 'done', place);
  const dog = new Dog();
  dog.placeAt(spot.dog, false);
  const ball = new FetchBall(new THREE.Scene());
  const pending = [...throws];
  const frames = [];
  for (let i = 0; i * DT < seconds; i++) {
    const t = i * DT;
    if (pending.length && t >= pending[0]) {
      pending.shift();
      thrower.throwBall(spot.fetch);
      ball.throw(spot.fetch);
      dog.go(fetchRun(LAYOUT, spot), false, RELEASE_AT);
    }
    thrower.update(t, DT);
    dog.update(t, DT);
    ball.update(DT, thrower, dog);
    frames.push({
      t, ball: ball.mesh.position.clone(), shown: ball.mesh.visible, hand: ballInHand(thrower),
      arm: thrower.hands[1].position.clone(), facing: facing(thrower), mouth: dog.mouth(), dog: dog.root.position.clone(), running: dog.running,
    });
  }
  return { frames, place };
}

/** Which way the thrower's body faces, as a world yaw. */
function facing(c: Character) {
  const d = c.pivot.getWorldDirection(new THREE.Vector3());
  return Math.atan2(d.x, d.z);
}
const angleBetween = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const DEG = Math.PI / 180;

const THROW = 1;
const at = (frames: ReturnType<typeof play>['frames'], t: number) => frames[Math.round(t / DT)];

describe('#75 AC1 on each fetch the arm throws a ball in an arc to the fetch spot', () => {
  for (const spot of LAYOUT.dogSpots) {
    it(`#75 AC1 the ball leaves the hand and arcs to the fetch spot (${spot.name})`, () => {
      const { frames } = play(spot, 4, [THROW]);
      const lastHeld = frames.findLastIndex((f) => f.t < THROW + 1.5 && f.ball.distanceTo(f.hand) < 0.01);
      expect(frames[lastHeld].t, 'in the hand until the release').toBeCloseTo(THROW + RELEASE_AT, 1);
      const start = frames[lastHeld + 1], mid = at(frames, THROW + RELEASE_AT + FLIGHT / 2), end = at(frames, THROW + RELEASE_AT + FLIGHT + 2 * DT);
      expect(start.ball.distanceTo(frames[lastHeld].ball), 'leaves from the hand').toBeLessThan(0.12);
      expect(flat(end.ball, spot.fetch), 'lands on the fetch spot').toBeLessThan(0.01);
      expect(end.ball.y).toBeCloseTo(BALL_R, 3);
      const straight = start.ball.clone().lerp(end.ball, flat(mid.ball, start.ball) / flat(end.ball, start.ball));
      expect(mid.ball.y - straight.y, 'an arc').toBeGreaterThanOrEqual(0.2);
      for (const f of frames) expect(f.shown).toBe(true);
    });
  }

  it('#75 AC1 the arm moves through a throw on the fetch event', () => {
    const { frames } = play(LAYOUT.dogSpots[1], 3, [THROW]);
    const travel = Math.max(...frames.filter((f) => f.t >= THROW && f.t < THROW + 1).map((f) => f.arm.distanceTo(frames[0].arm)));
    expect(travel).toBeGreaterThan(0.4);
  });

  it('#75 AC1 the controller\'s fetch names the fetch spot, and the dog sets off as the ball leaves the hand', () => {
    const o = office(5, 9);
    for (let n = 1; n <= 5; n++) o.set(n, 'done');
    o.run(7200, 0.25);
    const events = o.log.map((l) => l.event);
    const fetches = ofType(events, 'fetch');
    expect(fetches.length).toBeGreaterThan(0);
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.type !== 'fetch') continue;
      const run = events[i + 1];
      expect(run.type).toBe('dog');
      if (run.type !== 'dog') continue;
      expect(run.wait).toBe(RELEASE_AT);
      expect(run.path.some((p) => p.x === e.to.x && p.z === e.to.z), 'the dog runs to where the ball lands').toBe(true);
    }
  });
});

describe('#75 AC2 the ball waits at the spot for the dog, then comes back in its mouth', () => {
  for (const spot of LAYOUT.dogSpots) {
    it(`#75 AC2 on the ground until the dog gets there, then in its mouth back to the thrower (${spot.name})`, () => {
      const { frames, place } = play(spot, 8, [THROW]);
      const landed = frames.findIndex((f) => f.t > THROW && flat(f.ball, spot.fetch) < 0.01 && Math.abs(f.ball.y - BALL_R) < 1e-6);
      expect(landed, 'it lands before the dog gets there').toBeLessThanOrEqual(Math.ceil((THROW + RELEASE_AT + FLIGHT) / DT));
      const picked = frames.findIndex((f, i) => i > landed && f.ball.distanceTo(frames[landed].ball) > 1e-6);
      expect(picked, 'picked up').toBeGreaterThan(landed);
      for (const f of frames.slice(landed, picked)) expect(f.ball.y).toBeCloseTo(BALL_R, 3);
      expect(flat(frames[picked].dog, spot.fetch), 'the dog is there when it leaves the ground').toBeLessThan(0.5);
      const stopped = frames.findIndex((f, i) => i > picked && !f.running);
      expect(stopped, 'the dog gets back').toBeGreaterThan(picked);
      for (const f of frames.slice(picked + Math.round(0.3 / DT), stopped)) expect(f.ball.distanceTo(f.mouth), `t=${f.t.toFixed(2)}`).toBeLessThan(0.02);
      expect(flat(frames[stopped].dog, place), 'back by the thrower').toBeLessThan(1.6);
      const after = at(frames, frames[stopped].t + 1);
      expect(after.ball.distanceTo(after.hand), 'handed back').toBeLessThan(0.01);
    });
  }

  it('#75 AC2 the ball never jumps', () => {
    for (const spot of LAYOUT.dogSpots) {
      const { frames } = play(spot, 8, [THROW]);
      for (let i = 1; i < frames.length; i++) expect(frames[i].ball.distanceTo(frames[i - 1].ball), `${spot.name} t=${frames[i].t.toFixed(2)}`).toBeLessThan(0.12);
    }
  });
});

describe('#75 AC3 between fetches the ball is in hand, and the arm throws only on a fetch', () => {
  it('#75 AC3 with no fetch, the ball stays in the hand and the arm stays still', () => {
    const { frames } = play(LAYOUT.dogSpots[1], 20, []);
    for (const f of frames.slice(Math.round(1 / DT))) {
      expect(f.ball.distanceTo(f.hand)).toBeLessThan(0.01);
      expect(f.arm.distanceTo(frames[60].arm)).toBeLessThan(0.02);
    }
  });

  it('#75 AC3 between two fetches the ball is back in the hand', () => {
    const second = 9;
    const { frames } = play(LAYOUT.dogSpots[1], 12, [THROW, second]);
    const between = at(frames, second - 0.1);
    expect(between.ball.distanceTo(between.hand)).toBeLessThan(0.01);
    const thrown = at(frames, second + RELEASE_AT + FLIGHT / 2);
    expect(thrown.ball.distanceTo(thrown.hand), 'and is thrown again').toBeGreaterThan(0.5);
  });
});

describe('#114 face the way you throw', () => {
  const throwers = LAYOUT.dogSpots.flatMap((spot) => spot.visitors.filter((v) => v.poses.includes('throwing-ball')).map((visitor) => ({ spot, visitor })));

  for (const { spot, visitor } of throwers) {
    const name = `${spot.name} from ${visitor.at.x},${visitor.at.z}`;

    it(`#114 AC1 at the release the thrower faces within 30° of the ball's flight (${name})`, () => {
      const { frames } = play(spot, 4, [THROW], visitor);
      const lastHeld = frames.findLastIndex((f) => f.t < THROW + 1.5 && f.ball.distanceTo(f.hand) < 0.01);
      const release = frames[lastHeld];
      const flight = yawTowards({ x: release.ball.x, z: release.ball.z }, spot.fetch);
      expect(angleBetween(release.facing, flight) / DEG).toBeLessThanOrEqual(30);
    });

    it(`#114 AC2 the turn to throw and back is smooth (${name})`, () => {
      const { frames } = play(spot, 6, [THROW], visitor);
      for (let i = Math.round(THROW / DT); i < frames.length; i++) {
        expect(angleBetween(frames[i].facing, frames[i - 1].facing) / DEG, `t=${frames[i].t.toFixed(2)}`).toBeLessThanOrEqual(10);
      }
    });

    it(`#114 AC3 the ball leaves the hand, lands at the fetch spot, and the thrower turns back to the dog (${name})`, () => {
      const { frames, place } = play(spot, 8, [THROW], visitor);
      const lastHeld = frames.findLastIndex((f) => f.t < THROW + 1.5 && f.ball.distanceTo(f.hand) < 0.01);
      expect(frames[lastHeld].t, 'released on time, as the dog sets off').toBeCloseTo(THROW + RELEASE_AT, 1);
      expect(frames[lastHeld + 1].ball.distanceTo(frames[lastHeld].ball), 'leaves from the hand').toBeLessThan(0.12);
      const end = at(frames, THROW + RELEASE_AT + FLIGHT + 2 * DT);
      expect(flat(end.ball, spot.fetch), 'lands on the fetch spot').toBeLessThan(0.01);
      expect(angleBetween(at(frames, THROW + 3).facing, place.yaw) / DEG, 'watching the dog again').toBeLessThan(15);
    });
  }
});
