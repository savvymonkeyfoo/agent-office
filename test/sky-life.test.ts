import { describe, expect, it } from 'vitest';
import {
  CLOUD_SPRITE, PUFF_BLUR, cloudPlacement, cloudTints, createClouds, createVisitors, starVisibility, sunState,
} from '../src/client/sky.ts';

const today = { rise: 6, set: 18 };
const seeded = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const dominant = (tints: Record<string, number>) => Object.entries(tints).sort((a, b) => b[1] - a[1])[0][0];

describe('#94 clouds, birds and shooting stars', () => {
  it('#94 AC1 clouds are drawn only in the upper half of the sky', () => {
    const clouds = createClouds(seeded(3));
    expect(clouds).toHaveLength(6);
    for (const [W, H] of [[1600, 900], [2560, 1080], [3840, 1000], [800, 600], [390, 844], [1000, 300]]) {
      for (let seconds = 0; seconds < 600; seconds += 7) {
        for (const cloud of clouds) {
          const { y, h } = cloudPlacement(cloud, seconds, W, H);
          expect(y + h * CLOUD_SPRITE.base).toBeLessThanOrEqual(H / 2 + 1e-9); // the flat bottom: nothing is painted below it
        }
      }
    }
  });

  it('#94 AC2 cloud tints: day at solar noon, sunset at sunset, night halfway through the night', () => {
    expect(dominant(cloudTints(sunState(12, today).e))).toBe('day');
    expect(dominant(cloudTints(sunState(18, today).e))).toBe('sunset');
    expect(dominant(cloudTints(sunState(0, today).e))).toBe('night');
  });

  it('#94 AC3 every puff, blur included, stays clear of the edges of its cloud sprite', () => {
    for (const seed of [1, 2, 3, 11, 42, 999]) {
      for (const { puffs } of createClouds(seeded(seed))) {
        for (const [x, y, r] of puffs) {
          const reach = r + PUFF_BLUR * 3;
          expect(r).toBeGreaterThan(0);
          expect(x - reach).toBeGreaterThanOrEqual(1);
          expect(x + reach).toBeLessThanOrEqual(CLOUD_SPRITE.w - 1);
          expect(y - reach).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it('#94 AC4 birds fly only while the sun is up', () => {
    const visitors = createVisitors(seeded(5));
    for (let seconds = 0; seconds < 300; seconds += 0.1) expect(visitors.birds(seconds, -0.3)).toEqual([]);
    let seen = 0;
    for (let seconds = 300; seconds < 600; seconds += 0.1) {
      const flock = visitors.birds(seconds, 0.5);
      if (flock.length) { seen++; expect(flock.length).toBeGreaterThanOrEqual(3); expect(flock.length).toBeLessThanOrEqual(7); }
    }
    expect(seen).toBeGreaterThan(0);
    // A flock in the air when the sun goes down is gone at once.
    let seconds = 600;
    while (!visitors.birds(seconds, 0.5).length) seconds += 0.1;
    expect(visitors.birds(seconds + 0.1, -0.01)).toEqual([]);
  });

  it('#94 AC4 shooting stars only while the stars are visible', () => {
    const visitors = createVisitors(seeded(7));
    const noon = starVisibility(sunState(12, today).e), midnight = starVisibility(sunState(0, today).e);
    for (let seconds = 0; seconds < 300; seconds += 0.05) expect(visitors.shootingStar(seconds, noon)).toBeNull();
    let starts = 0, wasShowing = false;
    for (let seconds = 300; seconds < 600; seconds += 0.05) {
      const showing = visitors.shootingStar(seconds, midnight) !== null;
      if (showing && !wasShowing) starts++;
      wasShowing = showing;
    }
    expect(starts).toBeGreaterThanOrEqual(300 / 15); // one every 5–14 s
    expect(starts).toBeLessThanOrEqual(300 / 5.9);
  });
});
