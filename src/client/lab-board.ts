// The Innovation lab's wall board: "Waiting on you" and "Working on now" in the middle, the
// projects in the room (in their rug colours) on the left.
// Warm colours on a cream board, drawn on canvases like the Control room's screen wall.
import * as THREE from 'three';
import type { AgentRecord, OfficeState } from '../shared/agent.ts';
import { newCanvas, plainText } from './screen.ts';
import { boardModel, type BoardModel } from './board.ts';

/** Rug colours, one per project, picked by name so a project keeps its colour. */
export const PROJECT_COLORS = ['#E9785A', '#5FA8A0', '#E8B04A', '#8C7BC8', '#6FA35A', '#D9668F', '#4F8FC9', '#C9874E', '#9AA83E', '#5A9BB8'];

export function projectColor(project: string) {
  let h = 0;
  for (const ch of project) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PROJECT_COLORS[h % PROJECT_COLORS.length];
}

/** Warm status colours: working green, needs-you orange, done blue, stale grey. */
export const LAB_STATUS: Record<OfficeState, string> = {
  working: '#3FA66B', needs: '#F08A24', done: '#4F7FD9', finished: '#4F7FD9', stale: '#9A9188',
};

export interface BoardRow { name: string; project: string; line: string }
/** The big board's tiles too (every agent, in desk order), like the other layouts' boards. */
export interface LabBoardModel extends BoardModel {
  waiting: BoardRow[];
  working: BoardRow[];
  projects: { project: string; sessions: number; waiting: number }[];
}

/** What each session is up to, in a line: the question for a waiting one, the latest step for a working one. */
export function taskLine(r: AgentRecord) {
  if (r.state === 'needs') return plainText(r.lastMessage ?? '') || 'Waiting for your reply';
  const step = r.progress?.find((s) => !/^[✓✔x]/i.test(s.trim()));
  return (step ?? r.activity.at(-1) ?? plainText(r.lastMessage ?? '')).replace(/^[○◯•\-\s]+/, '');
}

export function labBoardModel(records: AgentRecord[]): LabBoardModel {
  const row = (r: AgentRecord): BoardRow => ({ name: r.name, project: r.project, line: taskLine(r) });
  const projects = new Map<string, { project: string; sessions: number; waiting: number }>();
  for (const r of records) {
    const p = projects.get(r.project) ?? projects.set(r.project, { project: r.project, sessions: 0, waiting: 0 }).get(r.project)!;
    p.sessions++;
    if (r.state === 'needs') p.waiting++;
  }
  return {
    tiles: [],
    waiting: records.filter((r) => r.state === 'needs').map(row),
    working: records.filter((r) => r.state === 'working').map(row),
    projects: [...projects.values()].sort((a, b) => b.waiting - a.waiting || b.sessions - a.sessions),
  };
}

export const LAB_CANVAS = { centre: { width: 1720, height: 800 }, side: { width: 740, height: 680 } };
const FONT = (size: number, weight = 800) => `${weight} ${size}px Nunito, Arial, sans-serif`;
const INK = '#3B2F25', MUTED = '#8A7A68', PAPER = '#FBF5EA', CARD = '#FFFFFF';

function fit(g: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (g.measureText(text).width <= maxWidth) return text;
  let chars = text.length;
  while (chars > 0 && g.measureText(`${text.slice(0, chars)}…`).width > maxWidth) chars--;
  return `${text.slice(0, chars)}…`;
}

function rounded(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function paintBase(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = PAPER;
  g.fillRect(0, 0, w, h);
  g.textBaseline = 'top';
  g.textAlign = 'left';
}

function heading(g: CanvasRenderingContext2D, x: number, y: number, text: string, count: number | null, color: string) {
  g.fillStyle = color;
  g.beginPath();
  g.arc(x + 16, y + 28, 15, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = INK;
  g.font = FONT(60);
  g.fillText(text, x + 44, y - 4);
  if (count != null) {
    const tw = g.measureText(text).width;
    g.fillStyle = color;
    g.font = FONT(56);
    g.fillText(String(count), x + 64 + tw, y - 2);
  }
}

/** A column of session cards: name and project on top, what it's on below. */
function cards(g: CanvasRenderingContext2D, rows: BoardRow[], x: number, top: number, w: number, h: number, accent: string, empty: string) {
  const cardH = 150, gap = 16, fits = Math.max(1, Math.floor((h - top + gap) / (cardH + gap)));
  if (!rows.length) {
    g.fillStyle = MUTED;
    g.font = FONT(36, 700);
    g.fillText(empty, x + 8, top + 16);
    return;
  }
  const shown = rows.length > fits ? rows.slice(0, fits - 1) : rows;
  shown.forEach((r, i) => {
    const y = top + i * (cardH + gap);
    g.fillStyle = CARD;
    rounded(g, x, y, w, cardH, 16);
    g.fill();
    g.fillStyle = accent;
    rounded(g, x, y, 10, cardH, 5);
    g.fill();
    g.fillStyle = projectColor(r.project);
    g.beginPath();
    g.arc(x + 40, y + 42, 14, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = INK;
    g.font = FONT(48);
    const name = fit(g, r.name, w * 0.45);
    g.fillText(name, x + 64, y + 16);
    g.fillStyle = MUTED;
    const nameW = g.measureText(name).width;
    g.font = FONT(38, 700);
    g.fillText(fit(g, r.project, w - 110 - nameW), x + 88 + nameW, y + 24);
    g.fillStyle = INK;
    g.font = FONT(42, 700);
    g.fillText(fit(g, r.line, w - 56), x + 32, y + 86);
  });
  if (rows.length > shown.length) {
    g.fillStyle = MUTED;
    g.font = FONT(32, 700);
    g.fillText(`+${rows.length - shown.length} more`, x + 8, top + shown.length * (cardH + gap) + 4);
  }
}

export function paintLabCentre(g: CanvasRenderingContext2D, model: LabBoardModel) {
  const { width: w, height: h } = LAB_CANVAS.centre;
  paintBase(g, w, h);
  const colW = (w - 3 * 36) / 2;
  heading(g, 36, 28, 'Waiting on you', model.waiting.length, LAB_STATUS.needs);
  heading(g, 72 + colW, 28, 'Working on now', model.working.length, LAB_STATUS.working);
  g.fillStyle = '#E8DCC8';
  g.fillRect(w / 2 - 2, 30, 4, h - 60);
  cards(g, model.waiting, 36, 120, colW, h - 20, LAB_STATUS.needs, 'Nothing needs you');
  cards(g, model.working, 72 + colW, 120, colW, h - 20, LAB_STATUS.working, 'Nobody is working');
}

export function paintLabProjects(g: CanvasRenderingContext2D, model: LabBoardModel) {
  const { width: w, height: h } = LAB_CANVAS.side;
  paintBase(g, w, h);
  g.fillStyle = INK;
  g.font = FONT(58);
  g.fillText('Projects', 32, 28);
  const rowH = 100, top = 116, fits = Math.floor((h - top) / rowH);
  if (!model.projects.length) {
    g.fillStyle = MUTED;
    g.font = FONT(42, 700);
    g.fillText('No sessions yet', 32, top);
  }
  model.projects.slice(0, fits).forEach((p, i) => {
    const y = top + i * rowH;
    g.fillStyle = projectColor(p.project);
    rounded(g, 32, y, 44, 70, 12);
    g.fill();
    g.fillStyle = INK;
    g.font = FONT(46);
    g.fillText(fit(g, p.project, w - 290), 96, y + 10);
    g.textAlign = 'right';
    if (p.waiting) {
      g.fillStyle = LAB_STATUS.needs;
      g.font = FONT(42);
      g.fillText(`${p.waiting} !`, w - 130, y + 10);
    }
    g.fillStyle = MUTED;
    g.font = FONT(42, 700);
    g.fillText(String(p.sessions), w - 40, y + 10);
    g.textAlign = 'left';
  });
}


class Display {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private drawn: ReturnType<typeof newCanvas>;
  private texture: THREE.CanvasTexture | null = null;

  constructor(w: number, h: number, canvas: { width: number; height: number }) {
    this.drawn = newCanvas(canvas.width, canvas.height);
    const material = new THREE.MeshBasicMaterial({ color: PAPER, toneMapped: false });
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

/** The board's two panels (the board and the projects beside it), kept up to date from the occupants. */
export class LabBoard {
  readonly centre: Display;
  readonly left: Display;
  model: LabBoardModel = labBoardModel([]);
  private key = '';

  constructor(centre: { w: number; h: number }, side: { w: number; h: number }) {
    this.centre = new Display(centre.w, centre.h, LAB_CANVAS.centre);
    this.left = new Display(side.w, side.h, LAB_CANVAS.side);
    this.repaint();
  }

  get mesh() { return this.centre.mesh; }

  /** Call every frame with each desk's agent; it only redraws when something changed. */
  update(occupants: Map<number, AgentRecord>) {
    const records = [...occupants].sort(([a], [b]) => a - b).map(([, r]) => r);
    const key = JSON.stringify(records);
    if (key === this.key) return;
    this.key = key;
    this.model = { ...labBoardModel(records), tiles: boardModel(occupants).tiles };
    this.repaint();
  }

  private repaint() {
    this.centre.paint((g) => paintLabCentre(g, this.model));
    this.left.paint((g) => paintLabProjects(g, this.model));
  }
}
