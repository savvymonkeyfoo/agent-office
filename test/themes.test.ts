// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { THEMES, bindThemePicker, savedTheme } from '../src/client/themes.ts';
import { lookFor } from '../src/client/look.ts';

describe('seasonal themes', () => {
  it('are off by default and remember the pick', () => {
    const saved = new Map<string, string>();
    const storage = { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => void saved.set(k, v) };
    expect(savedTheme(storage)).toBeNull();
    const host = document.createElement('div');
    const picks: (string | null)[] = [];
    bindThemePicker(host, (id) => picks.push(id), storage);
    const [off, halloween] = host.querySelectorAll('button');
    expect(off.getAttribute('aria-pressed')).toBe('true');
    halloween.click();
    expect(picks).toEqual(['halloween']);
    expect(savedTheme(storage)).toBe('halloween');
    off.click();
    expect(savedTheme(storage)).toBeNull();
  });

  it('dresses agents in witch hats with a real colour, and keeps coordinators crowned', () => {
    for (const n of [1, 2 ** 31 + 5, 2 ** 32 - 1]) {
      const look = THEMES.halloween.costume(lookFor('cse_a'), n);
      expect(look.hat).toBe('witch');
      expect(look.hatColor).toMatch(/^#/);
      expect(look.shirt).toMatch(/^#/);
    }
    expect(THEMES.halloween.costume(lookFor('cse_c', true), 7).hat).toBe('crown');
  });

  it('decorates the office', () => {
    const decor = THEMES.halloween.decorate({ left: -11, right: 22, back: -8, front: 12 }, () => 0);
    expect(decor.children.length).toBeGreaterThan(5);
  });
});
