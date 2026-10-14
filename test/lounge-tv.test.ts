import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { INITIAL_ROWS, officeLayout } from '../src/client/layout.ts';
import { buildOffice } from '../src/client/office.ts';
import { Character } from '../src/client/character.ts';
import { lookFor } from '../src/client/look.ts';
import { TV_OFF, gameFrame, paintGame } from '../src/client/tv.ts';
import { ofType, office } from './office-sim.ts';

const START = officeLayout(INITIAL_ROWS);
const SOFA = ['lounge', 'couch-co-op'];
const sofaPlaces = START.hangouts.filter((s) => SOFA.includes(s.name)).flatMap((s) => s.places);

/** A 2D context that records what's drawn. */
function recorder() {
  const calls: string[] = [];
  const g = new Proxy({} as Record<string, unknown>, {
    get: (target, key) => (key in target ? target[key as string] : (...args: unknown[]) => { calls.push(`${String(key)}(${args.map((a) => (typeof a === 'number' ? a.toFixed(1) : a)).join(',')})`); }),
    set: (target, key, value) => { target[key as string] = value; calls.push(`${String(key)}=${value}`); return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { g, calls };
}

describe('#61 AC1/AC2 the TV is on only while someone is on the sofa', () => {
  it('#61 AC1 with nobody on the sofa the screen is dark, with no picture', () => {
    const { tv } = buildOffice(INITIAL_ROWS);
    tv.update(false, 3);
    expect(tv.on).toBe(false);
    expect(tv.screen.material.map).toBeNull();
    expect('#' + tv.screen.material.color.getHexString()).toBe(TV_OFF.toLowerCase());
  });

  it('#61 AC2 it turns on when someone sits down, and off when the last one leaves', () => {
    const { tv } = buildOffice(INITIAL_ROWS);
    tv.update(true, 1);
    expect(tv.on).toBe(true);
    expect(tv.screen.material.color.getHexString()).toBe('ffffff');
    tv.update(false, 2);
    expect(tv.on).toBe(false);
    expect('#' + tv.screen.material.color.getHexString()).toBe(TV_OFF.toLowerCase());
  });

  it('#61 AC2 someone counts as on the sofa once seated there (lounge or couch co-op), not while walking up', () => {
    expect(sofaPlaces).toHaveLength(6); // 3 lounging, 3 co-op (#112)
    for (const place of sofaPlaces) {
      const c = new Character(lookFor('session-1'));
      c.placeAt(START.seats[0], 'done', place);
      expect(c.onSofa(), place.spot).toBe(true);
      c.go([{ x: place.x, z: place.z }, ...place.link.slice(1)], null);
      c.update(0, 0.016);
      expect(c.onSofa()).toBe(false);
    }
    const elsewhere = new Character(lookFor('session-2'));
    elsewhere.placeAt(START.seats[0], 'done', START.hangouts.find((s) => s.name === 'kitchen')!.places[0]);
    expect(elsewhere.onSofa()).toBe(false);
  });
});

describe('#61 AC3 an animated arena game, with nothing real in it', () => {
  it('#61 AC3 minions and champions move over time, and there are hit flashes', () => {
    const a = gameFrame(1), b = gameFrame(2.5);
    expect(a.minions.length).toBeGreaterThan(5);
    expect(a.champions.length).toBeGreaterThanOrEqual(4);
    expect(b.minions).not.toEqual(a.minions);
    expect(b.champions).not.toEqual(a.champions);
    const flashes = Array.from({ length: 120 }, (_, i) => gameFrame(i * 0.1).flashes.length).filter((n) => n > 0);
    expect(flashes.length).toBeGreaterThan(0);
    for (const t of [0, 1.3, 4.9, 7]) {
      const f = gameFrame(t);
      for (const d of [...f.minions, ...f.champions]) {
        expect(d.x).toBeGreaterThanOrEqual(0);
        expect(d.x).toBeLessThanOrEqual(1);
        expect(d.y).toBeGreaterThanOrEqual(0);
        expect(d.y).toBeLessThanOrEqual(1);
      }
    }
  });

  it('#61 AC3 the picture changes over time and is shapes only: no text, names or logos', () => {
    const first = recorder(), later = recorder();
    paintGame(first.g, 1);
    paintGame(later.g, 3);
    expect(later.calls).not.toEqual(first.calls);
    for (const call of [...first.calls, ...later.calls]) expect(call).not.toMatch(/^(fillText|strokeText|drawImage)/);
  });
});

/** Idle agents wandering for an hour; at each tick, who sits on the sofa and the cheers. */
function sofaHour(seed: number) {
  const o = office(8, seed);
  for (let n = 1; n <= 8; n++) o.set(n, 'done');
  const ticks: { t: number; sitting: string[]; cheers: string[][] }[] = [];
  o.run(60 * 60, 0.25, () => {
    const sitting = [...o.c.agents].filter(([, a]) => SOFA.includes(a.place?.spot ?? '') && a.arrivesAt <= o.clock.t).map(([k]) => k).sort();
    const cheers = o.log.filter((l) => l.t === o.clock.t && l.event.type === 'cheer').map((l) => [...(l.event as { keys: string[] }).keys].sort());
    ticks.push({ t: o.clock.t, sitting, cheers });
  });
  return ticks;
}

describe('#61 AC4 every so often everyone on the sofa cheers together', () => {
  it('#61 AC4 a cheer includes everyone sitting on the sofa at that moment, in one event', () => {
    const ticks = sofaHour(3);
    const cheering = ticks.filter((k) => k.cheers.length);
    expect(cheering.length).toBeGreaterThan(5);
    for (const k of cheering) {
      expect(k.cheers).toHaveLength(1);
      expect(k.cheers[0]).toEqual(k.sitting);
    }
  });

  it('#61 AC4 cheers are at least 20 s apart, and at most 60 s while the sofa stays occupied', () => {
    let gaps = 0;
    for (const seed of [3, 4, 5, 6, 7, 8]) {
      const ticks = sofaHour(seed);
      let last: number | null = null, occupied = true;
      for (const k of ticks) {
        if (!k.sitting.length) occupied = false;
        if (!k.cheers.length) continue;
        if (last != null) {
          expect(k.t - last).toBeGreaterThanOrEqual(20 - 0.25);
          if (occupied) { expect(k.t - last).toBeLessThanOrEqual(60 + 0.25); gaps++; }
        }
        last = k.t;
        occupied = true;
      }
    }
    expect(gaps).toBeGreaterThan(3);
  });

  it('#61 AC4 the intervals come from the injectable random', () => {
    const cheers = (seed: number) => sofaHour(seed).filter((k) => k.cheers.length).map((k) => k.t);
    expect(cheers(5)).toEqual(cheers(5));
    expect(cheers(5)).not.toEqual(cheers(6));
  });
});

describe('#61 AC5 a cheer lasts about 1.5 s, then back to the pose', () => {
  it('#61 AC5 the fists go up together, pump, and come back down to the pose after about 1.5 s', () => {
    for (const place of [sofaPlaces[0], sofaPlaces.at(-1)!]) {
      const c = new Character(lookFor('session-1'));
      c.placeAt(START.seats[0], 'done', place);
      const hands = () => { c.root.updateMatrixWorld(true); return c.hands.map((h) => h.position.clone()); };
      c.update(0, 0.016);
      const before = hands();
      c.cheer();
      let up = 0, t = 0.016;
      for (; t < 1.4; t += 0.05) {
        c.update(t, 0.05);
        if (hands().every((h) => h.y > 1.6)) up++;
      }
      expect(up, place.spot).toBeGreaterThan(15);
      for (; t < 1.7; t += 0.05) c.update(t, 0.05);
      hands().forEach((h, i) => expect(h.distanceTo(before[i]), `${place.spot} hand ${i}`).toBeLessThan(0.1));
    }
  });
});

describe('#61 AC6 no sofa, no cheers', () => {
  it('#61 AC6 a cheer only ever comes while someone is sitting on the sofa', () => {
    for (const seed of [9, 10, 11]) {
      const o = office(3, seed);
      for (let n = 1; n <= 3; n++) o.set(n, 'done');
      let empty = 0;
      o.run(60 * 60, 0.25, () => {
        const sitting = [...o.c.agents.values()].filter((a) => SOFA.includes(a.place?.spot ?? '') && a.arrivesAt <= o.clock.t).length;
        if (!sitting) empty++;
        const cheers = o.log.filter((l) => l.t === o.clock.t && l.event.type === 'cheer');
        if (!sitting) expect(cheers, `seed ${seed} at ${o.clock.t}`).toEqual([]);
      });
      expect(empty).toBeGreaterThan(1000);
    }
  });
});

it('#61 the TV screen is part of the office, on the back wall', () => {
  const { tv } = buildOffice(INITIAL_ROWS);
  const at = tv.screen.getWorldPosition(new THREE.Vector3());
  expect(Math.abs(at.x - START.lounge.tv.x)).toBeLessThan(0.01);
});
