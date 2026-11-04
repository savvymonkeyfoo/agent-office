import path from 'node:path';
import os from 'node:os';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export const MAX_PROJECTS = 200;
export const MAX_PROJECT_NAME = 200;

export function hiddenProjectsFile(homedir = os.homedir()) {
  return path.join(homedir, '.agent-office', 'hidden-projects.json');
}

/** Which projects are Capgemini work and which are personal, as marked in the Projects panel. */
export function projectKindsFile(homedir = os.homedir()) {
  return path.join(homedir, '.agent-office', 'project-kinds.json');
}

export type ProjectKind = 'work' | 'personal';
/** A project nobody has marked yet counts as work. */
export const DEFAULT_KIND: ProjectKind = 'work';
const isKind = (v: unknown): v is ProjectKind => v === 'work' || v === 'personal';

/**
 * Each marked project's kind, kept on disk. Marks are set one project at a time,
 * so a browser tab with an old copy can't wipe marks made elsewhere.
 */
export function createProjectKindsStore(file = projectKindsFile()) {
  let kinds = readKinds(file);
  return {
    get: () => ({ ...kinds }),
    set(project: string, kind: ProjectKind) {
      if (kinds[project] === kind) return;
      const next = { ...kinds, [project]: kind };
      // Keep the newest marks if the list ever grows past the cap.
      const names = Object.keys(next);
      for (const old of names.slice(0, Math.max(0, names.length - MAX_PROJECTS))) delete next[old];
      kinds = next;
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(kinds, null, 2));
    },
  };
}

export type ProjectKindsStore = ReturnType<typeof createProjectKindsStore>;

/** A valid `{ project, kind }` mark, or null. */
export function projectMark(value: unknown): { project: string; kind: ProjectKind } | null {
  const v = value as { project?: unknown; kind?: unknown } | null;
  if (!v || typeof v.project !== 'string' || !v.project || v.project.length > MAX_PROJECT_NAME || !isKind(v.kind)) return null;
  return { project: v.project, kind: v.kind };
}

function readKinds(file: string): Record<string, ProjectKind> {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter(([p, k]) => p.length <= MAX_PROJECT_NAME && isKind(k)).slice(-MAX_PROJECTS)) as Record<string, ProjectKind>;
  } catch {
    return {};
  }
}

/**
 * Projects unticked in the office's Projects panel, kept on disk so every view
 * (the office in any browser, the desktop pet) hides the same ones.
 */
export function createHiddenProjectsStore(file = hiddenProjectsFile()) {
  let projects = read(file);
  return {
    get: () => [...projects],
    set(next: string[]) {
      projects = [...new Set(next)];
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(projects, null, 2));
    },
  };
}

export type HiddenProjectsStore = ReturnType<typeof createHiddenProjectsStore>;

/** A valid list of project names, or null. */
export function projectList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_PROJECTS) return null;
  return value.every((p) => typeof p === 'string' && p.length <= MAX_PROJECT_NAME) ? value : null;
}

function read(file: string): string[] {
  try {
    return projectList(JSON.parse(readFileSync(file, 'utf8'))) ?? [];
  } catch {
    return [];
  }
}
