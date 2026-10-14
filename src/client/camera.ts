import * as THREE from 'three';
import { INITIAL_ROWS, WALL_HEIGHT, officeLayout } from './layout.ts';

/** How far the camera can zoom, in metres from its target. Narrow screens may raise `max` to fit the floor (#22). */
export const ZOOM = { min: 6, max: 45 };
/** Vertical field of view: 34° normally, widened up to 45° on narrow screens (#22). */
export const FOV = { base: 34, max: 45 };
/** Tilt from straight down, in radians: nearly overhead to nearly level, never below the floor. */
export const TILT = { min: 0.1, max: 1.45 };
/** Furthest the fit will back off; the camera's far plane is 150 m. */
const FIT_LIMIT = 120;
/** The starting view sits this much farther out than the tight fit, for room around the office (#111). */
const HOME_PULL_BACK = 1.15;

/** Where the orbit target may go: the whole floor, deck included. */
export interface FloorBounds { left: number; right: number; back: number; front: number }

export interface Orbit { theta: number; phi: number; radius: number; target: THREE.Vector3; maxRadius: number; bounds: FloorBounds }

/** The starting (and reset) view looks at the office square-on, this many degrees below horizontal. */
export const HOME_LOOK_DOWN = 25;

export const initialOrbit = (): Orbit => ({
  theta: 0, phi: THREE.MathUtils.degToRad(90 - HOME_LOOK_DOWN), radius: 18, target: new THREE.Vector3(0, 0.5, 0), maxRadius: ZOOM.max, bounds: officeLayout(INITIAL_ROWS).bounds,
});

/** Metres the target moves per pixel dragged, per metre of zoom. */
const PAN_SPEED = 0.0008;

/** Keeps the target in the room: over the floor (deck included), between the floor and the wall top. */
function keepInRoom({ target, bounds }: Orbit) {
  target.x = THREE.MathUtils.clamp(target.x, bounds.left, bounds.right);
  target.y = THREE.MathUtils.clamp(target.y, 0, WALL_HEIGHT);
  target.z = THREE.MathUtils.clamp(target.z, bounds.back, bounds.front);
}

/** Slides the target across the floor as if dragging the floor by (dx, dy) pixels. */
export function panBy(orbit: Orbit, dx: number, dy: number) {
  const step = orbit.radius * PAN_SPEED;
  const sin = Math.sin(orbit.theta), cos = Math.cos(orbit.theta);
  orbit.target.x -= (cos * dx + sin * dy) * step;
  orbit.target.z += (sin * dx - cos * dy) * step;
  keepInRoom(orbit);
}

/** Zooms to `radius`, moving towards `point` so it stays where it is on screen (null: towards the target). */
export function zoomToward(orbit: Orbit, point: THREE.Vector3 | null, radius: number) {
  if (point) orbit.target.sub(point).multiplyScalar(radius / orbit.radius).add(point);
  orbit.radius = radius;
  keepInRoom(orbit);
}

/** Centres the target on a point (on the floor, furniture or the big board). */
export function focusOn(orbit: Orbit, point: THREE.Vector3) {
  orbit.target.copy(point);
  keepInRoom(orbit);
}

/** A surface under the pointer: the point hit, and the surface's facing there. */
export interface Hit { point: THREE.Vector3; normal: THREE.Vector3 }

/** Screen pixels to rays (from where the camera is now), and to what they hit in the office. */
export interface Pointer {
  ray(x: number, y: number): THREE.Ray;
  pick(x: number, y: number): Hit | null;
}

/** Drawn and solid: not hidden, not see-through (glass, the selection ring), not an outline hull. */
function solid(object: THREE.Object3D) {
  if (!(object instanceof THREE.Mesh)) return false;
  const material = object.material as THREE.Material;
  if (material.transparent || material.side === THREE.BackSide) return false;
  for (let o: THREE.Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/** The first solid surface `raycaster` hits under `root`. */
export function pickSurface(raycaster: THREE.Raycaster, root: THREE.Object3D): Hit | null {
  const hit = raycaster.intersectObject(root, true).find((h) => solid(h.object));
  if (!hit) return null;
  const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
  return { point: hit.point.clone(), normal };
}

/** A point under the pointer, and the plane it slides along when dragged. */
export interface Grab { point: THREE.Vector3; plane: THREE.Plane }

/**
 * What the pointer grabs: the surface under it (the floor, a desk, the big board), or, over nothing,
 * the level plane through the target.
 */
export function grabAt(pointer: Pointer, orbit: Orbit, x: number, y: number): Grab | null {
  const hit = pointer.pick(x, y);
  if (hit) return { point: hit.point, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(hit.normal, hit.point) };
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -orbit.target.y);
  const point = pointer.ray(x, y).intersectPlane(plane, new THREE.Vector3());
  return point && { point, plane };
}

/**
 * Map-style mouse: left (or middle) drag pans; right or Shift+left drag orbits. On touch and pen,
 * one finger orbits (two fingers pan).
 */
export const pansWith = ({ button, shiftKey, pointerType }: { button: number; shiftKey: boolean; pointerType: string }) =>
  pointerType === 'mouse' && (button === 1 || (button === 0 && !shiftKey));

/** Right-drag orbits the office, so it doesn't open the browser's menu there. */
export const blockContextMenu = (canvas: EventTarget) => canvas.addEventListener('contextmenu', (e) => e.preventDefault());

/** Back to the view on first load: starting angle, tilt and target, zoomed to fit the floor. */
export function goHome(camera: THREE.PerspectiveCamera, orbit: Orbit, rows: number, preset = 'classic') {
  const start = initialOrbit();
  orbit.theta = start.theta;
  orbit.phi = start.phi;
  orbit.target.copy(start.target);
  frameFloor(camera, orbit, rows, preset);
}

/** Close-up view: tilted further down and pulled in, so desks, screens and speech bubbles are readable. */
export const CLOSE_UP = { lookDown: 36, zoom: 0.8 };

/** Turns a framed starting view into the close-up one, centred on the room (x = 0) rather than the room plus deck. */
export function closeUp(camera: THREE.PerspectiveCamera, orbit: Orbit, preset = 'classic') {
  // Classic's deck is in front of the room, not beside it, so it only needs pulling in a little.
  if (preset !== 'control-room') {
    orbit.radius *= 0.88;
    placeCamera(camera, orbit);
    return;
  }
  orbit.phi = THREE.MathUtils.degToRad(90 - CLOSE_UP.lookDown);
  orbit.radius *= CLOSE_UP.zoom;
  orbit.target.x = 0;
  placeCamera(camera, orbit);
}

/** The Home key goes back to the starting view. */
export function bindHomeKey(target: EventTarget, home: () => void) {
  target.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key !== 'Home') return;
    e.preventDefault();
    home();
  });
}

/** Returns a tap checker: true when a tap lands soon after, and close to, the previous one. */
export function createDoubleTap(withinMs = 350, nearPx = 24) {
  let last: { x: number; y: number; t: number } | null = null;
  return (x: number, y: number, t: number) => {
    const double = !!last && t - last.t <= withinMs && Math.hypot(x - last.x, y - last.y) <= nearPx;
    last = double ? null : { x, y, t };
    return double;
  };
}

export function placeCamera(camera: THREE.PerspectiveCamera, { theta, phi, radius, target }: Orbit) {
  camera.position.set(
    target.x + radius * Math.sin(phi) * Math.sin(theta),
    target.y + radius * Math.cos(phi),
    target.z + radius * Math.sin(phi) * Math.cos(theta),
  );
  camera.lookAt(target);
  camera.updateMatrixWorld();
}

const clampZoom = (radius: number, max: number) => THREE.MathUtils.clamp(radius, ZOOM.min, Math.max(ZOOM.max, max));

/** Scrolling down zooms out, up zooms in. */
export const wheelRadius = (radius: number, deltaY: number, max = ZOOM.max) => clampZoom(radius * (deltaY > 0 ? 1.08 : 0.92), max);

/** Spreading the fingers zooms in, pinching zooms out, in proportion to the finger distance. */
export const pinchRadius = (startRadius: number, startDistance: number, distance: number, max = ZOOM.max) =>
  clampZoom(startRadius * (startDistance / Math.max(distance, 1)), max);

/** Wider on narrow screens, so the side-to-side view doesn't shrink as much; never past FOV.max. */
export const fovFor = (aspect: number) => {
  const keepHorizontal = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(FOV.base / 2)) / aspect));
  return THREE.MathUtils.clamp(keepHorizontal, FOV.base, FOV.max);
};

/** The corners of the whole floor, deck included; in the Control room also the tops of the screen wall and of the lounge's side walls. */
export const floorCorners = (rows: number, preset = 'classic') => {
  const layout = officeLayout(rows, preset);
  const { left, right, back, front } = layout.bounds;
  const corners = [[left, back], [right, back], [left, front], [right, front]].map(([x, z]) => new THREE.Vector3(x, 0, z));
  if (layout.preset !== 'control-room') return corners;
  const { room, screenWall, crewLounge } = layout;
  return [
    ...corners,
    ...[room.left - 0.3, room.right + 0.3].flatMap((x) => [
      new THREE.Vector3(x, screenWall.height, back), new THREE.Vector3(x, crewLounge.height + crewLounge.wallHeight, crewLounge.z1),
    ]),
  ];
};

/** Whether every point lands inside the screen, leaving `margin` (in NDC units) at the edges. */
export function allOnScreen(camera: THREE.PerspectiveCamera, points: THREE.Vector3[], margin = 0) {
  const limit = 1 - margin;
  return points.every((p) => {
    const ndc = p.clone().project(camera);
    return Math.abs(ndc.x) <= limit && Math.abs(ndc.y) <= limit && ndc.z < 1;
  });
}

/** The closest camera distance at which all the points fit on screen, at the camera's current aspect and fov. */
export function fitRadius(camera: THREE.PerspectiveCamera, orbit: Orbit, points: THREE.Vector3[], margin = 0.04) {
  camera.updateProjectionMatrix();
  const fits = (radius: number) => {
    placeCamera(camera, { ...orbit, radius });
    return allOnScreen(camera, points, margin);
  };
  // Further away only ever shrinks the floor on screen, so a binary search finds the edge.
  let near = ZOOM.min, far = FIT_LIMIT;
  if (fits(near)) return near;
  if (!fits(far)) return far;
  while (far - near > 0.05) {
    const mid = (near + far) / 2;
    if (fits(mid)) far = mid; else near = mid;
  }
  return far;
}

/** What the starting view centres on screen: the floor corners, and in Classic the top of the back wall too. */
const officeOutline = (rows: number, preset: string) => {
  const corners = floorCorners(rows, preset);
  if (officeLayout(rows, preset).preset === 'control-room') return corners;
  const { left, right, back } = officeLayout(rows, preset).bounds;
  return [...corners, new THREE.Vector3(left, WALL_HEIGHT, back), new THREE.Vector3(right, WALL_HEIGHT, back)];
};

/** How far the office's middle sits above the screen's middle, in NDC (negative: below). */
function heightOnScreen(camera: THREE.PerspectiveCamera, points: THREE.Vector3[]) {
  const ys = points.map((p) => p.clone().project(camera).y);
  return (Math.min(...ys) + Math.max(...ys)) / 2;
}

/**
 * Sets the fov for the screen shape, aims at the floor, backs off until all of it is on screen,
 * and slides the aim back or forward so the office sits in the middle of the screen, top to bottom.
 */
export function frameFloor(camera: THREE.PerspectiveCamera, orbit: Orbit, rows: number, preset = 'classic') {
  camera.fov = fovFor(camera.aspect);
  orbit.bounds = officeLayout(rows, preset).bounds;
  const { left, right, back, front } = orbit.bounds;
  orbit.target.x = (left + right) / 2;
  orbit.target.z = (back + front) / 2;
  // Never closer than the hand-tuned desktop framing, so walls and furniture above the floor stay in view.
  const handTuned = 4 + Math.max(right - left, front - back) * 0.9;
  const fit = () => {
    orbit.radius = Math.max(fitRadius(camera, orbit, floorCorners(rows, preset)), handTuned) * HOME_PULL_BACK;
    placeCamera(camera, orbit);
  };
  const outline = officeOutline(rows, preset);
  const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  for (let pass = 0; pass < 3; pass++) {
    fit();
    // Moving the aim away from the camera by d slides the office down the screen by about d·cos(phi) / (radius·tan(fov/2)).
    const away = (heightOnScreen(camera, outline) * orbit.radius * halfHeight) / Math.cos(orbit.phi);
    orbit.target.x -= away * Math.sin(orbit.theta);
    orbit.target.z -= away * Math.cos(orbit.theta);
    keepInRoom(orbit);
  }
  fit();
  orbit.maxRadius = Math.max(ZOOM.max, orbit.radius);
}

type ScreenPoint = { x: number; y: number };

/** How far (px) a press may wobble and still count as a tap. */
const TAP_SLOP = 4;

/**
 * Pointer gestures on the canvas: a press orbits, or pans if it `pans` (see `pansWith`); two fingers
 * pan and pinch-zoom towards their centre. Panning grabs the surface under the pointer (via
 * `pointer`) and keeps it there. A press that `taps` (left button, a finger), barely moves and never
 * had a second finger counts as a tap.
 */
export function createGestures(orbit: Orbit, pointer: Pointer | null = null) {
  const pointers = new Map<number, ScreenPoint>();
  let drag: { x: number; y: number; theta: number; phi: number } | null = null;
  let pan: { at: ScreenPoint; plane: THREE.Plane | null } | null = null;
  let pinch: { distance: number; radius: number; centre: ScreenPoint; plane: THREE.Plane | null } | null = null;
  let pressedAt: ScreenPoint = { x: 0, y: 0 };
  let moved = false;
  let tappable = false;
  const noteMove = ({ x, y }: ScreenPoint) => {
    if (Math.hypot(x - pressedAt.x, y - pressedAt.y) > TAP_SLOP) moved = true;
  };
  const grabPlane = ({ x, y }: ScreenPoint) => (pointer && grabAt(pointer, orbit, x, y)?.plane) || null;
  const onPlane = (plane: THREE.Plane | null, { x, y }: ScreenPoint) =>
    (plane && pointer?.ray(x, y).intersectPlane(plane, new THREE.Vector3())) || null;
  /** Drags the grabbed surface from one screen point to another, so it stays under the pointer. */
  const slide = (plane: THREE.Plane | null, from: ScreenPoint, to: ScreenPoint) => {
    const grabbed = onPlane(plane, from), under = onPlane(plane, to);
    if (!grabbed || !under) return panBy(orbit, to.x - from.x, to.y - from.y); // nothing to grab: slide along the floor
    orbit.target.add(grabbed).sub(under);
    keepInRoom(orbit);
  };
  const twoFingers = () => {
    const [a, b] = [...pointers.values()];
    return { spread: Math.hypot(a.x - b.x, a.y - b.y), centre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  return {
    get dragging() { return moved; },
    /** `pans`: this press pans rather than orbits (see `pansWith`). `taps`: a still press is a click. */
    down(id: number, x: number, y: number, { pans = false, taps = true } = {}) {
      pointers.set(id, { x, y });
      drag = pan = null;
      if (pointers.size === 1) {
        pressedAt = { x, y };
        moved = false;
        tappable = taps;
        if (pans) pan = { at: { x, y }, plane: grabPlane({ x, y }) };
        else drag = { x, y, theta: orbit.theta, phi: orbit.phi };
      } else {
        tappable = false;
        if (pointers.size === 2) {
          const { spread, centre } = twoFingers();
          pinch = { distance: spread, radius: orbit.radius, centre, plane: grabPlane(centre) };
        }
      }
    },
    /** Returns whether the camera moved. */
    move(id: number, x: number, y: number) {
      if (!pointers.has(id)) return false;
      pointers.set(id, { x, y });
      if (pinch && pointers.size === 2) {
        const { spread, centre } = twoFingers();
        zoomToward(orbit, onPlane(pinch.plane, pinch.centre), pinchRadius(pinch.radius, pinch.distance, spread, orbit.maxRadius));
        slide(pinch.plane, pinch.centre, centre);
        pinch.centre = centre;
        return true;
      }
      if (pan) {
        slide(pan.plane, pan.at, { x, y });
        pan.at = { x, y };
        noteMove({ x, y });
        return true;
      }
      if (!drag) return false;
      const dx = x - drag.x, dy = y - drag.y;
      noteMove({ x, y });
      orbit.theta = drag.theta - dx * 0.005;
      orbit.phi = THREE.MathUtils.clamp(drag.phi - dy * 0.004, TILT.min, TILT.max);
      return true;
    },
    /** Returns whether this release was a tap. */
    up(id: number) {
      if (!pointers.delete(id)) return false;
      if (pointers.size < 2) pinch = null;
      if (pointers.size > 0) { drag = pan = null; return false; }
      const tap = tappable && !moved;
      drag = pan = null;
      moved = false;
      return tap;
    },
  };
}

/**
 * Anchor for a box drawn centred above (x, y) with its bottom `gap` px above it (the tooltip's CSS),
 * moved so the box stays `margin` px inside the screen.
 */
export function clampTooltip(x: number, y: number, box: { width: number; height: number }, screen: { width: number; height: number }, margin = 8, gap = 12) {
  const half = box.width / 2;
  const top = margin + box.height + gap;
  return {
    x: THREE.MathUtils.clamp(x, margin + half, Math.max(margin + half, screen.width - margin - half)),
    y: THREE.MathUtils.clamp(y, top, Math.max(top, screen.height - margin)),
  };
}
