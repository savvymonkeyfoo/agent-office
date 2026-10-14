// The Control room in 3D (#101), built from its floor plan (control-room.ts): a dim room lit by
// the screen wall, tiers of consoles with status lights, the entrance and side door, a warm crew
// lounge behind the top tier, and the deck outside with its pool and a lake cut square at the edge.
import * as THREE from 'three';
import { at, box, cyl, mesh, part, tag, toon, toonRamp } from './toon.ts';
import type { Area, Point } from './layout.ts';
import { HALF_STEP, STAIRS, TIER_RISE, heightAt, stairsHeightAt, type ControlRoomLayout } from './control-room.ts';
import type { OfficeState } from '../shared/agent.ts';
import { DeskScreen, newCanvas } from './screen.ts';
import { STATUS_COLORS, ScreenWall } from './screen-wall.ts';
import { POOL_RIM, addGameTables, addPetCorner, addPool, addSoloProps } from './break-room.ts';
import { waterSurface } from './water.ts';
import { WORKTOP, buildCounter, buildEspressoMachine, buildFruitBowl, buildKettle, buildToaster } from './kitchen.ts';
import { addBistro, addLounge, buildBookshelf, buildChair, buildCooler, buildPlant, type Seat } from './office.ts';

const C = {
  floor: '#3A3358', pit: '#2F2A4A', tierTop: '#4F4578', tierSide: '#3E3662', wall: '#2B2545', trim: '#463E66',
  console: '#5A5280', consoleTop: '#8C7FB0', bezel: '#241C2F', glow: '#59D3FF', display: '#101A38',
loungeSide: '#3E3662', rail: '#C9A57A', door: '#F07A4A', frame: '#8C7FB0',
  grass: '#7FB069', grassSide: '#6A9A57', earth: '#9C7553', boards: '#D9B48A', stone: '#E6DCC8',
  lakeBed: '#C9B27E', lake: '#4C9BD6', lakeCut: '#2F6FA8',
};

export { STATUS_COLORS };
export const STATUS_OFF = '#2C3350';

/** A soft round glow, white in the middle fading to nothing, generated as pixels (no canvas needed). */
const glowDot = (() => {
  const size = 32, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
      data.set([255, 255, 255, Math.round(255 * Math.max(0, 1 - d) ** 2)], (y * size + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
})();

/** A console's status light (the beacon and the strip along its front share it). */
export class StatusLight {
  readonly material = new THREE.MeshBasicMaterial({ color: STATUS_OFF });
  readonly halo = new THREE.SpriteMaterial({ map: glowDot, color: STATUS_OFF, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  get color() { return this.material.color; }

  /** `state`: its agent's state; null for an empty console. */
  show(state: OfficeState | null) {
    const color = state ? STATUS_COLORS[state] : STATUS_OFF;
    this.material.color.set(color);
    this.halo.color.set(color);
    this.halo.opacity = state ? 0.55 : 0;
  }
}

/** Anyone this close to the entrance is walking in or out through it (nothing else comes near). */
export const DOOR_REACH = 2.2;
export const doorsOpen = (door: Point, walkers: Point[]) => walkers.some((p) => Math.hypot(p.x - door.x, p.z - door.z) < DOOR_REACH);

const DOOR = { width: 1.6, height: 2.4, swing: 1.3, seconds: 0.45 };

/** The entrance's double doors: they swing out of the room, and back shut. */
export class EntranceDoors {
  readonly leaves: THREE.Object3D[] = [];
  private hinges: THREE.Group[] = [];
  openness = 0;

  constructor(entrance: THREE.Group) {
    for (const side of [-1, 1]) {
      const hinge = at(new THREE.Group(), 0, 0, side * DOOR.width / 2);
      const leaf = at(box(0.08, DOOR.height, DOOR.width / 2 - 0.04, C.door, { outline: 0.02 }), 0, DOOR.height / 2, -side * DOOR.width / 4);
      leaf.add(at(box(0.1, 0.6, DOOR.width / 2 - 0.3, '#BFE6F5', { outline: 0, shadow: false }), 0, 0.5, 0));
      leaf.add(at(box(0.12, 0.05, 0.22, '#F4EEE2', { outline: 0 }), 0, 0, side * (DOOR.width / 4 - 0.14)));
      hinge.add(leaf);
      hinge.userData.side = side;
      entrance.add(hinge);
      this.hinges.push(hinge);
      this.leaves.push(leaf);
    }
  }

  /** Call every frame with whether anyone is coming or going. */
  update(open: boolean, dt: number) {
    this.openness = THREE.MathUtils.clamp(this.openness + (open ? dt : -dt) / DOOR.seconds, 0, 1);
    const k = this.openness * this.openness * (3 - 2 * this.openness);
    for (const hinge of this.hinges) hinge.rotation.y = hinge.userData.side * DOOR.swing * k;
  }
}

/** The Control room for `layout`, shaped like the classic build (and with its entrance doors). */
export function buildControlRoom(layout: ControlRoomLayout) {
  const group = new THREE.Group();
  addRoom(group, layout);
  const { backWall, board } = addScreenWall(group, layout);
  addTiers(group, layout);
  const doors = addEntrance(group, layout);
  addSideDoor(group, layout);
  const { lounge, tv } = addCrewLounge(group, layout);
  const deck = addDeck(group, layout);
  addProps(layout, lounge, deck);
  layout.plants.forEach((p, i) => group.add(at(buildPlant(i), p.x, heightAt(layout, p), p.z)));
  const seats = addConsoles(group, layout);
  return { group, seats, layout, board, backWall, tv, doors };
}

const turned = <T extends THREE.Object3D>(obj: T, yaw: number) => {
  obj.rotation.y = yaw;
  return obj;
};
const glowing = (color: string) => new THREE.MeshBasicMaterial({ color });
const glass = new THREE.MeshBasicMaterial({ color: '#BFE6F5', transparent: true, opacity: 0.22, depthWrite: false });

/** A shape on the floor from (x, z) points (shape y is -z: shapes are laid flat by turning them -90° about x). */
const flat = (points: Point[]) => new THREE.Shape(points.map((p) => new THREE.Vector2(p.x, -p.z)));
/** `shape` extruded `depth` up from y = 0, caps and sides in their own colours. */
function slab(shape: THREE.Shape, depth: number, top: string, side: string) {
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 24 });
  geometry.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geometry, [toon(top), toon(side)]);
  m.receiveShadow = true;
  return m;
}

function addRoom(group: THREE.Group, { room, door, sideDoor, crewLounge, screenWall, tiers }: ControlRoomLayout) {
  const width = room.right - room.left, depth = room.front - room.back;
  group.add(tag(at(box(width, 0.3, depth, C.floor, { outline: 0, shadow: false }), 0, -0.15, (room.back + room.front) / 2), 'floor'));

  // The pit: a darker floor between the screens and the first tier, with glow lines running to the screens.
  const span = Math.asin(STAIRS.x1 / tiers[0].inner);
  const pit = new THREE.Mesh(new THREE.RingGeometry(screenWall.z - screenWall.focus.z + 0.3, tiers[0].inner, 48, 1, -Math.PI / 2 - span, 2 * span), toon(C.pit));
  pit.rotation.x = -Math.PI / 2;
  pit.receiveShadow = true;
  group.add(tag(at(pit, screenWall.focus.x, 0.004, screenWall.focus.z), 'floor'));
  for (const a of [-span * 0.6, 0, span * 0.6]) {
    const [r0, r1] = [screenWall.z - screenWall.focus.z + 0.8, tiers[0].inner - 0.6];
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.05, r1 - r0), new THREE.MeshBasicMaterial({ color: C.glow, transparent: true, opacity: 0.4 }));
    line.rotation.set(-Math.PI / 2, 0, a);
    const r = (r0 + r1) / 2;
    group.add(at(line, screenWall.focus.x + r * Math.sin(a), 0.008, screenWall.focus.z + r * Math.cos(a)));
  }

  // Low side walls (so the camera sees in), rising beside the lounge to hang the dart board on.
  // Each has a gap for its door.
  const low = 1.4, high = crewLounge.height + crewLounge.wallHeight;
  const wall = (x: number, z0: number, z1: number, h: number) => {
    const w = tag(at(box(0.25, h, z1 - z0, C.wall, { outline: 0.01 }), x, h / 2, (z0 + z1) / 2), 'wall');
    w.add(at(box(0.32, 0.06, z1 - z0, C.trim, { outline: 0, shadow: false }), 0, h / 2, 0));
    group.add(w);
  };
  for (const [x, gapZ] of [[room.left - 0.15, door.z], [room.right + 0.15, sideDoor.z]] as const) {
    wall(x, room.back, gapZ - 0.9, low);
    wall(x, gapZ + 0.9, crewLounge.z0, low);
    wall(x, crewLounge.z0, crewLounge.z1, high);
  }
}

const SCREENS = { centre: { w: 8.2, h: 3.85 }, side: { w: 4.0, h: 2.85, x: 6.85, out: 0.9, yaw: 0.35 }, y: 3.7 };
/** Long enough to reach the wall from a side screen's back at its angle. */
const ARM_LENGTH = 0.9;

/** A wall screen (tagged), `w` × `h`, its dark display facing +z. */
function wallScreen(w: number, h: number) {
  const screen = tag(new THREE.Group(), 'wall-screen');
  screen.add(box(w + 0.24, h + 0.24, 0.12, C.bezel, { outline: 0.015 }));
  const display = part(at(new THREE.Mesh(new THREE.PlaneGeometry(w, h), glowing(C.display)), 0, 0, 0.065), 'display');
  screen.add(display);
  // A thin glow round the display, as if lit from inside.
  for (const [sw, sh, y] of [[w, 0.03, h / 2 + 0.06], [w, 0.03, -h / 2 - 0.06]]) screen.add(at(new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), glowing(C.glow)), 0, y, 0.07));
  return screen;
}

/** The tall back wall with its three screens (the centre one shows the big board), and the glow they cast. */
function addScreenWall(group: THREE.Group, { room, screenWall }: ControlRoomLayout) {
  const backWall = new THREE.Group();
  const width = room.right - room.left + 0.6, z = room.back;
  backWall.add(tag(at(box(width, screenWall.height, 0.4, C.wall, { outline: 0.01 }), 0, screenWall.height / 2, z - 0.2), 'wall'));
  // A darker band behind the screens, a skirting light, and slim light ribs between the panels.
  backWall.add(at(box(width, 4.9, 0.02, '#221D3A', { outline: 0, shadow: false }), 0, SCREENS.y, z + 0.01));
  backWall.add(at(new THREE.Mesh(new THREE.PlaneGeometry(width, 0.05), glowing(C.glow)), 0, 0.12, z + 0.02));
  for (const x of [-10, -4.5, 4.5, 10]) backWall.add(at(new THREE.Mesh(new THREE.PlaneGeometry(0.06, 4.4), glowing('#3A6FA8')), x, SCREENS.y, z + 0.025));

  const { centre, side, y } = SCREENS;
  const middle = at(wallScreen(centre.w, centre.h), 0, y, z + 0.1);
  const board = new ScreenWall(centre, side);
  middle.add(at(board.centre.mesh, 0, 0, 0.07));
  backWall.add(middle);
  for (const s of [-1, 1]) {
    const x = s * side.x, out = z + side.out;
    const screen = wallScreen(side.w, side.h);
    screen.add(at((s < 0 ? board.left : board.right).mesh, 0, 0, 0.07));
    // Arms from the screen's back into the wall: they turn with the screen, so they never poke through its face.
    for (const dy of [-0.8, 0.8]) screen.add(part(at(box(0.12, 0.12, ARM_LENGTH, C.bezel, { outline: 0 }), 0, dy, -0.06 - ARM_LENGTH / 2), 'arm'));
    backWall.add(turned(at(screen, x, y, out), -s * side.yaw));
  }
  group.add(backWall);

  const light = new THREE.PointLight(C.glow, 40, 22, 1.5);
  light.position.set(0, 3.8, z + 3.5);
  group.add(light);
  return { backWall, board };
}

/** The tiers: each an arc of floor stepped up from the one in front, out to the staircases; the top one runs back to the lounge. */
function addTiers(group: THREE.Group, layout: ControlRoomLayout) {
  const { tiers, screenWall: { focus }, crewLounge } = layout;
  const onArc = (r: number, a: number): Point => ({ x: focus.x + r * Math.sin(a), z: focus.z + r * Math.cos(a) });
  /** An arc of radius `r` from the left staircase to the right one. */
  const arc = (r: number, steps = 32) => {
    const span = Math.asin(STAIRS.x0 / r);
    return Array.from({ length: steps + 1 }, (_, i) => onArc(r, -span + (2 * span * i) / steps));
  };
  tiers.forEach((tier, t) => {
    const last = t === tiers.length - 1;
    const back = last ? [{ x: focus.x + STAIRS.x0, z: crewLounge.z0 }, { x: focus.x - STAIRS.x0, z: crewLounge.z0 }] : arc(tier.outer).reverse();
    group.add(tag(slab(flat([...arc(tier.inner), ...back]), tier.height, C.tierTop, C.tierSide), 'floor'));
    // A glow strip along the tier's front edge.
    const edge = arc(tier.inner + 0.02, 40).map((p) => new THREE.Vector3(p.x, tier.height + 0.012, p.z));
    group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edge), 80, 0.022, 6), glowing(C.glow)));
  });
  for (const side of [-1, 1]) addStaircase(group, layout, side);
}

/**
 * A staircase up one end of the tiers (`side` -1 left, 1 right), from the pit to the lounge: a
 * landing at each tier's height, a half step up to each, glow on the nosings and a handrail on the outside.
 */
function addStaircase(group: THREE.Group, layout: ControlRoomLayout, side: number) {
  const { tiers, crewLounge, screenWall: { focus } } = layout;
  const width = STAIRS.x1 - STAIRS.x0, x = focus.x + side * (STAIRS.x0 + STAIRS.x1) / 2;
  const fronts = [...tiers.map((t) => t.stairs), crewLounge.z0];
  // Treads from the first half step up to the lounge, each from one change of height to the next.
  const edges = fronts.flatMap((z) => [z - HALF_STEP, z]);
  const bottom = edges[0], top = crewLounge.z0;
  const stairs = part(tag(new THREE.Group(), 'floor'), 'staircase');
  for (let i = 0; i + 1 < edges.length; i++) {
    const z0 = edges[i], z1 = edges[i + 1], h = stairsHeightAt(layout, (z0 + z1) / 2);
    stairs.add(part(tag(at(box(width, h, z1 - z0, C.tierTop, { outline: 0.01 }), x, h / 2, (z0 + z1) / 2), 'floor'), 'steps'));
    stairs.add(at(new THREE.Mesh(new THREE.PlaneGeometry(width, 0.04), glowing(C.glow)), x, h + 0.003, z0 + 0.03).rotateX(-Math.PI / 2));
  }
  group.add(stairs);
  // A handrail on the outer side, on posts that follow the steps up.
  const rail = tag(new THREE.Group(), 'handrail');
  const railX = focus.x + side * (STAIRS.x1 + 0.06);
  const posts = Math.ceil((top - bottom) / 1.4) + 1;
  const zs = Array.from({ length: posts }, (_, k) => bottom + 0.1 + ((top - bottom - 0.2) * k) / (posts - 1));
  const tops = zs.map((z) => new THREE.Vector3(railX, stairsHeightAt(layout, z) + 0.9, z));
  for (const top of tops) rail.add(at(cyl(0.03, 0.03, 0.9, C.frame, { outline: 0 }), top.x, top.y - 0.45, top.z));
  tops.slice(1).forEach((to, k) => {
    const from = tops[k];
    const bar = cyl(0.04, 0.04, from.distanceTo(to), C.rail, { outline: 0.03 });
    bar.position.copy(from).add(to).multiplyScalar(0.5);
    bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    rail.add(bar);
  });
  group.add(rail);
}

/** A lit sign: `text` on a dark plate (a plain glow where there's no canvas). */
function sign(text: string, w: number, color: string) {
  const drawn = newCanvas(256, 64);
  const material = new THREE.MeshBasicMaterial({ color });
  if (drawn) {
    const { canvas, g } = drawn;
    g.fillStyle = '#152246';
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = color;
    g.font = '800 36px Nunito, Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 128, 34);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    Object.assign(material, { map: texture, color: new THREE.Color('#FFFFFF') });
  }
  return part(new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), material), 'sign');
}

/** A door frame in a side wall (its posts either side of `width`), facing into the room along +x. */
function doorFrame(width: number) {
  const frame = new THREE.Group();
  for (const s of [-1, 1]) frame.add(at(box(0.4, 2.7, 0.22, C.frame, { outline: 0.02 }), 0, 1.35, s * (width / 2 + 0.11)));
  frame.add(at(box(0.4, 0.26, width + 0.66, C.frame, { outline: 0.02 }), 0, 2.83, 0));
  return frame;
}

/** The entrance: double doors in the left wall, beside the pit, under a lit sign, with a mat inside. */
function addEntrance(group: THREE.Group, { room, door }: ControlRoomLayout) {
  const entrance = part(tag(doorFrame(DOOR.width), 'door'), 'entrance');
  entrance.add(turned(at(sign('IN · OUT', 1.2, '#5BD68A'), 0.21, 2.83, 0), Math.PI / 2));
  const doors = new EntranceDoors(entrance);
  group.add(at(entrance, room.left - 0.15, 0, door.z));
  group.add(tag(at(box(1.1, 0.02, 1.5, '#5BA37A', { outline: 0, shadow: false }), room.left + 0.65, 0.01, door.z), 'rug'));
  return doors;
}

/** The open side door in the right wall, out to the deck, with its sign and a step across to the deck. */
function addSideDoor(group: THREE.Group, { room, sideDoor, deck }: ControlRoomLayout) {
  const door = part(tag(doorFrame(1.4), 'door'), 'side-door');
  door.add(turned(at(sign('DECK →', 1.2, '#FFB648'), -0.21, 2.83, 0), -Math.PI / 2));
  group.add(at(door, sideDoor.x, 0, sideDoor.z));
  group.add(tag(at(box(deck.x0 - room.right + 0.6, 0.03, 1.4, '#F07A4A', { outline: 0, shadow: false }), (room.right + deck.x0) / 2, 0.015, sideDoor.z), 'rug'));
}

/** The crew lounge: a raised mezzanine with a glass rail over the pit, warm floor and light, kitchen, cooler, bookshelf, sofa and TV. */
function addCrewLounge(group: THREE.Group, layout: ControlRoomLayout) {
  const { crewLounge: area, rail: railLines } = layout;
  const width = area.x1 - area.x0, depth = area.z1 - area.z0, h = area.height;
  const centre = { x: (area.x0 + area.x1) / 2, z: (area.z0 + area.z1) / 2 };
  group.add(part(tag(at(box(width, h, depth, C.loungeSide, { outline: 0, shadow: false }), centre.x, h / 2, centre.z), 'floor'), 'crew-lounge'));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshToonMaterial({ map: plankTexture(width / 2.4, depth / 1.2), gradientMap: toonRamp }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(tag(at(floor, centre.x, h + 0.005, centre.z), 'floor'));
  group.add(at(new THREE.Mesh(new THREE.PlaneGeometry(width, 0.05), glowing('#FFC98A')), centre.x, h - 0.1, area.z0 - 0.005));

  for (const [a, b] of railLines) {
    const rail = tag(new THREE.Group(), 'glass-rail');
    const len = b.x - a.x;
    rail.add(at(new THREE.Mesh(new THREE.BoxGeometry(len, 0.9, 0.04), glass), 0, 0.45, 0));
    rail.add(at(box(len, 0.06, 0.1, C.rail, { outline: 0.02 }), 0, 0.93, 0));
    for (let x = -len / 2 + 0.05; x <= len / 2; x += Math.max(len / Math.ceil(len / 1.6), 0.1)) rail.add(at(box(0.05, 0.9, 0.05, C.frame, { outline: 0 }), x, 0.45, 0));
    group.add(at(rail, (a.x + b.x) / 2, h, a.z + 0.03));
  }

  const lounge = tag(at(new THREE.Group(), 0, h, 0), 'lounge');
  const tv = addLounge(lounge, layout, -1);
  // Lower than classic's wall-mounted TV: it stands on a unit, and keeps the view of the sofa open.
  lounge.traverse((o) => { if (o.userData.kind === 'tv') o.position.y = TV_DROP; });
  const stand = tag(new THREE.Group(), 'media-unit');
  stand.add(at(box(layout.lounge.tv.w + 0.3, 0.5, 0.42, '#8C6A4A'), 0, 0.25, 0));
  for (const dx of [-0.7, 0, 0.7]) stand.add(at(box(0.6, 0.3, 0.02, '#A37E58', { outline: 0 }), dx, 0.25, -0.22));
  lounge.add(at(stand, layout.lounge.tv.x, 0, layout.lounge.tv.z + 0.05));

  // The kitchen faces into the room (-z): classic's counter, mirrored front to back.
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

  // Warm floor lamps, and the lounge's own warm light.
  for (const [x, u] of [[1.0, 5.7], [-9.4, 5.6]]) {
    const lamp = tag(new THREE.Group(), 'lamp');
    lamp.add(at(cyl(0.2, 0.22, 0.04, C.bezel, { outline: 0.02 }), 0, 0.02, 0));
    lamp.add(at(cyl(0.025, 0.025, 1.5, C.bezel, { outline: 0 }), 0, 0.77, 0));
    const shade = at(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.3, 20, 1, true), new THREE.MeshBasicMaterial({ color: '#FFD9A0', side: THREE.DoubleSide })), 0, 1.6, 0);
    lamp.add(shade);
    lounge.add(at(lamp, x, 0, area.z0 + u));
  }
  const warm = new THREE.PointLight('#FFC98A', 45, 20, 1.4);
  warm.position.set(0, 4, centre.z);
  lounge.add(warm);
  group.add(lounge);
  return { lounge, tv };
}

/** Warm floorboards, staggered, generated as pixels (no canvas needed); one tile is 2.4 × 1.2 m, four boards across. */
function plankTexture(repeatX: number, repeatY: number) {
  const w = 64, h = 32, data = new Uint8Array(w * h * 4);
  const shades = [[0xd9, 0xa8, 0x77], [0xd2, 0x9f, 0x6c], [0xdd, 0xb0, 0x80], [0xcf, 0x9c, 0x6a]];
  for (let y = 0; y < h; y++) {
    const board = Math.floor(y / 8), seamX = board % 2 ? 16 : 48;
    for (let x = 0; x < w; x++) {
      const seam = y % 8 === 0 || x === seamX;
      data.set([...(seam ? [0xa8, 0x7a, 0x50] : shades[(board + (x > seamX ? 1 : 0)) % 4]), 255], (y * w + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

const EARTH_DEPTH = 1.0;
/** Classic's TV hangs with its bottom at 0.95 m; here it sits on a 0.5 m unit. */
const TV_DROP = -0.44;
const GRASS_DEPTH = 0.1;
const LAKE_DEPTH = 0.6;
const WATER_Y = -0.05;

/**
 * The lake's shore: a winding line from the deck's right edge round the fish's water to its front
 * edge, so the lake runs off the deck's front-right corner and is cut off square on both edges.
 */
function lakeShore({ deck, props: { pond } }: ControlRoomLayout): Point[] {
  const { x, z, rx, rz } = pond;
  const knots: Point[] = [
    { x: deck.x1, z: z - rz - 1.0 }, { x: x + rx - 0.4, z: z - rz - 1.35 }, { x: x + 0.3, z: z - rz - 0.95 },
    { x: x - rx + 0.3, z: z - rz - 1.25 }, { x: x - rx - 0.6, z: z - rz - 0.4 }, { x: x - rx - 0.85, z: z + 0.2 },
    { x: x - rx - 0.6, z: z + rz - 0.1 }, { x: x - rx - 0.95, z: deck.z1 },
  ];
  return new THREE.SplineCurve(knots.map((p) => new THREE.Vector2(p.x, p.z))).getPoints(64).map((p) => ({ x: p.x, z: p.y }));
}

/** The deck: a block of grass over earth outside the side door, boards by the house, stepping stones, and the lake. */
function addDeck(group: THREE.Group, layout: ControlRoomLayout) {
  const { deck: area, props: { pool } } = layout;
  const deck = tag(new THREE.Group(), 'deck');
  const shore = lakeShore(layout);
  const outline = flat([{ x: area.x0, z: area.z0 }, { x: area.x1, z: area.z0 }, ...shore, { x: area.x0, z: area.z1 }]);
  const [hx, hz] = [pool.w / 2 - POOL_RIM, pool.d / 2 - POOL_RIM];
  outline.holes.push(new THREE.Path(flat([
    { x: pool.x - hx, z: pool.z - hz }, { x: pool.x - hx, z: pool.z + hz }, { x: pool.x + hx, z: pool.z + hz }, { x: pool.x + hx, z: pool.z - hz },
  ]).getPoints()));
  deck.add(tag(at(slab(outline, GRASS_DEPTH, C.grass, C.grassSide), 0, -GRASS_DEPTH, 0), 'floor'));
  deck.add(at(slab(outline, EARTH_DEPTH - GRASS_DEPTH, C.earth, C.earth), 0, -EARTH_DEPTH, 0));

  // Boards along the house, from the side door.
  const boardsX1 = 13.4;
  deck.add(tag(at(box(boardsX1 - area.x0, 0.02, area.z1 - area.z0, C.boards, { outline: 0, shadow: false }), (area.x0 + boardsX1) / 2, 0.01, (area.z0 + area.z1) / 2), 'floor'));
  for (let z = area.z0 + 0.3; z < area.z1; z += 0.5) deck.add(at(box(boardsX1 - area.x0, 0.004, 0.025, '#B98F63', { outline: 0, shadow: false }), (area.x0 + boardsX1) / 2, 0.022, z));
  // Stepping stones along the paths across the grass.
  for (const path of layout.walkways.filter((w) => w.every((p) => p.x > area.x0))) {
    for (let i = 0; i + 1 < path.length; i++) {
      const [a, b] = [path[i], path[i + 1]];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      for (let d = 0.35; d < len; d += 0.7) {
        const p = { x: a.x + ((b.x - a.x) * d) / len, z: a.z + ((b.z - a.z) * d) / len };
        if (p.x < boardsX1 + 0.3) continue; // on the boards already
        const stone = cyl(0.24, 0.26, 0.03, C.stone, { outline: 0.03, shadow: false }, 10);
        stone.rotation.y = d;
        deck.add(at(stone, p.x, 0.015, p.z));
      }
    }
  }
  deck.add(buildLake(shore, area));
  group.add(deck);
  return deck;
}

/** The lake inside `shore` and the deck's front-right corner, ending at the deck's edges in a deep-blue cut face, like a diorama. */
function buildLake(shore: Point[], deck: Area) {
  const lake = tag(new THREE.Group(), 'lake');
  const outline = [...shore, { x: deck.x1, z: deck.z1 }];
  lake.userData.shore = outline;
  const shape = flat(outline);
  const bed = new THREE.Mesh(new THREE.ShapeGeometry(shape), toon(C.lakeBed));
  bed.rotation.x = -Math.PI / 2;
  lake.add(at(bed, 0, -LAKE_DEPTH, 0));
  lake.add(at(slab(shape, EARTH_DEPTH - LAKE_DEPTH, C.earth, C.earth), 0, -EARTH_DEPTH, 0));
  lake.add(at(waterSurface(new THREE.ShapeGeometry(shape), C.lake), 0, WATER_Y, 0));
  // The cut faces, a hair proud of the deck's sides, each with a pale line where the water meets the cut.
  const height = LAKE_DEPTH + WATER_Y, y = (WATER_Y - LAKE_DEPTH) / 2;
  const [frontX0, rightZ0] = [shore.at(-1)!.x, shore[0].z];
  const frontW = deck.x1 - frontX0, rightD = deck.z1 - rightZ0;
  lake.add(part(at(box(frontW, height, 0.02, C.lakeCut, { outline: 0, shadow: false }), (frontX0 + deck.x1) / 2, y, deck.z1 + 0.01), 'cut-face'));
  lake.add(part(at(box(0.02, height, rightD, C.lakeCut, { outline: 0, shadow: false }), deck.x1 + 0.01, y, (rightZ0 + deck.z1) / 2), 'cut-face'));
  lake.add(at(box(frontW, 0.03, 0.03, '#BFE6F5', { outline: 0, shadow: false }), (frontX0 + deck.x1) / 2, WATER_Y, deck.z1 + 0.015));
  lake.add(at(box(0.03, 0.03, rightD, '#BFE6F5', { outline: 0, shadow: false }), deck.x1 + 0.015, WATER_Y, (rightZ0 + deck.z1) / 2));
  // Reeds in clumps near the shore.
  const reedAt = [0.12, 0.3, 0.55, 0.8].map((k) => shore[Math.round(k * (shore.length - 1))]);
  const middle = shore.reduce((s, p) => ({ x: s.x + p.x / shore.length, z: s.z + p.z / shore.length }), { x: 0, z: 0 });
  for (const p of reedAt) {
    const q = { x: p.x + (middle.x - p.x) * 0.12, z: p.z + (middle.z - p.z) * 0.12 };
    for (let k = 0; k < 3; k++) lake.add(at(cyl(0.02, 0.03, 0.6 + 0.15 * k, '#5BA37A', { outline: 0, shadow: false }, 6), q.x + (k - 1) * 0.1, WATER_Y + 0.3, q.z + (k % 2) * 0.08));
  }
  return lake;
}

/** The break-room props from the plan: lounge ones on the lounge floor, the rest on the deck (the lake replaces the pond). */
function addProps(layout: ControlRoomLayout, lounge: THREE.Group, deck: THREE.Group) {
  const all = new THREE.Group();
  addSoloProps(all, layout.props, { pond: false });
  addGameTables(all, layout.props);
  addPool(all, layout.props);
  addPetCorner(all, layout.props);
  for (const child of [...all.children]) (child.position.x > layout.room.right ? deck : lounge).add(child);
}

/** A console facing +z (towards the screens), its sitter on the -z side; `light` shows its agent's state. */
function buildConsole(light: StatusLight) {
  const desk = tag(new THREE.Group(), 'console');
  desk.add(at(box(1.36, 0.72, 0.42, C.console), 0, 0.36, 0.1));
  // The top tapers towards the sitter, so neighbours on the curve sit snug.
  const top = new THREE.ExtrudeGeometry(flat([{ x: -0.74, z: 0.36 }, { x: 0.74, z: 0.36 }, { x: 0.56, z: -0.3 }, { x: -0.56, z: -0.3 }]), { depth: 0.06, bevelEnabled: false });
  top.rotateX(-Math.PI / 2);
  desk.add(at(mesh(top, C.consoleTop, { outline: 0.02 }), 0, 0.72, 0));
  desk.add(at(box(1.3, 0.04, 0.02, C.bezel, { outline: 0, shadow: false }), 0, 0.6, 0.32));
  desk.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.03, 0.02), light.material), 0, 0.6, 0.335));
  desk.add(part(at(box(0.5, 0.03, 0.16, '#F4EEE2', { outline: 0.03 }), 0, 0.795, -0.14), 'keyboard'));
  desk.add(part(at(box(0.12, 0.03, 0.16, '#F4EEE2', { outline: 0.04 }), 0.4, 0.795, -0.12), 'mouse'));
  // Two small side monitors, turned in towards the sitter.
  for (const s of [-1, 1]) {
    const monitor = at(new THREE.Group(), s * 0.6, 0, 0.12);
    monitor.add(at(box(0.04, 0.2, 0.04, C.bezel, { outline: 0 }), 0, 0.88, 0.02));
    monitor.add(at(box(0.32, 0.24, 0.04, C.bezel, { outline: 0.02 }), 0, 1.08, 0));
    const face = at(new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.19), glowing('#2E5A96')), 0, 1.08, -0.025);
    face.rotation.y = Math.PI;
    monitor.add(face);
    desk.add(turned(monitor, s * 0.45));
  }
  // The status light: a beacon on a post at the sitter's right-hand corner.
  desk.add(at(cyl(0.02, 0.02, 0.5, C.bezel, { outline: 0 }), -0.48, 1.03, -0.24));
  const beacon = tag(at(new THREE.Mesh(new THREE.SphereGeometry(0.065, 16, 12), light.material), -0.48, 1.3, -0.24), 'status-light');
  const halo = new THREE.Sprite(light.halo);
  halo.scale.set(0.5, 0.5, 1);
  beacon.add(halo);
  desk.add(beacon);
  return desk;
}

/** Each seat's console, chair and monitor, on its tier. */
function addConsoles(group: THREE.Group, layout: ControlRoomLayout): Seat[] {
  const rows = layout.tiers.map(() => tag(new THREE.Group(), 'desk-row'));
  group.add(...rows);
  return layout.seats.map((spot) => {
    const row = rows[spot.row], y = layout.tiers[spot.row].height;
    const light = new StatusLight();
    row.add(turned(at(buildConsole(light), spot.desk.x, y, spot.desk.z), spot.yaw));
    const chair = turned(at(buildChair(), spot.chair.x, y, spot.chair.z), spot.yaw);
    row.add(chair);
    const screen = new DeskScreen(spot.desk, spot.yaw);
    screen.root.position.y = y;
    row.add(screen.root);
    return { ...spot, screen, light, swivel: chair };
  });
}

