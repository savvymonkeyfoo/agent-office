// The Innovation lab in 3D, built from its floor plan (lab.ts): a copy of the Control room's
// build (control-room-3d.ts), reskinned warm. Timber floor and cream walls, the board flat on
// the back wall, pods of oak workstations on project-coloured rugs, a break corner behind the
// desks, and the Control room's deck outside the side door. A desk only shows while a session
// sits at it; a pod's rug only while a project has a desk there.
import * as THREE from 'three';
import { at, ball, box, cyl, mesh, part, tag, toonRamp } from './toon.ts';
import type { Point } from './layout.ts';
import { ISLAND, RUG_R, VAULT_RISE, type LabLayout } from './lab.ts';
import type { AgentRecord, OfficeState } from '../shared/agent.ts';
import { DeskScreen, newCanvas } from './screen.ts';
import { addGameTables, addPetCorner, addPool, addSoloProps } from './break-room.ts';
import { WORKTOP, buildCounter, buildEspressoMachine, buildFruitBowl, buildKettle, buildToaster } from './kitchen.ts';
import { addBistro, addLounge, buildBookshelf, buildCooler, type Seat } from './office.ts';
import { EntranceDoors, addDeck, doorFrame, plankTexture, sign } from './control-room-3d.ts';
import { LAB_STATUS, LabBoard, projectColor } from './lab-board.ts';

const C = {
  wall: '#F1E4CE', wallSide: '#E6D5B8', wainscot: '#C99A6B', trim: '#A87A50', floorSide: '#9C7553',
  oak: '#D8AE78', oakDark: '#A97C4F', bezel: '#2F2A2A', chair: '#E07B54', chairDark: '#B85F3E',
  lampShade: '#F6D58C', key: '#F4EEE2', frame: '#8C6A4A', door: '#E07B54',
};
const STATUS_OFF = '#6B625A';

/** A workstation pops in or packs away over this long. */
const POP_SECONDS = 0.35;

/** The keyboard's backlight, in its sitter's status colour (dark for an empty desk). */
export class KeyLight {
  readonly material = new THREE.MeshBasicMaterial({ color: STATUS_OFF });
  get color() { return this.material.color; }
  show(state: OfficeState | null) {
    this.material.color.set(state ? LAB_STATUS[state] : STATUS_OFF);
  }
}

const turned = <T extends THREE.Object3D>(obj: T, yaw: number) => {
  obj.rotation.y = yaw;
  return obj;
};
const glowing = (color: string) => new THREE.MeshBasicMaterial({ color });

/** The Innovation lab for `layout`, with what the scene needs to keep it up to date. */
export function buildLab(layout: LabLayout) {
  const group = new THREE.Group();
  addRoom(group, layout);
  const { backWall, board } = addBackWall(group, layout);
  const doors = addEntrance(group, layout);
  addSideDoor(group, layout);
  const { lounge, tv } = addBreakCorner(group, layout);
  const deck = tag(new THREE.Group(), 'deck-props');
  addDeck(group, layout);
  addProps(layout, lounge, deck);
  group.add(deck);
  layout.plants.forEach((p, i) => group.add(at(buildLeafyPlant(i, 1.1), p.x, 0, p.z)));
  addAtelier(group, layout);
  addTrees(group, layout);
  const maker = addMaker(group, layout);
  const { seats, pods } = addPods(group, layout, maker.update);
  return { group, seats, layout, board, backWall, tv, doors, pods };
}

/** Pale oak boards, wide and blond like a timber studio floor. */
const PALE_PLANKS = { shades: [[0xee, 0xd5, 0xae], [0xe7, 0xcb, 0xa1], [0xf2, 0xdc, 0xb8], [0xe3, 0xc5, 0x9a]], seamColor: [0xc8, 0xa2, 0x76] };

function addRoom(group: THREE.Group, { room }: LabLayout) {
  const width = room.right - room.left, depth = room.front - room.back;
  const centre = { x: (room.left + room.right) / 2, z: (room.back + room.front) / 2 };
  group.add(tag(at(box(width, 0.3, depth, C.floorSide, { outline: 0, shadow: false }), centre.x, -0.15, centre.z), 'floor'));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshToonMaterial({ map: plankTexture(width / 3.2, depth / 1.0, PALE_PLANKS), gradientMap: toonRamp }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(tag(at(floor, centre.x, 0.002, centre.z), 'floor'));
}

const BOARD = { centre: { w: 8.6, h: 4.0 }, side: { w: 3.7, h: 3.4, x: 7.0 }, y: 2.7 };

/** A board panel: a timber frame round a cream face, `w` × `h`. */
function framed(w: number, h: number) {
  const frame = tag(new THREE.Group(), 'wall-board');
  frame.add(box(w + 0.24, h + 0.24, 0.1, C.trim, { outline: 0.012 }));
  return frame;
}

/** The tall back wall: cream above a timber wainscot, the board's three panels flat on it, and warm lights over them. */
function addBackWall(group: THREE.Group, { room, backWall: wallPlan }: LabLayout) {
  const backWall = new THREE.Group();
  const width = room.right - room.left + 0.6, z = room.back;
  backWall.add(tag(at(box(width, wallPlan.height, 0.4, C.wall, { outline: 0.01 }), 0, wallPlan.height / 2, z - 0.2), 'wall'));
  backWall.add(at(box(width, 0.95, 0.04, C.wainscot, { outline: 0, shadow: false }), 0, 0.475, z + 0.02));
  backWall.add(at(box(width, 0.06, 0.06, C.trim, { outline: 0, shadow: false }), 0, 0.97, z + 0.04));
  backWall.add(at(box(width, 0.12, 0.08, C.trim, { outline: 0, shadow: false }), 0, wallPlan.height - 0.06, z + 0.04));

  const { centre, side, y } = BOARD;
  const board = new LabBoard(centre, side);
  const middle = at(framed(centre.w, centre.h), 0, y, z + 0.07);
  middle.add(at(board.centre.mesh, 0, 0, 0.056));
  backWall.add(middle);
  for (const s of [-1, 1]) {
    const panel = at(framed(side.w, side.h), s * side.x, y - (centre.h - side.h) / 2, z + 0.07);
    panel.add(at((s < 0 ? board.left : board.right).mesh, 0, 0, 0.056));
    backWall.add(panel);
  }
  // Picture lights over the panels.
  for (const x of [-side.x, 0, side.x]) {
    const lamp = tag(new THREE.Group(), 'lamp');
    lamp.add(at(box(x ? 1.2 : 2.2, 0.08, 0.14, C.bezel, { outline: 0.02 }), 0, 0, 0.3));
    lamp.add(at(box(0.05, 0.05, 0.3, C.bezel, { outline: 0 }), 0, 0, 0.15));
    lamp.add(at(new THREE.Mesh(new THREE.PlaneGeometry(x ? 1.1 : 2.1, 0.05), glowing('#FFE7B0')), 0, -0.045, 0.3).rotateX(Math.PI / 2));
    backWall.add(at(lamp, x, y + centre.h / 2 + 0.32, z));
  }
  group.add(backWall);
  const light = new THREE.PointLight('#FFE2B5', 30, 14, 1.5);
  light.position.set(0, 4.2, z + 2.5);
  group.add(light);
  return { backWall, board };
}

/** The entrance: double doors in the left wall, beside the front walkway, under a sign, with a mat inside. */
function addEntrance(group: THREE.Group, { room, door }: LabLayout) {
  const entrance = part(tag(doorFrame(1.6), 'door'), 'entrance');
  entrance.add(turned(at(sign('IN · OUT', 1.2, '#7FD39B'), 0.21, 2.83, 0), Math.PI / 2));
  const doors = new EntranceDoors(entrance);
  group.add(at(entrance, room.left - 0.15, 0, door.z));
  group.add(tag(at(box(1.1, 0.02, 1.5, '#6FA35A', { outline: 0, shadow: false }), room.left + 0.65, 0.01, door.z), 'rug'));
  return doors;
}

/** The open side door in the right wall, out to the deck, with its sign and a step across to the deck. */
function addSideDoor(group: THREE.Group, { room, sideDoor, deck }: LabLayout) {
  const door = part(tag(doorFrame(1.4), 'door'), 'side-door');
  door.add(turned(at(sign('DECK →', 1.2, '#FFB648'), -0.21, 2.83, 0), -Math.PI / 2));
  group.add(at(door, sideDoor.x, 0, sideDoor.z));
  group.add(tag(at(box(deck.x0 - room.right + 0.6, 0.03, 1.4, C.door, { outline: 0, shadow: false }), (room.right + deck.x0) / 2, 0.015, sideDoor.z), 'rug'));
}

/** The break corner behind the desks: kitchen, cooler, bookshelf, sofa and TV, warm lamps. */
function addBreakCorner(group: THREE.Group, layout: LabLayout) {
  const { crewLounge: area } = layout;
  const centre = { x: (area.x0 + area.x1) / 2, z: (area.z0 + area.z1) / 2 };
  const lounge = tag(new THREE.Group(), 'lounge');
  const tv = addLounge(lounge, layout, -1);
  lounge.traverse((o) => { if (o.userData.kind === 'tv') o.position.y = TV_DROP; });
  const stand = tag(new THREE.Group(), 'media-unit');
  stand.add(at(box(layout.lounge.tv.w + 0.3, 0.5, 0.42, C.oakDark), 0, 0.25, 0));
  for (const dx of [-0.7, 0, 0.7]) stand.add(at(box(0.6, 0.3, 0.02, C.oak, { outline: 0 }), dx, 0.25, -0.22));
  lounge.add(at(stand, layout.lounge.tv.x, 0, layout.lounge.tv.z + 0.05));

  // The kitchen faces into the room (-z), as in the Control room.
  const { counter, coffee, table } = layout.kitchen;
  const kitchen = tag(at(new THREE.Group(), counter.x, 0, counter.z), 'kitchen');
  kitchen.scale.z = -1;
  kitchen.add(buildCounter(counter.w, counter.d));
  kitchen.add(at(buildEspressoMachine(), coffee.x - counter.x, WORKTOP, coffee.z - counter.z));
  kitchen.add(at(buildToaster(), -0.75, WORKTOP, -0.05));
  kitchen.add(at(buildKettle(), -0.3, WORKTOP, -0.05));
  kitchen.add(at(buildFruitBowl(), 0.05, WORKTOP, 0.02));
  lounge.add(kitchen);
  const bistro = tag(new THREE.Group(), 'kitchen');
  addBistro(bistro, table);
  lounge.add(bistro);
  lounge.add(at(buildCooler(), layout.cooler.x, 0, layout.cooler.z));
  lounge.add(turned(at(buildBookshelf(layout.bookshelf.length), layout.bookshelf.x, 0, layout.bookshelf.z), Math.PI / 2));

  for (const [x, u] of [[1.0, 5.7], [-9.4, 5.6]]) {
    const lamp = tag(new THREE.Group(), 'lamp');
    lamp.add(at(cyl(0.2, 0.22, 0.04, C.bezel, { outline: 0.02 }), 0, 0.02, 0));
    lamp.add(at(cyl(0.025, 0.025, 1.5, C.bezel, { outline: 0 }), 0, 0.77, 0));
    lamp.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.3, 20, 1, true), new THREE.MeshBasicMaterial({ color: '#FFD9A0', side: THREE.DoubleSide })), 0, 1.6, 0));
    lounge.add(at(lamp, x, 0, area.z0 + u));
  }
  const warm = new THREE.PointLight('#FFC98A', 30, 18, 1.4);
  warm.position.set(0, 4, centre.z);
  lounge.add(warm);
  group.add(lounge);
  return { lounge, tv };
}

/** The TV stands on a 0.5 m unit, as in the Control room. */
const TV_DROP = -0.44;

/** The break-room props from the plan: inside ones in the break corner, the rest on the deck. */
function addProps(layout: LabLayout, lounge: THREE.Group, deck: THREE.Group) {
  const all = new THREE.Group();
  addSoloProps(all, layout.props, { pond: false });
  addGameTables(all, layout.props);
  addPool(all, layout.props);
  addPetCorner(all, layout.props);
  for (const child of [...all.children]) (child.position.x > layout.room.right ? deck : lounge).add(child);
  // The break corner in the studio's colours: a sage sofa with terracotta cushions on a mustard rug, a sage ping-pong table.
  recolour(lounge, { '#5B7DB1': '#86A97F', '#4C6B9C': '#6E9067', '#6E90C4': '#E0A07A', '#F0A3B5': '#E2B86B', '#3E6FD0': '#7FA37A' });
}

/** Swaps colours (`from` hex: `to` hex) on every mesh under `root`, on copies of their materials. */
function recolour(root: THREE.Object3D, swaps: Record<string, string>) {
  const wanted = new Map(Object.entries(swaps).map(([from, to]) => [new THREE.Color(from).getHex(), new THREE.Color(to)]));
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    const material = m.material as THREE.MeshToonMaterial | undefined;
    const to = material?.color && wanted.get(material.color.getHex());
    if (to) m.material = Object.assign(material!.clone(), { color: to });
  });
}

/**
 * One seat's kit on an island, facing +z (towards the island's middle once turned), its sitter on the -z side:
 * a keyboard on a backlight strip in the status colour, a mouse, and a small second screen turned in.
 * The table is the island's; the seat's live screen stands behind the keyboard.
 */
export function buildWorkstation(light: KeyLight) {
  const kit = tag(new THREE.Group(), 'desk');
  kit.add(part(at(box(0.48, 0.025, 0.16, C.key, { outline: 0.03 }), 0, ISLAND.height + 0.045, -0.13), 'keyboard'));
  kit.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.012, 0.2), light.material), 0, ISLAND.height + 0.036, -0.13));
  kit.add(part(at(box(0.1, 0.03, 0.15, C.key, { outline: 0.04 }), -0.36, ISLAND.height + 0.045, -0.11), 'mouse'));
  const side = at(new THREE.Group(), 0.42, ISLAND.height - 0.74, 0.08);
  side.add(at(box(0.04, 0.16, 0.04, C.bezel, { outline: 0 }), 0, 0.85, 0.02));
  side.add(at(box(0.32, 0.22, 0.035, C.bezel, { outline: 0.02 }), 0, 1.03, 0));
  const face = at(new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.17), light.material), 0, 1.03, -0.02);
  face.rotation.y = Math.PI;
  side.add(face);
  kit.add(turned(side, 0.5));
  return kit;
}

/** A round oak stool with a cushion in the island's colour mix, for a bot to perch on. */
function buildLabChair() {
  const chair = tag(new THREE.Group(), 'chair');
  chair.add(at(cyl(0.24, 0.24, 0.07, C.oak, { outline: 0.03 }, 24), 0, 0.44, 0));
  chair.add(at(cyl(0.2, 0.2, 0.04, C.chair, { outline: 0.03 }, 24), 0, 0.49, 0));
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const leg = at(cyl(0.025, 0.03, 0.44, C.oakDark, { outline: 0.04 }), Math.sin(a) * 0.15, 0.21, Math.cos(a) * 0.15);
    leg.rotation.set(Math.cos(a) * 0.12, 0, -Math.sin(a) * 0.12);
    chair.add(leg);
  }
  chair.add(turned(at(cyl(0.16, 0.16, 0.02, C.oakDark, { outline: 0 }, 20), 0, 0.16, 0), 0));
  return chair;
}

/** One desk's pieces: they show only while a session sits there, popping in and packing away. */
interface Workstation { root: THREE.Group; shown: number; target: number }

/**
 * A project's island: a round oak table with a glowing edge and a plant in the middle, on a round rug,
 * under a slowly turning holographic ring with the project's name and waiting count. All in the project's
 * colour, shown while any of its seats is taken.
 */
class Island {
  readonly root = tag(new THREE.Group(), 'pod');
  /** Just the table and its plant, for walk checks (the rug and ring are walked over and under). */
  readonly table = tag(new THREE.Group(), 'island');
  private rug = new THREE.MeshToonMaterial({ color: '#FFFFFF', gradientMap: toonRamp });
  private border = new THREE.MeshToonMaterial({ color: '#FFFFFF', gradientMap: toonRamp });
  private glow = new THREE.MeshBasicMaterial({ color: '#FFFFFF' });
  private haze = new THREE.MeshBasicMaterial({ color: '#DDF4FF', transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  private rim = new THREE.MeshBasicMaterial({ color: '#F4FCFF', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  private ring = new THREE.Group();
  private label: THREE.Sprite;
  private drawn = newCanvas(512, 128);
  private texture: THREE.CanvasTexture | null = null;
  private key = '';
  shown = 0;
  target = 0;

  constructor(centre: Point, i: number) {
    const floor = (geometry: THREE.BufferGeometry, material: THREE.Material, y: number) => {
      const m = new THREE.Mesh(geometry, material);
      m.rotation.x = -Math.PI / 2;
      m.position.y = y;
      m.receiveShadow = true;
      return m;
    };
    this.root.add(floor(new THREE.CircleGeometry(RUG_R, 64), this.border, 0.012), floor(new THREE.CircleGeometry(RUG_R - 0.14, 64), this.rug, 0.014));
    // The table: an oak top on a pedestal, ringed by a thin glowing band.
    this.table.add(at(cyl(ISLAND.r, ISLAND.r, 0.07, C.oak, { outline: 0.02 }, 48), 0, ISLAND.height - 0.035, 0));
    this.table.add(at(cyl(0.32, 0.4, ISLAND.height - 0.07, C.oakDark, { outline: 0.02 }), 0, (ISLAND.height - 0.07) / 2, 0));
    this.table.add(at(cyl(0.62, 0.66, 0.04, C.oakDark, { outline: 0.02 }, 32), 0, 0.02, 0));
    const band = new THREE.Mesh(new THREE.TorusGeometry(ISLAND.r + 0.005, 0.022, 6, 64), this.glow);
    band.rotation.x = Math.PI / 2;
    this.table.add(at(band, 0, ISLAND.height - 0.05, 0));
    // A plant in the middle of the table.
    this.table.add(at(cyl(0.16, 0.12, 0.2, '#D9774B'), 0, ISLAND.height + 0.1, 0));
    const greens = ['#5FA35A', '#6FB865', '#4E9150'];
    for (const [k, [x, y, z, r]] of ([[0, 0.36, 0, 0.17], [0.1, 0.3, 0.06, 0.12], [-0.1, 0.31, -0.04, 0.12], [0.02, 0.5, -0.02, 0.1]] as const).entries()) {
      this.table.add(at(ball(r, greens[(k + i) % 3], { outline: 0.06 }), x, ISLAND.height + y, z));
    }
    this.root.add(this.table);
    // The holographic ring: a faint band between two bright rims.
    this.ring.add(new THREE.Mesh(new THREE.CylinderGeometry(RING.r, RING.r, RING.h, 48, 1, true), this.haze));
    for (const y of [-RING.h / 2, RING.h / 2]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(RING.r, 0.018, 6, 64), this.rim);
      rim.rotation.x = Math.PI / 2;
      this.ring.add(at(rim, 0, y, 0));
    }
    this.ring.position.y = RING.y;
    this.root.add(this.ring);
    // The name, on the ring's camera side; drawn over everything so it never hides behind the next row.
    const material = new THREE.SpriteMaterial({ color: '#FFFFFF', transparent: true, depthWrite: false, depthTest: false });
    if (this.drawn) {
      this.texture = new THREE.CanvasTexture(this.drawn.canvas);
      this.texture.colorSpace = THREE.SRGBColorSpace;
      material.map = this.texture;
    }
    this.label = new THREE.Sprite(material);
    this.label.scale.set(2.2, 0.55, 1);
    this.label.renderOrder = 2;
    this.root.add(at(this.label, 0, RING.y - 0.05, RING.r + 0.25));
    this.root.position.set(centre.x, 0, centre.z);
    this.root.visible = false;
    this.root.userData.labelLift = this.label;
  }

  /** Shows the island for `project` (null: nobody here), with how many of its sessions are waiting on you. */
  show(project: string | null, waiting: number) {
    this.target = project ? 1 : 0;
    if (!project) return;
    const key = `${project}|${waiting}`;
    if (key === this.key) return;
    this.key = key;
    const color = projectColor(project);
    this.rug.color.set(color).lerp(new THREE.Color('#C9A77F'), 0.3);
    this.border.color.set(color).lerp(new THREE.Color('#5B4636'), 0.2);
    this.glow.color.set(color).lerp(new THREE.Color('#FFFFFF'), 0.25);
    this.haze.color.set('#DDF4FF').lerp(new THREE.Color(color), 0.25);
    if (!this.drawn) return;
    const { g, canvas } = this.drawn;
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.textBaseline = 'middle';
    const badge = waiting ? `${waiting} !` : '';
    g.font = '800 50px Nunito, Arial, sans-serif';
    const badgeW = badge ? g.measureText(badge).width + 40 : 0;
    g.font = '800 54px Nunito, Arial, sans-serif';
    let text = project;
    while (text.length > 1 && g.measureText(text).width > canvas.width - 70 - badgeW) text = text.slice(0, -1);
    if (text !== project) text = `${text.slice(0, -1)}…`;
    const textW = g.measureText(text).width;
    const w = textW + 60 + badgeW, x0 = (canvas.width - w) / 2;
    g.fillStyle = color;
    g.beginPath();
    g.roundRect(x0, 14, w, 100, 50);
    g.fill();
    g.fillStyle = '#FFFFFF';
    g.fillText(text, x0 + 30, 66);
    if (badge) {
      g.beginPath();
      g.roundRect(x0 + textW + 48, 28, badgeW - 8, 72, 36);
      g.fill();
      g.fillStyle = LAB_STATUS.needs;
      g.font = '800 50px Nunito, Arial, sans-serif';
      g.fillText(badge, x0 + textW + 64, 66);
    }
    this.texture!.needsUpdate = true;
  }

  /** Pops in or out, and turns the ring slowly. */
  update(t: number, dt: number) {
    this.shown = THREE.MathUtils.clamp(this.shown + Math.sign(this.target - this.shown) * (dt / POP_SECONDS), 0, 1);
    this.root.visible = this.shown > 0;
    this.root.scale.setScalar(Math.max(0.001, ease(this.shown)));
    this.ring.rotation.y = t * 0.25;
    this.ring.position.y = RING.y + Math.sin(t * 1.2) * 0.04;
  }
}

/** The holographic ring over an island: radius, height and how high it floats (metres). */
const RING = { r: 0.78, h: 0.3, y: 1.62 };

const ease = (k: number) => k * k * (3 - 2 * k);

/** Every seat's workstation, chair and live screen, and each pod's rug, with what keeps them up to date. */
function addPods(group: THREE.Group, layout: LabLayout, animate: (t: number) => void) {
  const islands = layout.pods.map((pod, i) => {
    const island = new Island(pod, i);
    group.add(island.root);
    return island;
  });
  const stations: Workstation[] = [];
  const seats: Seat[] = layout.seats.map((spot) => {
    const root = tag(new THREE.Group(), 'workstation');
    root.position.set(spot.desk.x, 0, spot.desk.z);
    const light = new KeyLight();
    root.add(turned(buildWorkstation(light), spot.yaw));
    const chair = turned(at(buildLabChair(), spot.chair.x - spot.desk.x, 0, spot.chair.z - spot.desk.z), spot.yaw);
    root.add(chair);
    const screen = new DeskScreen({ x: 0, z: 0 }, spot.yaw);
    // A low screen, so the sitter's face shows over it from the camera.
    screen.root.scale.setScalar(0.75);
    screen.root.position.y = 0.08;
    root.add(screen.root);
    root.visible = false;
    root.scale.setScalar(0.001);
    group.add(root);
    stations.push({ root, shown: 0, target: 0 });
    return { ...spot, screen, light, swivel: chair };
  });
  let clock = 0;

  /** Call every frame with each seat's agent: seats pop in and pack away, islands follow their projects. */
  function update(occupants: Map<number, AgentRecord>, dt: number) {
    clock += dt;
    animate(clock);
    stations.forEach((s, i) => {
      s.target = occupants.has(i) ? 1 : 0;
      s.shown = THREE.MathUtils.clamp(s.shown + Math.sign(s.target - s.shown) * (dt / POP_SECONDS), 0, 1);
      s.root.visible = s.shown > 0;
      s.root.scale.setScalar(Math.max(0.001, ease(s.shown)));
    });
    layout.pods.forEach((pod, i) => {
      const here = pod.seats.map((k) => occupants.get(k)).filter((r): r is AgentRecord => !!r);
      islands[i].show(here[0]?.project ?? null, here.filter((r) => r.state === 'needs').length);
      islands[i].update(clock, dt);
    });
  }

  return { seats, pods: { update, islands, stations } };
}

/** A tube of oak along `points` (a smooth curve through them). */
function rib(points: THREE.Vector3[], radius: number, color = C.oak) {
  const curve = new THREE.CatmullRomCurve3(points);
  // No outline: the hull scales about the origin, and a rib's points are far from it.
  const tube = mesh(new THREE.TubeGeometry(curve, 48, radius, 10, false), color, { outline: 0 });
  // Lit a little from within, so the undersides (all the camera sees of the crown) stay warm, not dark.
  const material = (tube.material as THREE.MeshToonMaterial).clone();
  tube.material = material;
  material.emissive.set(color).multiplyScalar(0.35);
  return tube;
}

/**
 * The vault (#lab): the side walls run up to WALL_TOP, then timber ribs arch across the room to the
 * crown. Angles run from 0 (springing off the left wall) to π (the right wall).
 */
const VAULT = { rise: VAULT_RISE, spacing: 2.6 };

/** A point on the vault's curve at angle `a`, in a room `half` wide whose walls stop at `top`. */
const vaultPoint = (a: number, half: number, top: number, z: number) =>
  new THREE.Vector3(-Math.cos(a) * half, top + Math.sin(a) * VAULT.rise, z);

const LEAF_GREENS = ['#3F7F49', '#4E9150', '#5FA35A', '#6FB865', '#7CC36E', '#386F42'];

/** Many leaves as one mesh: each `[x, y, z, size, tilt]`, turned out from a wall facing `facing` (+1: +x). */
function leafMass(leaves: [number, number, number, number, number][], facing: number) {
  const material = new THREE.MeshToonMaterial({ color: '#FFFFFF', gradientMap: toonRamp });
  const leafy = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), material, leaves.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), colour = new THREE.Color();
  leaves.forEach(([x, y, z, size, tilt], k) => {
    e.set(tilt, (k % 7) * 0.9, facing * (0.5 + (k % 5) * 0.18), 'YXZ');
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(size * 0.45, size * 0.12, size));
    leafy.setMatrixAt(k, m);
    leafy.setColorAt(k, colour.set(LEAF_GREENS[(k * 7) % LEAF_GREENS.length]));
  });
  leafy.castShadow = false;
  return leafy;
}

/** A brick face, `w` × `h` metres, for the green wall's backing. */
function brickTexture(w: number, h: number) {
  const tw = 32, th = 16, data = new Uint8Array(tw * th * 4);
  const bricks = [[0xb8, 0x6a, 0x4c], [0xad, 0x60, 0x44], [0xc2, 0x74, 0x55], [0xa9, 0x5d, 0x45]];
  for (let y = 0; y < th; y++) {
    const course = Math.floor(y / 4), shift = course % 2 ? 8 : 0;
    for (let x = 0; x < tw; x++) {
      const mortar = y % 4 === 0 || (x + shift) % 16 === 0;
      data.set([...(mortar ? [0xe4, 0xd3, 0xbd] : bricks[(course + Math.floor((x + shift) / 16)) % 4]), 255], (y * tw + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(data, tw, th, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(w / 1.0, h / 0.5);
  texture.needsUpdate = true;
  return texture;
}

/** A hanging planter on a cord from `top` down to `y`, with trailing vines. */
function hangingPlant(i: number, top: number, y: number) {
  const hang = tag(new THREE.Group(), 'hanging-plant');
  hang.add(at(cyl(0.012, 0.012, top - y, '#6B5440', { outline: 0 }), 0, (top + y) / 2, 0));
  hang.add(at(cyl(0.2, 0.14, 0.22, i % 2 ? '#D9774B' : '#F1E4CE', { outline: 0.03 }), 0, y - 0.11, 0));
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + i;
    hang.add(at(ball(0.13, LEAF_GREENS[(k + i) % 4], { outline: 0.05 }), Math.sin(a) * 0.14, y + 0.02, Math.cos(a) * 0.14));
    for (let d = 1; d <= 2 + ((k + i) % 3); d++) {
      hang.add(at(ball(0.07, LEAF_GREENS[(k + d + i) % LEAF_GREENS.length], { outline: 0.06 }), Math.sin(a) * (0.2 + d * 0.015), y - 0.05 - d * 0.17, Math.cos(a) * (0.2 + d * 0.015)));
    }
  }
  return hang;
}

/**
 * The atelier shell (#lab), after the mock-up: a brick wall covered in a living green wall on the
 * entrance side, tall garden windows on the deck side, and a timber vault over the room, its ribs
 * arching from wall to wall with hanging plants. The vault stops short of the camera's side, so the
 * room stays open to the view.
 */
function addAtelier(group: THREE.Group, { room, door, sideDoor, crewLounge, backWall }: LabLayout) {
  const atelier = tag(new THREE.Group(), 'atelier');
  const top = backWall.height, half = room.right + 0.15;
  const left = room.left - 0.15, right = room.right + 0.15;

  // The entrance wall: brick, full height, with a doorway; a living green wall over the work area.
  const brick = new THREE.MeshToonMaterial({ map: brickTexture(1, 1), gradientMap: toonRamp });
  const wallRun = (z0: number, z1: number, y0: number, h: number) => {
    const material = brick.clone();
    material.map = brickTexture(z1 - z0, h);
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.3, h, z1 - z0), material);
    w.castShadow = w.receiveShadow = true;
    atelier.add(tag(at(w, left - 0.05, y0 + h / 2, (z0 + z1) / 2), 'wall'));
  };
  const doorHalf = 1.25, lintel = 2.96;
  wallRun(room.back - 0.2, door.z - doorHalf, 0, top);
  wallRun(door.z + doorHalf, room.front, 0, top);
  wallRun(door.z - doorHalf, door.z + doorHalf, lintel, top - lintel);

  const leaves: [number, number, number, number, number][] = [];
  const greenRuns = [[room.back + 0.25, door.z - doorHalf - 0.15], [door.z + doorHalf + 0.15, crewLounge.z0 - 0.3]];
  let k = 0;
  for (const [z0, z1] of greenRuns) {
    // A planter trough along the foot of the green wall.
    atelier.add(tag(at(box(0.5, 0.42, z1 - z0, C.oakDark, { outline: 0.02 }), left + 0.3, 0.21, (z0 + z1) / 2), 'planter'));
    for (let z = z0; z < z1; z += 0.2) {
      for (let y = 0.45; y < top - 0.1; y += 0.24) {
        const j = (k++ * 0.618034) % 1;
        leaves.push([left + 0.22 + j * 0.3, y + (j - 0.5) * 0.18, z + (j - 0.5) * 0.15, 0.24 + j * 0.16, -0.6 + j * 1.2]);
      }
    }
  }
  atelier.add(leafMass(leaves, 1));

  // The deck side: tall garden windows, oak mullions on a low sill, a transom, and pale glass.
  const glass = new THREE.MeshBasicMaterial({ color: '#E3F2EA', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
  const sideHalf = 0.95;
  for (const [z0, z1] of [[room.back - 0.2, sideDoor.z - sideHalf], [sideDoor.z + sideHalf, room.front]] as const) {
    const len = z1 - z0, mid = (z0 + z1) / 2;
    atelier.add(tag(at(box(0.34, 0.5, len, C.oak, { outline: 0.02 }), right, 0.25, mid), 'wall'));
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(len, top - 0.5), glass);
    pane.rotation.y = Math.PI / 2;
    atelier.add(at(pane, right, (top + 0.5) / 2, mid));
    for (const y of [2.9, top]) atelier.add(at(box(0.16, 0.12, len, C.oak, { outline: 0.02 }), right, y, mid));
    const bays = Math.max(1, Math.round(len / 1.7));
    for (let b = 0; b <= bays; b++) atelier.add(at(box(0.14, top - 0.5, 0.12, C.oak, { outline: 0.02 }), right, (top + 0.5) / 2, z0 + (len * b) / bays));
  }
  atelier.add(at(box(0.16, top - lintel, sideHalf * 2, C.oak, { outline: 0.02 }), right, (top + lintel) / 2, sideDoor.z));
  // Potted plants along the windows, between the bays.
  const potted: Point[] = [];
  for (let z = room.back + 1.2; z < crewLounge.z0 - 0.5; z += 3.4) if (Math.abs(z - sideDoor.z) > 1.6) potted.push({ x: room.right - 0.4, z });
  potted.forEach((p, i) => atelier.add(at(buildLeafyPlant(i, 0.72), p.x, 0, p.z)));

  // The back wall's top follows the vault: a curved cream gable over it.
  const gable = new THREE.Shape();
  gable.moveTo(-half, 0);
  for (let s = 1; s < 32; s++) {
    const p = vaultPoint((s / 32) * Math.PI, half, 0, 0);
    gable.lineTo(p.x, p.y);
  }
  gable.lineTo(half, 0);
  gable.closePath();
  const gableWall = mesh(new THREE.ShapeGeometry(gable), C.wall, { outline: 0 });
  gableWall.material = Object.assign((gableWall.material as THREE.MeshToonMaterial).clone(), { side: THREE.DoubleSide });
  atelier.add(at(gableWall, 0, top, room.back - 0.25));

  // The vault: full arches over the back of the room, and over the front only their springing, so the
  // camera looks in under the roof. Purlins run along it between the ribs.
  const zFull = room.back + 0.1 + VAULT.spacing * 3;
  const arcs: { z: number; full: boolean }[] = [];
  for (let z = room.back + 0.1; z < room.front - 0.3; z += VAULT.spacing) arcs.push({ z, full: z <= zFull + 0.01 });
  const haunch = 0.55;
  for (const { z, full } of arcs) {
    const span = (a0: number, a1: number) => {
      const pts: THREE.Vector3[] = [];
      for (let s = 0; s <= 24; s++) pts.push(vaultPoint(a0 + ((a1 - a0) * s) / 24, half, top, z));
      return pts;
    };
    const r = z === arcs[0].z ? 0.2 : 0.12;
    if (full) atelier.add(rib(span(0, Math.PI), r));
    else for (const [a0, a1] of [[0, haunch], [Math.PI - haunch, Math.PI]]) atelier.add(rib(span(a0, a1), r));
    // Each rib comes down the wall as a post.
    for (const s of [-1, 1]) atelier.add(at(box(0.22, top, 0.22, C.oak, { outline: 0.02 }), s * half, top / 2, z));
  }
  const lastFull = arcs.filter((a) => a.full).at(-1)!.z, lastZ = arcs.at(-1)!.z;
  for (const a of [0.25, 0.5, 0.78, Math.PI / 2, Math.PI - 0.78, Math.PI - 0.5, Math.PI - 0.25]) {
    const reach = a < haunch || a > Math.PI - haunch ? lastZ : lastFull;
    const p = vaultPoint(a, half, top, 0);
    atelier.add(at(box(0.09, 0.09, reach - arcs[0].z, C.oakDark, { outline: 0.02 }), p.x, p.y, (reach + arcs[0].z) / 2));
  }
  // Pale glass between the full ribs.
  const roofGlass = new THREE.MeshBasicMaterial({ color: '#F4FAF6', transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide });
  const roof = new THREE.CylinderGeometry(1, 1, lastFull - arcs[0].z, 32, 1, true, -Math.PI / 2, Math.PI);
  const shell = new THREE.Mesh(roof, roofGlass);
  shell.rotation.x = Math.PI / 2;
  shell.scale.set(half, 1, VAULT.rise);
  atelier.add(at(shell, 0, top, (lastFull + arcs[0].z) / 2));
  // Hanging plants from the ribs, down the sides of the room.
  arcs.forEach(({ z }, i) => {
    if (i === 0) return;
    for (const s of [-1, 1]) {
      const p = vaultPoint(s < 0 ? 0.42 : Math.PI - 0.42, half, top, z);
      atelier.add(at(hangingPlant(i + (s > 0 ? 1 : 0), p.y, 3.3 - (i % 2) * 0.3), p.x, 0, z));
    }
  });
  group.add(atelier);
}

/** Leafy plants between the islands in each row, so the room reads as a garden studio, not rows of desks. */
function addTrees(group: THREE.Group, { pods }: LabLayout) {
  pods.slice(1).forEach((pod, k) => {
    const left = pods[k];
    if (left.row !== pod.row) return;
    group.add(at(buildLeafyPlant(k, 1.3), (left.x + pod.x) / 2, 0, pod.z));
  });
}

/**
 * A big leafy floor plant in a cream or terracotta pot: long leaves arching out and up from the middle,
 * `size` times a 1.4 m plant.
 */
export function buildLeafyPlant(i: number, size = 1) {
  const plant = tag(new THREE.Group(), 'tree');
  plant.add(at(cyl(0.3, 0.24, 0.48, i % 2 ? '#F1E4CE' : '#D9774B', { outline: 0.03 }), 0, 0.24, 0));
  plant.add(at(cyl(0.27, 0.27, 0.03, '#5B4636', { outline: 0 }), 0, 0.47, 0));
  const count = 11;
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2 + i * 0.7;
    const lean = 0.35 + ((k * 5 + i) % 4) * 0.22;
    const len = 0.42 + ((k * 3 + i) % 3) * 0.1;
    const leaf = new THREE.Group();
    leaf.rotation.set(0, a, 0);
    const blade = ball(1, LEAF_GREENS[(k + i) % LEAF_GREENS.length], { outline: 0.03 });
    blade.scale.set(len * 0.42, 0.04, len);
    blade.rotation.x = -lean;
    blade.position.set(0, 0.55 + Math.sin(lean) * len * 0.6 + (k % 3) * 0.1, Math.cos(lean) * len * 0.75);
    leaf.add(blade);
    plant.add(leaf);
  }
  plant.scale.setScalar(size);
  return plant;
}

/**
 * The maker corner (#lab): an oak bench with a 3D printer building a part, a robot arm that slowly
 * picks and places, and a shelf of prototypes. `update(t)` keeps the arm and the print head moving.
 */
function addMaker(group: THREE.Group, { maker }: LabLayout) {
  // Built along x with its back (and the shelf) on +z, then turned so the back is against the wall.
  const corner = new THREE.Group();
  corner.position.set(maker.x, 0, maker.z);
  corner.rotation.y = maker.yaw;
  const bench = tag(new THREE.Group(), 'maker-bench');
  bench.add(at(box(maker.w, 0.07, maker.d, C.oak, { outline: 0.02 }), 0, 0.9, 0));
  for (const s of [-1, 1]) bench.add(at(box(0.07, 0.87, maker.d - 0.08, C.oakDark, { outline: 0.02 }), s * (maker.w / 2 - 0.08), 0.435, 0));
  bench.add(at(box(maker.w - 0.2, 0.05, maker.d - 0.1, C.oakDark, { outline: 0.02 }), 0, 0.3, 0));
  // The 3D printer: a dark frame, a glowing print bed and a part growing on it.
  const printer = at(new THREE.Group(), -0.6, 0.94, 0);
  for (const [px, pz] of [[-0.24, -0.2], [0.24, -0.2], [-0.24, 0.2], [0.24, 0.2]]) printer.add(at(box(0.04, 0.6, 0.04, C.bezel, { outline: 0 }), px, 0.3, pz));
  printer.add(at(box(0.56, 0.05, 0.48, C.bezel, { outline: 0.02 }), 0, 0.62, 0));
  printer.add(at(box(0.56, 0.06, 0.48, C.bezel, { outline: 0.02 }), 0, 0.03, 0));
  printer.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.015, 0.34), glowing('#FFB648')), 0, 0.07, 0));
  const print = at(cyl(0.08, 0.1, 0.12, '#E07B54', { outline: 0.05 }), 0, 0.14, 0);
  printer.add(print);
  const head = at(box(0.1, 0.06, 0.1, '#F4EEE2', { outline: 0.04 }), 0, 0.3, 0);
  head.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), glowing('#FFE7B0')), 0, -0.04, 0));
  printer.add(head);
  bench.add(printer);
  // The robot arm: a base, two links and a gripper, turning and nodding.
  const arm = at(new THREE.Group(), 0.45, 0.94, 0);
  arm.add(at(cyl(0.14, 0.16, 0.08, C.bezel, { outline: 0.03 }), 0, 0.04, 0));
  const turn = at(new THREE.Group(), 0, 0.08, 0);
  turn.add(at(cyl(0.08, 0.08, 0.1, '#E07B54', { outline: 0.03 }), 0, 0.05, 0));
  const shoulder = at(new THREE.Group(), 0, 0.12, 0);
  shoulder.add(at(box(0.07, 0.36, 0.07, '#F4EEE2', { outline: 0.03 }), 0, 0.18, 0));
  const elbow = at(new THREE.Group(), 0, 0.36, 0);
  elbow.add(at(ball(0.05, '#E07B54', { outline: 0.05 }), 0, 0, 0));
  elbow.add(at(box(0.06, 0.3, 0.06, '#F4EEE2', { outline: 0.03 }), 0, 0.15, 0));
  const grip = at(new THREE.Group(), 0, 0.3, 0);
  for (const s of [-1, 1]) grip.add(at(box(0.02, 0.07, 0.03, C.bezel, { outline: 0 }), s * 0.03, 0.03, 0));
  elbow.add(grip);
  shoulder.add(elbow);
  turn.add(shoulder);
  arm.add(turn);
  bench.add(arm);
  // A little crate of parts and a prototype bot head.
  bench.add(at(box(0.3, 0.12, 0.22, '#C98F55', { outline: 0.03 }), 0.0, 1.0, 0.1));
  bench.add(at(box(0.18, 0.14, 0.12, '#7FAEFF', { outline: 0.04 }), -0.05, 1.01, -0.14));
  corner.add(bench);
  // A shelf of prototypes on the wall over the bench.
  const shelf = tag(at(new THREE.Group(), 0, 0, maker.d / 2 + 0.05), 'maker-shelf');
  for (const s of [-1, 1]) shelf.add(at(box(0.06, 1.7, 0.06, C.oakDark, { outline: 0.02 }), s * (maker.w / 2 - 0.1), 0.85, 0));
  for (const y of [1.3, 1.75]) shelf.add(at(box(maker.w - 0.1, 0.05, 0.24, C.oak, { outline: 0.02 }), 0, y, 0));
  const protos = ['#E07B54', '#5FA35A', '#E2B347', '#7FAEFF', '#C25B7A'];
  protos.forEach((c, k) => shelf.add(at(k % 2 ? ball(0.09, c, { outline: 0.05 }) : box(0.16, 0.16, 0.16, c, { outline: 0.04 }), -0.8 + k * 0.4, 1.41 + (k % 2) * 0.45, 0)));
  corner.add(shelf);
  group.add(corner);

  return {
    update(t: number) {
      turn.rotation.y = Math.sin(t * 0.6) * 1.1;
      shoulder.rotation.z = 0.35 + Math.sin(t * 0.9) * 0.25;
      elbow.rotation.z = 0.9 + Math.sin(t * 0.9 + 1) * 0.35;
      grip.children.forEach((c, k) => { c.position.x = (k ? 1 : -1) * (0.025 + Math.max(0, Math.sin(t * 1.8)) * 0.02); });
      head.position.x = Math.sin(t * 2.3) * 0.12;
      head.position.z = Math.cos(t * 1.7) * 0.1;
      print.scale.y = 0.4 + ((t * 0.05) % 1) * 0.9;
      print.position.y = 0.08 + print.scale.y * 0.06;
    },
  };
}

/** Where a pod's rug is, for tests and checks. */
export const rugCentre = (rug: { x0: number; x1: number; z0: number; z1: number }): Point => ({ x: (rug.x0 + rug.x1) / 2, z: (rug.z0 + rug.z1) / 2 });
