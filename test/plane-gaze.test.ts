import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { INITIAL_ROWS, officeLayout, type Point } from '../src/client/layout.ts';
import { Character } from '../src/client/character.ts';
import { lookFor } from '../src/client/look.ts';
import { PaperPlanes, landingPoint } from '../src/client/paper-planes.ts';

const START = officeLayout(INITIAL_ROWS);
const PLACE = START.hangouts.find((s) => s.name === 'planes')!.places[0];
const FRAME = 1 / 60;
const DEG = Math.PI / 180;

/** A point `metres` from the thrower, `degrees` round from its facing (positive: to its left, turning like yaw). */
const around = (degrees: number, metres: number): Point =>
  ({ x: PLACE.x + Math.sin(PLACE.yaw + degrees * DEG) * metres, z: PLACE.z + Math.cos(PLACE.yaw + degrees * DEG) * metres });

const forwardOf = (o: THREE.Object3D) => new THREE.Vector3(0, 0, 1).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion()));
const yawOf = (v: THREE.Vector3) => Math.atan2(v.x, v.z);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

interface Frame { t: number; gaze: THREE.Vector3; eye: THREE.Vector3; headYaw: number; plane: THREE.Vector3 | null; flying: boolean; head: THREE.Quaternion; twist: number }

/** A settled thrower throws at `desk`; every frame records where its head points and where the plane is. */
function throwAt(desk: Point, seconds = 5) {
  const character = new Character(lookFor('session-1'));
  character.placeAt(START.seats[0], 'done', PLACE);
  for (let t = 0; t < 1; t += FRAME) character.update(t, FRAME);
  const before = { head: character.head.quaternion.clone(), twist: character.pivot.rotation.y };
  const planes = new PaperPlanes(new THREE.Scene());
  let releasedAt: number | null = null;
  character.throwPlane((from) => { releasedAt = frames.length; return planes.throw(from, desk); }, landingPoint(desk));
  const frames: Frame[] = [];
  for (let i = 0; i < seconds / FRAME; i++) {
    character.update(1 + i * FRAME, FRAME);
    planes.update(FRAME);
    character.root.updateMatrixWorld(true);
    const [plane] = planes.planes();
    frames.push({
      t: i * FRAME,
      gaze: forwardOf(character.head),
      eye: character.head.getWorldPosition(new THREE.Vector3()),
      headYaw: wrap(yawOf(forwardOf(character.head)) - yawOf(forwardOf(character.pivot))),
      plane: plane?.position.clone() ?? null,
      flying: !!plane && plane.position.distanceTo(landingPoint(desk)) > 1e-6,
      head: character.head.quaternion.clone(),
      twist: character.pivot.rotation.y,
    });
  }
  return { frames, releasedAt: releasedAt!, before };
}

const angleTo = (f: Frame, p: THREE.Vector3) => f.gaze.angleTo(p.clone().sub(f.eye)) / DEG;

const DESKS = { 'its usual desk': START.seats[0].desk, 'a desk off to the side': around(70, 3), 'a desk behind it': around(150, 3) };

describe('#116 AC1 the thrower eyes the target desk by the release', () => {
  for (const [name, desk] of Object.entries(DESKS)) {
    it(`#116 AC1 at the release the gaze is within 20° of ${name}`, () => {
      const { frames, releasedAt } = throwAt(desk);
      expect(releasedAt).toBeGreaterThan(10);
      expect(angleTo(frames[releasedAt - 1], landingPoint(desk))).toBeLessThan(20);
    });
  }
});

describe('#116 AC2 the head follows the plane while it flies', () => {
  for (const [name, desk] of Object.entries(DESKS)) {
    it(`#116 AC2 every frame in the air the gaze is within 20° of the plane (${name})`, () => {
      const { frames } = throwAt(desk);
      const flying = frames.filter((f) => f.flying);
      expect(flying.length).toBeGreaterThan(60);
      for (const f of flying) expect(angleTo(f, f.plane!), `at ${f.t.toFixed(2)} s`).toBeLessThan(20);
    });
  }
});

describe('#116 AC3 the head turns at most 80° from the body; the body turns for the rest', () => {
  it('#116 AC3 throwing at a desk behind it, the head stays within 80° of the body, which turns', () => {
    const { frames } = throwAt(DESKS['a desk behind it']);
    for (const f of frames) expect(Math.abs(f.headYaw) / DEG, `at ${f.t.toFixed(2)} s`).toBeLessThanOrEqual(80);
    expect(Math.max(...frames.map((f) => Math.abs(f.twist))) / DEG, 'the upper body turned').toBeGreaterThan(40);
  });

  it('#116 AC3 the same holds for every desk', () => {
    for (const desk of Object.values(DESKS)) {
      for (const f of throwAt(desk).frames) expect(Math.abs(f.headYaw) / DEG).toBeLessThanOrEqual(80);
    }
  });
});

describe('#116 AC4 back to the usual pose within 1 s of landing', () => {
  for (const [name, desk] of Object.entries(DESKS)) {
    it(`#116 AC4 a second after landing on ${name} the head and body are as before the throw`, () => {
      const { frames, before: usual } = throwAt(desk, 6);
      const landed = frames.findIndex((f, i) => i > 0 && frames[i - 1].flying && !f.flying);
      expect(landed).toBeGreaterThan(0);
      const later = frames[landed + Math.round(1 / FRAME)];
      expect(later.head.angleTo(usual.head) / DEG, 'head').toBeLessThan(2);
      expect(Math.abs(later.twist - usual.twist) / DEG, 'body').toBeLessThan(2);
    });
  }
});
