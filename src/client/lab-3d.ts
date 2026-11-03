// The Innovation lab in 3D, built from its floor plan (lab.ts): a copy of the Control room's
// build (control-room-3d.ts), reskinned warm. Timber floor and cream walls, the board flat on
// the back wall, pods of oak workstations on project-coloured rugs, a break corner behind the
// desks, and the Control room's deck outside the side door. A desk only shows while a session
// sits at it; a pod's rug only while a project has a desk there.
import * as THREE from 'three';
import { at, box, cyl, part, tag, toonRamp } from './toon.ts';
import type { Point } from './layout.ts';
import type { LabLayout } from './lab.ts';
import type { AgentRecord, OfficeState } from '../shared/agent.ts';
import { DeskScreen, newCanvas } from './screen.ts';
import { addGameTables, addPetCorner, addPool, addSoloProps } from './break-room.ts';
import { WORKTOP, buildCounter, buildEspressoMachine, buildFruitBowl, buildKettle, buildToaster } from './kitchen.ts';
import { addBistro, addLounge, buildBookshelf, buildCooler, buildPlant, type Seat } from './office.ts';
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
  layout.plants.forEach((p, i) => group.add(at(buildPlant(i), p.x, 0, p.z)));
  const { seats, pods } = addPods(group, layout);
  return { group, seats, layout, board, backWall, tv, doors, pods };
}

function addRoom(group: THREE.Group, { room, door, sideDoor, crewLounge }: LabLayout) {
  const width = room.right - room.left, depth = room.front - room.back;
  const centre = { x: (room.left + room.right) / 2, z: (room.back + room.front) / 2 };
  group.add(tag(at(box(width, 0.3, depth, C.floorSide, { outline: 0, shadow: false }), centre.x, -0.15, centre.z), 'floor'));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshToonMaterial({ map: plankTexture(width / 2.4, depth / 1.2), gradientMap: toonRamp }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(tag(at(floor, centre.x, 0.002, centre.z), 'floor'));

  // Low side walls (so the camera sees in), rising beside the break corner to hang the dart board on.
  const low = 1.2, high = crewLounge.wallHeight;
  const wall = (x: number, z0: number, z1: number, h: number) => {
    const w = tag(at(box(0.25, h, z1 - z0, C.wall, { outline: 0.01 }), x, h / 2, (z0 + z1) / 2), 'wall');
    w.add(at(box(0.3, 0.06, z1 - z0, C.trim, { outline: 0, shadow: false }), 0, h / 2, 0));
    group.add(w);
  };
  for (const [x, gapZ] of [[room.left - 0.15, door.z], [room.right + 0.15, sideDoor.z]] as const) {
    wall(x, room.back, gapZ - 0.9, low);
    wall(x, gapZ + 0.9, crewLounge.z0, low);
    wall(x, crewLounge.z0, crewLounge.z1, high);
  }
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
}

/** An oak workstation facing +z (towards the board once turned), its sitter on the -z side; `light` backlights the keyboard. */
export function buildWorkstation(light: KeyLight) {
  const desk = tag(new THREE.Group(), 'desk');
  desk.add(at(box(1.4, 0.06, 0.75, C.oak, { outline: 0.02 }), 0, 0.74, 0));
  // Two slab legs and a modesty panel at the front.
  for (const s of [-1, 1]) desk.add(at(box(0.06, 0.71, 0.66, C.oakDark, { outline: 0.02 }), s * 0.64, 0.355, 0));
  desk.add(at(box(1.22, 0.36, 0.03, C.oakDark, { outline: 0 }), 0, 0.5, 0.3));
  // Keyboard on a backlight strip in the status colour, a mouse, and a mug-sized coaster.
  desk.add(part(at(box(0.52, 0.025, 0.17, C.key, { outline: 0.03 }), 0, 0.785, -0.13), 'keyboard'));
  desk.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.012, 0.21), light.material), 0, 0.776, -0.13));
  desk.add(part(at(box(0.11, 0.03, 0.16, C.key, { outline: 0.04 }), -0.42, 0.785, -0.11), 'mouse'));
  // A second monitor, turned in towards the sitter (the main one is the desk's live screen).
  const side = at(new THREE.Group(), 0.5, 0, 0.12);
  side.add(at(box(0.05, 0.22, 0.05, C.bezel, { outline: 0 }), 0, 0.88, 0.02));
  side.add(at(box(0.42, 0.3, 0.04, C.bezel, { outline: 0.02 }), 0, 1.12, 0));
  const face = at(new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.24), light.material), 0, 1.12, -0.025);
  face.rotation.y = Math.PI;
  face.scale.setScalar(1);
  side.add(face);
  desk.add(turned(side, 0.5));
  // A desk lamp at the far left corner.
  const lamp = tag(at(new THREE.Group(), -0.56, 0.77, 0.24), 'desk-lamp');
  lamp.add(at(cyl(0.08, 0.09, 0.03, C.bezel, { outline: 0.03 }), 0, 0.015, 0));
  lamp.add(at(cyl(0.015, 0.015, 0.42, C.bezel, { outline: 0 }), 0, 0.22, 0));
  const shade = at(cyl(0.05, 0.11, 0.12, C.lampShade, { outline: 0.03 }), 0.06, 0.44, -0.04);
  shade.rotation.z = -0.5;
  lamp.add(shade);
  lamp.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), glowing('#FFF2C8')), 0.08, 0.4, -0.05));
  desk.add(lamp);
  return desk;
}

/** A warm task chair facing +z (its back on the -z side). */
function buildLabChair() {
  const chair = tag(new THREE.Group(), 'chair');
  chair.add(at(box(0.5, 0.09, 0.48, C.chair, { outline: 0.03 }), 0, 0.44, 0));
  chair.add(at(box(0.5, 0.52, 0.08, C.chair, { outline: 0.03 }), 0, 0.76, -0.25));
  chair.add(at(cyl(0.035, 0.035, 0.38, C.bezel, { outline: 0 }), 0, 0.21, 0));
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    chair.add(turned(at(box(0.04, 0.03, 0.28, C.bezel, { outline: 0 }), Math.sin(a) * 0.14, 0.03, Math.cos(a) * 0.14), a));
  }
  return chair;
}

/** One desk's pieces: they show only while a session sits there, popping in and packing away. */
interface Workstation { root: THREE.Group; shown: number; target: number }

/** A pod's rug and its name tag: shown while any of its desks is taken, in the project's colour. */
class PodRug {
  readonly root = tag(new THREE.Group(), 'pod');
  private rug: THREE.Mesh<THREE.BoxGeometry, THREE.MeshToonMaterial>;
  private border: THREE.Mesh<THREE.BoxGeometry, THREE.MeshToonMaterial>;
  private label: THREE.Sprite;
  private drawn = newCanvas(512, 128);
  private texture: THREE.CanvasTexture | null = null;
  private key = '';
  shown = 0;
  target = 0;

  constructor(rug: { x0: number; x1: number; z0: number; z1: number }) {
    const w = rug.x1 - rug.x0, d = rug.z1 - rug.z0;
    this.border = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), new THREE.MeshToonMaterial({ color: '#FFFFFF', gradientMap: toonRamp }));
    this.rug = new THREE.Mesh(new THREE.BoxGeometry(w - 0.24, 0.022, d - 0.24), new THREE.MeshToonMaterial({ color: '#FFFFFF', gradientMap: toonRamp }));
    this.border.receiveShadow = this.rug.receiveShadow = true;
    this.root.add(at(this.border, 0, 0.012, 0), at(this.rug, 0, 0.014, 0));
    // Drawn over the desks in front of it, so a pod's name never hides behind the next row.
    const material = new THREE.SpriteMaterial({ color: '#FFFFFF', transparent: true, depthWrite: false, depthTest: false });
    if (this.drawn) {
      this.texture = new THREE.CanvasTexture(this.drawn.canvas);
      this.texture.colorSpace = THREE.SRGBColorSpace;
      material.map = this.texture;
    }
    this.label = new THREE.Sprite(material);
    this.label.scale.set(2.2, 0.55, 1);
    this.label.renderOrder = 2;
    // On the rug's back edge (the camera side), just off the floor.
    this.root.add(at(this.label, 0, 0.45, d / 2 + 0.05));
    this.root.position.set((rug.x0 + rug.x1) / 2, 0, (rug.z0 + rug.z1) / 2);
    this.root.visible = false;
    this.root.userData.labelLift = this.label;
  }

  /**
   * Shows the rug for `project` (null: no project here), with how many of its sessions are waiting on you.
   * `labelled` false: a busy project's next pod along, whose rug runs on from this one's under one name tag.
   */
  show(project: string | null, waiting: number, labelled = true) {
    this.target = project ? 1 : 0;
    this.label.visible = labelled;
    if (!project) return;
    const key = `${project}|${waiting}`;
    if (key === this.key) return;
    this.key = key;
    const color = projectColor(project);
    const base = new THREE.Color(color);
    this.rug.material.color.copy(base).lerp(new THREE.Color('#FFF8EE'), 0.45);
    this.border.material.color.set(color);
    if (!this.drawn) return;
    const { g, canvas } = this.drawn;
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.font = '800 54px Nunito, Arial, sans-serif';
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
      g.fillStyle = '#FFFFFF';
      g.beginPath();
      g.roundRect(x0 + textW + 48, 28, badgeW - 8, 72, 36);
      g.fill();
      g.fillStyle = LAB_STATUS.needs;
      g.font = '800 50px Nunito, Arial, sans-serif';
      g.fillText(badge, x0 + textW + 64, 66);
    }
    this.texture!.needsUpdate = true;
  }
}

const ease = (k: number) => k * k * (3 - 2 * k);

/** Every seat's workstation, chair and live screen, and each pod's rug, with what keeps them up to date. */
function addPods(group: THREE.Group, layout: LabLayout) {
  const rugs = layout.pods.map((pod) => {
    const rug = new PodRug(pod.rug);
    group.add(rug.root);
    return rug;
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
    root.add(screen.root);
    root.visible = false;
    root.scale.setScalar(0.001);
    group.add(root);
    stations.push({ root, shown: 0, target: 0 });
    return { ...spot, screen, light, swivel: chair };
  });

  /** Call every frame with each desk's agent: desks pop in and pack away, rugs follow their pods' projects. */
  function update(occupants: Map<number, AgentRecord>, dt: number) {
    stations.forEach((s, i) => {
      s.target = occupants.has(i) ? 1 : 0;
      s.shown = THREE.MathUtils.clamp(s.shown + Math.sign(s.target - s.shown) * (dt / POP_SECONDS), 0, 1);
      s.root.visible = s.shown > 0;
      s.root.scale.setScalar(Math.max(0.001, ease(s.shown)));
    });
    const projects = layout.pods.map((pod) => pod.seats.map((k) => occupants.get(k)).filter((r): r is AgentRecord => !!r));
    const projectOf = (i: number) => projects[i]?.[0]?.project ?? null;
    layout.pods.forEach((pod, i) => {
      const project = projectOf(i);
      // Side-by-side pods of one project read as one long rug: the first carries the name and every pod's waiting count.
      const runsOn = i > 0 && layout.pods[i - 1].row === pod.row && project != null && projectOf(i - 1) === project;
      let waiting = 0;
      for (let k = i; k < layout.pods.length && layout.pods[k].row === pod.row && projectOf(k) === project; k++) {
        waiting += projects[k].filter((r) => r.state === 'needs').length;
      }
      const rug = rugs[i];
      rug.show(project, waiting, !runsOn);
      rug.shown = THREE.MathUtils.clamp(rug.shown + Math.sign(rug.target - rug.shown) * (dt / POP_SECONDS), 0, 1);
      rug.root.visible = rug.shown > 0;
      rug.root.scale.set(Math.max(0.001, ease(rug.shown)), 1, Math.max(0.001, ease(rug.shown)));
    });
  }

  return { seats, pods: { update, rugs, stations } };
}

/** Where a pod's rug is, for tests and checks. */
export const rugCentre = (rug: { x0: number; x1: number; z0: number; z1: number }): Point => ({ x: (rug.x0 + rug.x1) / 2, z: (rug.z0 + rug.z1) / 2 });
