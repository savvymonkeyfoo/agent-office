import { describe, expect, it } from 'vitest';
import type { AgentRecord, OfficeState } from '../src/shared/agent.ts';
import { OfficeController, type OfficeEvent } from '../src/client/controller.ts';
import { INITIAL_ROWS, officeLayout } from '../src/client/layout.ts';
import { lookFor } from '../src/client/look.ts';
import { POSES, screenColor } from '../src/client/poses.ts';
import { Character } from '../src/client/character.ts';
import { buildOffice, SCREEN_OFF, updateScreens } from '../src/client/office.ts';

const rec = (n: number, state: OfficeState = 'working'): AgentRecord => ({
  id: `a${n}`, sessionId: `session-${n}`, name: `agent ${n}`, project: 'demo-app',
  cwd: '/home/alex/projects/demo-app', state, lastMessage: null, branch: null, activity: [],
});
const START = officeLayout(INITIAL_ROWS);
const DOOR = START.door;
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => rec(from + i));
const seatOf = (c: OfficeController, n: number) => c.agents.get(`session-${n}`)?.seat.index;
const ofType = <T extends OfficeEvent['type']>(events: OfficeEvent[], type: T) =>
  events.filter((e): e is Extract<OfficeEvent, { type: T }> => e.type === type);

describe('#5 AC1 seating', () => {
  it('#5 AC1 new agents take the first free desk in order', () => {
    const c = new OfficeController();
    c.update(range(1, 3));
    expect([1, 2, 3].map((n) => seatOf(c, n))).toEqual([0, 1, 2]);
  });

  it('#5 AC1 agents keep their desk while others come and go; a leaver frees its desk', () => {
    const c = new OfficeController();
    c.update(range(1, 3));
    c.update([rec(1), rec(3)]); // 2 leaves
    expect(seatOf(c, 1)).toBe(0);
    expect(seatOf(c, 3)).toBe(2);
    c.update([rec(1), rec(3), rec(4)]); // 4 takes the freed desk
    expect(seatOf(c, 4)).toBe(1);
    c.update([rec(3), rec(4), rec(1)]); // order of the list doesn't matter
    expect([1, 3, 4].map((n) => seatOf(c, n))).toEqual([0, 2, 1]);
  });
});

describe('#5 AC2 more desks', () => {
  // #13 changed the unit: pods of 4, grown a whole row (2 pods) at a time, starting at 16 desks.
  // #25 changed it to curved rows of 8, starting with 2; a new row goes in behind the last.
  it('#5 AC2 adds desks when every desk is taken', () => {
    const c = new OfficeController();
    c.update(range(1, 16));
    expect(c.rows).toBe(2);
    c.update(range(1, 17));
    expect(c.rows).toBe(3);
    expect(seatOf(c, 17)).toBe(16);
    expect(officeLayout(3).seats[16].desk.z).toBeLessThan(officeLayout(2).seats[15].desk.z);
  });
});

describe('#5 AC3 poses and bubbles', () => {
  it('#5 AC3 each state has the prototype pose and bubble', () => {
    expect(POSES).toEqual({
      working: { pose: 'typing', bubble: 'working' },
      needs: { pose: 'waving', bubble: 'needs' },
      done: { pose: 'sipping', bubble: null },
      stale: { pose: 'slumped', bubble: 'stale' },
      finished: { pose: 'standing', bubble: 'finished' },
    });
  });

  it('#5 AC3 a state change reaches the agent and changes its pose and bubble', () => {
    const c = new OfficeController();
    c.update([rec(1)]);
    const events = c.update([rec(1, 'needs')]);
    expect(ofType(events, 'state')).toEqual([{ type: 'state', key: 'session-1', state: 'needs' }]);

    const character = new Character(lookFor('session-1'));
    character.sitAt(START.seats[0], 'working');
    character.update(1, 0.016);
    expect([character.pose, character.bubbleKind]).toEqual(['typing', 'working']);
    for (const state of ['needs', 'done', 'stale'] as const) {
      character.setState(state);
      character.update(2, 0.016);
      expect([character.pose, character.bubbleKind]).toEqual([POSES[state].pose, POSES[state].bubble]);
    }
    character.setState('finished');
    for (let t = 0; t < 2; t += 0.05) character.update(t, 0.05); // hops up beside the chair
    expect([character.pose, character.bubbleKind]).toEqual(['standing', 'finished']);
  });
});

describe('#5 AC4 walking in and out', () => {
  it('#5 AC4 a new agent walks from the door to its seat', () => {
    const c = new OfficeController();
    c.update([]);
    const [arrive] = ofType(c.update([rec(1)]), 'arrive');
    expect(arrive.walk).toBe(true);
    expect(arrive.path[0]).toEqual(DOOR);
    expect(arrive.path.at(-1)).toEqual(arrive.seat.sit);
  });

  it('#5 AC4 an agent that leaves the list walks from its desk to the door', () => {
    const c = new OfficeController();
    c.update([rec(1)]);
    const seat = c.agents.get('session-1')!.seat;
    const [leave] = ofType(c.update([]), 'leave');
    expect(leave.key).toBe('session-1');
    expect(leave.path[0]).toEqual(seat.sit);
    expect(leave.path.at(-1)).toEqual(DOOR);
    expect(c.agents.has('session-1')).toBe(false);
  });

  it('#20 AC4 an agent that reappears after being dismissed walks in from the door like a new arrival', () => {
    const c = new OfficeController();
    c.update([rec(1, 'finished')]);
    expect(ofType(c.update([]), 'leave')).toHaveLength(1); // Got it
    const [arrive] = ofType(c.update([rec(1, 'working')]), 'arrive');
    expect(arrive.key).toBe('session-1');
    expect(arrive.walk).toBe(true);
    expect(arrive.path[0]).toEqual(DOOR);
    expect(arrive.path.at(-1)).toEqual(arrive.seat.sit);
  });

  it('#5 AC4 the walked character ends at its seat, and leaves through the door', () => {
    const clock = { t: 0 };
    const c = new OfficeController({ now: () => clock.t });
    c.update([]);
    const [arrive] = ofType(c.update([rec(1)]), 'arrive');
    clock.t = 30; // #14: the controller knows when the walk-in ends
    const character = new Character(lookFor('session-1'));
    character.arrive(arrive.seat, 'working', arrive.path);
    for (let t = 0; t < 30 && character.mode !== 'seated'; t += 0.05) character.update(t, 0.05);
    expect(character.mode).toBe('seated');
    expect(character.root.position.x).toBeCloseTo(arrive.seat.sit.x);
    expect(character.root.position.z).toBeCloseTo(arrive.seat.sit.z);

    const [leave] = ofType(c.update([]), 'leave');
    character.leave(leave.path);
    for (let t = 0; t < 30 && character.mode !== 'gone'; t += 0.05) character.update(t, 0.05);
    expect(character.mode).toBe('gone');
    expect(Math.hypot(character.root.position.x - DOOR.x, character.root.position.z - DOOR.z)).toBeLessThan(0.5);
  });

  it('#5 AC4 agents already listed when the page opens are seated straight away', () => {
    const c = new OfficeController();
    const [arrive] = ofType(c.update([rec(1)]), 'arrive');
    expect(arrive.walk).toBe(false);
  });
});

describe('#5 AC5 look from session id', () => {
  it('#5 AC5 the same id always gives the same look; ids vary', () => {
    expect(lookFor('session-1')).toEqual(lookFor('session-1'));
    const looks = new Set(range(1, 30).map((r) => JSON.stringify(lookFor(r.sessionId))));
    expect(looks.size).toBeGreaterThan(10);
    const look = lookFor('session-7');
    expect(look.shirt).toMatch(/^#[0-9A-F]{6}$/i);
    expect(['headphones', 'cap', 'beanie', 'chef', 'tuft', 'bun']).toContain(look.hat);
  });
});

describe('#5 AC6 monitors', () => {
  it('#5 AC6 glow blue for working, amber for needs, dark otherwise', () => {
    expect(screenColor('working')).toBe('#7FB2FF');
    expect(screenColor('needs')).toBe('#FFB648');
    for (const s of ['done', 'stale', 'finished'] as const) expect(screenColor(s)).toBe(SCREEN_OFF);
  });

  // #38: the glow is the monitor's screen (where there's no canvas to draw the content on).
  it('#5 AC6 each desk shows its occupant, empty desks are dark', () => {
    const { seats } = buildOffice(2);
    updateScreens(seats, new Map([[0, rec(1, 'working')], [1, rec(2, 'needs')], [2, rec(3, 'done')]]), 0);
    const hex = (i: number) => `#${seats[i].screen.display.material.color.getHexString().toUpperCase()}`;
    expect([hex(0), hex(1), hex(2), hex(3)]).toEqual(['#7FB2FF', '#FFB648', SCREEN_OFF, SCREEN_OFF]);
  });
});
