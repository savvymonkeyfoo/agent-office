// The Control room's screen wall (#102), filled from the feed: every agent by state in the centre,
// sessions by project on the left, the latest tool calls on the right.
import * as THREE from 'three';
import type { AgentRecord, OfficeState } from '../shared/agent.ts';
import { boardModel, type BoardModel } from './board.ts';
import { newCanvas } from './screen.ts';

/** Status colours: working green, needs-you amber, done blue (finished too: done, and ended), stale grey. */
export const STATUS_COLORS: Record<OfficeState, string> = {
  working: '#5BD68A', needs: '#FFB648', done: '#4D86FF', finished: '#4D86FF', stale: '#8C8FA0',
};

export interface ProjectRow { project: string; branches: string[]; states: OfficeState[] }
export interface ToolCall { session: string; line: string }
/** The centre board is the big board's tiles (every agent, in desk order), shown in state columns. */
export interface WallModel extends BoardModel { projects: ProjectRow[]; calls: ToolCall[] }

const COLUMNS: { label: string; states: OfficeState[] }[] = [
  { label: 'Working', states: ['working'] },
  { label: 'Needs you', states: ['needs'] },
  { label: 'Done', states: ['done', 'finished'] },
  { label: 'Stale', states: ['stale'] },
];

/** The centre board's columns: each agent's name under its state. */
export const stateColumns = ({ tiles }: BoardModel) => COLUMNS.map(({ label, states }) => ({
  label, color: STATUS_COLORS[states[0]], names: tiles.filter((t) => states.includes(t.state)).map((t) => t.name),
}));

/** One row per project (in desk order), with its branches and each session's state. */
export function projectRows(records: AgentRecord[]): ProjectRow[] {
  const rows = new Map<string, ProjectRow>();
  for (const r of records) {
    const row = rows.get(r.project) ?? rows.set(r.project, { project: r.project, branches: [], states: [] }).get(r.project)!;
    if (r.branch && !row.branches.includes(r.branch)) row.branches.push(r.branch);
    row.states.push(r.state);
  }
  return [...rows.values()];
}

/** Calls the right screen keeps. */
const CALLS_KEPT = 12;

/**
 * The latest tool calls across all agents, newest first. A record only carries its last few calls,
 * so each update adds the lines that weren't in that session's previous window.
 */
export class ToolLog {
  calls: ToolCall[] = [];
  private seen = new Map<string, string[]>();

  update(records: AgentRecord[]) {
    const fresh: ToolCall[] = [];
    for (const r of records) {
      const before = this.seen.get(r.sessionId) ?? [];
      for (const line of r.activity.slice(overlap(before, r.activity))) fresh.push({ session: r.name, line });
      this.seen.set(r.sessionId, r.activity);
    }
    const here = new Set(records.map((r) => r.sessionId));
    for (const id of this.seen.keys()) if (!here.has(id)) this.seen.delete(id);
    this.calls = [...fresh.reverse(), ...this.calls].slice(0, CALLS_KEPT);
  }
}

/** How many of `after`'s first lines are the end of `before` (the window slid along). */
function overlap(before: string[], after: string[]) {
  for (let k = Math.min(before.length, after.length); k > 0; k--) {
    if (after.slice(0, k).every((line, i) => line === before[before.length - k + i])) return k;
  }
  return 0;
}

export const WALL_CANVAS = { centre: { width: 1536, height: 720 }, side: { width: 900, height: 640 } };
const FONT = (size: number, weight = 800) => `${weight} ${size}px Nunito, Arial, sans-serif`;
const INK = '#F4EEE2', MUTED = '#B9B0D6', GLOW = '#59D3FF';

/** `text`, cut and ended with … if it's wider than `maxWidth` in the current font. */
function fit(g: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (g.measureText(text).width <= maxWidth) return text;
  let chars = text.length;
  while (chars > 0 && g.measureText(`${text.slice(0, chars)}…`).width > maxWidth) chars--;
  return `${text.slice(0, chars)}…`;
}

/** The dark gridded background and title every wall screen shares. */
function paintBase(g: CanvasRenderingContext2D, w: number, h: number, title: string, aside = '') {
  const shade = g.createLinearGradient?.(0, 0, 0, h);
  shade?.addColorStop(0, '#152246');
  shade?.addColorStop(1, '#0E1530');
  g.fillStyle = shade ?? '#121C3C';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(89,211,255,0.08)';
  g.lineWidth = 1;
  g.beginPath();
  for (let x = 0; x < w; x += 32) { g.moveTo(x, 0); g.lineTo(x, h); }
  for (let y = 0; y < h; y += 32) { g.moveTo(0, y); g.lineTo(w, y); }
  g.stroke();
  g.textBaseline = 'top';
  g.fillStyle = GLOW;
  g.font = FONT(44);
  g.fillText(title, 28, 20);
  if (aside) {
    g.textAlign = 'right';
    g.fillStyle = MUTED;
    g.font = FONT(34, 700);
    g.fillText(aside, w - 28, 26);
    g.textAlign = 'left';
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function paintCentre(g: CanvasRenderingContext2D, model: BoardModel) {
  const { width: w, height: h } = WALL_CANVAS.centre;
  paintBase(g, w, h, 'ALL SESSIONS', `${plural(model.tiles.length, 'session')} in the room`);
  const gap = 20, colW = (w - 56 - 3 * gap) / 4, rowH = 76, top = 158;
  const fits = Math.floor((h - top - 12) / rowH);
  stateColumns(model).forEach(({ label, color, names }, i) => {
    const x = 28 + i * (colW + gap);
    g.fillStyle = color;
    g.font = FONT(38);
    g.fillText(`${label.toUpperCase()}  ${names.length}`, x, 92);
    g.fillRect(x, 138, colW, 5);
    const shown = names.length > fits ? [...names.slice(0, fits - 1), `+${names.length - fits + 1} more`] : names;
    shown.forEach((name, j) => {
      const y = top + j * rowH;
      g.globalAlpha = 0.16;
      g.fillStyle = color;
      roundRect(g, x, y, colW, rowH - 10, 10);
      g.fill();
      g.globalAlpha = 1;
      g.fillStyle = INK;
      g.font = FONT(36, 700);
      g.fillText(fit(g, name, colW - 32), x + 14, y + 13);
    });
  });
}

export function paintProjects(g: CanvasRenderingContext2D, projects: ProjectRow[]) {
  const { width: w, height: h } = WALL_CANVAS.side;
  paintBase(g, w, h, 'PROJECTS', plural(projects.length, 'project'));
  const rowH = 108, top = 96, dot = 18, fits = Math.floor((h - top) / rowH);
  projects.slice(0, fits).forEach(({ project, branches, states }, row) => {
    const y = top + row * rowH;
    g.fillStyle = 'rgba(244,238,226,0.06)';
    roundRect(g, 28, y, w - 56, rowH - 12, 12);
    g.fill();
    const dots = Math.min(states.length, 8), textW = w - 96 - dots * 2.6 * dot;
    g.fillStyle = INK;
    g.font = FONT(40);
    g.fillText(fit(g, project, textW), 48, y + 8);
    g.fillStyle = MUTED;
    g.font = FONT(30, 700);
    g.fillText(fit(g, branches.join(' · ') || 'no branch', textW), 48, y + 56);
    states.slice(0, dots).forEach((state, k) => {
      g.fillStyle = STATUS_COLORS[state];
      g.beginPath();
      g.arc(w - 64 - k * 2.6 * dot, y + (rowH - 12) / 2, dot, 0, Math.PI * 2);
      g.fill();
    });
  });
}

const callColor = (tool: string) => /^(Ask|AskUserQuestion)$/.test(tool) ? STATUS_COLORS.needs : STATUS_COLORS.working;

export function paintCalls(g: CanvasRenderingContext2D, calls: ToolCall[]) {
  const { width: w, height: h } = WALL_CANVAS.side;
  paintBase(g, w, h, 'LIVE ACTIVITY');
  const rowH = 64, top = 100;
  calls.slice(0, Math.floor((h - top) / rowH)).forEach(({ session, line }, i) => {
    const y = top + i * rowH;
    const [tool, ...rest] = line.split(' ');
    g.globalAlpha = 1 - i * 0.05;
    g.font = FONT(32);
    g.fillStyle = callColor(tool);
    g.fillText(fit(g, tool, 120), 28, y);
    g.font = FONT(32, 700);
    g.fillStyle = MUTED;
    g.fillText(fit(g, session, 300), 160, y);
    g.fillStyle = INK;
    g.fillText(fit(g, rest.join(' '), w - 508), 480, y);
  });
  g.globalAlpha = 1;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** A canvas-drawn display `w` × `h` metres; paints when it has a DOM, stays a dark panel without one. */
class WallDisplay {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private drawn: ReturnType<typeof newCanvas>;
  private texture: THREE.CanvasTexture | null = null;

  constructor(w: number, h: number, canvas: { width: number; height: number }) {
    this.drawn = newCanvas(canvas.width, canvas.height);
    const material = new THREE.MeshBasicMaterial({ color: '#101A38', toneMapped: false });
    if (this.drawn) {
      this.texture = new THREE.CanvasTexture(this.drawn.canvas);
      this.texture.colorSpace = THREE.SRGBColorSpace;
      this.texture.anisotropy = 8;
      Object.assign(material, { map: this.texture, color: new THREE.Color('#FFFFFF') });
    }
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  }

  paint(draw: (g: CanvasRenderingContext2D) => void) {
    if (!this.drawn) return;
    draw(this.drawn.g);
    this.texture!.needsUpdate = true;
  }
}

/** The three wall screens' displays (`mesh` of each, to hang in its bezel), kept up to date from the occupants. */
export class ScreenWall {
  readonly centre: WallDisplay;
  readonly left: WallDisplay;
  readonly right: WallDisplay;
  model: WallModel = { tiles: [], projects: [], calls: [] };
  private log = new ToolLog();
  private key = '';
  /** The centre board's display (where the classic office has its big board). */
  get mesh() { return this.centre.mesh; }

  constructor(centre: { w: number; h: number }, side: { w: number; h: number }) {
    this.centre = new WallDisplay(centre.w, centre.h, WALL_CANVAS.centre);
    this.left = new WallDisplay(side.w, side.h, WALL_CANVAS.side);
    this.right = new WallDisplay(side.w, side.h, WALL_CANVAS.side);
    this.repaint();
  }

  /** Call every frame with each desk's agent; it only redraws when something changed. */
  update(occupants: Map<number, AgentRecord>) {
    const records = [...occupants].sort(([a], [b]) => a - b).map(([, r]) => r);
    const key = JSON.stringify(records);
    if (key === this.key) return;
    this.key = key;
    this.log.update(records);
    this.model = { ...boardModel(occupants), projects: projectRows(records), calls: this.log.calls };
    this.repaint();
  }

  private repaint() {
    this.centre.paint((g) => paintCentre(g, this.model));
    this.left.paint((g) => paintProjects(g, this.model.projects));
    this.right.paint((g) => paintCalls(g, this.model.calls));
  }
}
