import { describe, expect, it } from 'vitest';
import { unclash } from '../src/client/lab-captions.ts';

const size = { w: 100, h: 20 };
const run = (pts: [number, number][]) => unclash(pts.map(([x, y], i) => ({ el: i, x, y })), () => size.w, () => size.h);

describe('lab captions never overlap', () => {
  it('leaves captions that are apart where they are', () => {
    expect(run([[0, 100], [300, 100]]).map((p) => p.y)).toEqual([100, 100]);
  });
  it('lifts the farther caption clear of the nearer one', () => {
    const [near, far] = run([[0, 200], [40, 190]]).sort((a, b) => a.el - b.el);
    expect(near.y).toBe(200);
    expect(far.y).toBeLessThanOrEqual(200 - size.h - 3);
  });
  it('stacks a crowd so no two boxes touch', () => {
    const out = run(Array.from({ length: 6 }, (_, i) => [i * 10, 200 - i * 4] as [number, number]));
    for (const a of out) for (const b of out) {
      if (a === b) continue;
      const overlapX = Math.abs(a.x - b.x) < size.w;
      const overlapY = a.y > b.y - size.h && b.y > a.y - size.h;
      expect(overlapX && overlapY).toBe(false);
    }
  });
});
