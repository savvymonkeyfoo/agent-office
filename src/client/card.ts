import type { AgentRecord, OfficeState } from '../shared/agent.ts';
import { escapeHtml, renderMarkdown } from './markdown.ts';
import { clampTooltip } from './camera.ts';

export const STATE_LABEL: Record<OfficeState, string> = {
  working: 'Working',
  needs: 'Needs you',
  done: 'Done',
  stale: 'Stale',
  finished: 'Finished',
};


interface CardActions {
  close(): void;
  acknowledge(record: AgentRecord): void;
  /** Whether the last message is shown in full, and how to flip it. */
  expanded: boolean;
  toggleMessage(): void;
  /** Replaces the `claude attach` command with a link, e.g. to a cloud session on claude.ai. */
  openLink?: (record: AgentRecord) => string;
}

const PREVIEW_LINES = 4;
const PREVIEW_CHARS = 280;
const isLong = (text: string) => text.split('\n').length > PREVIEW_LINES || text.length > PREVIEW_CHARS;

function progressSection(record: AgentRecord) {
  const lines = record.progress?.length ? record.progress : record.activity;
  if (!record.progress || !lines.length) return '';
  const items = lines.map((line) => {
    const mark = line.match(/^([✓✱○])\s*/);
    return `<li class="${mark ? { '✓': 'done', '✱': 'now', '○': 'todo' }[mark[1]] : 'head'}">${escapeHtml(mark ? line.slice(mark[0].length) : line)}</li>`;
  }).join('');
  return `<div class="section"><span class="label">What it's doing</span><ul class="progress">${items}</ul></div>`;
}

function linkButtons(record: AgentRecord) {
  return (record.links ?? []).map((l) => `<a class="btn" href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.label)}</a>`).join('');
}

function messageSection(text: string | null, expanded: boolean) {
  if (!text) return '';
  const long = isLong(text);
  const collapsed = long && !expanded ? ' collapsed' : '';
  const toggle = long ? `<button class="btn link" data-more aria-expanded="${expanded}">${expanded ? 'Show less' : 'Show more'}</button>` : '';
  return `<div class="section"><span class="label">Last message</span><div class="desc${collapsed}">${renderMarkdown(text)}</div>${toggle}</div>`;
}

export const attachCommand = (record: AgentRecord) => `claude attach ${record.id}`;
export const canDismiss = (record: AgentRecord) => record.state === 'finished' || record.state === 'stale';

/** Fills the agent card: what it's doing and how to pick it up. */
export function renderCard(card: HTMLElement, record: AgentRecord, actions: CardActions) {
  const command = attachCommand(record);
  card.innerHTML = `
    <header>
      <h2>${escapeHtml(record.name)}</h2>
      <button class="btn icon" data-close aria-label="Close">×</button>
    </header>
    <div class="meta">
      <span>${escapeHtml(record.project)}</span>
      ${record.branch ? `<span>· ${escapeHtml(record.branch)}</span>` : ''}
      <span class="pill ${record.state}">${STATE_LABEL[record.state]}</span>
    </div>
    ${progressSection(record)}
    ${messageSection(record.lastMessage, actions.expanded)}
    <div class="section">
      <span class="label">Pick it up</span>
      ${actions.openLink
        ? `<div class="links"><a class="btn primary" href="${escapeHtml(actions.openLink(record))}" target="_blank" rel="noopener">Open session</a>${linkButtons(record)}</div>`
        : `<div class="command"><code>${escapeHtml(command)}</code><button class="btn" data-copy>Copy</button></div>`}
    </div>
    ${canDismiss(record) || (actions.openLink && record.state !== 'working') ? '<div><button class="btn primary" data-ack>Got it</button></div>' : ''}`;
  card.hidden = false;

  card.querySelector<HTMLButtonElement>('[data-close]')!.onclick = actions.close;
  const copy = card.querySelector<HTMLButtonElement>('[data-copy]');
  if (copy) copy.onclick = () => {
    navigator.clipboard?.writeText(command).then(() => { copy.textContent = 'Copied'; }, () => { copy.textContent = 'Copy failed'; });
  };
  const more = card.querySelector<HTMLButtonElement>('[data-more]');
  if (more) more.onclick = actions.toggleMessage;
  const ack = card.querySelector<HTMLButtonElement>('[data-ack]');
  if (ack) ack.onclick = () => { ack.disabled = true; actions.acknowledge(record); };
}

export function showTooltip(el: HTMLElement, record: AgentRecord | undefined, x: number, y: number) {
  el.hidden = !record;
  if (!record) return;
  el.innerHTML = `<span class="bright">${escapeHtml(record.project)}</span> <span class="dim">· ${escapeHtml(record.name)}</span>`;
  const stage = el.parentElement!;
  const at = clampTooltip(x, y, { width: el.offsetWidth, height: el.offsetHeight }, { width: stage.clientWidth, height: stage.clientHeight });
  el.style.left = `${at.x}px`;
  el.style.top = `${at.y}px`;
}
