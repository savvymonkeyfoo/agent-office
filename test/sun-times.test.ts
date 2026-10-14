import { describe, expect, it } from 'vitest';
import { sunTimes } from '../src/client/sun-times.ts';

const hours = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h + m / 60; };
const threeMinutes = 3 / 60;
const on = (day: string) => new Date(`${day}T12:00:00Z`);

const expectTimes = (zone: string, day: string, rise: string, set: string) => {
  const times = sunTimes(zone, on(day));
  expect(Math.abs(times.rise - hours(rise))).toBeLessThanOrEqual(threeMinutes);
  expect(Math.abs(times.set - hours(set))).toBeLessThanOrEqual(threeMinutes);
  expect(times.estimated).toBe(false);
};

describe('#92 sunrise and sunset from the time zone', () => {
  it('#92 AC1 Europe/London on 2026-10-13 rises 07:19 and sets 18:14', () => {
    expectTimes('Europe/London', '2026-10-13', '07:19', '18:14');
  });

  it('#92 AC2 Australia/Sydney and Asia/Tokyo on 2026-10-13', () => {
    expectTimes('Australia/Sydney', '2026-10-13', '06:17', '19:06');
    expectTimes('Asia/Tokyo', '2026-10-13', '05:45', '17:10');
  });

  it('#92 AC3 an old zone name gives the same times as its current name', () => {
    expect(sunTimes('Asia/Calcutta', on('2026-10-13'))).toEqual(sunTimes('Asia/Kolkata', on('2026-10-13')));
  });

  it('#92 AC4 a zone not in the table is estimated from its UTC offset', () => {
    const times = sunTimes('Etc/GMT-5', on('2026-10-13')); // UTC+5, so longitude 75°E
    expect(times.estimated).toBe(true);
    expect(Number.isFinite(times.rise) && Number.isFinite(times.set)).toBe(true);
    expect(Math.abs((times.rise + times.set) / 2 - 12)).toBeLessThan(0.5); // solar noon near 12:00 local
  });

  it('#92 AC5 Arctic/Longyearbyen in polar night and midnight sun gives finite times', () => {
    for (const day of ['2026-12-21', '2026-06-21']) {
      const times = sunTimes('Arctic/Longyearbyen', on(day));
      expect(Number.isFinite(times.rise)).toBe(true);
      expect(Number.isFinite(times.set)).toBe(true);
      expect(times.set).not.toBe(times.rise);
    }
  });
});
