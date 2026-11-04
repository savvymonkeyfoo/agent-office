import type { AgentRecord } from '../shared/agent.ts';
import { escapeHtml } from './markdown.ts';

const HIDDEN_KEY = 'agent-office:hidden-projects';
const KINDS_KEY = 'agent-office:project-kinds';
const TAB_KEY = 'agent-office:projects-tab';
const COLLAPSED_KEY = 'agent-office:projects-collapsed';

/** Which projects the list (and the office) shows: everything, only work ones, or only personal ones. */
export type ProjectTab = 'all' | 'work' | 'personal';
const TABS: { tab: ProjectTab; label: string }[] = [
  { tab: 'all', label: 'All' },
  { tab: 'work', label: 'Capgemini' },
  { tab: 'personal', label: 'Personal' },
];

function load<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? '') as T; } catch { return fallback; }
}
function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* not remembered in this browser */ }
}

/** Where else a list of project names is kept: the office server, so the desktop pet and other browsers agree. */
export interface ListSync {
  /** The saved list; null when there isn't one (or the server can't be reached). */
  load(): Promise<string[] | null>;
  save(projects: string[]): void;
}
export type HiddenSync = ListSync;

/** Keeps a list of project names on the office server at `url`. */
export function serverListSync(url: string): ListSync {
  return {
    load: () => fetch(url).then((r) => (r.ok ? r.json() : null)).then((list) => (Array.isArray(list) ? list : null), () => null),
    save: (projects) => {
      fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(projects) }).catch(() => {});
    },
  };
}

/** Projects unticked in the list (/api/hidden-projects). */
export const serverHiddenSync = serverListSync('/api/hidden-projects');
export type ProjectKind = 'work' | 'personal';
export type ProjectKinds = Record<string, ProjectKind>;

/** Where each project's Capgemini/personal mark is kept besides this browser. */
export interface KindsSync {
  /** Every saved mark; null when the server can't be reached. */
  load(): Promise<ProjectKinds | null>;
  /** Saves one project's mark, so another tab's old copy can't overwrite the rest. */
  save(project: string, kind: ProjectKind): void;
}

/** Keeps marks on the office server (/api/project-kinds, saved in ~/.agent-office/project-kinds.json). */
export const serverKindsSync: KindsSync = {
  load: () => fetch('/api/project-kinds').then((r) => (r.ok ? r.json() : null))
    .then((v) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as ProjectKinds) : null), () => null),
  save: (project, kind) => {
    fetch('/api/project-kinds', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project, kind }) }).catch(() => {});
  },
};

/** A set of names kept in this browser and, with `sync`, on the server (whose copy wins). */
function syncedSet(key: string, sync: ListSync | undefined, onLoad: () => void) {
  const set = new Set<string>(load<string[]>(key, []));
  // A browser that kept names before the server did shares its own.
  sync?.load().then((saved) => {
    if (!saved || (!saved.length && set.size)) { if (set.size) sync.save([...set]); return; }
    set.clear();
    for (const name of saved) set.add(name);
    save(key, [...set]);
    onLoad();
  });
  return {
    has: (name: string) => set.has(name),
    toggle(name: string, on: boolean) {
      if (on) set.add(name); else set.delete(name);
      save(key, [...set]);
      sync?.save([...set]);
    },
  };
}

/** Capgemini/personal marks: the server's copy wins, and is read again whenever the office comes back into view. */
function syncedKinds(sync: KindsSync | undefined, onLoad: () => void) {
  let kinds = load<ProjectKinds>(KINDS_KEY, {});
  if (!kinds || typeof kinds !== 'object' || Array.isArray(kinds)) kinds = {};
  const refresh = () => sync?.load().then((saved) => {
    if (!saved) return;
    // A server that has never had marks (or lost its file) gets this browser's.
    if (!Object.keys(saved).length) { for (const [p, k] of Object.entries(kinds)) sync.save(p, k); return; }
    if (JSON.stringify(saved) === JSON.stringify(kinds)) return;
    kinds = saved;
    save(KINDS_KEY, kinds);
    onLoad();
  });
  refresh();
  if (sync && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  }
  return {
    /** Unmarked projects count as work. */
    isWork: (project: string) => kinds[project] !== 'personal',
    set(project: string, kind: ProjectKind) {
      kinds = { ...kinds, [project]: kind };
      save(KINDS_KEY, kinds);
      sync?.save(project, kind);
    },
  };
}

/**
 * A list of projects with a checkbox each, to hide a whole project's agents from the office.
 * Tabs at the top narrow the list and the office to Capgemini (work) or personal projects;
 * each project's 💼/🏠 button marks which it is (unmarked ones are work). Both are remembered
 * in this browser, and with `sync`/`kindsSync` on the server too.
 */
export function mountProjectFilter(el: HTMLElement, onChange: () => void, sync?: HiddenSync, kindsSync?: KindsSync) {
  const reload = () => { if (counts.size) render(); onChange(); };
  const hidden = syncedSet(HIDDEN_KEY, sync, reload);
  const work = syncedKinds(kindsSync, reload);
  let tab = load<ProjectTab>(TAB_KEY, 'all');
  if (!TABS.some((t) => t.tab === tab)) tab = 'all';
  let collapsed = load<boolean>(COLLAPSED_KEY, false);
  let counts = new Map<string, number>();

  const inTab = (project: string) => tab === 'all' || (tab === 'work') === work.isWork(project);

  function render() {
    el.hidden = counts.size === 0;
    const listed = [...counts].filter(([project]) => inTab(project)).sort(([a], [b]) => a.localeCompare(b));
    const rows = listed.map(([project, n]) => {
      const isWork = work.isWork(project);
      const name = escapeHtml(project);
      return `
      <li><label><input type="checkbox" data-project="${name}" ${hidden.has(project) ? '' : 'checked'}>
        <span>${name}</span><b>${n}</b></label>
        <button class="kind" data-kind="${name}" aria-pressed="${isWork}"
          title="${isWork ? 'Capgemini project: click to make it personal' : 'Personal project: click to make it Capgemini'}"
          aria-label="${name} is ${isWork ? 'a Capgemini' : 'a personal'} project">${isWork ? '💼' : '🏠'}</button></li>`;
    }).join('');
    const empty = tab === 'work'
      ? '<p class="muted">Every project here is marked personal.</p>'
      : '<p class="muted">No personal projects yet. Tap 💼 next to a project to mark it as personal.</p>';
    const tabs = TABS.map((t) => `<button class="chip" data-tab="${t.tab}" aria-pressed="${t.tab === tab}">${t.label}</button>`).join('');
    el.innerHTML = `
      <div class="usage-head">
        <span class="label">Projects</span>
        <button class="btn icon" data-toggle aria-expanded="${!collapsed}" aria-label="${collapsed ? 'Show' : 'Hide'} projects">${collapsed ? '▸' : '▾'}</button>
      </div>
      <div class="usage-body" ${collapsed ? 'hidden' : ''}>
        <div class="project-tabs" role="group" aria-label="Show projects">${tabs}</div>
        ${rows ? `<ul class="project-filter">${rows}</ul>` : empty}
      </div>`;
    el.querySelector<HTMLButtonElement>('[data-toggle]')!.onclick = () => { collapsed = !collapsed; save(COLLAPSED_KEY, collapsed); render(); };
    el.querySelectorAll<HTMLButtonElement>('button[data-tab]').forEach((button) => {
      button.onclick = () => { tab = button.dataset.tab as ProjectTab; save(TAB_KEY, tab); render(); onChange(); };
    });
    el.querySelectorAll<HTMLButtonElement>('button[data-kind]').forEach((button) => {
      button.onclick = () => { const project = button.dataset.kind!; work.set(project, work.isWork(project) ? 'personal' : 'work'); render(); onChange(); };
    });
    el.querySelectorAll<HTMLInputElement>('input[data-project]').forEach((box) => {
      box.onchange = () => { hidden.toggle(box.dataset.project!, !box.checked); onChange(); };
    });
  }

  return {
    /** Updates the list from the latest agents and returns the ones to show. */
    filter(records: AgentRecord[]) {
      const next = new Map<string, number>();
      for (const r of records) next.set(r.project, (next.get(r.project) ?? 0) + 1);
      if (JSON.stringify([...next]) !== JSON.stringify([...counts])) { counts = next; render(); }
      return records.filter((r) => !hidden.has(r.project) && inTab(r.project));
    },
  };
}
