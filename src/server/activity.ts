import { posix, win32 } from 'node:path';

/** How many recent tool calls an agent record carries, and how long each line may be. */
const RECENT = 6;
const MAX_LINE = 60;

type Input = Record<string, unknown>;

/** The input field that names what each kind of tool works on; tools not listed show their name only. */
const TARGET: Record<string, string> = {
  Read: 'file_path', Edit: 'file_path', Write: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path',
  Glob: 'pattern', WebFetch: 'url', WebSearch: 'query', Agent: 'description', Task: 'description', Skill: 'skill',
};
const PATHS = new Set(['file_path', 'notebook_path', 'path']);

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** Paths inside `cwd` are shown relative to it; anything else as given. The cwd's own style decides the separators. */
function shown(file: string, cwd: string | undefined) {
  if (!cwd) return file;
  const path = /^[a-zA-Z]:|\\/.test(cwd) ? win32 : posix;
  if (!path.isAbsolute(file)) return file;
  const relative = path.relative(cwd, file);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : file;
}

function target(name: string, input: Input, cwd: string | undefined) {
  if (name === 'Bash') return text(input.command).split('\n')[0];
  if (name === 'Grep') return [`"${text(input.pattern)}"`, input.path ? shown(text(input.path), cwd) : ''].filter(Boolean).join(' ');
  const field = TARGET[name];
  const value = field ? text(input[field]) : '';
  return PATHS.has(field) ? shown(value, cwd) : value;
}

const clip = (line: string) => (line.length > MAX_LINE ? `${line.slice(0, MAX_LINE - 1)}…` : line);

export interface ToolCall { name: string; input: Input; cwd?: string }

/** One short line per tool call, e.g. `Edit src/client/card.ts`. Only the call itself: never its output. */
export function describeCall({ name, input, cwd }: ToolCall) {
  return clip([name, target(name, input ?? {}, cwd)].filter(Boolean).join(' '));
}

/** The last few tool calls, oldest first. */
export const recentActivity = (calls: ToolCall[]) => calls.slice(-RECENT).map(describeCall);
