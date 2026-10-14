import path from 'node:path';
import os from 'node:os';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export const MAX_PROJECTS = 200;
export const MAX_PROJECT_NAME = 200;

export function hiddenProjectsFile(homedir = os.homedir()) {
  return path.join(homedir, '.agent-office', 'hidden-projects.json');
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
