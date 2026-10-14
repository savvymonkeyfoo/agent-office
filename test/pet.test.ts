// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { feedChanges, petStatus, shortName } from '../src/client/pet/mood.ts';
import { startPet } from '../src/client/pet/main.ts';
import { Dog } from '../src/client/dog.ts';
import type { PetScene } from '../src/client/pet/scene.ts';
import type { Mood } from '../src/client/pet/mood.ts';
import type { AgentRecord, OfficeState } from '../src/shared/agent.ts';

const rec = (id: string, name: string, state: OfficeState): AgentRecord => ({
  id, sessionId: id, name, project: 'Agent Office', cwd: '/', state, lastMessage: null, branch: null, activity: [],
});

describe('desktop pet mood', () => {
  it('a waiting question beats work, which beats nothing on', () => {
    expect(petStatus([rec('a', 'One', 'working'), rec('b', 'Two', 'needs')]).mood).toBe('needs');
    expect(petStatus([rec('a', 'One', 'working'), rec('b', 'Two', 'done')]).mood).toBe('working');
    expect(petStatus([rec('a', 'One', 'done'), rec('b', 'Two', 'stale'), rec('c', 'Three', 'finished')]).mood).toBe('idle');
    expect(petStatus([]).mood).toBe('idle');
  });

  it("no feed, or the office's error, means it can't reach the office", () => {
    expect(petStatus(null)).toMatchObject({ mood: 'offline', text: "Can't reach the office" });
    expect(petStatus({ error: 'Not signed in' }).mood).toBe('offline');
  });

  it('names one session, counts several', () => {
    expect(petStatus([rec('a', 'Halloween theme', 'needs')]).text).toBe('“Halloween theme” has a question for you');
    expect(petStatus([rec('a', 'One', 'needs'), rec('b', 'Two', 'needs')]).text).toBe('2 questions waiting for you');
    expect(petStatus([rec('a', 'Desktop pet', 'working')]).text).toBe('Working on “Desktop pet”');
    expect(petStatus([rec('a', 'One', 'working'), rec('b', 'Two', 'working')]).text).toBe('2 agents working');
    expect(petStatus([rec('a', 'One', 'done')]).text).toBeNull();
  });

  it('cuts long names short, and falls back to the project for a blank one', () => {
    const name = shortName(rec('a', 'A very long thread title that goes on and on about everything', 'needs'));
    expect(name.length).toBeLessThanOrEqual(42);
    expect(name.endsWith('…”')).toBe(true);
    expect(shortName(rec('a', '  ', 'needs'))).toBe('“Agent Office”');
  });

  it('spots new questions and finished work, but the first feed only primes it', () => {
    const before = [rec('a', 'One', 'working'), rec('b', 'Two', 'needs'), rec('c', 'Three', 'working')];
    expect(feedChanges(null, before)).toEqual({ newlyNeeding: [], finished: [] });
    const after = [rec('a', 'One', 'done'), rec('b', 'Two', 'needs'), rec('c', 'Three', 'needs'), rec('d', 'Four', 'needs')];
    const changes = feedChanges(before, after);
    expect(changes.finished.map((r) => r.id)).toEqual(['a']);
    expect(changes.newlyNeeding.map((r) => r.id)).toEqual(['c', 'd']);
  });
});

function fakeScene() {
  const calls = { moods: [] as Mood[], hops: 0, icon: true, disposed: false };
  const scene: PetScene = {
    setMood: (m) => calls.moods.push(m),
    showIcon: (show) => { calls.icon = show; },
    hop: () => { calls.hops++; },
    bounds: () => ({ x: 40, y: 80, width: 120, height: 150 }),
    dispose: () => { calls.disposed = true; },
  };
  return { scene, calls };
}

describe('desktop pet page', () => {
  let root: HTMLElement;
  beforeEach(() => {
    vi.useFakeTimers();
    root = document.createElement('div');
    document.body.replaceChildren(root);
  });
  afterEach(() => vi.useRealTimers());

  function start() {
    const { scene, calls } = fakeScene();
    const opened: string[] = [];
    const hits: unknown[] = [];
    const pet = startPet(root, {
      kind: 'worker', officeUrl: 'http://127.0.0.1:4321/', createScene: () => scene,
      open: (url) => opened.push(url), reportHitAreas: (rects) => hits.push(rects),
    });
    const bubble = () => root.querySelector<HTMLElement>('.pet-bubble')!;
    return { pet, calls, opened, hits, bubble };
  }

  it('keeps a waiting question up, and hides the icon bubble while it does', () => {
    const { pet, calls, bubble } = start();
    pet.applyFeed([rec('session_a', 'Halloween theme', 'needs')]);
    expect(bubble().hidden).toBe(false);
    expect(bubble().textContent).toBe('“Halloween theme” has a question for you');
    expect(bubble().dataset.mood).toBe('needs');
    expect(calls.moods.at(-1)).toBe('needs');
    expect(calls.icon).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(bubble().hidden).toBe(false);
  });

  it('says so when work starts, then quietens down to the icon', () => {
    const { pet, calls, bubble } = start();
    pet.applyFeed([rec('session_a', 'Desktop pet', 'done')]);
    expect(bubble().hidden).toBe(true);
    pet.applyFeed([rec('session_a', 'Desktop pet', 'working')]);
    expect(bubble().textContent).toBe('Working on “Desktop pet”');
    vi.advanceTimersByTime(6000);
    expect(bubble().hidden).toBe(true);
    expect(calls.icon).toBe(true);
    expect(calls.moods.at(-1)).toBe('working');
  });

  it('hovering shows what is going on', () => {
    const { pet, bubble } = start();
    pet.applyFeed([rec('session_a', 'One', 'done')]);
    pet.hover(true);
    expect(bubble().textContent).toBe('All quiet in the office');
    pet.hover(false);
    expect(bubble().hidden).toBe(true);
  });

  it('a session finishing gets a short note, and a new question a hop', () => {
    const { pet, calls, bubble } = start();
    pet.applyFeed([rec('session_a', 'Desktop pet', 'working'), rec('session_b', 'Other', 'done')]);
    vi.advanceTimersByTime(6000);
    pet.applyFeed([rec('session_a', 'Desktop pet', 'done'), rec('session_b', 'Other', 'done')]);
    expect(bubble().textContent).toBe('“Desktop pet” is done');
    expect(bubble().dataset.mood).toBe('note');
    vi.advanceTimersByTime(9000);
    expect(bubble().hidden).toBe(true);
    pet.applyFeed([rec('session_a', 'Desktop pet', 'done'), rec('session_b', 'Other', 'needs')]);
    expect(calls.hops).toBe(1);
  });

  it('dozes when the office goes away', () => {
    const { pet, calls, bubble } = start();
    pet.applyFeed(null);
    expect(calls.moods.at(-1)).toBe('offline');
    expect(bubble().textContent).toBe("Can't reach the office");
  });

  it("clicking opens the waiting session on claude.ai, else the office", () => {
    const { pet, opened } = start();
    pet.applyFeed([rec('session_a', 'One', 'working')]);
    pet.click();
    pet.applyFeed([rec('cse_b', 'Two', 'needs'), rec('session_c', 'Three', 'needs')]);
    pet.click();
    pet.applyFeed([rec('local-1', 'On this Mac', 'needs')]);
    pet.click();
    expect(opened).toEqual(['http://127.0.0.1:4321/', 'https://claude.ai/code/session_b', 'http://127.0.0.1:4321/']);
  });

  it('tells the Mac app where the character and bubble are, only when that changes', () => {
    const { pet, hits } = start();
    pet.applyFeed([rec('session_a', 'One', 'done')]);
    const count = hits.length;
    expect(hits.at(-1)).toEqual([{ x: 40, y: 80, width: 120, height: 150 }]);
    vi.advanceTimersByTime(2000);
    expect(hits.length).toBe(count);
    pet.applyFeed([rec('session_a', 'One', 'needs')]);
    expect((hits.at(-1) as unknown[]).length).toBe(2);
  });

  it('stop() lets the scene go', () => {
    const { pet, calls } = start();
    pet.stop();
    expect(calls.disposed).toBe(true);
  });
});

describe('the dog as a desktop pet', () => {
  it('trots on the spot: legs going, but it stays put', () => {
    const dog = new Dog();
    dog.placeAt({ x: 0, z: 0 }, false);
    dog.trotting = true;
    const legs = dog.root.children[0].children.slice(-4);
    const swings = new Set<number>();
    for (let i = 1; i <= 20; i++) {
      dog.update(i * 0.05, 0.05);
      swings.add(Math.round(legs[0].rotation.x * 100));
    }
    expect(swings.size).toBeGreaterThan(3);
    expect([dog.root.position.x, dog.root.position.z]).toEqual([0, 0]);
  });

  it('lying down beats trotting', () => {
    const dog = new Dog();
    dog.placeAt({ x: 0, z: 0 }, true);
    dog.trotting = true;
    dog.update(1, 0.05);
    const legs = dog.root.children[0].children.slice(-4);
    expect(legs.every((leg) => Math.abs(leg.rotation.x - Math.PI / 2) < 1e-9)).toBe(true);
  });
});
