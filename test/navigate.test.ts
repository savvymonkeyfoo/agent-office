import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import {
  blockContextMenu, createDoubleTap, createGestures, focusOn, frameFloor, goHome, grabAt, initialOrbit, pansWith, pickSurface,
  placeCamera, wheelRadius, zoomToward, type Orbit, type Pointer,
} from '../src/client/camera.ts';
import { INITIAL_ROWS, WALL_HEIGHT, officeLayout } from '../src/client/layout.ts';
import { buildOffice } from '../src/client/office.ts';

const SCREEN = { width: 1600, height: 1000 };
const toPixels = (p: THREE.Vector3, camera: THREE.Camera) => {
  const ndc = p.clone().project(camera);
  return { x: ((ndc.x + 1) / 2) * SCREEN.width, y: ((1 - ndc.y) / 2) * SCREEN.height };
};

/** A camera framed as on first load over the real office, and a pointer like the view's. */
function setup(rows = INITIAL_ROWS, { hitNothing = false } = {}) {
  const camera = new THREE.PerspectiveCamera(34, SCREEN.width / SCREEN.height, 0.1, 150);
  const orbit = initialOrbit();
  frameFloor(camera, orbit, rows);
  const office = buildOffice(rows);
  office.group.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  const pointer: Pointer = {
    ray(x, y) {
      placeCamera(camera, orbit);
      raycaster.setFromCamera(new THREE.Vector2((x / SCREEN.width) * 2 - 1, -(y / SCREEN.height) * 2 + 1), camera);
      return raycaster.ray.clone();
    },
    pick(x, y) {
      pointer.ray(x, y);
      return hitNothing ? null : pickSurface(raycaster, office.group);
    },
  };
  return { camera, orbit, office, pointer, gestures: createGestures(orbit, pointer) };
}

const view = (orbit: Orbit) => ({ theta: orbit.theta, phi: orbit.phi, radius: orbit.radius, target: orbit.target.clone() });
const inRoom = (orbit: Orbit, rows = INITIAL_ROWS) => {
  const { left, right, back, front } = officeLayout(rows).bounds;
  const { x, y, z } = orbit.target;
  return x >= left && x <= right && z >= back && z <= front && y >= 0 && y <= WALL_HEIGHT;
};
/** The big board's centre, on its screen face, and where it is on screen. */
function boardSpot(office: ReturnType<typeof buildOffice>, camera: THREE.Camera) {
  const centre = office.board.mesh.getWorldPosition(new THREE.Vector3());
  return { centre, pixels: toPixels(centre, camera) };
}

describe('#41 AC1 pan', () => {
  it('#41 AC1 / AC6 with a mouse, left-drag and middle-drag pan; right-drag and Shift+left-drag orbit', () => {
    const mouse = (button: number, shiftKey = false) => pansWith({ button, shiftKey, pointerType: 'mouse' });
    expect(mouse(0)).toBe(true);
    expect(mouse(1)).toBe(true);
    expect(mouse(2)).toBe(false);
    expect(mouse(0, true)).toBe(false);
  });

  it('#41 AC6 on touch, one finger still orbits', () => {
    expect(pansWith({ button: 0, shiftKey: false, pointerType: 'touch' })).toBe(false);
    expect(pansWith({ button: 0, shiftKey: false, pointerType: 'pen' })).toBe(false);
  });

  it('#41 AC1 the floor point grabbed stays under the pointer; angle, tilt and zoom stay', () => {
    const { orbit, camera, pointer, gestures } = setup();
    const before = view(orbit);
    // A pixel over open floor in the starting view (moved up from y 700 when the view pulled back, #111).
    const grabbed = grabAt(pointer, orbit, 700, 600)!.point;
    gestures.down(1, 700, 600, { pans: true });
    gestures.move(1, 760, 590);
    gestures.move(1, 850, 540);
    expect(gestures.up(1)).toBe(false);
    expect([orbit.theta, orbit.phi, orbit.radius]).toEqual([before.theta, before.phi, before.radius]);
    expect(orbit.target.distanceTo(before.target)).toBeGreaterThan(0.3);
    placeCamera(camera, orbit);
    const now = toPixels(grabbed, camera);
    expect(now.x).toBeCloseTo(850, 3);
    expect(now.y).toBeCloseTo(540, 3);
  });

  it('#41 AC1 grabbing the big board drags it along with the pointer, up and down too', () => {
    const { orbit, camera, office, pointer, gestures } = setup();
    for (let i = 0; i < 12; i++) zoomToward(orbit, grabAt(pointer, orbit, 800, 300)!.point, wheelRadius(orbit.radius, -1, orbit.maxRadius));
    placeCamera(camera, orbit);
    const { centre, pixels } = boardSpot(office, camera);
    const grab = grabAt(pointer, orbit, pixels.x, pixels.y)!;
    expect(grab.point.distanceTo(centre)).toBeLessThan(0.2); // it's the board that's grabbed
    gestures.down(1, pixels.x, pixels.y, { pans: true });
    gestures.move(1, pixels.x - 40, pixels.y + 120);
    placeCamera(camera, orbit);
    const now = toPixels(grab.point, camera);
    expect(now.x).toBeCloseTo(pixels.x - 40, 2);
    expect(now.y).toBeCloseTo(pixels.y + 120, 2);
  });

  it('#41 AC1 two fingers dragging together pan without orbiting or zooming', () => {
    const { orbit, gestures } = setup();
    const before = view(orbit);
    gestures.down(1, 700, 600);
    gestures.down(2, 900, 600);
    gestures.move(1, 750, 640);
    gestures.move(2, 950, 640);
    expect([orbit.theta, orbit.phi]).toEqual([before.theta, before.phi]);
    expect(orbit.radius).toBeCloseTo(before.radius, 6);
    expect(orbit.target.distanceTo(before.target)).toBeGreaterThan(0.3);
    expect(gestures.up(1)).toBe(false);
    expect(gestures.up(2)).toBe(false);
  });

  it('#41 AC1 two-finger pinch still zooms', () => {
    const { orbit, gestures } = setup();
    const radius = orbit.radius;
    gestures.down(1, 700, 600);
    gestures.down(2, 900, 600);
    gestures.move(1, 600, 600);
    gestures.move(2, 1000, 600);
    expect(orbit.radius).toBeCloseTo(radius / 2, 6);
  });
});

describe('#41 AC2 the target stays in the room', () => {
  it('#41 AC2 panning far in any direction stops at the floor bounds, between the floor and the wall top', () => {
    for (const [dx, dy] of [[5000, 0], [-5000, 0], [0, 5000], [0, -5000], [4000, 4000]]) {
      const { orbit, gestures } = setup();
      gestures.down(1, 800, 700, { pans: true });
      for (let s = 1; s <= 10; s++) gestures.move(1, 800 + (dx * s) / 10, 700 + (dy * s) / 10);
      expect(inRoom(orbit), `${dx},${dy}`).toBe(true);
    }
  });

  it('#41 AC2 dragging the board far up or down keeps the target between the floor and the wall top', () => {
    for (const dy of [3000, -3000]) {
      const { orbit, camera, office, gestures } = setup();
      orbit.phi = 1.4;
      orbit.target.set(0, 2, officeLayout(INITIAL_ROWS).bounds.back + 3);
      orbit.radius = 8;
      placeCamera(camera, orbit);
      const { pixels } = boardSpot(office, camera);
      gestures.down(1, pixels.x, pixels.y, { pans: true });
      for (let s = 1; s <= 10; s++) gestures.move(1, pixels.x, pixels.y + (dy * s) / 10);
      expect(inRoom(orbit), `${dy}`).toBe(true);
    }
  });

  it('#41 AC2 the bounds grow with the office', () => {
    const { orbit, camera } = setup(4);
    expect(orbit.bounds).toEqual(officeLayout(4).bounds);
    focusOn(orbit, new THREE.Vector3(0, 0.5, officeLayout(4).bounds.back + 0.5));
    expect(orbit.target.z).toBeCloseTo(officeLayout(4).bounds.back + 0.5);
    frameFloor(camera, orbit, INITIAL_ROWS);
    expect(orbit.bounds).toEqual(officeLayout(INITIAL_ROWS).bounds);
  });

  it('#41 AC2 zooming towards, and focusing on, points outside the room stay inside', () => {
    const { orbit } = setup();
    zoomToward(orbit, new THREE.Vector3(60, 9, -60), 6);
    expect(inRoom(orbit)).toBe(true);
    focusOn(orbit, new THREE.Vector3(-80, -4, 90));
    expect(inRoom(orbit)).toBe(true);
    focusOn(orbit, new THREE.Vector3(0, 20, 0));
    expect(inRoom(orbit)).toBe(true);
  });
});

describe('#41 AC3 zoom towards what is under the pointer', () => {
  for (const [x, y] of [[300, 700], [1300, 600], [800, 500]]) {
    it(`#41 AC3 wheel zoom keeps the point under the pointer at (${x}, ${y})`, () => {
      const { orbit, camera, pointer } = setup();
      for (const deltaY of [-100, -100, 100]) {
        const point = grabAt(pointer, orbit, x, y)!.point;
        zoomToward(orbit, point, wheelRadius(orbit.radius, deltaY, orbit.maxRadius));
        placeCamera(camera, orbit);
        const after = toPixels(point, camera);
        expect(after.x).toBeCloseTo(x, 3);
        expect(after.y).toBeCloseTo(y, 3);
      }
    });
  }

  it('#41 AC3 zooming at the big board goes right up to it, keeping it under the pointer', () => {
    const { orbit, camera, office, pointer } = setup();
    // Seen from a little to the side and above, as the starting view was before #50.
    Object.assign(orbit, { theta: 0.22, phi: 0.86 });
    frameFloor(camera, orbit, INITIAL_ROWS);
    const start = boardSpot(office, camera);
    for (let i = 0; i < 40; i++) {
      zoomToward(orbit, grabAt(pointer, orbit, start.pixels.x, start.pixels.y)!.point, wheelRadius(orbit.radius, -1, orbit.maxRadius));
    }
    placeCamera(camera, orbit);
    const now = boardSpot(office, camera).pixels;
    expect(now.x).toBeCloseTo(start.pixels.x, 0);
    expect(now.y).toBeCloseTo(start.pixels.y, 0);
    expect(orbit.radius).toBe(6);
    // From ~30 m away to a few metres; the board is off-centre, so a little over the 6 m zoom limit.
    expect(camera.position.distanceTo(start.centre)).toBeLessThan(8);
    expect(orbit.target.y, 'the pivot rose towards the board').toBeGreaterThan(1.2);
  });

  it('#41 AC3 pointing at nothing zooms towards the floor-level point under the pointer, as before', () => {
    const { orbit, camera, pointer } = setup(INITIAL_ROWS, { hitNothing: true });
    const grab = grabAt(pointer, orbit, 400, 700)!;
    expect(grab.point.y).toBeCloseTo(orbit.target.y);
    zoomToward(orbit, grab.point, 10);
    placeCamera(camera, orbit);
    const after = toPixels(grab.point, camera);
    expect(after.x).toBeCloseTo(400, 3);
    expect(after.y).toBeCloseTo(700, 3);
  });

  it('#41 AC3 zoom limits still hold', () => {
    const { orbit, pointer } = setup();
    for (let i = 0; i < 40; i++) zoomToward(orbit, grabAt(pointer, orbit, 800, 600)!.point, wheelRadius(orbit.radius, -1, orbit.maxRadius));
    expect(orbit.radius).toBe(6);
  });

  it('#41 AC3 pinch zoom keeps the point under the pinch centre', () => {
    const { orbit, camera, pointer, gestures } = setup();
    const centre = { x: 500, y: 650 };
    const point = grabAt(pointer, orbit, centre.x, centre.y)!.point;
    gestures.down(1, centre.x - 50, centre.y);
    gestures.down(2, centre.x + 50, centre.y);
    for (const spread of [70, 90, 120, 160]) {
      gestures.move(1, centre.x - spread, centre.y);
      gestures.move(2, centre.x + spread, centre.y);
    }
    expect(orbit.radius).toBeLessThan(18);
    placeCamera(camera, orbit);
    const after = toPixels(point, camera);
    expect(after.x).toBeCloseTo(centre.x, 0);
    expect(after.y).toBeCloseTo(centre.y, 0);
  });
});

describe('#41 AC4 double-click to focus', () => {
  it('#41 AC4 two quick taps close together are a double tap; slow or far apart ones are not', () => {
    const tap = createDoubleTap();
    expect(tap(100, 100, 1000)).toBe(false);
    expect(tap(104, 102, 1250)).toBe(true);
    expect(tap(104, 102, 1400)).toBe(false); // a third tap starts over
    expect(tap(104, 102, 2000)).toBe(false); // too slow
    expect(tap(300, 102, 2100)).toBe(false); // too far
  });

  it('#41 AC4 focusing on the floor or the big board centres the target there, keeping angle, tilt and zoom', () => {
    const { orbit, camera, office, pointer } = setup();
    const onBoard = () => {
      placeCamera(camera, orbit);
      const { x, y } = boardSpot(office, camera).pixels;
      return [x, y];
    };
    for (const where of [() => [400, 750], onBoard]) {
      const [x, y] = where();
      const before = view(orbit);
      const point = grabAt(pointer, orbit, x, y)!.point;
      focusOn(orbit, point);
      expect(orbit.target.distanceTo(point)).toBeLessThan(1e-9);
      expect([orbit.theta, orbit.phi, orbit.radius]).toEqual([before.theta, before.phi, before.radius]);
      placeCamera(camera, orbit);
      const centre = toPixels(point, camera);
      expect(centre.x).toBeCloseTo(800, 3);
      expect(centre.y).toBeCloseTo(500, 3);
    }
    expect(orbit.target.y, 'centred on the board').toBeGreaterThan(1.2);
  });
});

describe('#41 AC5 Home', () => {
  it('#41 AC5 Home restores target, angle, tilt and zoom as on first load', () => {
    for (const rows of [INITIAL_ROWS, 3]) {
      const { orbit, camera, gestures, pointer } = setup(rows);
      const start = view(orbit);
      gestures.down(1, 800, 500);
      gestures.move(1, 1100, 300);
      gestures.up(1);
      gestures.down(1, 800, 600, { pans: true });
      gestures.move(1, 600, 750);
      gestures.up(1);
      zoomToward(orbit, grabAt(pointer, orbit, 200, 700)?.point ?? null, 9);
      focusOn(orbit, new THREE.Vector3(5, 2, 9));
      goHome(camera, orbit, rows);
      const home = view(orbit);
      expect(home.theta).toBe(start.theta);
      expect(home.phi).toBe(start.phi);
      expect(home.radius).toBeCloseTo(start.radius, 6);
      expect(home.target.distanceTo(start.target)).toBeLessThan(1e-9);
    }
  });

  it('#41 AC5 the page has a Home button', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toMatch(/<button[^>]*id="home"[^>]*>/);
  });
});

describe('#41 AC6 tap still selects; right-drag and one finger orbit', () => {
  it('#41 AC6 a still left click (it pans when dragged) and a one-finger tap are taps', () => {
    const { gestures } = setup();
    gestures.down(1, 800, 500, { pans: true });
    expect(gestures.up(1), 'left click').toBe(true);
    gestures.down(1, 800, 500, { pans: true });
    gestures.move(1, 802, 501); // a hand's tremble
    expect(gestures.up(1), 'left click, slight wobble').toBe(true);
    gestures.down(1, 800, 500);
    expect(gestures.up(1), 'one-finger tap').toBe(true);
  });

  it('#41 AC6 a left drag that moves is not a tap; a still right click is not a tap either', () => {
    const { gestures } = setup();
    gestures.down(1, 800, 500, { pans: true });
    gestures.move(1, 860, 500);
    expect(gestures.up(1)).toBe(false);
    gestures.down(1, 800, 500, { taps: false });
    expect(gestures.up(1)).toBe(false);
  });

  it('#41 AC6 an orbit drag (right-drag, one finger) turns and tilts and leaves the target; a pan drag does not orbit', () => {
    const { orbit, gestures } = setup();
    const before = view(orbit);
    gestures.down(1, 800, 500, { taps: false });
    gestures.move(1, 860, 480);
    expect(gestures.up(1)).toBe(false);
    expect(orbit.theta).toBeCloseTo(before.theta - 0.3);
    expect(orbit.phi).toBeCloseTo(before.phi + 0.08);
    expect(orbit.target.equals(before.target)).toBe(true);
    const turned = view(orbit);
    gestures.down(1, 800, 600, { pans: true });
    gestures.move(1, 860, 580);
    gestures.up(1);
    expect([orbit.theta, orbit.phi]).toEqual([turned.theta, turned.phi]);
  });

  it('#41 AC6 right-click on the office does not open the browser menu', () => {
    const canvas = new EventTarget();
    blockContextMenu(canvas);
    const event = new Event('contextmenu', { cancelable: true });
    canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
