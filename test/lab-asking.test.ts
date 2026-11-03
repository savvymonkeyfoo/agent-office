// Innovation lab (#lab): an agent with a question waves at you from its chair. Lab chairs already
// face the camera, so unlike the control room it must not swivel round to the back wall.
import { describe, expect, it } from 'vitest';
import { labLayout } from '../src/client/lab.ts';

describe('#lab agents with a question face the camera', () => {
  it('keeps every seat turned towards the camera, with no turn-away for questions', () => {
    for (const seat of labLayout(3).seats) {
      expect(seat.askYaw, `seat ${seat.index}`).toBeUndefined();
      expect(Math.cos(seat.yaw), `seat ${seat.index} faces +z, the camera`).toBeGreaterThan(0.5);
    }
  });
});
