// Agent Office as a claude.ai artifact: the office shows your Claude Code cloud sessions,
// read through the viewer's "Claude Code Remote" connector instead of a local server.
import './style.css';
import { createOfficeScene } from './office-scene.ts';
import { renderCard, showTooltip } from './card.ts';
import { hasWebGL } from './webgl.ts';
import { buildCloudList, sessionsFromPayload, sessionUrl } from '../cloud/sessions.ts';
import type { AgentRecord } from '../shared/agent.ts';

const SERVER = 'Claude Code Remote';
const TOOL = 'list_sessions';
const REFRESH_MS = 30_000;
const ACK_KEY = 'agent-office:acknowledged';

interface McpError { code: string; message?: string; server?: string }
type WatchEvent = { type: 'data'; result: { payload?: unknown } } | { type: 'error'; error: McpError };
interface Mcp {
  listTools(server?: string): Promise<{ servers: { server: string; authStatus: string; tools: { name: string }[] }[] }>;
  watchTool(server: string, tool: string, input: unknown, handler: (ev: WatchEvent) => void, options?: { cache?: { staleTime?: number }; refetchInterval?: number }): () => void;
}
declare global {
  interface Window { claude?: { use(name: string): Promise<unknown> } }
}

function showStatus(text: string | null, problem = false) {
  const status = document.getElementById('status')!;
  status.hidden = text == null;
  status.className = problem ? 'status problem' : 'status';
  status.textContent = text;
}

/** Per-viewer list of finished sessions sent out the door with Got it. */
function loadAcknowledged(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(ACK_KEY) ?? '[]')); } catch { return new Set(); }
}
function saveAcknowledged(ids: Set<string>) {
  try { localStorage.setItem(ACK_KEY, JSON.stringify([...ids].slice(-500))); } catch { /* storage blocked: Got it lasts this visit */ }
}

function explain(error: McpError) {
  switch (error.code) {
    case 'server_not_connected':
    case 'server_not_found':
      return `Add the ${SERVER} connector in claude.ai Settings → Connectors, then reload.`;
    case 'needs_reauth':
      return `Reconnect ${SERVER} in claude.ai Settings → Connectors, then reload.`;
    case 'not_in_manifest':
    case 'approval_required':
    case 'consent_required':
      return 'Agent Office needs your OK to read your Claude Code sessions. Open the artifact’s Permissions menu to allow it.';
    case 'selection_required':
      return `Choose which ${SERVER} connector to use when claude.ai asks, then reload.`;
    case 'not_granted':
    case 'capability_disabled':
    case 'capability_removed':
      return 'Open this page on claude.ai to see your Claude Code sessions.';
    default:
      return `Couldn’t read your sessions: ${error.message || error.code}. Retrying shortly.`;
  }
}

const RETRACT = new Set(['needs_reauth', 'server_not_connected', 'server_not_found', 'not_in_manifest', 'blocked_by_policy', 'approval_required', 'consent_required', 'not_granted']);

async function start() {
  if (!hasWebGL()) {
    showStatus("3D isn't available in this browser, so the office can't be shown. Try a browser with WebGL turned on.", true);
    return;
  }
  document.getElementById('usage')?.remove();
  const office = createOfficeScene(document.getElementById('scene')!);
  const card = document.getElementById('card')!;
  const tooltip = document.getElementById('tooltip')!;
  const acknowledged = loadAcknowledged();
  let sessions: unknown[] = [];
  let records = new Map<string, AgentRecord>();
  let selected: string | null = null;
  let expanded = false;

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
      openLink: sessionUrl,
    });
  }

  function render() {
    const list = buildCloudList(sessions as never, Date.now()).filter((r) => !acknowledged.has(r.sessionId));
    records = new Map(list.map((r) => [r.sessionId, r]));
    office.show(list);
    if (selected) select(selected);
  }

  function acknowledge(record: AgentRecord) {
    acknowledged.add(record.sessionId);
    saveAcknowledged(acknowledged);
    select(null);
    render();
  }

  office.onPick(select);
  office.onHover((key, x, y) => showTooltip(tooltip, key ? records.get(key) : undefined, x, y));

  showStatus('Finding your Claude Code sessions…');
  const mcp = (await window.claude?.use('mcp').catch(() => null)) as Mcp | null | undefined;
  if (!mcp) return showStatus('Open this page on claude.ai to see your Claude Code sessions.', true);

  mcp.watchTool(SERVER, TOOL, { limit: 50 }, (ev) => {
    if (ev.type === 'data') {
      sessions = sessionsFromPayload(ev.result.payload);
      render();
      showStatus(sessions.length ? null : 'No Claude Code sessions yet. Start one and it will walk in.');
      return;
    }
    if (RETRACT.has(ev.error.code)) { sessions = []; render(); }
    showStatus(explain(ev.error) + diagnosis, true);
    diagnose(mcp, ev.error);
  }, { cache: { staleTime: 15_000 }, refetchInterval: REFRESH_MS });
}

/** Adds what the connector actually offers to the error, so a wrong tool name is easy to spot. */
let diagnosis = '';
let diagnosed = false;
function diagnose(mcp: Mcp, error: McpError) {
  if (diagnosed) return;
  diagnosed = true;
  const add = (text: string) => {
    diagnosis = ` [${error.code}] ${text}`;
    document.getElementById('status')!.textContent += diagnosis;
  };
  mcp.listTools().then(({ servers }) => {
    const found = servers.map((s) => `${s.server} (${s.authStatus}): ${s.tools.map((t) => t.name).join(', ') || 'no tools'}`).join(' · ');
    add(`Connectors this page can see: ${found || 'none'}.`);
  }, (e: McpError) => add(`Couldn’t list connectors: ${e.code}.`));
}

start();
