import './style.css';
import { createOfficeScene } from './office-scene.ts';
import { renderCard, showTooltip } from './card.ts';
import { startUsagePanel } from './usage.ts';
import { mountProjectFilter, serverHiddenSync } from './projects.ts';
import { hasWebGL } from './webgl.ts';
import { sessionUrl } from '../cloud/sessions.ts';
import { startClock } from './clock.ts';
import { bindPetButton } from './pet-button.ts';
import type { AgentRecord, FeedPayload } from '../shared/agent.ts';

export { hasWebGL };

function showStatus(text: string | null, problem = false) {
  const status = document.getElementById('status')!;
  status.hidden = text == null;
  status.className = problem ? 'status problem' : 'status';
  status.textContent = text;
}

/** The 3D side, as the page sees it. Keys are session ids; null means the floor. */
export interface Office {
  show(records: AgentRecord[]): void;
  onPick(handle: (key: string | null) => void): void;
  onHover(handle: (key: string | null, x: number, y: number) => void): void;
  select?(key: string | null): void;
}

interface BootOptions {
  createOffice?: (host: HTMLElement) => Office;
}

export function boot({ createOffice }: BootOptions = {}) {
  if (!createOffice && !hasWebGL()) {
    showStatus("3D isn't available in this browser, so the office can't be shown. Try a browser with WebGL turned on.", true);
    return;
  }
  const office = (createOffice ?? createOfficeScene)(document.getElementById('scene')!);
  const card = document.getElementById('card')!;
  const tooltip = document.getElementById('tooltip')!;
  let records = new Map<string, AgentRecord>();
  let selected: string | null = null;
  /** The open card's last message is shown in full; kept across live re-renders of the same agent. */
  let expanded = false;
  showStatus(null);

  function select(key: string | null) {
    const next = key && records.has(key) ? key : null;
    if (next !== selected) expanded = false;
    selected = next;
    office.select?.(selected);
    if (!selected) { card.hidden = true; return; }
    renderCard(card, records.get(selected)!, {
      close: () => select(null),
      acknowledge,
      expanded,
      toggleMessage: () => { expanded = !expanded; select(selected); },
      // Cloud sessions (ids like session_… or cse_…) open on claude.ai instead of `claude attach`.
      openLink: /^(session|cse)_/.test(selected) ? sessionUrl : undefined,
    });
  }

  function acknowledge(record: AgentRecord) {
    // The server drops the session from the feed, and the agent walks out.
    fetch('/api/acknowledge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: record.sessionId }),
    }).then(() => select(null), () => select(selected));
  }

  office.onPick(select);
  office.onHover((key, x, y) => showTooltip(tooltip, key ? records.get(key) : undefined, x, y));

  const projects = mountProjectFilter(document.getElementById('projects')!, () => last && applyFeed(last), import.meta.env.VITEST ? undefined : serverHiddenSync);
  let last: FeedPayload | null = null;

  function applyFeed(payload: FeedPayload) {
    if (!Array.isArray(payload)) return showStatus(payload.error, true);
    last = payload;
    const shown = projects.filter(payload);
    records = new Map(shown.map((r) => [r.sessionId, r]));
    office.show(shown);
    showStatus(null);
    if (selected) select(selected);
  }

  return { applyFeed };
}

/** Dev builds only: `?idle=15` shows that many idle agents wandering, without a server (#89). */
const idleDemo = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get('idle')) : 0;

if (!import.meta.env.VITEST) {
  startUsagePanel(document.getElementById('usage')!);
  startClock(document.querySelector('.brand h1')!);
  const petButton = document.getElementById('pet');
  if (petButton instanceof HTMLButtonElement) bindPetButton(petButton);
  const app = boot();
  // Dev only (#102): `officeFeed([...records])` feeds the office by hand, e.g. to fill the screen wall.
  if (import.meta.env.DEV && app) Object.assign(window, { officeFeed: app.applyFeed });
  if (app && idleDemo) {
    app.applyFeed(Array.from({ length: idleDemo }, (_, i) => ({
      id: `idle-${i}`, sessionId: `idle-${i}`, name: `agent ${i + 1}`, project: 'demo', cwd: '/demo',
      state: 'done' as const, lastMessage: null, branch: null, activity: [],
    })));
  } else if (app) {
    const events = new EventSource('/api/events');
    events.onmessage = (e) => app.applyFeed(JSON.parse(e.data));
  }
}
