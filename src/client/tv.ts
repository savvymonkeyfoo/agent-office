// The lounge TV (#61): switched on and off with a remote by whoever's on the sofa (#113); when on, a looping top-down arena match in a
// generic MOBA style (no real game's names, logos or characters): three lanes between two bases,
// minion waves marching down them, a few champion markers trading blows, and hit flashes.
import * as THREE from 'three';
import { newCanvas } from './screen.ts';

export const TV_CANVAS = { width: 320, height: 150 };
export const TV_OFF = '#15121F';

type Team = 'blue' | 'red';
interface Dot { x: number; y: number; team: Team }
export interface GameFrame { minions: Dot[]; champions: Dot[]; flashes: { x: number; y: number; r: number }[] }

type P = [number, number];
/** Lanes in unit coordinates, from the blue base (bottom left) to the red one (top right). */
const BLUE_BASE: P = [0.08, 0.9], RED_BASE: P = [0.92, 0.1];
const LANES: P[][] = [
  [BLUE_BASE, [0.08, 0.1], RED_BASE],
  [BLUE_BASE, RED_BASE],
  [BLUE_BASE, [0.92, 0.9], RED_BASE],
];
/** A wave leaves each base every WAVE seconds and meets the other at the lane's middle MARCH seconds later. */
const WAVE = 6;
const MARCH = 5;
const FLASH = 0.4;

function along(lane: P[], k: number): P {
  const lengths = lane.slice(1).map((p, i) => Math.hypot(p[0] - lane[i][0], p[1] - lane[i][1]));
  let d = k * lengths.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lengths.length; i++) {
    if (d <= lengths[i] || i === lengths.length - 1) {
      const f = Math.min(1, d / lengths[i]);
      return [lane[i][0] + (lane[i + 1][0] - lane[i][0]) * f, lane[i][1] + (lane[i + 1][1] - lane[i][1]) * f];
    }
    d -= lengths[i];
  }
  return lane[0];
}

/** What's on the map `t` seconds into the loop. */
export function gameFrame(t: number): GameFrame {
  const minions: Dot[] = [], champions: Dot[] = [], flashes: GameFrame['flashes'] = [];
  const since = ((t % WAVE) + WAVE) % WAVE;
  LANES.forEach((lane, l) => {
    for (const team of ['blue', 'red'] as Team[]) {
      for (let m = 0; m < 3 && since < MARCH; m++) {
        const k = Math.max(0, since / MARCH - m * 0.03) * 0.5;
        const [x, y] = along(lane, team === 'blue' ? k : 1 - k);
        minions.push({ x, y, team });
      }
      // Two champions a side roam the top and middle lanes, edging back and forth around the middle.
      if (l < 2) {
        const sway = 0.08 * Math.sin(t * (0.7 + l * 0.3) + (team === 'blue' ? 0 : 1.7));
        const [x, y] = along(lane, (team === 'blue' ? 0.42 : 0.58) + sway);
        champions.push({ x, y, team });
      }
    }
    if (since >= MARCH && since < MARCH + FLASH) {
      const [x, y] = along(lane, 0.5);
      flashes.push({ x, y, r: 0.03 + 0.05 * ((since - MARCH) / FLASH) });
    }
  });
  return { minions, champions, flashes };
}

const COLORS: Record<Team, string> = { blue: '#4D86FF', red: '#FF5A5A' };

/** Paints the match `t` seconds in. Shapes only: no text. */
export function paintGame(g: CanvasRenderingContext2D, t: number) {
  const { width: w, height: h } = TV_CANVAS;
  const at = ([x, y]: P): P => [x * w, y * h];
  g.fillStyle = '#2E5E3A';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#C9B98A';
  g.lineWidth = 8;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const lane of LANES) {
    g.beginPath();
    lane.map(at).forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
  }
  const dot = (p: P, r: number, fill: string) => { g.fillStyle = fill; g.beginPath(); g.arc(...at(p), r, 0, Math.PI * 2); g.fill(); };
  dot(BLUE_BASE, 14, COLORS.blue);
  dot(RED_BASE, 14, COLORS.red);
  const frame = gameFrame(t);
  for (const m of frame.minions) dot([m.x, m.y], 2.5, COLORS[m.team]);
  for (const c of frame.champions) { dot([c.x, c.y], 6, '#FFF8EC'); dot([c.x, c.y], 4.5, COLORS[c.team]); }
  for (const f of frame.flashes) dot([f.x, f.y], f.r * w * 0.3, 'rgba(255, 248, 236, 0.8)');
}

/** The TV's screen: dark when off; the animated match when on. */
export class LoungeTv {
  on: boolean | null = null;
  private texture: THREE.CanvasTexture | null = null;
  private g: CanvasRenderingContext2D | null = null;

  constructor(readonly screen: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>) {
    const drawn = newCanvas(TV_CANVAS.width, TV_CANVAS.height);
    if (drawn) {
      this.g = drawn.g;
      this.texture = new THREE.CanvasTexture(drawn.canvas);
      this.texture.colorSpace = THREE.SRGBColorSpace;
    }
    this.update(false, 0);
  }

  /** Call every frame with whether the TV is switched on. */
  update(on: boolean, t: number) {
    const material = this.screen.material;
    if (on !== this.on) {
      this.on = on;
      material.map = on ? this.texture : null;
      material.color.set(on ? '#FFFFFF' : TV_OFF);
      material.needsUpdate = true;
    }
    if (on && this.g) {
      paintGame(this.g, t);
      this.texture!.needsUpdate = true;
    }
  }
}

/** Someone who can work the TV's remote (a Character). */
export interface RemoteUser {
  usingRemote(): boolean;
  useRemote(click: () => void): void;
}

/** Who works the remote (#113): the first to sit on the empty sofa switches the TV on, the last to get up switches it off. */
export class SofaRemote {
  on = false;

  /** Every frame, with everyone sitting on the sofa. */
  update(sitters: RemoteUser[]) {
    if (this.on || !sitters.length || sitters.some((c) => c.usingRemote())) return;
    sitters[0].useRemote(() => { this.on = true; });
  }

  /** `c` is about to get up (call before it walks off): the last one on the sofa switches the TV off first. */
  gettingUp(c: RemoteUser, sitters: RemoteUser[]) {
    if (sitters.length !== 1 || sitters[0] !== c) return;
    if (this.on || c.usingRemote()) c.useRemote(() => { this.on = false; });
  }
}
