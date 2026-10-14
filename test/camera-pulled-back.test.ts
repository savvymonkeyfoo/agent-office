// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { allOnScreen, fitRadius, floorCorners, frameFloor, goHome, initialOrbit, wheelRadius } from '../src/client/camera.ts';
import { INITIAL_ROWS, WALL_HEIGHT, officeLayout } from '../src/client/layout.ts';

const SHAPES = [[1440, 900], [2560, 1080], [390, 844], [375, 667], [800, 800]] as const;
const SIZES = [[INITIAL_ROWS, 'classic'], [3, 'classic'], [6, 'classic'], [INITIAL_ROWS, 'control-room'], [4, 'control-room']] as const;

/** The pre-#111 starting distance: the fit radius or the hand-tuned one, whichever is larger. */
function previousRadius(camera: THREE.PerspectiveCamera, rows: number, preset: string) {
  const orbit = initialOrbit();
  frameFloor(camera, orbit, rows, preset);
  const { left, right, back, front } = officeLayout(rows, preset).bounds;
  const handTuned = 4 + Math.max(right - left, front - back) * 0.9;
  return Math.max(fitRadius(camera, orbit, floorCorners(rows, preset)), handTuned);
}

describe('#111 AC1 the starting view is 10–20% farther than before', () => {
  for (const [w, h] of SHAPES) {
    for (const [rows, preset] of SIZES) {
      it(`#111 AC1 ${w}×${h}, ${rows} rows, ${preset}`, () => {
        const camera = new THREE.PerspectiveCamera(34, w / h, 0.1, 150);
        const orbit = initialOrbit();
        frameFloor(camera, orbit, rows, preset);
        const before = previousRadius(new THREE.PerspectiveCamera(34, w / h, 0.1, 150), rows, preset);
        const ratio = orbit.radius / before;
        expect(ratio).toBeGreaterThanOrEqual(1.1);
        expect(ratio).toBeLessThanOrEqual(1.2);
        expect(camera.position.distanceTo(orbit.target)).toBeCloseTo(orbit.radius, 6);
      });
    }
  }
});

describe('#111 AC2 Home returns to the farther view, and zoom still works both ways', () => {
  for (const [w, h] of SHAPES) {
    it(`#111 AC2 ${w}×${h}`, () => {
      const first = new THREE.PerspectiveCamera(34, w / h, 0.1, 150);
      const start = initialOrbit();
      frameFloor(first, start, INITIAL_ROWS);
      const camera = new THREE.PerspectiveCamera(34, w / h, 0.1, 150);
      const orbit = initialOrbit();
      orbit.radius = 7;
      goHome(camera, orbit, INITIAL_ROWS);
      expect(orbit.radius).toBeCloseTo(start.radius, 9);
      expect(orbit.maxRadius).toBeGreaterThanOrEqual(orbit.radius);
      expect(wheelRadius(orbit.radius, -1, orbit.maxRadius)).toBeLessThan(orbit.radius);
      const out = wheelRadius(orbit.radius, 1, orbit.maxRadius);
      expect(out).toBeGreaterThanOrEqual(orbit.radius);
      expect(wheelRadius(out, -1, orbit.maxRadius)).toBeLessThan(out);
    });
  }
});

describe('the starting view sits the office in the middle of the screen, top to bottom', () => {
  for (const [w, h] of SHAPES) {
    for (const [rows, preset] of SIZES) {
      it(`${w}×${h}, ${rows} rows, ${preset}`, () => {
        const camera = new THREE.PerspectiveCamera(34, w / h, 0.1, 150);
        frameFloor(camera, initialOrbit(), rows, preset);
        const { left, right, back } = officeLayout(rows, preset).bounds;
        // The floor corners (with the Control room's walls), plus Classic's back wall top.
        const outline = [...floorCorners(rows, preset), ...(preset === 'classic' ? [new THREE.Vector3(left, WALL_HEIGHT, back), new THREE.Vector3(right, WALL_HEIGHT, back)] : [])];
        const ys = outline.map((p) => p.clone().project(camera).y);
        expect(Math.abs((Math.min(...ys) + Math.max(...ys)) / 2)).toBeLessThan(0.03);
        expect(allOnScreen(camera, floorCorners(rows, preset))).toBe(true);
      });
    }
  }
});
