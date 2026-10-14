import * as THREE from 'three';
import { Character } from '../character.ts';
import { Dog } from '../dog.ts';
import { bubbleTexture } from '../bubbles.ts';
import { screenColor } from '../poses.ts';
import { at, box, cyl, mesh } from '../toon.ts';
import type { BubbleKind } from '../poses.ts';
import type { OfficeState } from '../../shared/agent.ts';
import type { Mood } from './mood.ts';

export type PetKind = 'worker' | 'dog';

/** The office state the worker acts out for each mood: typing, waving, sipping a coffee, or slumped asleep. */
const WORKER_STATE: Record<Mood, OfficeState> = { working: 'working', needs: 'needs', idle: 'done', offline: 'stale' };
const DOG_BUBBLE: Record<Mood, BubbleKind | null> = { working: 'working', needs: 'needs', idle: null, offline: 'stale' };
const WORKER_LOOK = { shirt: '#4D86FF', hat: 'headphones' as const, hatColor: '#3A3150', skin: '#F6CFA8' };
const DOG_SCALE = 2.3;
/** A small screen-space margin around the character, in CSS pixels, so the edges are easy to grab. */
const HIT_MARGIN = 6;

export interface PetScene {
  setMood(mood: Mood): void;
  /** The office's little icon bubble (cog, !, zz) over the character; hidden while the speech bubble has words up. */
  showIcon(show: boolean): void;
  /** A little hop, when something new comes in. */
  hop(): void;
  /** Where the character is drawn, in CSS pixels from the canvas's top left (to know what's clickable). */
  bounds(): { x: number; y: number; width: number; height: number } | null;
  dispose(): void;
}

/** One office character on a see-through canvas: the worker at a little desk, or the office dog. */
export function createPetScene(host: HTMLElement, kind: PetKind): PetScene {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, premultipliedAlpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#FFF1DC', '#5A4E7A', 0.75 * Math.PI));
  const sun = new THREE.DirectionalLight('#FFF4E2', 0.7 * Math.PI);
  sun.position.set(3, 6, 5);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
  const actor = new THREE.Group();
  scene.add(actor);
  actor.add(groundShadow(kind === 'dog' ? 0.75 : 0.85));

  let mood: Mood = 'idle';
  let hopFor = 0;
  let iconShown = true;
  let worker: Character | null = null;
  let laptopGlow: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial> | null = null;
  let dog: Dog | null = null;
  let dogBubble: THREE.Sprite | null = null;

  if (kind === 'worker') {
    worker = new Character(WORKER_LOOK);
    const seat = { index: 0, row: 0, desk: { x: 0, z: 0.74 }, chair: { x: 0, z: 0 }, yaw: 0, sit: { x: 0, z: 0 }, approach: { x: 0, z: -0.5 }, standSpot: { x: 0, z: -0.5 }, link: [] };
    worker.sitAt(seat, WORKER_STATE[mood]);
    const desk = littleDesk();
    laptopGlow = desk.glow;
    actor.add(chair(), worker.root, desk.root);
    // The desk sits between the worker and you: the camera looks over it from the front.
    camera.position.set(2.4, 3.6, 8.2);
    camera.lookAt(0, 1.6, 0.35);
  } else {
    dog = new Dog();
    dog.root.scale.setScalar(DOG_SCALE);
    dog.root.rotation.y = 0.5; // three-quarter on, looking out at you
    dog.placeAt({ x: 0, z: 0 }, true);
    dogBubble = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
    dogBubble.center.set(0.5, 0);
    dogBubble.scale.set(0.72, 0.72, 1);
    dogBubble.renderOrder = 10;
    actor.add(dog.root, dogBubble);
    camera.position.set(1.3, 2.4, 6.3);
    camera.lookAt(0, 1.05, 0);
  }

  function resize() {
    const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    renderer.domElement.style.width = `${width}px`;
    renderer.domElement.style.height = `${height}px`;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(host);
  resize();

  const clock = new THREE.Clock();
  let frame = 0;
  function tick() {
    frame = requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.1), t = clock.elapsedTime;
    hopFor = Math.max(0, hopFor - dt);
    const hopY = hopFor > 0 ? Math.sin((1 - hopFor / 0.5) * Math.PI) * 0.25 : 0;
    actor.position.y = hopY;
    if (worker) {
      worker.update(t, dt);
      worker.bubble.visible &&= iconShown;
      laptopGlow!.material.color.set(screenColor(WORKER_STATE[mood]));
    }
    if (dog && dogBubble) {
      dog.lying = mood === 'idle' || mood === 'offline';
      dog.trotting = mood === 'working';
      dog.update(t, dt);
      // Asking: up on its hind legs every so often, tail going.
      dog.root.position.y = mood === 'needs' ? Math.abs(Math.sin(t * 5)) * 0.12 : 0;
      const kindNow = DOG_BUBBLE[mood], texture = kindNow && bubbleTexture(kindNow);
      dogBubble.visible = !!texture && iconShown;
      if (texture) {
        dogBubble.material.map = texture;
        dogBubble.material.needsUpdate = true;
        dogBubble.position.set(0.35, (dog.lying ? 1.25 : 1.6) + (mood === 'needs' ? Math.abs(Math.sin(t * 3.2)) * 0.1 : 0), 0.2);
      }
    }
    renderer.render(scene, camera);
  }
  tick();

  const box3 = new THREE.Box3(), corner = new THREE.Vector3();
  return {
    setMood(next) {
      mood = next;
      worker?.setState(WORKER_STATE[mood]);
    },
    showIcon(show) {
      iconShown = show;
    },
    hop() {
      hopFor = 0.5;
    },
    bounds() {
      box3.setFromObject(actor);
      if (box3.isEmpty()) return null;
      const width = host.clientWidth, height = host.clientHeight;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < 8; i++) {
        corner.set(i & 1 ? box3.max.x : box3.min.x, i & 2 ? box3.max.y : box3.min.y, i & 4 ? box3.max.z : box3.min.z).project(camera);
        const sx = ((corner.x + 1) / 2) * width, sy = ((1 - corner.y) / 2) * height;
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
      }
      x0 = Math.max(0, x0 - HIT_MARGIN); y0 = Math.max(0, y0 - HIT_MARGIN);
      x1 = Math.min(width, x1 + HIT_MARGIN); y1 = Math.min(height, y1 + HIT_MARGIN);
      return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
    },
    dispose() {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

/** A soft dark oval under the character, so it looks like it's standing on your desktop rather than floating. */
function groundShadow(radius: number) {
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 32),
    new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.18, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.005;
  shadow.scale.set(1.25, 1, 1);
  return shadow;
}

/** The office chair, its back behind the worker. */
function chair() {
  const g = new THREE.Group();
  g.add(at(cyl(0.3, 0.3, 0.09, '#6B5B95'), 0, 0.42, 0));
  g.add(at(box(0.55, 0.5, 0.09, '#6B5B95'), 0, 0.72, -0.3));
  g.add(at(cyl(0.04, 0.04, 0.38, '#3A3150', { outline: 0 }), 0, 0.2, 0));
  g.add(at(cyl(0.26, 0.26, 0.04, '#3A3150', { outline: 0.02 }), 0, 0.03, 0));
  return g;
}

/** A small desk with a laptop; the glowing strip on the lid shows what the worker's doing (blue busy, amber asking). */
function littleDesk() {
  const root = new THREE.Group();
  root.position.set(0, 0, 0.74);
  root.add(at(box(1.0, 0.07, 0.55, '#E9B872'), 0, 0.75, 0));
  for (const [lx, lz] of [[-0.44, -0.22], [0.44, -0.22], [-0.44, 0.22], [0.44, 0.22]]) {
    root.add(at(box(0.06, 0.72, 0.06, '#8C6A4A', { outline: 0.02 }), lx, 0.36, lz));
  }
  root.add(at(box(0.5, 0.03, 0.32, '#C9C0E3', { outline: 0.03 }), 0, 0.8, -0.04));
  // The lid stands up at the far edge, its back to you.
  const lid = mesh(new THREE.BoxGeometry(0.5, 0.34, 0.03), '#C9C0E3', { outline: 0.03 });
  lid.position.set(0, 0.97, 0.12);
  lid.rotation.x = 0.18;
  root.add(lid);
  const glow = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.005), new THREE.MeshBasicMaterial({ color: screenColor('done') }));
  glow.position.set(0, 0, 0.018);
  lid.add(glow);
  return { root, glow };
}
