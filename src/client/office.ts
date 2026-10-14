import * as THREE from 'three';
import { at, ball, box, cyl, mesh, part, tag, toonRamp } from './toon.ts';
import {
  DECK_Z, FLOOR, GLASS_DOORS, GLASS_Z, LEFT_WALL_FACE, LEFT_WALL_HEIGHT, MEETING_ROOM, MEETING_TABLE, WALL_HEIGHT, officeLayout, type OfficeLayout, type Props, type SeatSpot,
} from './layout.ts';
import { SCREEN_OFF } from './poses.ts';
import { DeskScreen, screenContent } from './screen.ts';
import { BigBoard } from './board.ts';
import { POOL_RIM, addGameTables, addPetCorner, addPool, addSoloProps } from './break-room.ts';
import { LoungeTv } from './tv.ts';
import {
  WORKTOP, buildCounter, buildEspressoMachine, buildFruitBowl, buildKettle, buildToaster, buildVase, buildWallCabinet,
} from './kitchen.ts';
import type { AgentRecord } from '../shared/agent.ts';
import { buildControlRoom, type StatusLight } from './control-room-3d.ts';

export { SCREEN_OFF };

export interface Seat extends SeatSpot {
  screen: DeskScreen;
  /** The console's status light (Control room). */
  light?: StatusLight;
  /** The chair, which swivels with its sitter (Control room). */
  swivel?: THREE.Object3D;
}

/** Turns each swivel chair with whoever sits in it; empty or left chairs face their console. Call every frame. */
export function swivelChairs(seats: Seat[], sitters: Iterable<{ seat?: SeatSpot; mode: string; root: THREE.Object3D }>) {
  const turned = new Map<number, number>();
  for (const s of sitters) if (s.seat && s.mode === 'seated') turned.set(s.seat.index, s.root.rotation.y);
  for (const seat of seats) if (seat.swivel) seat.swivel.rotation.y = turned.get(seat.index) ?? seat.yaw;
}

/**
 * Each desk's monitor shows its occupant (empty desks stay dark).
 * Call every frame: screens only redraw when their content changes.
 */
export function updateScreens(seats: Seat[], occupants: Map<number, AgentRecord>, now: number) {
  for (const seat of seats) {
    seat.screen.show(screenContent(occupants.get(seat.index)), now);
    seat.light?.show(occupants.get(seat.index)?.state ?? null);
  }
}

/** Hides the back wall while the camera is behind it, so it doesn't block the view of the floor. */
export function updateBackWall(office: { backWall: THREE.Object3D; layout: OfficeLayout }, camera: THREE.Vector3) {
  office.backWall.visible = camera.z > office.layout.bounds.back;
}

/** The office for preset `preset` (classic if unknown) with `rows` curved rows of desks. Builds without a DOM or WebGL. */
export function buildOffice(rows: number, preset = 'classic') {
  const layout = officeLayout(rows, preset);
  if (layout.preset === 'control-room') return buildControlRoom(layout);
  const group = new THREE.Group();
  const backWall = addRoom(group, layout);
  addFrontGlass(group);
  addMeetingRoom(group);
  addKitchen(group, layout, backWall);
  const tv = addLounge(group, layout);
  const board = addBackWallPieces(group, layout);
  addWallArt(group, layout);
  addPlants(group, layout);
  addSoloProps(group, layout.props);
  addGameTables(group, layout.props);
  addPool(group, layout.props);
  addPetCorner(group, layout.props);

  const deskRows = Array.from({ length: rows }, () => tag(new THREE.Group(), 'desk-row'));
  group.add(...deskRows);
  const seats: Seat[] = layout.seats.map((spot) => {
    const row = deskRows[spot.row];
    row.add(turned(at(buildDesk(), spot.desk.x, 0, spot.desk.z), spot.yaw));
    row.add(turned(at(buildChair(), spot.chair.x, 0, spot.chair.z), spot.yaw));
    const screen = new DeskScreen(spot.desk, spot.yaw);
    row.add(screen.root);
    return { ...spot, screen };
  });
  return { group, seats, layout, board, backWall, tv, doors: null };
}

const turned = <T extends THREE.Object3D>(obj: T, yaw: number) => {
  obj.rotation.y = yaw;
  return obj;
};

const WALL = '#B9A6E0';
const WOOD = '#C98A55';
const INK = '#3A3150';

function addRoom(group: THREE.Group, layout: OfficeLayout) {
  const { left, right, back, front } = layout.bounds;
  const width = right - left, centerX = (left + right) / 2;
  const indoorDepth = GLASS_Z - back, indoorZ = (back + GLASS_Z) / 2;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(width, indoorDepth),
    new THREE.MeshToonMaterial({ map: tileTexture(width / 2, indoorDepth / 2), gradientMap: toonRamp }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(centerX, 0, indoorZ);
  floor.receiveShadow = true;
  group.add(tag(floor, 'floor'));

  // The deck, and the base under the whole floor, have holes for the sunken pool and pond (#63).
  const deck = tag(new THREE.Group(), 'deck');
  const boards = new THREE.Mesh(
    new THREE.ShapeGeometry(withWaterHoles(rectangle(left, right, GLASS_Z, front), layout.props)),
    new THREE.MeshToonMaterial({ color: '#D9B48A', gradientMap: toonRamp }),
  );
  boards.rotation.x = -Math.PI / 2;
  boards.position.y = 0.001;
  boards.receiveShadow = true;
  deck.add(tag(boards, 'floor'));
  for (let z = GLASS_Z + 0.6; z < front; z += 0.6) {
    for (const [x0, x1] of outsideWater(left, right, z, layout.props)) {
      deck.add(at(box(x1 - x0, 0.004, 0.03, '#B98F63', { outline: 0, shadow: false }), (x0 + x1) / 2, 0.003, z));
    }
  }
  group.add(deck);

  const base = mesh(new THREE.ExtrudeGeometry(withWaterHoles(rectangle(left - 0.15, right + 0.15, back - 0.15, front + 0.15), layout.props), { depth: 0.3, bevelEnabled: false }), '#4A4068', { outline: 0, shadow: false });
  base.rotation.x = -Math.PI / 2;
  base.position.y = -0.31;
  group.add(base);

  // The back wall is tall (the camera faces it, and the big board hangs on it); the left wall is tall enough to hang things on (#83).
  const backZ = back - 0.15;
  const backWall = new THREE.Group();
  backWall.add(tag(at(box(width + 0.3, WALL_HEIGHT, 0.25, WALL, { outline: 0.01 }), centerX, WALL_HEIGHT / 2, backZ), 'wall'));
  for (const x of layout.windows) {
    backWall.add(tag(at(box(1.0, 0.6, 0.05, '#BFE6F5', { outline: 0.03, shadow: false }), x, 1.9, backZ + 0.14), 'window'));
  }
  group.add(backWall);
  group.add(tag(at(box(0.25, LEFT_WALL_HEIGHT, indoorDepth + 0.25, WALL, { outline: 0.01 }), LEFT_WALL_FACE - 0.125, LEFT_WALL_HEIGHT / 2, indoorZ), 'wall'));

  const door = tag(new THREE.Group(), 'door');
  door.add(at(box(0.9, 2.0, 0.06, INK, { outline: 0, shadow: false }), 0, 1.0, 0));
  door.add(at(box(0.12, 2.1, 0.3, WOOD), -0.51, 1.05, 0.01));
  door.add(at(box(0.12, 2.1, 0.3, WOOD), 0.51, 1.05, 0.01));
  door.add(at(box(1.14, 0.12, 0.3, WOOD), 0, 2.06, 0.01));
  door.add(at(box(0.9, 0.03, 0.6, '#7FB069', { outline: 0.02, shadow: false }), 0, 0.015, 0.57));
  group.add(at(door, layout.door.x, 0, back + 0.13));
  return backWall;
}

const glass = new THREE.MeshBasicMaterial({ color: '#BFE6F5', transparent: true, opacity: 0.28, depthWrite: false });

/** A glass pane with a frame rail top and bottom, `length` long along x or z. */
function glassWall(length: number, alongX: boolean) {
  const size = (thick: number) => (alongX ? [length, thick] : [thick, length]);
  const [w, d] = size(0.06);
  const pane = new THREE.Mesh(new THREE.BoxGeometry(w, 1.5, d), glass);
  pane.position.y = 0.75;
  const [rw, rd] = size(0.1);
  pane.add(at(box(rw, 0.08, rd, '#8C7FB0', { outline: 0.02 }), 0, 0.75, 0));
  pane.add(at(box(rw, 0.08, rd, '#8C7FB0', { outline: 0.02 }), 0, -0.71, 0));
  return tag(pane, 'glass-wall');
}

/** The glass wall onto the deck, with an open doorway at each side aisle. */
function addFrontGlass(group: THREE.Group) {
  const front = tag(new THREE.Group(), 'glass-front');
  const edges = [FLOOR.left, ...GLASS_DOORS.flatMap((d) => [d.x0, d.x1]), FLOOR.right];
  for (let i = 0; i < edges.length; i += 2) {
    const [x0, x1] = [edges[i], edges[i + 1]];
    front.add(at(glassWall(x1 - x0, true), (x0 + x1) / 2, 0, GLASS_Z));
  }
  for (const { x0, x1 } of GLASS_DOORS) {
    const doorway = tag(new THREE.Group(), 'glass-door');
    doorway.add(at(box(x1 - x0, 0.02, 0.5, '#8C7FB0', { outline: 0, shadow: false }), 0, 0.01, 0));
    front.add(at(doorway, (x0 + x1) / 2, 0, GLASS_Z));
  }
  // A mat on the deck walkway, so the path between the doors reads as one.
  front.add(tag(at(box(GLASS_DOORS[1].x1 - GLASS_DOORS[0].x0, 0.01, 0.5, '#C9A57A', { outline: 0, shadow: false }), 0, 0.006, DECK_Z), 'rug'));
  group.add(front);
}

function addMeetingRoom(group: THREE.Group) {
  const { x0, x1, z0, z1 } = MEETING_ROOM;
  const room = tag(new THREE.Group(), 'meeting-room');
  room.add(at(glassWall(x1 - x0, true), (x0 + x1) / 2, 0, z0));
  room.add(at(glassWall(x1 - x0, true), (x0 + x1) / 2, 0, z1));
  // The aisle side, with a doorway in the middle.
  const doorway = { from: 0.3, to: 1.2 };
  room.add(at(glassWall(doorway.from - z0, false), x1, 0, (z0 + doorway.from) / 2));
  room.add(at(glassWall(z1 - doorway.to, false), x1, 0, (doorway.to + z1) / 2));

  const { x, z, w, d } = MEETING_TABLE;
  const table = tag(new THREE.Group(), 'meeting-table');
  table.add(at(box(w, 0.08, d, '#F4EEE2'), 0, 0.74, 0));
  table.add(at(cyl(0.12, 0.2, 0.7, '#8C6A4A', { outline: 0.02 }), -w / 3, 0.35, 0));
  table.add(at(cyl(0.12, 0.2, 0.7, '#8C6A4A', { outline: 0.02 }), w / 3, 0.35, 0));
  room.add(at(table, x, 0, z));
  for (const dx of [-0.45, 0.45]) {
    for (const side of [-1, 1] as const) {
      room.add(turned(at(tag(buildChair(), 'meeting-chair'), x + dx, 0, z + side * (d / 2 + 0.38)), side === -1 ? 0 : Math.PI));
    }
  }

  const board = tag(new THREE.Group(), 'whiteboard');
  board.add(at(box(2.0, 1.0, 0.06, '#FFFFFF', { outline: 0.02 }), 0, 1.3, 0));
  board.add(at(box(2.1, 0.06, 0.12, '#8C8FA0', { outline: 0.02 }), 0, 0.78, 0.03));
  for (const [sx, sy, sw, color] of [[-0.5, 1.5, 0.7, '#4D86FF'], [0.3, 1.3, 0.9, '#F07A4A'], [-0.2, 1.1, 0.6, '#5BA37A']] as const) {
    board.add(at(box(sw, 0.04, 0.02, color, { outline: 0 }), sx, sy, 0.04));
  }
  // Flat on the room's solid side (the office's left wall), facing in: nothing opaque against the glass (#62).
  room.add(turned(at(board, LEFT_WALL_FACE + 0.03, 0, z), Math.PI / 2));
  group.add(room);
}

/** The kitchen (#88); its wall cabinet hangs on the back wall, so it hides with it. */
function addKitchen(group: THREE.Group, layout: OfficeLayout, backWall: THREE.Group) {
  const kitchen = tag(new THREE.Group(), 'kitchen');
  const { counter, coffee, table } = layout.kitchen;
  kitchen.add(at(buildCounter(counter.w, counter.d), counter.x, 0, counter.z));
  kitchen.add(at(buildEspressoMachine(), coffee.x, WORKTOP, coffee.z));
  kitchen.add(at(buildToaster(), counter.x - 0.75, WORKTOP, counter.z - 0.05));
  kitchen.add(at(buildKettle(), counter.x - 0.3, WORKTOP, counter.z - 0.05));
  kitchen.add(at(buildFruitBowl(), counter.x + 0.05, WORKTOP, counter.z + 0.02));
  backWall.add(at(buildWallCabinet(), counter.x, 0, layout.bounds.back));
  addBistro(kitchen, table);
  group.add(kitchen);
}

/** The kitchen's bistro table with a vase, and a stool either side. */
export function addBistro(kitchen: THREE.Group, table: { x: number; z: number }) {
  const bistro = tag(new THREE.Group(), 'kitchen-table');
  bistro.add(at(cyl(0.45, 0.45, 0.06, '#F4EEE2'), 0, 0.74, 0));
  bistro.add(at(cyl(0.05, 0.05, 0.72, INK, { outline: 0 }), 0, 0.36, 0));
  bistro.add(at(cyl(0.25, 0.25, 0.04, INK, { outline: 0.02 }), 0, 0.02, 0));
  kitchen.add(at(bistro, table.x, 0, table.z));
  kitchen.add(at(buildVase(), table.x, 0.77, table.z));
  for (const dx of [-0.8, 0.8]) {
    const stool = tag(new THREE.Group(), 'stool');
    stool.add(at(cyl(0.2, 0.2, 0.07, '#F07A4A'), 0, 0.55, 0));
    stool.add(at(cyl(0.04, 0.04, 0.52, INK, { outline: 0 }), 0, 0.26, 0));
    kitchen.add(at(stool, table.x + dx, 0, table.z));
  }
}

/**
 * The TV (returned, for the scene to switch on and off, #61) with a sofa facing it. `tvFacing`: 1 when
 * the TV faces +z (on classic's back wall), -1 when it faces -z.
 */
export function addLounge(group: THREE.Group, layout: OfficeLayout, tvFacing: 1 | -1 = 1) {
  const { tv, sofa: sofaAt, rug } = layout.lounge;
  const lounge = tag(new THREE.Group(), 'lounge');
  const mat = tag(at(cyl(1, 1, 0.03, '#F0A3B5', { outline: 0.02, shadow: false }, 48), rug.x, 0.015, rug.z), 'rug');
  mat.scale.set(1.8, 1, 1.1);
  lounge.add(mat);

  const screen = tag(new THREE.Group(), 'tv');
  screen.add(at(box(tv.w, 1.3, 0.1, INK), 0, 1.6, 0));
  const picture = at(new THREE.Mesh(new THREE.PlaneGeometry(tv.w - 0.16, 1.14), new THREE.MeshBasicMaterial()), 0, 1.6, 0.06);
  screen.add(picture);
  lounge.add(turned(at(screen, tv.x, 0, tv.z), tvFacing > 0 ? 0 : Math.PI));

  const w = sofaAt.w;
  const sofa = tag(new THREE.Group(), 'sofa');
  sofa.add(at(box(w, 0.38, 0.85, '#5B7DB1'), 0, 0.27, 0));
  sofa.add(part(at(box(w, 0.55, 0.25, '#4C6B9C'), 0, 0.6, -0.3), 'backrest'));
  sofa.add(at(box(0.25, 0.5, 0.85, '#4C6B9C'), -w / 2 + 0.125, 0.4, 0));
  sofa.add(at(box(0.25, 0.5, 0.85, '#4C6B9C'), w / 2 - 0.125, 0.4, 0));
  for (const dx of [-0.75, 0, 0.75]) sofa.add(part(at(box(0.7, 0.12, 0.6, '#6E90C4'), dx, 0.5, 0.05), 'cushion'));
  lounge.add(turned(at(sofa, sofaAt.x, 0, sofaAt.z), tvFacing > 0 ? Math.PI : 0)); // faces the TV
  group.add(lounge);
  return new LoungeTv(picture);
}

/** The big board (returned, for the scene to keep up to date), water cooler and bookshelf. */
function addBackWallPieces(group: THREE.Group, layout: OfficeLayout) {
  const { back } = layout.bounds;
  const frame = tag(new THREE.Group(), 'big-board');
  frame.add(at(box(layout.board.w, 2.4, 0.1, INK, { outline: 0.01 }), 0, 2.05, 0));
  const board = new BigBoard(layout.board.w - 0.2);
  frame.add(at(board.mesh, 0, 2.05, 0.06));
  group.add(at(frame, layout.board.x, 0, back + 0.05));

  group.add(at(buildCooler(), layout.cooler.x, 0, layout.cooler.z));
  const { x, z, length } = layout.bookshelf;
  group.add(turned(at(buildBookshelf(length), x, 0, z), Math.PI / 2)); // against the left wall
  return board;
}

export function buildCooler() {
  const cooler = tag(new THREE.Group(), 'water-cooler');
  cooler.add(at(box(0.4, 0.75, 0.4, '#E9E3F5'), 0, 0.38, 0));
  cooler.add(at(cyl(0.18, 0.18, 0.45, '#8FD3F2', { outline: 0.04 }), 0, 0.98, 0));
  return cooler;
}

export function buildBookshelf(length: number) {
  const shelf = tag(new THREE.Group(), 'bookshelf');
  shelf.add(at(box(length, 1.4, 0.4, WOOD), 0, 0.7, 0));
  const spines = ['#4D86FF', '#F07A4A', '#5BA37A', '#E2B347', '#C25B7A', '#7E6BD6', '#3FB3A6'];
  [0.3, 0.75, 1.2].forEach((y, row) => {
    for (let i = 0; i < 7; i++) {
      const h = 0.26 + ((i * 7 + row * 3) % 5) * 0.025;
      const book = box(0.15, h, 0.3, spines[(i + row * 2) % spines.length], { outline: 0.03, shadow: false });
      shelf.add(at(book, -0.57 + i * 0.19, y - 0.17 + h / 2, 0.06));
    }
  });
  return shelf;
}

const ART = [['#F07A4A', '#E2B347'], ['#4D86FF', '#8FD3F2'], ['#5BA37A', '#F0A3B5']];

function addWallArt(group: THREE.Group, layout: OfficeLayout) {
  layout.wallArt.forEach((z, i) => {
    const art = tag(new THREE.Group(), 'wall-art');
    const [a, b] = ART[i % ART.length];
    art.add(at(box(0.9, 0.65, 0.05, INK, { outline: 0.02 }), 0, 0, 0));
    art.add(at(box(0.76, 0.51, 0.02, '#FFF8EC', { outline: 0, shadow: false }), 0, 0, 0.03));
    const sun = at(ball(0.14, a, { outline: 0, shadow: false }), -0.15, 0.05, 0.045);
    sun.scale.z = 0.1; // painted on, not poking through the wall behind
    art.add(sun);
    art.add(at(box(0.3, 0.2, 0.02, b, { outline: 0, shadow: false }), 0.15, -0.08, 0.05));
    group.add(turned(at(art, LEFT_WALL_FACE + 0.025, 0.95, z), Math.PI / 2));
  });
}

function addPlants(group: THREE.Group, layout: OfficeLayout) {
  layout.plants.forEach(({ x, z }, i) => group.add(at(buildPlant(i), x, 0, z)));
}

/** A potted plant; `i` varies its size. */
export function buildPlant(i: number) {
  const plant = tag(new THREE.Group(), 'plant');
  plant.add(at(cyl(0.22, 0.17, 0.36, '#D9774B'), 0, 0.18, 0));
  for (const [px, py, pz, r] of [[0, 0.62, 0, 0.26], [0.14, 0.5, 0.08, 0.2], [-0.13, 0.52, -0.06, 0.2], [0.02, 0.82, -0.04, 0.17]]) {
    plant.add(at(ball(r, '#5FA35A'), px, py, pz));
  }
  plant.scale.setScalar(0.85 + (i % 3) * 0.15);
  return plant;
}

/** A desk whose sitter is on its -z side, facing +z (the screen side), so their right is -x. 0.7 m deep, so 1.5 m stays clear between rows. */
function buildDesk() {
  const desk = tag(new THREE.Group(), 'desk');
  desk.add(at(box(1.24, 0.08, 0.7, '#E9B872'), 0, 0.75, 0));
  for (const [lx, lz] of [[-0.55, -0.28], [0.55, -0.28], [-0.55, 0.28], [0.55, 0.28]]) {
    desk.add(at(box(0.07, 0.72, 0.07, '#8C6A4A', { outline: 0.02 }), lx, 0.36, lz));
  }
  desk.add(part(at(box(0.5, 0.03, 0.16, '#F4EEE2', { outline: 0.03 }), 0, 0.805, -0.12), 'keyboard'));
  desk.add(part(at(box(0.14, 0.03, 0.18, '#F4EEE2', { outline: 0.04 }), -0.4, 0.805, -0.1), 'mouse'));
  return desk;
}

/** A chair facing +z (its back on the -z side). */
export function buildChair() {
  const chair = tag(new THREE.Group(), 'chair');
  chair.add(at(cyl(0.3, 0.3, 0.09, '#6B5B95'), 0, 0.42, 0));
  chair.add(at(box(0.55, 0.5, 0.09, '#6B5B95'), 0, 0.72, -0.3));
  chair.add(at(cyl(0.04, 0.04, 0.38, INK, { outline: 0 }), 0, 0.2, 0));
  chair.add(at(cyl(0.26, 0.26, 0.04, INK, { outline: 0.02 }), 0, 0.03, 0));
  return chair;
}

/** A rectangle on the floor as a shape (shape y is -z: shapes are laid flat by turning them -90° about x). */
function rectangle(x0: number, x1: number, z0: number, z1: number) {
  const shape = new THREE.Shape();
  shape.moveTo(x0, -z0).lineTo(x1, -z0).lineTo(x1, -z1).lineTo(x0, -z1).lineTo(x0, -z0);
  return shape;
}

/** The pool's and pond's water areas, cut out of a floor shape. */
function withWaterHoles(shape: THREE.Shape, { pool, pond }: Props) {
  const [hx, hz] = [pool.w / 2 - POOL_RIM, pool.d / 2 - POOL_RIM];
  const hole = new THREE.Path();
  hole.moveTo(pool.x - hx, -(pool.z - hz)).lineTo(pool.x - hx, -(pool.z + hz)).lineTo(pool.x + hx, -(pool.z + hz)).lineTo(pool.x + hx, -(pool.z - hz)).lineTo(pool.x - hx, -(pool.z - hz));
  const hollow = new THREE.Path();
  hollow.absellipse(pond.x, -pond.z, pond.rx, pond.rz, 0, Math.PI * 2, true, 0);
  shape.holes.push(hole, hollow);
  return shape;
}

/** The stretches of a line across the deck at `z` (from x0 to x1) that aren't over the pool or pond. */
function outsideWater(x0: number, x1: number, z: number, { pool, pond }: Props): [number, number][] {
  const cuts: [number, number][] = [];
  if (Math.abs(z - pool.z) < pool.d / 2 - POOL_RIM) cuts.push([pool.x - pool.w / 2 + POOL_RIM, pool.x + pool.w / 2 - POOL_RIM]);
  const k = (z - pond.z) / pond.rz;
  if (Math.abs(k) < 1) { const half = pond.rx * Math.sqrt(1 - k * k); cuts.push([pond.x - half, pond.x + half]); }
  const spans: [number, number][] = [];
  let from = x0;
  for (const [a, b] of cuts.sort((p, q) => p[0] - q[0])) {
    if (a > from) spans.push([from, a]);
    from = Math.max(from, b);
  }
  if (from < x1) spans.push([from, x1]);
  return spans;
}

/** Two-tone floor tiles with grout lines, generated as pixels (no canvas needed). */
function tileTexture(repeatX: number, repeatY: number) {
  const size = 64;
  const light = [0xe2, 0xd3, 0xb8], dark = [0xd2, 0xc0, 0x9f], grout = [0xc4, 0xb1, 0x92];
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const edge = x % 32 < 1 || y % 32 < 1;
      const color = edge ? grout : (x < 32) === (y < 32) ? dark : light;
      data.set([...color, 255], (y * size + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
