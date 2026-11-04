import type { AgentRecord } from '../shared/agent.ts';
import { escapeHtml } from './markdown.ts';

const HIDDEN_KEY = 'agent-office:hidden-projects';
const WORK_KEY = 'agent-office:work-projects';
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
/** Projects marked as Capgemini work (/api/work-projects); every other project is personal. */
export const serverWorkSync = serverListSync('/api/work-projects');

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

/**
 * A list of projects with a checkbox each, to hide a whole project's agents from the office.
 * Tabs at the top narrow the list and the office to Capgemini (work) or personal projects;
 * each project's 💼/🏠 button marks which it is. Both are remembered in this browser, and with `sync` on the server too.
 */
export function mountProjectFilter(el: HTMLElement, onChange: () => void, sync?: HiddenSync, workSync?: ListSync) {
  const reload = () => { if (counts.size) render(); onChange(); };
  const hidden = syncedSet(HIDDEN_KEY, sync, reload);
  const work = syncedSet(WORK_KEY, workSync, reload);
  let tab = load<ProjectTab>(TAB_KEY, 'all');
  if (!TABS.some((t) => t.tab === tab)) tab = 'all';
  let collapsed = load<boolean>(COLLAPSED_KEY, false);
  let counts = new Map<string, number>();

  const inTab = (project: string) => tab === 'all' || (tab === 'work') === work.has(project);

  function render() {
    el.hidden = counts.size === 0;
    const listed = [...counts].filter(([project]) => inTab(project)).sort(([a], [b]) => a.localeCompare(b));
    const rows = listed.map(([project, n]) => {
      const isWork = work.has(project);
      const name = escapeHtml(project);
      return `
      <li><label><input type="checkbox" data-project="${name}" ${hidden.has(project) ? '' : 'checked'}>
        <span>${name}</span><b>${n}</b></label>
        <button class="kind" data-kind="${name}" aria-pressed="${isWork}"
          title="${isWork ? 'Capgemini project: click to make it personal' : 'Personal project: click to make it Capgemini'}"
          aria-label="${name} is ${isWork ? 'a Capgemini' : 'a personal'} project">${isWork ? '💼' : '🏠'}</button></li>`;
    }).join('');
    const empty = tab === 'work'
      ? '<p class="muted">No Capgemini projects yet. On All, tap 🏠 next to a project to mark it as Capgemini.</p>'
      : '<p class="muted">Every project here is marked Capgemini.</p>';
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
      button.onclick = () => { const project = button.dataset.kind!; work.toggle(project, !work.has(project)); render(); onChange(); };
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
