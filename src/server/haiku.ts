// One place the office asks Claude Haiku for a few sentences: the briefing, the pet's lines, the stuck check and the ask box.
// It pays with an Anthropic API key kept only for the office (your API credit), else falls back to the
// `claude` CLI on your claude.ai login. It never reads ANTHROPIC_API_KEY or ANTHROPIC_BASE_URL: on a work
// laptop those point at the employer's gateway (e.g. Foundry), which must never pay for this.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeConfigDir } from './transcript.ts';
import { usesWorkProvider } from './cloud.ts';

export const MODEL = 'claude-haiku-5-5';
/** Where the office's own key can live, if not in AGENT_OFFICE_ANTHROPIC_KEY. */
export const keyFile = () => join(homedir(), '.agent-office', 'anthropic-key');
/** A ceiling on calls per day, so a bug can't drain the credit (Haiku costs about $0.001 a call here). */
const DAILY_CALLS = Number(process.env.AGENT_OFFICE_HAIKU_DAILY) || 400;

const WORK_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX'];

export type HaikuRoute = 'api' | 'login' | null;

export interface HaikuRequest {
  system: string;
  prompt: string;
  /** Room for the reply; Haiku thinks a little first, so leave some. */
  maxTokens?: number;
}

export interface Haiku {
  /** How calls are paid for: the office's API key, your claude.ai login through the CLI, or not at all. */
  route(): HaikuRoute;
  /** The reply text, or null when Haiku is off, over the daily cap, or the call failed. */
  ask(request: HaikuRequest): Promise<string | null>;
}

export function officeKey(env: NodeJS.ProcessEnv = process.env, read: (file: string) => string = (f) => readFileSync(f, 'utf8')) {
  const fromEnv = env.AGENT_OFFICE_ANTHROPIC_KEY?.trim();
  if (fromEnv) return fromEnv;
  try { return read(keyFile()).trim() || null; } catch { return null; }
}

const readSettings = () => { try { return JSON.parse(readFileSync(join(claudeConfigDir(), 'settings.json'), 'utf8')); } catch { return null; } };

interface HaikuOptions {
  env?: NodeJS.ProcessEnv;
  /** Tests swap the API and CLI calls. */
  callApi?: (key: string, request: HaikuRequest) => Promise<string | null>;
  callCli?: (request: HaikuRequest, env: NodeJS.ProcessEnv) => Promise<string | null>;
  workSettings?: () => boolean;
  now?: () => number;
}

export function createHaiku({ env = process.env, callApi = apiCall, callCli = cliCall, workSettings = () => usesWorkProvider(readSettings()), now = Date.now }: HaikuOptions = {}): Haiku {
  let day = '';
  let calls = 0;
  const route = (): HaikuRoute => {
    if (env.AGENT_OFFICE_HAIKU === '0') return null;
    if (officeKey(env)) return 'api';
    // The CLI fallback only runs on a plain claude.ai login: never through a work key or gateway.
    return env.AGENT_OFFICE_HAIKU === 'api' || workSettings() ? null : 'login';
  };
  return {
    route,
    async ask(request) {
      const via = route();
      if (!via) return null;
      const today = new Date(now()).toISOString().slice(0, 10);
      if (today !== day) { day = today; calls = 0; }
      if (++calls > DAILY_CALLS) return null;
      try {
        const text = via === 'api' ? await callApi(officeKey(env)!, request) : await callCli(request, env);
        return text?.trim() || null;
      } catch (error) {
        console.error(`Haiku call failed: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
        return null;
      }
    },
  };
}

/**
 * One Messages API call. Plain fetch rather than the Anthropic SDK, because the office ships with no runtime
 * dependencies (`npx` must download nothing). Explicit key and URL, so no work key or gateway in the environment is used.
 */
async function apiCall(key: string, { system, prompt, maxTokens = 2000 }: HaikuRequest) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      // Short summaries of status text: little thinking needed.
      output_config: { effort: 'low' },
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const body = await res.json() as { stop_reason?: string; content?: { type: string; text?: string }[] };
  if (body.stop_reason === 'refusal') return null;
  return (body.content ?? []).flatMap((block) => (block.type === 'text' && block.text ? [block.text] : [])).join('\n');
}

function cliCall({ system, prompt }: HaikuRequest, env: NodeJS.ProcessEnv) {
  const childEnv = { ...env };
  for (const key of WORK_KEYS) delete childEnv[key];
  return new Promise<string | null>((resolve) => {
    const child = execFile(env.CLAUDE_BIN || 'claude', ['-p', '--model', 'haiku'],
      // On Windows an npm-installed claude is a .cmd script, which only runs through the shell.
      { env: childEnv, cwd: tmpdir(), timeout: 120_000, maxBuffer: 1024 * 1024, shell: process.platform === 'win32', windowsHide: true },
      (error, stdout) => resolve(error ? null : String(stdout)));
    // Everything goes in on stdin: it can be long, and it's never parsed as arguments (or by the Windows shell).
    child.stdin?.end(`${system}\n\n${prompt}\n\nReply with only the answer text. Don't use any tools.`);
  });
}
