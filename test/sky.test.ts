import { describe, expect, it } from 'vitest';
import { createSunClock, moonState, skyColours, skyPath, starVisibility, sunState } from '../src/client/sky.ts';
import { sunTimes } from '../src/client/sun-times.ts';

const today = { rise: 6, set: 18 };
const W = 1000, H = 600;
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

describe('#93 sky by time of day', () => {
  it('#93 AC1 the sun is up by day and the moon by night', () => {
    for (const hour of [6.1, 9, 12, 15, 17.9]) {
      const sun = sunState(hour, today);
      expect(sun.up).toBe(true);
      expect(moonState(sun).up).toBe(false);
    }
    for (const hour of [18.1, 21, 0, 3, 5.9]) {
      const sun = sunState(hour, today);
      expect(sun.up).toBe(false);
      expect(moonState(sun).up).toBe(true);
    }
  });

  it('#93 AC2 the sun enters past the left edge, peaks centred at 14% from the top, leaves past the right edge', () => {
    const at = (hour: number) => skyPath(sunState(hour, today), W, H);
    expect(at(6)).toMatchObject({ x: -0.1 * W, y: 0.5 * H });
    expect(at(12).x).toBeCloseTo(0.5 * W);
    expect(at(12).y).toBeCloseTo(0.14 * H);
    expect(at(18 - 1e-9).x).toBeCloseTo(1.1 * W);
  });

  it('#93 AC3 stars are hidden at solar noon and fully visible halfway through the night', () => {
    expect(starVisibility(sunState(12, today).e)).toBe(0);
    expect(starVisibility(sunState(0, today).e)).toBe(1);
  });

  it('#93 AC4 sky colours at noon and the middle of the night are the 1.0 and -1.0 stops', () => {
    const round = (colours: number[][]) => colours.map((c) => c.map(Math.round));
    expect(round(skyColours(sunState(12, today).e))).toEqual(['#2C74CC', '#6CADE8', '#BEDFF5'].map(hex));
    expect(round(skyColours(sunState(0, today).e))).toEqual(['#04051A', '#0A0E2E', '#171C47'].map(hex));
  });

  it('#93 AC5 sunrise and sunset are recomputed when the date changes', () => {
    const clock = createSunClock('Europe/London');
    const october = clock.at(new Date('2026-10-13T12:00:00Z')).today;
    expect(october).toEqual(sunTimes('Europe/London', new Date('2026-10-13T12:00:00Z')));
    const nextDay = clock.at(new Date('2026-10-14T00:30:00Z')).today;
    expect(nextDay).toEqual(sunTimes('Europe/London', new Date('2026-10-14T00:30:00Z')));
    expect(nextDay.rise).not.toBe(october.rise);
  });
});
