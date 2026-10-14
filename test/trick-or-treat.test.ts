import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { INITIAL_ROWS, officeLayout, overTheShoulder } from '../src/client/layout.ts';
import { Character } from '../src/client/character.ts';
import { lookFor } from '../src/client/look.ts';

const bucketOf = (c: Character) => c.hands[0].children.find((o) => o.children.some((m) => (m as THREE.Mesh).isMesh && ((m as THREE.Mesh).material as THREE.MeshToonMaterial).color?.getHexString() === 'f07a1a'));

describe('trick-or-treating', () => {
  const layout = officeLayout(INITIAL_ROWS);
  const seat = layout.seats[0];

  it('holds the treat bucket out when visiting a desk', () => {
    const visitor = new Character(lookFor('cse_v'), { trickOrTreat: true });
    visitor.placeAt(seat, 'done', overTheShoulder(layout, seat));
    for (let t = 1; t < 3; t += 0.1) visitor.update(t, 0.1);
    const bucket = bucketOf(visitor)!;
    expect(bucket).toBeDefined();
    expect(bucket.visible).toBe(true);
    expect(visitor.hands[0].position.z).toBeGreaterThan(0.3);
  });

  it('keeps the bucket away when sitting, and off without the theme', () => {
    const sitter = new Character(lookFor('cse_s'), { trickOrTreat: true });
    sitter.sitAt(seat, 'working');
    sitter.update(1, 0.1);
    expect(bucketOf(sitter)!.visible).toBe(false);
    expect(bucketOf(new Character(lookFor('cse_n')))).toBeUndefined();
  });
});
