// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { bindBackgroundToggle } from '../src/client/background-toggle.ts';

const memoryStorage = () => {
  const items = new Map<string, string>();
  return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v) };
};
const brokenStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };

const setup = (storage?: Pick<Storage, 'getItem' | 'setItem'>) => {
  const scene = new THREE.Scene(), sky = new THREE.Texture(), button = document.createElement('button');
  bindBackgroundToggle(button, scene, sky, storage);
  const isPlain = () => scene.background instanceof THREE.Color && scene.background.getHexString() === '2b2545';
  return { scene, sky, button, isPlain };
};

describe('#95 switch back to the plain background', () => {
  it('#95 AC1 pressing the toggle swaps the sky for plain #2B2545 and back', () => {
    const { scene, sky, button, isPlain } = setup(memoryStorage());
    expect(scene.background).toBe(sky);
    button.click();
    expect(isPlain()).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    button.click();
    expect(scene.background).toBe(sky);
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('#95 AC1 the toggle sits next to the camera button', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toMatch(/id="home"[\s\S]*?<\/button>\s*<button id="background"/);
  });

  it('#95 AC2 the choice survives a reload', () => {
    const storage = memoryStorage();
    setup(storage).button.click();
    expect(setup(storage).isPlain()).toBe(true);
    setup(storage).button.click();
    const reloaded = setup(storage);
    expect(reloaded.scene.background).toBe(reloaded.sky);
  });

  it('#95 AC3 with no saved choice the sky is shown', () => {
    const { scene, sky } = setup(memoryStorage());
    expect(scene.background).toBe(sky);
  });

  it('#95 AC3 with storage unavailable the sky is shown and the toggle still works', () => {
    const { scene, sky, button, isPlain } = setup(brokenStorage);
    expect(scene.background).toBe(sky);
    button.click();
    expect(isPlain()).toBe(true);
  });

  it('#95 AC3 a localStorage accessor that throws falls back to the sky', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
    try {
      const { scene, sky, button, isPlain } = setup();
      expect(scene.background).toBe(sky);
      button.click();
      expect(isPlain()).toBe(true);
    } finally {
      Object.defineProperty(window, 'localStorage', original);
    }
  });
});
