// Innovation lab: a caption over each working or waiting agent saying what it's on (its current
// step, or the question it's waiting on), kept over its head as it moves. DOM text, so it stays
// sharp at any zoom; text is set with textContent.
import * as THREE from 'three';
import type { AgentRecord } from '../shared/agent.ts';
import { taskLine } from './lab-board.ts';

/** Captions are cut to this many characters (the card has the rest). */
const CAPTION_CHARS = 32;
/** Metres above an agent's feet. */
const ABOVE = 2.15;

export const captionText = (r: AgentRecord) => {
  const line = taskLine(r);
  return line.length > CAPTION_CHARS ? `${line.slice(0, CAPTION_CHARS - 1)}…` : line;
};

export interface Placed<T> { el: T; x: number; y: number }

/**
 * Lifts captions that would overlap one another: the lowest on screen (nearest the camera) stays
 * put, and any caption above it that it would cover moves up just clear of it. `x`, `y` are each
 * caption's bottom middle, in pixels.
 */
export function unclash<T>(placed: Placed<T>[], width: (el: T) => number, height: (el: T) => number, gap = 3): Placed<T>[] {
  const done: Placed<T>[] = [];
  for (const p of [...placed].sort((a, b) => b.y - a.y)) {
    let y = p.y;
    for (let moved = true; moved;) {
      moved = false;
      for (const q of done) {
        const apart = Math.abs(p.x - q.x) >= (width(p.el) + width(q.el)) / 2 + gap;
        if (apart || y <= q.y - height(q.el) - gap || y - height(p.el) >= q.y) continue;
        y = q.y - height(q.el) - gap;
        moved = true;
      }
    }
    done.push({ ...p, y });
  }
  return done;
}

export class LabCaptions {
  private layer: HTMLDivElement | null = null;
  private shown = new Map<string, HTMLDivElement>();
  private point = new THREE.Vector3();

  constructor(private host: HTMLElement) {}

  /** Call every frame: `records` (empty outside the lab) and where each agent's character is. */
  update(records: AgentRecord[], characters: Map<string, { root: THREE.Object3D }>, camera: THREE.Camera, canvas: HTMLCanvasElement) {
    const wanted = records.filter((r) => (r.state === 'working' || r.state === 'needs') && characters.has(r.sessionId));
    if (!wanted.length && !this.shown.size) return;
    if (!this.layer) {
      this.layer = document.createElement('div');
      this.layer.className = 'lab-captions';
      this.host.append(this.layer);
    }
    const keep = new Set(wanted.map((r) => r.sessionId));
    for (const [key, el] of this.shown) if (!keep.has(key)) { el.remove(); this.shown.delete(key); }
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const placed: Placed<HTMLDivElement>[] = [];
    for (const r of wanted) {
      let el = this.shown.get(r.sessionId);
      if (!el) {
        el = document.createElement('div');
        this.layer.append(el);
        this.shown.set(r.sessionId, el);
      }
      const text = captionText(r);
      if (el.textContent !== text) el.textContent = text;
      const cls = `lab-caption ${r.state}`;
      if (el.className !== cls) el.className = cls;
      const root = characters.get(r.sessionId)!.root;
      this.point.set(root.position.x, root.position.y + ABOVE, root.position.z).project(camera);
      const visible = this.point.z < 1 && Math.abs(this.point.x) < 1.05 && Math.abs(this.point.y) < 1.05;
      el.hidden = !visible;
      if (visible) placed.push({ el, x: ((this.point.x + 1) / 2) * w, y: ((1 - this.point.y) / 2) * h });
    }
    for (const p of unclash(placed, (el) => el.offsetWidth, (el) => el.offsetHeight)) {
      p.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
    }
  }
}
