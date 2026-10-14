import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { INITIAL_ROWS, officeLayout, type HangoutPlace } from '../src/client/layout.ts';
import { Character } from '../src/client/character.ts';
import { lookFor } from '../src/client/look.ts';
import { SofaRemote } from '../src/client/tv.ts';
import { find } from './office-sim.ts';

const START = officeLayout(INITIAL_ROWS);
const lounge = START.hangouts.find((s) => s.name === 'lounge')!.places;
const coOp = START.hangouts.find((s) => s.name === 'couch-co-op')!.places;
const DT = 0.05;

/** The scene's per-frame loop, for a few characters and the remote, recording what happens. */
function sofa(...places: HangoutPlace[]) {
  const remote = new SofaRemote();
  const people = places.map((place, i) => {
    const c = new Character(lookFor(`session-${i + 1}`));
    c.placeAt(START.seats[i], 'done', place);
    return c;
  });
  let t = 0;
  const sitters = () => people.filter((c) => c.onSofa());
  const remoteOf = (c: Character) => find(c.root, 'remote')[0];
  const leftHandY = (c: Character) => c.hands[0].getWorldPosition(new THREE.Vector3()).y;
  const step = (each?: () => void) => {
    t += DT;
    people.forEach((c) => c.update(t, DT));
    remote.update(sitters());
    for (const c of people) expect(remoteOf(c).visible, '#113 AC4 the remote is only in hand while used').toBe(c.usingRemote());
    each?.();
  };
  /** Steps until `done` holds, returning the seconds that took. */
  const until = (done: () => boolean, max = 5) => {
    const from = t;
    while (!done()) { step(); if (t - from > max) throw new Error('never happened'); }
    return t - from;
  };
  /** Gets `c` up from the sofa, the way the scene does on a walk event. */
  const getUp = (c: Character) => {
    remote.gettingUp(c, sitters());
    c.go([{ x: c.place!.x, z: c.place!.z }, ...c.place!.link.slice(1)], null);
  };
  return { remote, people, step, until, getUp, remoteOf, leftHandY, sitters };
}

describe('#113 AC1 the first one on the empty sofa switches the TV on with the remote', () => {
  it('#113 AC1 the TV comes on 0.5–1.5 s after sitting, with the remote raised at that moment', () => {
    for (const place of [lounge[0], lounge[2], coOp[1]]) {
      const s = sofa(place);
      const [c] = s.people;
      s.step();
      const restY = s.leftHandY(c);
      expect(s.remote.on).toBe(false);
      const took = s.until(() => s.remote.on);
      expect(took, place.spot).toBeGreaterThanOrEqual(0.5);
      expect(took, place.spot).toBeLessThanOrEqual(1.5);
      expect(c.usingRemote()).toBe(true);
      expect(s.remoteOf(c).visible).toBe(true);
      expect(s.leftHandY(c) - restY, 'hand raised toward the TV').toBeGreaterThan(0.4);
    }
  });
});

describe('#113 AC2 the last one up switches it off first', () => {
  it('#113 AC2 raises the remote, the TV goes off, then stands (walking back or leaving)', () => {
    for (const leave of [false, true]) {
      const s = sofa(lounge[1]);
      const [c] = s.people;
      s.until(() => s.remote.on);
      s.until(() => !c.usingRemote());
      if (leave) {
        s.remote.gettingUp(c, s.sitters());
        c.leave([{ x: c.place!.x, z: c.place!.z }, ...c.place!.link.slice(1)]);
      } else s.getUp(c);
      expect(c.usingRemote()).toBe(true);
      let upY = 0;
      s.until(() => !s.remote.on);
      upY = s.leftHandY(c);
      expect(c.onSofa(), 'still seated as the TV goes off').toBe(true);
      expect(c.mode).toBe('hanging');
      expect(upY - c.root.position.y).toBeGreaterThan(1);
      const after = s.until(() => !c.onSofa());
      expect(after).toBeGreaterThan(0);
      expect(c.usingRemote()).toBe(false);
      expect(['hopping', 'walking']).toContain(c.mode);
      expect(s.remote.on).toBe(false);
    }
  });
});

describe('#113 AC3 others come and go without the remote', () => {
  it('#113 AC3 a second sitter arriving and the first leaving while others stay never use the remote; the TV stays on', () => {
    const s = sofa(lounge[0]);
    s.until(() => s.remote.on);
    s.until(() => !s.people[0].usingRemote());
    const late = new Character(lookFor('session-9'));
    late.placeAt(START.seats[3], 'done', lounge[2]);
    s.people.push(late);
    for (let i = 0; i < 40; i++) s.step(() => expect(late.usingRemote()).toBe(false));
    const first = s.people[0];
    s.getUp(first);
    expect(first.usingRemote()).toBe(false);
    expect(first.mode).toBe('hopping');
    for (let i = 0; i < 40; i++) s.step(() => {
      expect(s.remote.on).toBe(true);
      expect(first.usingRemote() || late.usingRemote()).toBe(false);
    });
    // The one left is now the last: it does use the remote.
    s.getUp(late);
    expect(late.usingRemote()).toBe(true);
    s.until(() => !s.remote.on);
  });

  it('#113 AC3 someone getting up just after sitting down, before the TV came on, leaves it off', () => {
    const s = sofa(lounge[0]);
    const [c] = s.people;
    s.step();
    s.step();
    s.getUp(c);
    s.until(() => !c.onSofa());
    for (let i = 0; i < 40; i++) s.step();
    expect(s.remote.on).toBe(false);
  });
});

describe('#113 AC4 the remote is only in a hand while in use', () => {
  it('#113 AC4 hidden before, shown while switching, hidden again once the hand is down', () => {
    const s = sofa(coOp[0]);
    const [c] = s.people;
    expect(s.remoteOf(c).visible).toBe(false);
    s.step();
    expect(s.remoteOf(c).visible).toBe(true);
    s.until(() => !c.usingRemote());
    for (let i = 0; i < 40; i++) s.step();
    expect(s.remoteOf(c).visible).toBe(false);
  });
});
