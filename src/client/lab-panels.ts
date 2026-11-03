// The Innovation lab's panels, over the scene: a status strip under the clock, a "Waiting on you"
// list on the left, a needs-you pop-up (Show me / Next / Open thread) at the bottom right, and the
// latest activity at the bottom left. They only show in the lab (body.lab). Built with DOM calls
// and textContent, so session text never becomes markup.
import type { AgentRecord } from '../shared/agent.ts';
import { ToolLog } from './screen-wall.ts';
import { projectColor, taskLine } from './lab-board.ts';
import { sessionUrl } from '../cloud/sessions.ts';

/** The waiting list shows this many; the pop-up's Next steps through the rest. */
const LIST_MAX = 4;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** An element with a class and its children (strings become text). */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, ...children: (Node | string)[]) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children);
  return node;
}

/** Where a session's thread opens: its first link, or claude.ai for a cloud session; null when there's nowhere. */
export function threadUrl(r: AgentRecord): string | null {
  const link = r.links?.find((l) => /^https:\/\//.test(l.url));
  if (link) return link.url;
  return /^(session|cse)_/.test(r.sessionId) ? sessionUrl(r) : null;
}

/** The status strip's counts. */
export function statusCounts(records: AgentRecord[]) {
  const count = (states: string[]) => records.filter((r) => states.includes(r.state)).length;
  return {
    working: count(['working']),
    waiting: count(['needs']),
    idle: count(['done', 'finished', 'stale']),
    projects: new Set(records.map((r) => r.project)).size,
  };
}

export interface PanelHosts { strip: HTMLElement; list: HTMLElement; popup: HTMLElement; feed: HTMLElement }

/** Mounts the panels into `hosts`; `select` opens an agent's card. Call `update` with each feed. */
export function mountLabPanels(hosts: PanelHosts, select: (key: string) => void) {
  const log = new ToolLog();
  let waiting: AgentRecord[] = [];
  /** The waiting session the pop-up shows, kept across feeds while it's still waiting. */
  let current: string | null = null;
  /** Sessions passed over with Next, until they stop waiting. */
  let skipped = new Set<string>();

  function strip(records: AgentRecord[]) {
    if (!records.length) return hosts.strip.replaceChildren();
    const c = statusCounts(records);
    const item = (dot: string, text: string) => el('span', 'strip-item', el('span', `dot ${dot}`), text);
    hosts.strip.replaceChildren(
      item('working', plural(c.working, 'working', 'working')),
      item('needs', `${c.waiting} waiting on you`),
      item('idle', `${c.idle} idle`),
      el('span', 'strip-item', plural(c.projects, 'project')),
    );
  }

  function list() {
    hosts.list.hidden = !waiting.length;
    const items = waiting.slice(0, LIST_MAX).map((r) => {
      const swatch = el('span', 'swatch');
      swatch.style.background = projectColor(r.project);
      const button = el('button', 'needs-item', swatch, el('span', 'who', el('b', '', r.name), el('span', 'muted', r.project)));
      button.type = 'button';
      button.onclick = () => select(r.sessionId);
      return el('li', '', button);
    });
    const more = waiting.length - LIST_MAX;
    if (more > 0) items.push(el('li', 'muted needs-more', `and ${more} more (use Next below)`));
    hosts.list.replaceChildren(el('div', 'usage-head', el('span', 'label', `Waiting on you · ${waiting.length}`)), el('ul', 'needs-list', ...items));
  }

  function popup() {
    const pool = waiting.filter((r) => !skipped.has(r.sessionId));
    const shown = pool.find((r) => r.sessionId === current) ?? pool[0] ?? null;
    current = shown?.sessionId ?? null;
    hosts.popup.hidden = !shown;
    if (!shown) return hosts.popup.replaceChildren();
    const look = el('button', 'btn', 'Show me');
    look.type = 'button';
    look.onclick = () => select(shown.sessionId);
    const actions = el('div', 'popup-actions', look);
    const others = waiting.length - 1;
    if (others > 0) {
      const next = el('button', 'btn', `Next (${others})`);
      next.type = 'button';
      next.onclick = () => {
        skipped.add(shown.sessionId);
        // Round again once every waiting session has been passed over.
        if (waiting.every((r) => skipped.has(r.sessionId))) skipped = new Set([shown.sessionId]);
        current = null;
        popup();
      };
      actions.append(next);
    }
    const url = threadUrl(shown);
    if (url) {
      const open = el('a', 'btn primary', 'Open thread');
      open.href = url;
      open.target = '_blank';
      open.rel = 'noopener';
      actions.append(open);
    }
    hosts.popup.replaceChildren(
      el('div', 'popup-head', el('span', 'dot needs'), el('b', '', shown.name), ' needs you ', el('span', 'muted', shown.project)),
      el('p', 'popup-line', taskLine(shown)),
      actions,
    );
  }

  function feed(records: AgentRecord[]) {
    log.update(records);
    hosts.feed.hidden = !log.calls.length;
    const rows = log.calls.slice(0, 6).map((c) => {
      const [tool, ...rest] = c.line.split(' ');
      return el('li', '', el('b', '', tool), ' ', el('span', 'muted', c.session), ` ${rest.join(' ')}`);
    });
    hosts.feed.replaceChildren(el('div', 'usage-head', el('span', 'label', 'Activity')), el('ul', 'activity', ...rows));
  }

  return {
    update(records: AgentRecord[]) {
      waiting = records.filter((r) => r.state === 'needs');
      const still = new Set(waiting.map((r) => r.sessionId));
      skipped = new Set([...skipped].filter((k) => still.has(k)));
      strip(records);
      list();
      popup();
      feed(records);
    },
  };
}
