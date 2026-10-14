// Seasonal themes (opt in): each one dresses the office and the agents for a time of year.
// Add a theme by adding an entry to THEMES with its decorations and costume.
import * as THREE from 'three';
import type { Look } from './look.ts';
import { at, ball, box, cyl } from './toon.ts';
import { WALL_HEIGHT } from './layout.ts';

export interface Theme {
  name: string;
  /** Props added to the office, given its floor bounds (the room is centred on x = 0). */
  decorate: (bounds: { left: number; right: number; back: number; front: number }, floorAt: (x: number, z: number) => number) => THREE.Object3D;
  /** What an agent wears, from its usual look and a stable number per agent. */
  costume: (look: Look, n: number) => Look;
  /** Agents carry a treat bucket on walks and hold it out when they visit a desk. */
  trickOrTreat?: boolean;
}

const KEY = 'agent-office.theme';
/** Half the width of the room itself (the deck sits beyond it), for both layouts. */
const ROOM_HALF = 8.5;

function jackOLantern(size = 1) {
  const g = new THREE.Group();
  const body = ball(0.28 * size, '#F07A1A', { outline: 0.06 });
  body.scale.y = 0.8;
  g.add(at(body, 0, 0.22 * size, 0));
  g.add(at(cyl(0.035 * size, 0.045 * size, 0.12 * size, '#4E7A2E'), 0, 0.48 * size, 0));
  // Glowing face on the front.
  const glow = (w: number, h: number, x: number, y: number) =>
    at(new THREE.Mesh(new THREE.BoxGeometry(w * size, h * size, 0.02), new THREE.MeshBasicMaterial({ color: '#FFD45A' })), x * size, y * size, 0.27 * size);
  g.add(glow(0.08, 0.06, -0.09, 0.28), glow(0.08, 0.06, 0.09, 0.28), glow(0.2, 0.05, 0, 0.15));
  return g;
}

function bat() {
  const g = new THREE.Group();
  g.add(ball(0.09, '#2A2233', { outline: 0.08 }));
  for (const side of [-1, 1]) {
    const wing = at(box(0.26, 0.02, 0.14, '#2A2233', { outline: 0.08 }), 0.16 * side, 0.02, 0);
    wing.rotation.z = 0.35 * side;
    g.add(wing);
  }
  for (const side of [-1, 1]) g.add(at(ball(0.018, '#FFD45A'), 0.035 * side, 0.03, 0.08));
  return g;
}

function ghost() {
  const g = new THREE.Group();
  g.add(at(ball(0.3, '#F4F1FA', { outline: 0.05 }), 0, 0.3, 0));
  g.add(at(cyl(0.3, 0.34, 0.35, '#F4F1FA', { outline: 0.05 }), 0, 0.1, 0));
  for (const side of [-1, 1]) g.add(at(ball(0.045, '#2A2233'), 0.1 * side, 0.36, 0.26));
  return g;
}

/** A string of bulbs along a line, alternating colours. */
function bulbs(from: THREE.Vector3, to: THREE.Vector3, count: number, colors: string[]) {
  const g = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const p = from.clone().lerp(to, i / (count - 1));
    p.y -= Math.sin((i / (count - 1)) * Math.PI * 6) ** 2 * 0.12;
    g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), new THREE.MeshBasicMaterial({ color: colors[i % colors.length] })), p.x, p.y, p.z));
  }
  return g;
}

const HALLOWEEN_SHIRTS = ['#F07A1A', '#6B3FA0', '#2A2233', '#5BA37A', '#8A2D3B'];
const WITCH_HATS = ['#2A2233', '#6B3FA0', '#2A2233', '#3B5B2E'];

export const THEMES: Record<string, Theme> = {
  halloween: {
    name: 'Halloween',
    trickOrTreat: true,
    decorate({ back, front }, floorAt) {
      const g = new THREE.Group();
      g.name = 'theme:halloween';
      // Jack-o'-lanterns along the front of the lounge and in the back corners.
      for (const x of [-1.6, 2.2, 8]) g.add(at(jackOLantern(1.6), x, floorAt(x, front - 1.3), front - 1.3));
      for (const x of [-ROOM_HALF + 0.8, ROOM_HALF - 0.8]) g.add(at(jackOLantern(1.8), x, floorAt(x, back + 0.9), back + 0.9));
      // Orange and purple lights along the top of the back wall.
      g.add(bulbs(new THREE.Vector3(-ROOM_HALF, WALL_HEIGHT - 0.15, back + 0.25), new THREE.Vector3(ROOM_HALF, WALL_HEIGHT - 0.15, back + 0.25), 31, ['#FF8A1F', '#9B5CFF']));
      // Bats over the room and a ghost drifting above the lounge.
      [[-5, 3.6, back + 2], [-1.5, 4.1, back + 1], [2.5, 3.8, back + 2.5], [6, 4.3, back + 1.5], [-3, 3.9, back + 4]].forEach(([x, y, z], i) => {
        const b = at(bat(), x, y, z);
        b.scale.setScalar(2);
        b.rotation.y = i * 0.7;
        b.userData.flap = i;
        g.add(b);
      });
      const spook = at(ghost(), 5.5, floorAt(5.5, front - 2.5) + 2.2, front - 2.5);
      spook.userData.baseY = spook.position.y;
      spook.scale.setScalar(1.4);
      spook.userData.drift = true;
      g.add(spook);
      return g;
    },
    costume(look, n) {
      if (look.hat === 'crown') return { ...look, shirt: '#6B3FA0' };
      return { ...look, shirt: HALLOWEEN_SHIRTS[n % HALLOWEEN_SHIRTS.length], hat: 'witch', hatColor: WITCH_HATS[(n >>> 3) % WITCH_HATS.length] };
    },
  },
};

/** Bats flap and the ghost bobs; call every frame with the scene clock. */
export function animateTheme(root: THREE.Object3D, t: number) {
  root.traverse((o) => {
    if (o.userData.flap !== undefined) {
      const k = Math.sin(t * 9 + o.userData.flap) * 0.5;
      o.children.forEach((c, i) => { if (i === 1 || i === 2) c.rotation.z = (i === 1 ? -1 : 1) * (0.35 + k); });
      o.position.y += Math.sin(t * 2 + o.userData.flap) * 0.002;
    }
    if (o.userData.drift) o.position.y = o.userData.baseY + Math.sin(t * 1.3) * 0.2;
  });
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): Store | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

/** The theme picked last time, or null (no theme, the default). */
export function savedTheme(storage = browserStorage()): string | null {
  try {
    const id = storage?.getItem(KEY);
    return id && THEMES[id] ? id : null;
  } catch {
    return null;
  }
}

/** Fills `host` with Off plus a button per theme; picking one saves it and calls `onPick`. */
export function bindThemePicker(host: HTMLElement, onPick: (id: string | null) => void, storage = browserStorage()) {
  let current = savedTheme(storage);
  const options: [string | null, string][] = [[null, 'No theme'], ...Object.entries(THEMES).map(([id, t]) => [id, t.name] as [string, string])];
  const buttons = options.map(([id, name]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.textContent = name;
    button.addEventListener('click', () => {
      if (id === current) return;
      current = id;
      try {
        storage?.setItem(KEY, id ?? '');
      } catch {
        // Storage blocked: the choice lasts until reload.
      }
      mark();
      onPick(id);
    });
    return button;
  });
  const mark = () => buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i][0] === current)));
  mark();
  host.replaceChildren(...buttons);
  return current;
}
