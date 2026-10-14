import { execFile } from 'node:child_process';
import type { AgentEntry } from './agents.ts';

interface Command { command: string; args: string[] }

export const CLAUDE_AGENTS: Command = { command: 'claude', args: ['agents', '--json', '--all'] };

const NOT_INSTALLED = "Claude Code isn't installed or isn't on your PATH: install it (https://code.claude.com/docs/en/setup), then restart Agent Office.";
const TOO_OLD = "This version of Claude Code doesn't support `claude agents --json`: run `claude update`, then restart Agent Office.";

type ExecError = Error & { code?: string | number | null; stderr?: string };

/** One line saying what went wrong running claude, and how to fix it. */
export function explainClaudeError(error: ExecError, command = 'claude'): string {
  const stderr = String(error.stderr ?? '').trim();
  if (error.code === 'ENOENT' || /is not recognized as an internal or external command|: not found|command not found/i.test(stderr)) {
    return NOT_INSTALLED;
  }
  if (/unknown (command|option)|unrecognized|invalid choice/i.test(stderr)) return TOO_OLD;
  const detail = stderr.split('\n')[0] || error.message;
  return `\`${command} agents --json --all\` failed: ${detail}`;
}

/** Runs `claude agents --json --all` and returns its entries; throws a readable error. */
export function listClaudeAgents({ command, args }: Command = CLAUDE_AGENTS): Promise<AgentEntry[]> {
  return new Promise((resolve, reject) => {
    // On Windows, an npm-installed claude is a .cmd script, which only runs through the shell.
    // The arguments are fixed, so the shell sees no user input. A full path to an .exe runs directly.
    const shell = process.platform === 'win32' && !/\.exe$/i.test(command);
    execFile(command, args, { shell, timeout: 15_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error) return reject(new Error(explainClaudeError(Object.assign(error, { stderr }), command)));
      try {
        const entries = JSON.parse(stdout);
        if (!Array.isArray(entries)) throw new Error('not a list');
        resolve(entries);
      } catch {
        reject(new Error(`Couldn't read the output of \`${[command, ...args].join(' ')}\`.`));
      }
    });
  });
}
