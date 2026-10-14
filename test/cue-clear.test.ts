import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { INITIAL_ROWS, officeLayout } from '../src/client/layout.ts';
import { Character } from '../src/client/character.ts';
import { lookFor } from '../src/client/look.ts';
import { SHOT_COUNT, SHOT_SECONDS } from '../src/client/pool.ts';

const START = officeLayout(INITIAL_ROWS);
const TURNS = START.poolTurns;
const FRAME = 1 / 60;
/** The cue model (character.ts): 1.45 m long, 0.022 m at the butt, with a 3% outline. */
const CUE_HALF = 1.45 / 2;
const CUE_R = 0.022 * 1.03;

/** One look per hat, so every head shape is checked. */
const LOOKS = (() => {
  const byHat = new Map<string, ReturnType<typeof lookFor>>();
  for (let i = 1; byHat.size < 6 && i < 500; i++) {
    const look = lookFor(`session-${i}`);
    if (!byHat.has(look.hat)) byHat.set(look.hat, look);
  }
  return [...byHat.values()];
})();

const isCue = (o: THREE.Object3D) => o instanceof THREE.Mesh && o.userData.kind === 'cue';
function visibleCue(c: Character) {
  let cue: THREE.Mesh | null = null;
  c.root.traverseVisible((o) => { if (!cue && isCue(o)) cue = o as THREE.Mesh; });
  return cue!;
}

/** The gap between the cue's surface and the nearest point of the head (skin, face, hat and their outlines). */
function cueToHead(c: Character) {
  c.root.updateMatrixWorld(true);
  const cue = visibleCue(c);
  const a = new THREE.Vector3(0, -CUE_HALF, 0).applyMatrix4(cue.matrixWorld);
  const b = new THREE.Vector3(0, CUE_HALF, 0).applyMatrix4(cue.matrixWorld);
  const axis = new THREE.Line3(a, b), v = new THREE.Vector3(), near = new THREE.Vector3();
  let gap = Infinity;
  c.head.traverseVisible((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const position = o.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(o.matrixWorld);
      gap = Math.min(gap, v.distanceTo(axis.closestPointToPoint(v, true, near)) - CUE_R);
    }
  });
  return gap;
}

/** The cue's turn relative to its holder. */
function cueTurn(c: Character) {
  c.root.updateMatrixWorld(true);
  return c.root.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(visibleCue(c).getWorldQuaternion(new THREE.Quaternion()));
}

function run(c: Character, from: number, seconds: number, each: (t: number) => void = () => {}) {
  for (let t = from; t < from + seconds; t += FRAME) {
    c.update(t, FRAME);
    each(t);
  }
}

describe('#117 AC1 the waiting cue is held the same way, shot or not', () => {
  for (let k = 0; k < SHOT_COUNT; k++) {
    it(`#117 AC1 turn ${k + 1}: same orientation in cue-wait after a shot as without one`, () => {
      const fresh = new Character(lookFor('session-1'));
      fresh.placeAt(START.seats[0], 'done', TURNS[k].wait);
      run(fresh, 0, 1);

      const shooter = new Character(lookFor('session-1'));
      shooter.placeAt(START.seats[0], 'done', TURNS[k].shoot);
      shooter.takeShot();
      run(shooter, 0, SHOT_SECONDS);
      shooter.placeAt(START.seats[0], 'done', TURNS[k].wait);
      run(shooter, 0, 1);

      expect(cueTurn(shooter).angleTo(cueTurn(fresh))).toBeLessThan(1e-6);
    });
  }
});

describe('#117 AC2 the cue stays at least 5 cm from the head', () => {
  for (const look of LOOKS) {
    it(`#117 AC2 cue-wait (${look.hat}): clear through a whole sway`, () => {
      const c = new Character(look);
      c.placeAt(START.seats[0], 'done', TURNS[0].wait);
      let worst = Infinity;
      run(c, 0, 12, () => { worst = Math.min(worst, cueToHead(c)); });
      expect(worst).toBeGreaterThanOrEqual(0.05);
    });

    it(`#117 AC2 cue-shot (${look.hat}): clear through the whole stroke`, () => {
      const c = new Character(look);
      c.placeAt(START.seats[0], 'done', TURNS[0].shoot);
      c.takeShot();
      let worst = Infinity;
      run(c, 0, SHOT_SECONDS, () => { worst = Math.min(worst, cueToHead(c)); });
      expect(worst).toBeGreaterThanOrEqual(0.05);
    });
  }

  it('#117 AC2 checks every hat', () => expect(LOOKS.length).toBe(6));
});
