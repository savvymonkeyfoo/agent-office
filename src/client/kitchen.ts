// The kitchen's pieces (#88), each built at its own origin for office.ts to place.
import * as THREE from 'three';
import { at, ball, box, cyl, mesh, part, tag } from './toon.ts';

const INK = '#3A3150';
const WOOD = '#C98A55';
const CUPBOARD = '#9C8FB8';
const STEEL = '#D5D9E2';

/** The worktop's surface height. */
export const WORKTOP = 0.91;
const CUPBOARD_TOP = 0.85;
const FRIDGE_W = 0.6;
/** The sink's hole in the worktop, in the counter's own frame. */
const SINK = { x: 0.6, hw: 0.25, hd: 0.17, floor: 0.74 };

/** Cupboards and a worktop with the sink cut into it, and the fridge at the right-hand end. */
export function buildCounter(w: number, d: number) {
  const counter = tag(new THREE.Group(), 'kitchen-counter');
  const left = -w / 2, runEnd = w / 2 - FRIDGE_W;
  const [holeL, holeR] = [SINK.x - SINK.hw, SINK.x + SINK.hw];
  const cupboard = (x0: number, x1: number, y0: number, y1: number, z = 0, depth = d) =>
    counter.add(at(box(x1 - x0, y1 - y0, depth, CUPBOARD), (x0 + x1) / 2, (y0 + y1) / 2, z));
  cupboard(left, holeL, 0, CUPBOARD_TOP);
  cupboard(holeR, runEnd, 0, CUPBOARD_TOP);
  cupboard(holeL, holeR, 0, SINK.floor - 0.02); // under the basin
  cupboard(holeL, holeR, SINK.floor - 0.02, CUPBOARD_TOP, d / 2 - 0.03, 0.06); // its front, closed over the basin

  counter.add(at(worktop(left - 0.03, runEnd, d / 2 + 0.02, [holeL, holeR]), 0, CUPBOARD_TOP, 0));
  counter.add(at(buildSink(), SINK.x, 0, 0));
  counter.add(at(buildFridge(d), w / 2 - FRIDGE_W / 2, 0, 0));
  return counter;
}

/** A slab from x0 to x1, `halfDepth` either side of z 0, with the sink's hole through it. */
function worktop(x0: number, x1: number, halfDepth: number, [holeL, holeR]: number[]) {
  // Shape y is -z once the slab is turned flat.
  const shape = new THREE.Shape().moveTo(x0, -halfDepth).lineTo(x1, -halfDepth).lineTo(x1, halfDepth).lineTo(x0, halfDepth).lineTo(x0, -halfDepth);
  const { hd } = SINK;
  shape.holes.push(new THREE.Path().moveTo(holeL, -hd).lineTo(holeL, hd).lineTo(holeR, hd).lineTo(holeR, -hd).lineTo(holeL, -hd));
  const slab = mesh(new THREE.ExtrudeGeometry(shape, { depth: WORKTOP - CUPBOARD_TOP, bevelEnabled: false }), '#F4EEE2', { outline: 0.005 });
  slab.rotation.x = -Math.PI / 2;
  return slab;
}

/** A steel basin under the worktop's hole, and a tap behind it. */
function buildSink() {
  const sink = tag(new THREE.Group(), 'sink');
  const { hw, hd, floor } = SINK, side = WORKTOP - floor, y = floor + side / 2;
  const steel = (w: number, h: number, d: number) => box(w, h, d, STEEL, { outline: 0 });
  sink.add(part(at(steel(hw * 2, 0.02, hd * 2), 0, floor - 0.01, 0), 'basin-floor'));
  sink.add(at(steel(hw * 2, side, 0.01), 0, y, -hd + 0.005), at(steel(hw * 2, side, 0.01), 0, y, hd - 0.005));
  sink.add(at(steel(0.01, side, hd * 2), -hw + 0.005, y, 0), at(steel(0.01, side, hd * 2), hw - 0.005, y, 0));

  const tap = part(new THREE.Group(), 'tap');
  tap.add(at(cyl(0.02, 0.025, 0.24, STEEL, { outline: 0.06 }), 0, WORKTOP + 0.12, -0.26));
  const spout = at(cyl(0.015, 0.015, 0.14, STEEL, { outline: 0.06 }), 0, WORKTOP + 0.225, -0.2);
  spout.rotation.x = Math.PI / 2;
  tap.add(spout);
  tap.add(at(cyl(0.025, 0.025, 0.03, '#4D86FF', { outline: 0.06 }), 0.07, WORKTOP + 0.015, -0.26));
  sink.add(tap);
  return sink;
}

function buildFridge(d: number) {
  const fridge = tag(new THREE.Group(), 'fridge');
  const front = d / 2;
  // Kept below the window sill, so it doesn't stand in front of the glass.
  fridge.add(at(box(FRIDGE_W, 1.5, d - 0.02, '#EEF1F6'), 0, 0.75, 0));
  fridge.add(at(box(FRIDGE_W - 0.04, 0.015, 0.01, '#A9A3BF', { outline: 0 }), 0, 1.05, front - 0.005));
  fridge.add(at(box(0.03, 0.22, 0.04, STEEL, { outline: 0.05 }), -FRIDGE_W / 2 + 0.07, 1.25, front + 0.01));
  fridge.add(at(box(0.03, 0.4, 0.04, STEEL, { outline: 0.05 }), -FRIDGE_W / 2 + 0.07, 0.75, front + 0.01));
  fridge.add(at(box(0.09, 0.09, 0.005, '#FFB648', { outline: 0 }), 0.1, 1.27, front)); // a note on the door
  return fridge;
}

/** Body and boiler at the back; the group head's spout over a drip tray, with a mug under it. */
export function buildEspressoMachine() {
  const machine = tag(new THREE.Group(), 'coffee-machine');
  machine.add(at(box(0.42, 0.44, 0.18, INK), 0, 0.22, -0.14));
  machine.add(at(box(0.42, 0.12, 0.3, INK), 0, 0.44, -0.08));
  machine.add(at(box(0.36, 0.015, 0.26, STEEL, { outline: 0.03 }), 0, 0.5075, -0.08)); // cup warmer
  machine.add(at(ball(0.025, '#FF5A5A', { outline: 0, shadow: false }), 0.14, 0.44, 0.075));
  const gauge = at(cyl(0.035, 0.035, 0.02, '#FFFFFF', { outline: 0.1 }), -0.12, 0.44, 0.075);
  gauge.rotation.x = Math.PI / 2;
  machine.add(gauge);

  machine.add(at(cyl(0.05, 0.05, 0.04, STEEL, { outline: 0.06 }), 0, 0.36, 0)); // group head
  machine.add(at(cyl(0.045, 0.04, 0.03, '#8C8FA0', { outline: 0.06 }), 0, 0.325, 0)); // portafilter
  machine.add(at(box(0.03, 0.03, 0.15, '#2A2238', { outline: 0 }), 0, 0.325, 0.11)); // its handle
  machine.add(part(at(cyl(0.012, 0.008, 0.04, STEEL, { outline: 0 }), 0, 0.29, 0), 'spout'));
  const wand = at(cyl(0.008, 0.008, 0.2, STEEL, { outline: 0 }), 0.17, 0.3, 0);
  wand.rotation.z = 0.25;
  machine.add(wand);

  machine.add(part(at(box(0.36, 0.03, 0.22, STEEL, { outline: 0.03 }), 0, 0.015, 0), 'drip-tray'));
  const mug = part(new THREE.Group(), 'mug');
  mug.add(at(cyl(0.042, 0.038, 0.08, '#FFFFFF', { outline: 0.06 }), 0, 0.04, 0));
  mug.add(at(cyl(0.035, 0.035, 0.004, '#6B4A33', { outline: 0 }), 0, 0.077, 0));
  machine.add(at(mug, 0, 0.0325, 0));
  return machine;
}

export function buildToaster() {
  const toaster = tag(new THREE.Group(), 'toaster');
  toaster.add(at(box(0.28, 0.17, 0.16, '#F07A4A'), 0, 0.085, 0));
  for (const dz of [-0.035, 0.035]) toaster.add(at(box(0.2, 0.005, 0.025, INK, { outline: 0 }), 0, 0.172, dz));
  toaster.add(at(box(0.03, 0.02, 0.03, INK, { outline: 0 }), 0.155, 0.12, 0));
  return toaster;
}

export function buildKettle() {
  const kettle = tag(new THREE.Group(), 'kettle');
  kettle.add(at(cyl(0.085, 0.085, 0.015, INK, { outline: 0.04 }), 0, 0.0075, 0));
  kettle.add(at(cyl(0.065, 0.08, 0.18, '#5BA37A'), 0, 0.105, 0));
  kettle.add(at(ball(0.02, INK, { outline: 0 }), 0, 0.2, 0));
  kettle.add(at(box(0.025, 0.14, 0.03, INK, { outline: 0 }), -0.09, 0.12, 0));
  const spout = at(cyl(0.012, 0.02, 0.08, '#5BA37A', { outline: 0 }), 0.09, 0.15, 0);
  spout.rotation.z = -0.9;
  kettle.add(spout);
  return kettle;
}

export function buildFruitBowl() {
  const bowl = tag(new THREE.Group(), 'fruit-bowl');
  bowl.add(at(cyl(0.14, 0.08, 0.07, '#4D86FF'), 0, 0.035, 0));
  const fruit = [[-0.05, 0.02, 0.045, '#FF8A3D'], [0.05, -0.02, 0.045, '#E84855'], [0, 0.05, 0.04, '#9BC53D'], [0.02, -0.05, 0.04, '#FF8A3D']] as const;
  for (const [x, z, r, color] of fruit) bowl.add(at(ball(r, color), x, 0.08, z));
  return bowl;
}

/** A cupboard with an open shelf of mugs and jars under it; its back is against the wall at z 0. */
export function buildWallCabinet() {
  const cabinet = tag(new THREE.Group(), 'wall-cabinet');
  cabinet.add(at(box(0.6, 0.42, 0.3, CUPBOARD, { outline: 0.02 }), 0, 1.95, 0.15));
  for (const side of [-1, 1]) {
    cabinet.add(at(box(0.27, 0.38, 0.01, '#B4A8D0', { outline: 0 }), side * 0.15, 1.95, 0.305));
    cabinet.add(at(ball(0.015, STEEL, { outline: 0 }), side * 0.04, 1.85, 0.315));
  }
  cabinet.add(at(box(0.6, 0.03, 0.24, WOOD, { outline: 0.02 }), 0, 1.4, 0.12));
  for (const [x, color] of [[-0.22, '#FFFFFF'], [-0.11, '#F0A3B5']] as const) {
    cabinet.add(part(at(cyl(0.035, 0.032, 0.08, color, { outline: 0.06 }), x, 1.455, 0.12), 'mug'));
  }
  for (const [x, fill] of [[0.06, WOOD], [0.2, '#E8D27A']] as const) {
    const jar = part(new THREE.Group(), 'jar');
    jar.add(at(cyl(0.045, 0.045, 0.12, fill, { outline: 0.05 }), 0, 0.06, 0));
    jar.add(at(cyl(0.048, 0.048, 0.025, INK, { outline: 0 }), 0, 0.13, 0));
    cabinet.add(at(jar, x, 1.415, 0.12));
  }
  return cabinet;
}

export function buildVase() {
  const vase = tag(new THREE.Group(), 'vase');
  vase.add(at(cyl(0.035, 0.05, 0.14, '#4D86FF', { outline: 0.05 }), 0, 0.07, 0));
  const flowers = [[0, 0, '#FF5A5A'], [0.04, 0.02, '#FFB648'], [-0.035, -0.02, '#F0A3B5']] as const;
  for (const [x, z, color] of flowers) {
    vase.add(at(cyl(0.004, 0.004, 0.12, '#5BA37A', { outline: 0 }), x / 2, 0.19, z / 2));
    vase.add(at(ball(0.03, color, { outline: 0.05 }), x, 0.25, z));
  }
  return vase;
}
