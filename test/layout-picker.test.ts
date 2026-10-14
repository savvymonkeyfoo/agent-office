// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { bindLayoutPicker, savedLayout } from '../src/client/layout-picker.ts';
import { OfficeController } from '../src/client/controller.ts';
import { officeLayout } from '../src/client/layout.ts';
import { ofType, rec } from './office-sim.ts';

const memoryStorage = () => {
  const items = new Map<string, string>();
  return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v) };
};
const brokenStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };

const setup = (storage?: Pick<Storage, 'getItem' | 'setItem'>) => {
  const host = document.createElement('div'), picked: string[] = [];
  const current = bindLayoutPicker(host, (id) => picked.push(id), storage);
  const button = (name: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === name)!;
  const marked = () => [...host.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.textContent);
  return { host, picked, current, button, marked };
};

describe('#104 layout picker', () => {
  it('#104 AC1 the picker lists Classic and Control room and marks the current one', () => {
    const { host, marked, button } = setup(memoryStorage());
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Classic', 'Control room']);
    expect(marked()).toEqual(['Control room']);
    button('Classic').click();
    expect(marked()).toEqual(['Classic']);
  });

  it('#104 AC1 the picker is on the page', () => {
    expect(readFileSync('index.html', 'utf8')).toMatch(/id="layout-picker"[^>]*aria-label="Office layout"/);
  });

  it('#104 AC2 picking one hands its preset id to the office (no reload)', () => {
    const { picked, button } = setup(memoryStorage());
    button('Classic').click();
    button('Control room').click();
    expect(picked).toEqual(['classic', 'control-room']);
  });

  it('#104 AC2 every agent keeps its session and state and is placed in the new layout', () => {
    const records = [rec(1, 'working'), rec(2, 'needs'), rec(3, 'done'), rec(4, 'stale')];
    const controlRoom = new OfficeController({}, 'control-room');
    const events = controlRoom.update(records);
    const arrivals = ofType(events, 'arrive');
    expect(arrivals.map((a) => [a.key, a.record.state])).toEqual(records.map((r) => [r.sessionId, r.state]));
    const seats = officeLayout(controlRoom.rows, 'control-room').seats;
    for (const a of arrivals) {
      expect(a.walk).toBe(false); // already there, not walking in through the door
      expect(seats[a.seat.index]).toEqual(a.seat);
    }
  });

  it('#104 AC3 the choice is saved and used on the next load', () => {
    const storage = memoryStorage();
    setup(storage).button('Classic').click();
    expect(savedLayout(storage)).toBe('classic');
    const reloaded = setup(storage);
    expect(reloaded.current).toBe('classic');
    expect(reloaded.marked()).toEqual(['Classic']);
  });

  it('#104 AC3 with nothing saved, or an unknown preset, the office is Control room (the default since #105)', () => {
    expect(savedLayout(memoryStorage())).toBe('control-room');
    const storage = memoryStorage();
    storage.setItem('agent-office.layout', 'moon-base');
    expect(savedLayout(storage)).toBe('control-room');
  });

  it('#104 AC3 with storage failing the office is Control room and the picker still works', () => {
    const { current, picked, button, marked } = setup(brokenStorage);
    expect(current).toBe('control-room');
    button('Classic').click();
    expect(picked).toEqual(['classic']);
    expect(marked()).toEqual(['Classic']);
  });

  it('#104 AC3 a localStorage accessor that throws falls back to Control room', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
    try {
      expect(savedLayout()).toBe('control-room');
    } finally {
      Object.defineProperty(window, 'localStorage', original);
    }
  });
});
