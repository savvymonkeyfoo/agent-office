import * as THREE from 'three';

// Three-step toon ramp, as in the prototype.
export const toonRamp = new THREE.DataTexture(
  new Uint8Array([110, 110, 110, 255, 185, 185, 185, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat,
);
toonRamp.minFilter = toonRamp.magFilter = THREE.NearestFilter;
toonRamp.needsUpdate = true;

const toonCache = new Map<string, THREE.MeshToonMaterial>();
export function toon(color: string) {
  let material = toonCache.get(color);
  if (!material) toonCache.set(color, (material = new THREE.MeshToonMaterial({ color, gradientMap: toonRamp })));
  return material;
}

const outlineMaterial = new THREE.MeshBasicMaterial({ color: '#2A2238', side: THREE.BackSide });

interface MeshOptions { outline?: number; shadow?: boolean }

/** A toon-shaded mesh with an inverted-hull black outline. */
export function mesh(geometry: THREE.BufferGeometry, color: string, { outline = 0.05, shadow = true }: MeshOptions = {}) {
  const m = new THREE.Mesh(geometry, toon(color));
  m.castShadow = shadow;
  m.receiveShadow = true;
  if (outline) {
    const hull = new THREE.Mesh(geometry, outlineMaterial);
    hull.scale.setScalar(1 + outline);
    m.add(hull);
  }
  return m;
}

export const at = <T extends THREE.Object3D>(obj: T, x: number, y: number, z: number) => {
  obj.position.set(x, y, z);
  return obj;
};
export const tag = <T extends THREE.Object3D>(obj: T, kind: string) => {
  obj.userData.kind = kind;
  return obj;
};
/** Marks a piece of a prop (not furniture of its own, so not tagged). */
export const part = <T extends THREE.Object3D>(obj: T, name: string) => {
  obj.userData.part = name;
  return obj;
};
export const box = (w: number, h: number, d: number, color: string, opts?: MeshOptions) =>
  mesh(new THREE.BoxGeometry(w, h, d), color, opts);
export const cyl = (rt: number, rb: number, h: number, color: string, opts?: MeshOptions, segments = 24) =>
  mesh(new THREE.CylinderGeometry(rt, rb, h, segments), color, opts);
export const ball = (r: number, color: string, opts?: MeshOptions) =>
  mesh(new THREE.SphereGeometry(r, 24, 16), color, opts);
