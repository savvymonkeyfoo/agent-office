// See-through water for the pool and the pond (#63): a semi-transparent surface with drifting
// highlights over a sunken bottom, and a couple of fish in the pond.
import * as THREE from 'three';
import { BREAK_ROOM, type Props } from './layout.ts';
import { at, ball, mesh, part } from './toon.ts';

export const WATER_OPACITY = 0.6;
/** How deep the pool and pond go below the deck. */
export const POOL_DEPTH = 0.8;
export const POND_DEPTH = 0.4;

/** Light streaks on blue, generated as pixels (no canvas needed); every surface shares it and its drift. */
const shimmer = (() => {
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const streak = Math.max(0, Math.sin((x + Math.sin(y / 6) * 5) / 4)) ** 12;
      const v = 200 + streak * 55;
      data.set([v, v, 255, 255], (y * size + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
})();

/** Drifts the highlights; call every frame. */
export function updateWater(t: number) {
  shimmer.offset.set(t * 0.02, Math.sin(t * 0.3) * 0.05);
}

/** A flat water surface over `geometry` (lying in the xy plane): see-through, drawn after the solid things in and under it. */
export function waterSurface(geometry: THREE.BufferGeometry, color: string) {
  const surface = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color, map: shimmer, transparent: true, opacity: WATER_OPACITY, depthWrite: false, side: THREE.DoubleSide,
  }));
  surface.rotation.x = -Math.PI / 2;
  surface.renderOrder = 1;
  surface.userData.part = 'water';
  return surface;
}

export const FISH = 2;

/** Where fish `i` is `t` seconds in: a slow loop well inside `pond`, a little below the surface. */
export function fishAt(i: number, t: number, pond: Props['pond'] = BREAK_ROOM.pond) {
  const w = 0.12 + i * 0.03, phase = i * 2.1;
  const pos = (s: number) => ({
    x: pond.x + 0.62 * pond.rx * Math.sin(w * s + phase),
    z: pond.z + 0.55 * pond.rz * Math.sin(2 * w * s + phase * 0.5),
  });
  const p = pos(t), ahead = pos(t + 0.05);
  return { ...p, y: -0.15 - i * 0.05, heading: Math.atan2(ahead.x - p.x, ahead.z - p.z) };
}

const FIN_THICKNESS = 0.012;
const fishLook = { outline: 0.06, shadow: false };

/** A thin upright fin from an outline drawn as (z along the fish, y up). */
function finGeometry(outline: [number, number][]) {
  const geometry = new THREE.ExtrudeGeometry(new THREE.Shape(outline.map(([z, y]) => new THREE.Vector2(z, y))), { depth: FIN_THICKNESS, bevelEnabled: false });
  geometry.translate(0, 0, -FIN_THICKNESS / 2);
  return geometry.rotateY(-Math.PI / 2);
}

/** A body fat behind the head and tapering to the tail: a lathe around z, squeezed side to side. */
function fishBody() {
  const profile: [number, number][] = [[0, -0.12], [0.022, -0.11], [0.045, -0.06], [0.068, 0], [0.074, 0.045], [0.064, 0.1], [0.038, 0.14], [0, 0.16]];
  const geometry = new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r, z)), 20).rotateX(Math.PI / 2);
  return geometry.scale(0.72, 1, 1);
}

/** A chunky toon fish (#108), 0.36 m nose to tail tip, nose along +z; its tail swings on `userData.tail`. */
function fishModel(color: string) {
  const fish = new THREE.Group();
  fish.add(part(mesh(fishBody(), color, fishLook), 'fish-body'));
  fish.add(at(part(mesh(finGeometry([[0.05, 0], [-0.05, 0], [-0.06, 0.055], [-0.01, 0.045]]), color, fishLook), 'fish-dorsal'), 0, 0.058, 0));
  const tail = at(new THREE.Group(), 0, 0, -0.11);
  tail.add(part(mesh(finGeometry([[0.015, 0.02], [-0.09, 0.07], [-0.065, 0], [-0.09, -0.07], [0.015, -0.02]]), color, fishLook), 'fish-tail'));
  fish.add(tail);
  for (const side of [-1, 1]) {
    const eye = at(part(ball(0.017, '#FFFFFF', fishLook), 'fish-eye'), side * 0.042, 0.018, 0.1);
    eye.add(at(ball(0.009, '#2A2238', { outline: 0, shadow: false }), side * 0.011, 0, 0.003));
    fish.add(eye);
  }
  fish.userData.tail = tail;
  return fish;
}

/** The tail's swing at `t`, side to side about its root. */
const tailSwing = (i: number, t: number) => 0.45 * Math.sin(5 * t + i * 1.7);

/** A "!!" (two bars over two dots), shown over a fish that's spotted the float (#58). */
function alertMark() {
  const mark = new THREE.Group();
  for (const dx of [-0.05, 0.05]) {
    mark.add(at(mesh(new THREE.BoxGeometry(0.035, 0.14, 0.035), '#FFB648', { outline: 0.1, shadow: false }), dx, 0.1, 0));
    mark.add(at(ball(0.022, '#FFB648', { outline: 0.1, shadow: false }), dx, -0.01, 0));
  }
  return mark;
}

/** The pond's fish, swimming their loops; one may be caught (#58). */
export class PondFish {
  readonly fish = ['#F07A4A', '#E2B347'].slice(0, FISH).map(fishModel);
  readonly alerts = this.fish.map(alertMark);

  /** `props`: the layout's props, read as it changes. */
  constructor(parent: THREE.Object3D, private props: () => Props = () => BREAK_ROOM) {
    parent.add(...this.fish, ...this.alerts);
    this.update(0);
  }

  /** `caught`: a fish taking part in a catch, where the cast puts it. */
  update(t: number, caught: { index: number; at: { x: number; y: number; z: number }; heading: number; pitch?: number; wriggle?: number; alert: boolean } | null = null) {
    this.fish.forEach((f, i) => {
      const at = caught?.index === i ? { ...caught.at, heading: caught.heading, pitch: caught.pitch ?? 0, wriggle: caught.wriggle ?? 0 } : { ...fishAt(i, t, this.props().pond), pitch: 0, wriggle: 0 };
      f.position.set(at.x, at.y, at.z);
      f.rotation.set(-at.pitch, at.heading, 0, 'YXZ');
      f.rotateY(at.wriggle);
      f.userData.tail.rotation.y = tailSwing(i, t);
      this.alerts[i].visible = caught?.index === i && caught.alert;
      this.alerts[i].position.set(at.x, 0.45, at.z);
    });
  }
}
