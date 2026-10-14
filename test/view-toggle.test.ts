// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { bindViewToggle, readCloseUp } from '../src/client/view-toggle.ts';

describe('close-up view toggle', () => {
  it('flips the view, reframes and remembers the choice', () => {
    const saved = new Map<string, string>();
    const storage = { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => void saved.set(k, v) };
    const button = document.createElement('button');
    const close = { on: readCloseUp(storage) };
    let reframes = 0;
    bindViewToggle(button, close, () => { reframes += 1; }, storage);
    expect(close.on).toBe(false);
    button.click();
    expect(close.on).toBe(true);
    expect(reframes).toBe(1);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(readCloseUp(storage)).toBe(true);
  });
});
