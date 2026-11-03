// Dev only: samples every character each frame while a check runs (scripts/office-check.mjs --motion),
// and reports pops (a jump faster than anyone moves), bumps (two agents on their feet
// closer than BUMP metres) and frame times.
import type * as THREE from 'three';

/** Faster than anyone moves: a sprint is about 3 m/s, so a pop is over 12 m/s or 1 m in one frame, whichever is more. */
const popAt = (dt: number) => Math.max(1, 12 * dt);
const BUMP = 0.42;

interface Mover { root: THREE.Object3D; mode: string }

export function motionCheck() {
  let on = false;
  let last = new WeakMap<Mover, { x: number; z: number }>();
  let frames = 0, slow = 0, worst = 0, total = 0;
  const pops: string[] = [], bumps = new Map<string, number>();

  function sample(characters: Map<string, Mover>, dt: number) {
    if (!on) return;
    frames++;
    total += dt;
    worst = Math.max(worst, dt);
    if (dt > 1 / 30) slow++;
    const standing: [string, THREE.Vector3][] = [];
    for (const [key, c] of characters) {
      const p = c.root.position, was = last.get(c);
      if (was && Math.hypot(p.x - was.x, p.z - was.z) > popAt(dt) && pops.length < 20) {
        pops.push(`${key} jumped ${Math.hypot(p.x - was.x, p.z - was.z).toFixed(2)} m while ${c.mode} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
      }
      last.set(c, { x: p.x, z: p.z });
      if (c.mode === 'walking' || c.mode === 'standing') standing.push([key, p]);
    }
    for (let i = 0; i < standing.length; i++) for (let j = i + 1; j < standing.length; j++) {
      const [a, pa] = standing[i], [b, pb] = standing[j];
      if (Math.hypot(pa.x - pb.x, pa.z - pb.z) < BUMP) {
        const pair = [a, b].sort().join(' + ');
        bumps.set(pair, (bumps.get(pair) ?? 0) + 1);
      }
    }
  }

  const hook = {
    start() {
      on = true;
      last = new WeakMap();
      frames = slow = worst = total = 0;
      pops.length = 0;
      bumps.clear();
    },
    stop() {
      on = false;
      return {
        frames, fps: frames ? Math.round(frames / total) : 0, worstFrameMs: Math.round(worst * 1000), slowFrames: slow,
        pops,
        // Brushing past for a frame or two is fine; a bump is a pair overlapping for over a third of a second.
        bumps: [...bumps].filter(([, n]) => n > 20).map(([pair, n]) => `${pair} for ${n} frames`),
      };
    },
  };
  return { hook, sample };
}
