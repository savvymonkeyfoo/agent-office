// #80: a guard over every hangout pose: no hand, foot or held prop snaps, and a held prop only
// disappears from the hand when a copy of it flies off (or is put down) from where it was.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HANGOUT_POSES, INITIAL_ROWS, officeLayout, overTheShoulder, type HangoutPlace, type HangoutPose } from '../src/client/layout.ts';
import { Character } from '../src/client/character.ts';
import { lookFor } from '../src/client/look.ts';
import { PaperPlanes } from '../src/client/paper-planes.ts';
import { BinBall, BoardDarts } from '../src/client/break-room.ts';
import { driftParams } from '../src/client/float.ts';
import { CAST_SECONDS, landingFrom } from '../src/client/fishing.ts';
import { SHOT_SECONDS } from '../src/client/pool.ts';
import { rallySeconds } from '../src/client/pong.ts';
import { seeded } from './office-sim.ts';

const START = officeLayout(INITIAL_ROWS);
const FRAME = 1 / 60;
/** Sampled from 1 s after arriving (the arrival blend is excluded), for 20 s (#72). */
const FROM = 1;
const SECONDS = 20;
const SNAP = 0.12;
const FLEW = 0.15;

/** A real place for `pose`; poses taken up at a desk or by the dog borrow an onlooker's spot. */
function placeFor(pose: HangoutPose): HangoutPlace {
  const place = START.hangouts.flatMap((s) => s.places).find((p) => p.pose === pose);
  return place ?? { ...overTheShoulder(START, START.seats[0]), pose };
}

/** Planes go to any desk; the farthest flies fastest, so it's the hardest to see leave the hand. */
const FAR_DESK = START.seats.map((s) => s.desk).reduce((a, b) => {
  const from = placeFor('throwing-plane'), d = (p: { x: number; z: number }) => Math.hypot(p.x - from.x, p.z - from.z);
  return d(b) > d(a) ? b : a;
});

/** What the controller sends an agent at each pose, and how often (as in the office scene). */
type Rig = { character: Character; planes: PaperPlanes; random: () => number; n: number };
const EVENTS: Partial<Record<HangoutPose, { every: number; fire: (rig: Rig) => void }>> = {
  'throwing-plane': { every: 5, fire: ({ character, planes }) => character.throwPlane((from) => planes.throw(from, FAR_DESK)) },
  'throwing-ball': { every: 6, fire: ({ character }) => character.throwBall(START.dogSpots[0].fetch) },
  fishing: { every: CAST_SECONDS + 1, fire: ({ character, random, n }) => character.fish({ landing: landingFrom(random), fish: n % 2 ? 0 : null }) },
  'cue-shot': { every: SHOT_SECONDS * 2, fire: ({ character }) => character.takeShot() },
  paddle: { every: rallySeconds({ server: 1, hits: 5 }), fire: ({ character }) => character.playRally({ server: 1, hits: 5 }, 1) },
  floating: { every: Infinity, fire: ({ character, random }) => character.float(driftParams(random)) },
};

const shown = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false; return true; };
const shape = (m: THREE.Mesh) => `${m.geometry.type} ${JSON.stringify((m.geometry as { parameters?: unknown }).parameters)}`;

interface Frame { t: number; limbs: THREE.Vector3[]; held: Map<THREE.Mesh, THREE.Vector3>; loose: { shape: string; at: THREE.Vector3 }[] }

/** An agent at `pose` with the scene's flying props, every frame from 1 s after arriving for 20 s. */
function sample(pose: HangoutPose, { flyingProps = true } = {}): Frame[] {
  const scene = new THREE.Scene();
  const character = new Character(lookFor('session-1'));
  scene.add(character.root);
  character.placeAt(START.seats[0], 'done', placeFor(pose));
  const planes = new PaperPlanes(scene), binBall = new BinBall(scene), boardDarts = new BoardDarts(scene);
  const rig: Rig = { character, planes, random: seeded(7), n: 0 };
  const events = EVENTS[pose];
  let next = 0.5;
  const frames: Frame[] = [];
  for (let i = 0; i * FRAME < FROM + SECONDS; i++) {
    const t = i * FRAME;
    if (events && t >= next) { events.fire(rig); rig.n++; next += events.every; }
    character.update(t, FRAME);
    planes.update(FRAME);
    if (flyingProps) binBall.update(character.hoopsShooter());
    if (flyingProps) boardDarts.update(character.dartsThrower());
    scene.updateMatrixWorld(true);
    if (t < FROM) continue;
    const world = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
    const held = new Map<THREE.Mesh, THREE.Vector3>();
    // Anything in a hand but the hand itself and its outline.
    character.hands.forEach((hand) => hand.traverse((o) => { if (o instanceof THREE.Mesh && o.geometry !== hand.geometry && shown(o)) held.set(o, world(o)); }));
    const loose: Frame['loose'] = [];
    scene.traverse((o) => { if (o instanceof THREE.Mesh && shown(o) && !held.has(o)) loose.push({ shape: shape(o), at: world(o) }); });
    frames.push({ t, limbs: [...character.hands, ...character.feet].map(world), held, loose });
  }
  return frames;
}

describe('#80 smoothness guard for every pose', () => {
  it('#80 covers every hangout pose', () => {
    expect(HANGOUT_POSES.length).toBeGreaterThanOrEqual(23);
  });

  describe.each(HANGOUT_POSES)('%s', (pose) => {
    const frames = sample(pose);

    it(`#80 AC1 #80 AC3 ${pose}: no hand, foot or held prop moves more than ${SNAP} m in a frame`, () => {
      const snaps: string[] = [];
      for (let i = 1; i < frames.length; i++) {
        const [a, b] = [frames[i - 1], frames[i]];
        b.limbs.forEach((p, j) => { const d = p.distanceTo(a.limbs[j]); if (d > SNAP) snaps.push(`limb ${j} ${d.toFixed(2)} m at ${b.t.toFixed(3)}`); });
        b.held.forEach((p, m) => { const was = a.held.get(m), d = was && p.distanceTo(was); if (d && d > SNAP) snaps.push(`${shape(m)} ${d.toFixed(2)} m at ${b.t.toFixed(3)}`); });
      }
      expect(snaps.slice(0, 5)).toEqual([]);
    });

    it(`#80 AC2 #80 AC3 ${pose}: a held prop leaves the hand only as a copy of it, within ${FLEW} m of where it was`, () => {
      expect(leavings(frames).vanished.slice(0, 5)).toEqual([]);
    });
  });

  it('#80 AC2 the guard sees darts, balls and planes leave the hand, and would catch one that just vanished', () => {
    for (const pose of ['throwing-darts', 'shooting-hoops', 'throwing-plane'] as const) {
      const { left, vanished } = leavings(sample(pose));
      expect(left, pose).toBeGreaterThanOrEqual(2);
      expect(vanished, pose).toEqual([]);
    }
    for (const pose of ['throwing-darts', 'shooting-hoops'] as const) expect(leavings(sample(pose, { flyingProps: false })).vanished.length, pose).toBeGreaterThan(0);
  });
});

/** Held props that left the hand, and those of them with no copy shown within FLEW of where they were. */
function leavings(frames: Frame[]) {
  const vanished: string[] = [];
  let left = 0;
  for (let i = 1; i < frames.length; i++) {
    const [a, b] = [frames[i - 1], frames[i]];
    a.held.forEach((was, m) => {
      if (b.held.has(m)) return;
      left++;
      const copy = b.loose.some((o) => o.shape === shape(m) && o.at.distanceTo(was) <= FLEW);
      if (!copy) vanished.push(`${shape(m)} at ${b.t.toFixed(3)}`);
    });
  }
  return { left, vanished };
}
