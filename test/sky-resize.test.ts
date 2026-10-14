// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { createSky } from '../src/client/sky.ts';

beforeAll(() => {
  // jsdom has no 2D canvas; resizing only needs createSky to build without throwing.
  const noop2d = new Proxy({}, { get: () => () => ({ addColorStop() {}, data: [] }) });
  HTMLCanvasElement.prototype.getContext = (() => noop2d) as never;
});

function sizedSky(w: number, h: number) {
  const sky = createSky();
  sky.resize(w, h);
  let released = 0;
  sky.texture.addEventListener('dispose', () => released++);
  return { sky, released: () => released };
}

describe('#106 sky texture follows the window size', () => {
  it('#106 AC1 resizing to a new size releases the old GPU texture and resizes the canvas', () => {
    const { sky, released } = sizedSky(800, 600);
    sky.resize(1200, 900);
    expect(released()).toBe(1);
    const canvas = sky.texture.image as HTMLCanvasElement;
    expect([canvas.width, canvas.height]).toEqual([1200, 900]);
  });

  it('#106 AC2 resizing to the same size keeps the texture', () => {
    const { sky, released } = sizedSky(800, 600);
    sky.resize(800, 600);
    expect(released()).toBe(0);
  });
});
