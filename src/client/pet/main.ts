import '@fontsource/nunito/700.css';
import '@fontsource/nunito/800.css';
import './pet.css';
import { hasWebGL } from '../webgl.ts';
import { sessionUrl } from '../../cloud/sessions.ts';
import { serverHiddenSync } from '../projects.ts';
import { createPetScene, type PetKind, type PetScene } from './scene.ts';
import { feedChanges, petStatus, shortName, type PetStatus } from './mood.ts';
import type { AgentRecord, FeedPayload } from '../../shared/agent.ts';

/** How long a one-off message ("… is done") stays up, and how long the bubble shows when work starts. */
const NOTE_MS = 8000;
const PEEK_MS = 5000;
/** How often to pick up projects hidden or shown again in the office. */
const HIDDEN_POLL_MS = 10_000;

/** The desktop app's side (mac/AgentPet.swift, or desktop-pet/ on Windows and Linux): it moves the window and opens links; absent in a plain browser. */
interface NativeBridge { postMessage(message: unknown): void }
const host = window as { webkit?: { messageHandlers?: { pet?: NativeBridge } }; petNative?: NativeBridge };
const native = host.webkit?.messageHandlers?.pet ?? host.petNative ?? null;

export interface Rect { x: number; y: number; width: number; height: number }

export interface PetOptions {
  kind: PetKind;
  /** Where the full office is (opened when there's no question to go to). */
  officeUrl: string;
  createScene?: (host: HTMLElement, kind: PetKind) => PetScene;
  open?: (url: string) => void;
  /** Tells the desktop app which parts of the window are the pet, so clicks elsewhere go through to what's behind. */
  reportHitAreas?: (rects: Rect[]) => void;
}

const div = (className: string) => Object.assign(document.createElement('div'), { className });

/** The desktop pet page: one character that shows what the office is up to, with a speech bubble. */
export function startPet(root: HTMLElement, { kind, officeUrl, createScene = createPetScene, open = defaultOpen, reportHitAreas }: PetOptions) {
  const bubble = div('pet-bubble'), text = document.createElement('span'), stage = div('pet-stage');
  text.className = 'pet-text';
  bubble.hidden = true;
  bubble.append(text);
  root.replaceChildren(bubble, stage);
  const scene = createScene(stage, kind);

  let status: PetStatus = petStatus(null);
  let records: AgentRecord[] | null = null;
  let note: { text: string; until: number } | null = null;
  let peekUntil = 0;
  let hovering = false;

  function render(now = Date.now()) {
    if (note && note.until <= now) note = null;
    // A waiting question always shows; otherwise a fresh note, then the status while peeking, hovered or offline.
    const shown = status.mood === 'needs' ? status.text
      : note ? note.text
      : (hovering || peekUntil > now || status.mood === 'offline') ? (status.text ?? 'All quiet in the office')
      : null;
    bubble.hidden = !shown;
    scene.showIcon(!shown);
    bubble.dataset.mood = note && status.mood !== 'needs' ? 'note' : status.mood;
    text.textContent = shown ?? '';
    root.dataset.mood = status.mood;
    reportHits();
  }

  let lastHits = '';
  function reportHits() {
    if (!reportHitAreas) return;
    const rects: Rect[] = [];
    const body = scene.bounds();
    if (body) rects.push({ ...body, y: body.y + stage.offsetTop });
    if (!bubble.hidden) {
      const r = bubble.getBoundingClientRect();
      rects.push({ x: r.left, y: r.top, width: r.width, height: r.height + 8 }); // and its tail
    }
    const rounded = rects.map((r) => ({ x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) }));
    const key = JSON.stringify(rounded);
    if (key !== lastHits) { lastHits = key; reportHitAreas(rounded); }
  }

  /** Projects unticked in the office's Projects panel: the pet leaves them out too. */
  let hidden = new Set<string>();
  let lastPayload: FeedPayload | null = null;

  function setHiddenProjects(projects: string[]) {
    const next = new Set(projects);
    if (next.size === hidden.size && [...next].every((p) => hidden.has(p))) return;
    hidden = next;
    // Re-read the last feed without announcing anything: only the filter changed.
    records = null;
    applyFeed(lastPayload);
  }

  function applyFeed(payload: FeedPayload | null) {
    lastPayload = payload;
    if (Array.isArray(payload) && hidden.size) payload = payload.filter((r) => !hidden.has(r.project));
    const next = petStatus(payload);
    const list = Array.isArray(payload) ? payload : null;
    if (list) {
      const changes = feedChanges(records, list);
      if (changes.newlyNeeding.length) scene.hop();
      if (changes.finished.length) {
        const [first] = changes.finished;
        note = { text: changes.finished.length === 1 ? `${shortName(first)} is done` : `${changes.finished.length} sessions are done`, until: Date.now() + NOTE_MS };
      }
      if (records && status.mood === 'idle' && next.mood === 'working') peekUntil = Date.now() + PEEK_MS;
    }
    records = list;
    status = next;
    scene.setMood(status.mood);
    render();
  }

  /** Clicking goes to the first question waiting (cloud sessions open on claude.ai), else the office. */
  function click() {
    const asking = status.needing[0];
    open(asking && /^(session|cse)_/.test(asking.sessionId) ? sessionUrl(asking) : officeUrl);
  }

  /** The pointer is over the pet: say what's going on. The desktop app calls this itself, since its window takes the mouse. */
  function hover(on: boolean) {
    hovering = on;
    render();
  }
  root.addEventListener('mouseenter', () => hover(true));
  root.addEventListener('mouseleave', () => hover(false));
  // Keeps notes expiring and the clickable area following the character as it moves.
  const timer = setInterval(() => render(), 250);

  return {
    applyFeed,
    setHiddenProjects,
    click,
    hover,
    get status() { return status; },
    stop() { clearInterval(timer); scene.dispose(); },
  };
}

function defaultOpen(url: string) {
  if (native) native.postMessage({ type: 'open', url });
  else window.open(url, '_blank', 'noopener');
}

if (!import.meta.env.VITEST) {
  const params = new URLSearchParams(location.search);
  const kind: PetKind = params.get('character') === 'dog' ? 'dog' : 'worker';
  const root = document.getElementById('pet')!;
  if (!hasWebGL()) {
    root.textContent = "3D isn't available here, so the pet can't be drawn.";
  } else {
    const pet = startPet(root, {
      kind,
      officeUrl: new URL('/', location.href).href,
      reportHitAreas: native ? (rects) => native.postMessage({ type: 'hit', rects }) : undefined,
    });
    // In a plain browser the page handles its own clicks; in the desktop app the window does (it also drags).
    if (!native) root.addEventListener('click', () => pet.click());
    Object.assign(window, { pet: { click: pet.click, hover: pet.hover, applyFeed: pet.applyFeed } });
    const events = new EventSource('/api/events');
    events.onmessage = (e) => pet.applyFeed(JSON.parse(e.data));
    // EventSource retries on its own; until it's back, the pet dozes.
    events.onerror = () => pet.applyFeed(null);
    const syncHidden = () => serverHiddenSync.load().then((list) => list && pet.setHiddenProjects(list));
    syncHidden();
    setInterval(syncHidden, HIDDEN_POLL_MS);
  }
}
