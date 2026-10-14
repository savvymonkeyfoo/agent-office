import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { INITIAL_ROWS, officeLayout } from '../src/client/layout.ts';
import { buildOffice } from '../src/client/office.ts';
import { Character } from '../src/client/character.ts';
import { lookFor } from '../src/client/look.ts';
import { find } from './office-sim.ts';

const START = officeLayout(INITIAL_ROWS);
const PLACE = START.hangouts.find((s) => s.name === 'yoga')!.places[0];
const FRAME = 1 / 60;
const SECONDS = 140;
/** Poses are sampled from 1 s after arriving: the arrival blend is excluded (#72). */
const FROM = 1;

/** A limb's extent, leaving out hidden things it could hold (a mug, a dart). */
function visibleBox(limb: THREE.Object3D) {
  const box = new THREE.Box3();
  limb.traverse((o) => {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return;
    if (!(o instanceof THREE.Mesh)) return;
    o.geometry.computeBoundingBox();
    box.union(o.geometry.boundingBox!.clone().applyMatrix4(o.matrixWorld));
  });
  return box;
}

/** A yogi on the mat, sampled every frame: world positions and boxes of its hands and feet. */
function flow() {
  const character = new Character(lookFor('session-1'));
  character.placeAt(START.seats[0], 'done', PLACE);
  const limbs = [...character.hands, ...character.feet];
  const frames: { t: number; at: THREE.Vector3[]; boxes: THREE.Box3[] }[] = [];
  for (let i = 0; i * FRAME < SECONDS; i++) {
    const t = i * FRAME;
    character.update(t, FRAME);
    character.root.updateMatrixWorld(true);
    if (t < FROM) continue;
    frames.push({ t, at: limbs.map((l) => l.getWorldPosition(new THREE.Vector3())), boxes: limbs.map(visibleBox) });
  }
  return frames;
}

const frames = flow();
const step = (i: number) => Math.max(...frames[i].at.map((p, j) => p.distanceTo(frames[i - 1].at[j])));

/** Runs of still frames (holds) and moving frames (eases), in order. */
function runs() {
  const out: { still: boolean; from: number; to: number; i: number }[] = [];
  for (let i = 1; i < frames.length; i++) {
    const still = step(i) < 1e-6, last = out[out.length - 1];
    if (last && last.still === still) last.to = frames[i].t;
    else out.push({ still, from: frames[i - 1].t, to: frames[i].t, i });
  }
  return out;
}

const segments = runs();
/** Whole segments only: the first and last are cut by the sampling window. */
const whole = segments.slice(1, -1);
const holds = whole.filter((s) => s.still);
/** Each hold's limb positions, and which distinct pose it is. */
const poses: THREE.Vector3[][] = [];
const held = holds.map((h) => {
  const at = frames[h.i].at;
  let pose = poses.findIndex((p) => p.every((q, j) => q.distanceTo(at[j]) < 0.01));
  if (pose < 0) pose = poses.push(at) - 1;
  return { ...h, pose };
});

describe('#79 yoga: a flow of poses', () => {
  it('#79 AC1 cycles through at least 4 distinct poses, each with a hand or foot 0.3 m from where it is in every other pose', () => {
    expect(poses.length).toBeGreaterThanOrEqual(4);
    poses.forEach((pose, a) => {
      const apart = pose.some((p, j) => poses.every((other, b) => b === a || p.distanceTo(other[j]) >= 0.3));
      expect(apart, `pose ${a}`).toBe(true);
    });
  });

  it('#79 AC2 each pose is held 3 to 6 s, then eases into the next over 1 to 2 s, never moving a limb more than 0.12 m a frame', () => {
    expect(holds.length).toBeGreaterThanOrEqual(8);
    for (const s of whole) {
      const length = s.to - s.from;
      if (s.still) expect(length, `hold at ${s.from.toFixed(2)}`).toBeGreaterThanOrEqual(3 - FRAME);
      if (s.still) expect(length, `hold at ${s.from.toFixed(2)}`).toBeLessThanOrEqual(6 + FRAME);
      if (!s.still) expect(length, `ease at ${s.from.toFixed(2)}`).toBeGreaterThanOrEqual(1 - FRAME);
      if (!s.still) expect(length, `ease at ${s.from.toFixed(2)}`).toBeLessThanOrEqual(2 + FRAME);
    }
    for (let i = 1; i < frames.length; i++) expect(step(i), `frame at ${frames[i].t.toFixed(2)}`).toBeLessThanOrEqual(0.12);
  });

  it('#79 AC3 the sequence loops: over any 60 s on the mat, every pose appears', () => {
    expect(poses.length).toBeGreaterThanOrEqual(4);
    const last = frames[frames.length - 1].t;
    expect(last - FROM).toBeGreaterThan(120);
    for (let start = FROM; start + 60 <= last; start += 0.5) {
      const seen = new Set(held.filter((h) => h.to > start && h.from < start + 60).map((h) => h.pose));
      expect(seen.size, `60 s from ${start}`).toBe(poses.length);
    }
  });

  it('#79 AC4 hands and feet stay on or above the mat, within its footprint', () => {
    const { group } = buildOffice(INITIAL_ROWS);
    const [mat] = find(group, 'yoga-mat');
    const box = new THREE.Box3().setFromObject(mat);
    for (const f of frames) {
      f.boxes.forEach((b, j) => expect(b.min.y, `limb ${j} at ${f.t.toFixed(2)}`).toBeGreaterThanOrEqual(box.max.y - 1e-6));
      f.at.forEach((p, j) => {
        expect(p.x, `limb ${j} at ${f.t.toFixed(2)}`).toBeGreaterThanOrEqual(box.min.x);
        expect(p.x, `limb ${j} at ${f.t.toFixed(2)}`).toBeLessThanOrEqual(box.max.x);
        expect(p.z, `limb ${j} at ${f.t.toFixed(2)}`).toBeGreaterThanOrEqual(box.min.z);
        expect(p.z, `limb ${j} at ${f.t.toFixed(2)}`).toBeLessThanOrEqual(box.max.z);
      });
    }
  });
});
