import type { LimitWindow, UsagePayload } from '../shared/usage.ts';
import { escapeHtml } from './markdown.ts';

const MINUTE = 60_000;
const REFRESH_MS = 30_000;
const COLLAPSED_KEY = 'agent-office:usage-collapsed';
const PHONE = '(max-width: 700px)';

const ENABLE_NOTE = 'Adds a status line to Claude Code’s settings.json that saves your plan limits for Agent Office. '
  + 'It shows nothing in your terminal and adds nothing to Claude’s context.';

export function formatResetIn(resetsAt: number, now: number) {
  const minutes = Math.max(1, Math.ceil((resetsAt - now) / MINUTE));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const parts = days ? [`${days}d`, `${hours}h`] : hours ? [`${hours}h`, `${minutes % 60}m`] : [`${minutes}m`];
  return `resets in ${parts.join(' ')}`;
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
export const formatTokens = (tokens: number) => compact.format(tokens);

function limitBar(label: string, window: LimitWindow | null, now: number) {
  const used = window ? Math.round(window.usedPercentage) : null;
  const fill = used == null ? 0 : Math.min(100, Math.max(0, used));
  return `
    <div class="limit">
      <div class="limit-line"><b>${label}</b><span>${used == null ? '—' : `${used}%`}</span>
        ${window ? `<span class="muted">${formatResetIn(window.resetsAt, now)}</span>` : ''}</div>
      <div class="bar" role="progressbar" aria-label="${label} limit used" aria-valuemin="0" aria-valuemax="100"
        ${used == null ? '' : `aria-valuenow="${used}"`}><span style="width:${fill}%"></span></div>
    </div>`;
}

const CLOUD_STATUS: Record<string, string> = { allowed: 'Within your limit', allowed_warning: 'Getting close to your limit', rejected: 'Limit reached' };

function cloudLimitLine({ cloud }: UsagePayload, now: number) {
  if (!cloud) return '<p class="muted">Your plan limit shows once a cloud session has replied.</p>';
  const label = cloud.window === 'five_hour' ? '5-hour limit' : cloud.window === 'seven_day' ? 'Weekly limit' : 'Plan limit';
  return `
    <div class="limit">
      <div class="limit-line"><b>${label}</b><span>${escapeHtml(CLOUD_STATUS[cloud.status] ?? cloud.status)}${cloud.overage ? ' (using extra usage)' : ''}</span>
        ${cloud.resetsAt ? `<span class="muted">${formatResetIn(cloud.resetsAt, now)}</span>` : ''}</div>
      <p class="muted">Cloud sessions report a status, not a percentage.</p>
    </div>`;
}

function trackingNotice({ tracking, limits }: UsagePayload, error: string | null) {
  const notice = (body: string) => `<div class="notice">${body}</div>`;
  if (tracking === 'off') {
    return notice(`<button class="btn primary" data-enable>Enable limit tracking</button><p>${ENABLE_NOTE}</p>`
      + (error ? `<p class="problem">${escapeHtml(error)}</p>` : ''));
  }
  if (tracking === 'other') return notice('<p>You already have a status line in Claude Code, so limit tracking can’t be added without replacing it.</p>');
  if (tracking === 'unreadable') return notice('<p>Couldn’t read Claude Code’s settings.json, so limit tracking can’t be set up.</p>');
  if (!limits.session && !limits.weekly) return notice('<p>Limits appear after your next Claude Code reply (Pro and Max plans only).</p>');
  return '';
}

function projectList({ projects, limits }: UsagePayload) {
  const label = limits.weekly ? 'Tokens this week' : 'Tokens, last 7 days';
  const rows = projects.map((p) => `<li data-project><span>${escapeHtml(p.project)}</span><b>${formatTokens(p.tokens)}</b></li>`).join('');
  return `<div class="section"><span class="label">${label}</span>${rows ? `<ul class="projects">${rows}</ul>` : '<p class="muted">None yet.</p>'}</div>`;
}

function readCollapsed(): boolean | null {
  try {
    const saved = localStorage.getItem(COLLAPSED_KEY);
    return saved == null ? null : saved === '1';
  } catch {
    return null;
  }
}

function saveCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    // Not remembered in this browser; the panel still works.
  }
}

interface PanelOptions {
  fetch?: typeof fetch;
  now?: () => number;
  isPhone?: () => boolean;
}

/** The plan usage panel: limit bars, then this week's tokens per project. */
export function mountUsagePanel(el: HTMLElement, {
  fetch: request = (...args) => fetch(...args),
  now = Date.now,
  isPhone = () => matchMedia(PHONE).matches,
}: PanelOptions = {}) {
  let collapsed = readCollapsed() ?? isPhone();
  let usage: UsagePayload | null = null;
  let enableError: string | null = null;

  function render() {
    const body = usage && 'cloud' in usage
      ? cloudLimitLine(usage, now())
      : usage
      ? limitBar('Session', usage.limits.session, now()) + limitBar('Week', usage.limits.weekly, now())
        + trackingNotice(usage, enableError) + projectList(usage)
      : '<p class="muted">Loading…</p>';
    el.innerHTML = `
      <div class="usage-head">
        <span class="label">Plan usage</span>
        <button class="btn icon" data-toggle aria-expanded="${!collapsed}" aria-controls="usage-body"
          aria-label="${collapsed ? 'Show' : 'Hide'} plan usage">${collapsed ? '▸' : '▾'}</button>
      </div>
      <div class="usage-body" id="usage-body" ${collapsed ? 'hidden' : ''}>${body}</div>`;
    el.querySelector<HTMLButtonElement>('[data-toggle]')!.onclick = () => {
      collapsed = !collapsed;
      saveCollapsed(collapsed);
      render();
    };
    const enable = el.querySelector<HTMLButtonElement>('[data-enable]');
    if (enable) enable.onclick = () => { enable.disabled = true; void enableTracking(); };
  }

  async function enableTracking() {
    try {
      const res = await request('/api/usage/enable', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      if (!res.ok) throw new Error(await res.text());
      usage = await res.json();
      enableError = null;
    } catch (error) {
      enableError = error instanceof Error && error.message ? error.message : 'Couldn’t enable limit tracking.';
    }
    render();
  }

  async function refresh() {
    try {
      const res = await request('/api/usage');
      if (res.ok) usage = await res.json();
    } catch {
      // Keep showing the last known usage.
    }
    render();
  }

  render();
  return { refresh };
}

/** Mounts the panel and keeps it fresh (limits, tokens and the reset countdown). */
export function startUsagePanel(el: HTMLElement) {
  const panel = mountUsagePanel(el);
  void panel.refresh();
  setInterval(() => void panel.refresh(), REFRESH_MS);
}
