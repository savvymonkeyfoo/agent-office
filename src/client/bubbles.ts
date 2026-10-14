import * as THREE from 'three';
import type { BubbleKind } from './poses.ts';

const FILL: Record<BubbleKind, string> = { working: '#3FBF7F', needs: '#FFB648', finished: '#4D86FF', stale: '#D9D3E6' };
const INK: Record<BubbleKind, string> = { working: '#FFFFFF', needs: '#3A2400', finished: '#FFFFFF', stale: '#5B5275' };
const cache = new Map<BubbleKind, THREE.CanvasTexture | null>();

/** The prototype's speech bubbles, drawn once per kind. Null where there's no 2D canvas (tests). */
export function bubbleTexture(kind: BubbleKind) {
  if (!cache.has(kind)) cache.set(kind, draw(kind));
  return cache.get(kind)!;
}

function draw(kind: BubbleKind) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  let g: CanvasRenderingContext2D | null = null;
  try { g = canvas.getContext('2d'); } catch { /* no canvas support */ }
  if (!g) return null;

  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(78, 24); g.lineTo(178, 24); g.quadraticCurveTo(232, 24, 232, 92);
  g.quadraticCurveTo(232, 168, 178, 168); g.lineTo(150, 168); g.lineTo(128, 214); g.lineTo(112, 168);
  g.lineTo(78, 168); g.quadraticCurveTo(24, 168, 24, 92); g.quadraticCurveTo(24, 24, 78, 24); g.closePath();
  g.fillStyle = FILL[kind]; g.fill();
  g.lineWidth = 12; g.strokeStyle = '#2A2238'; g.stroke();
  g.fillStyle = INK[kind]; g.strokeStyle = INK[kind];
  if (kind === 'needs') {
    g.beginPath(); g.roundRect(114, 46, 28, 70, 14); g.fill();
    g.beginPath(); g.arc(128, 140, 15, 0, Math.PI * 2); g.fill();
  } else if (kind === 'finished') {
    g.lineWidth = 22; g.lineCap = 'round';
    g.beginPath(); g.moveTo(84, 98); g.lineTo(114, 128); g.lineTo(172, 66); g.stroke();
  } else if (kind === 'working') {
    // A cog: busy, not waiting.
    g.translate(128, 96);
    for (let i = 0; i < 8; i++) { g.rotate(Math.PI / 4); g.beginPath(); g.roundRect(-11, -62, 22, 26, 5); g.fill(); }
    g.beginPath(); g.arc(0, 0, 44, 0, Math.PI * 2); g.fill();
    g.fillStyle = FILL[kind]; g.beginPath(); g.arc(0, 0, 17, 0, Math.PI * 2); g.fill();
    g.setTransform(1, 0, 0, 1, 0, 0);
  } else {
    g.font = '800 72px Nunito, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('z', 102, 108); g.font = '800 54px Nunito, Arial, sans-serif'; g.fillText('z', 156, 78);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
