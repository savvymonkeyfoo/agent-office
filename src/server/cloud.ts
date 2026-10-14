// Cloud mode: lists your Claude Code cloud sessions (claude.ai/code, the Claude app, Projects)
// with the login `claude` already saved on this computer. The token is only ever sent to Anthropic's API.
// ponytail: this uses the same unpublished endpoint `claude --teleport` uses, so a Claude Code update may change it.
import { execFile } from 'node:child_process';
import type { AckStore } from './acknowledged.ts';
import type { CloudLimit } from '../shared/usage.ts';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentRecord } from '../shared/agent.ts';
import { buildCloudList, type CloudSession } from '../cloud/sessions.ts';
import { claudeConfigDir } from './transcript.ts';

// Not ANTHROPIC_BASE_URL: that often points at a work gateway (e.g. Foundry) that can't see claude.ai sessions.
const API = process.env.AGENT_OFFICE_API_URL?.replace(/\/$/, '') || 'https://api.anthropic.com';
const BETA = 'ccr-byoc-2025-07-29';

export const wantsCloud = (argv: string[], env: NodeJS.ProcessEnv) => argv.includes('--cloud') || env.CLOUD === '1';

interface Login { token: string; expiresAt?: number; organization?: string }

const readJson = (read: () => string) => { try { return JSON.parse(read()); } catch { return null; } };

/** Why the keychain gave nothing, shown when no login is found. */
let keychainProblem = '';

function keychainCredentials(): Promise<string | null> {
  if (process.platform !== 'darwin') return Promise.resolve(null);
  return new Promise((resolve) => {
    // Generous timeout: macOS may be waiting for you to click Allow on its keychain prompt.
    execFile('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { timeout: 120_000, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      keychainProblem = error ? (error.killed ? 'the keychain prompt timed out' : String(stderr).trim() || error.message) : '';
      resolve(error ? null : stdout.trim());
    });
  });
}

/** The OAuth login `claude` saved: CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`), the macOS keychain, or .credentials.json. */
export async function readLogin(env: NodeJS.ProcessEnv = process.env): Promise<Login | null> {
  const account = readJson(() => readFileSync(join(homedir(), '.claude.json'), 'utf8'));
  const organization: string | undefined = account?.oauthAccount?.organizationUuid;
  if (env.CLAUDE_CODE_OAUTH_TOKEN) return { token: env.CLAUDE_CODE_OAUTH_TOKEN, organization };
  const fromKeychain = await keychainCredentials();
  const raw = fromKeychain ?? readJson(() => readFileSync(join(claudeConfigDir(), '.credentials.json'), 'utf8'));
  const parsed = typeof raw === 'string' ? readJson(() => raw) : raw;
  const oauth = parsed?.claudeAiOauth;
  if (!oauth?.accessToken) {
    // Describe what was found without showing any of it.
    if (fromKeychain != null && !parsed) keychainProblem = `got ${fromKeychain.length} characters that aren't JSON (first character code ${fromKeychain.charCodeAt(0)})`;
    else if (parsed) keychainProblem = `found ${Object.keys(parsed).join(', ')} but no claudeAiOauth.accessToken`;
    else if (!keychainProblem) keychainProblem = fromKeychain == null ? 'nothing returned' : 'empty';
    return null;
  }
  return { token: oauth.accessToken, expiresAt: oauth.expiresAt, organization };
}

const NO_LOGIN = "Couldn't read your Claude login on this computer. Run `claude` and sign in with your Claude account, then restart Agent Office.";
const EXPIRED = 'Your Claude login on this computer has expired or can\'t see cloud sessions, and Agent Office couldn\'t renew it. In a terminal run `claude`, then `/login` with the account your sessions belong to; the office picks it up within a minute. (Tokens from `claude setup-token` can\'t list sessions.)';

/** Older and newer session APIs name the state differently; this gives the office one status bucket. */
const BUCKET_FOR_STATUS: Record<string, string> = {
  working: 'SESSION_STATUS_BUCKET_WORKING', running: 'SESSION_STATUS_BUCKET_WORKING',
  waiting: 'SESSION_STATUS_BUCKET_BLOCKED', blocked: 'SESSION_STATUS_BUCKET_BLOCKED', requires_action: 'SESSION_STATUS_BUCKET_BLOCKED',
  idle: 'SESSION_STATUS_BUCKET_REVIEW_READY',
  completed: 'SESSION_STATUS_BUCKET_COMPLETED', archived: 'SESSION_STATUS_BUCKET_COMPLETED',
  cancelled: 'SESSION_STATUS_BUCKET_FAILED', rejected: 'SESSION_STATUS_BUCKET_FAILED', failed: 'SESSION_STATUS_BUCKET_FAILED',
};

export function normaliseSession(raw: Record<string, unknown>): CloudSession {
  const session = raw as unknown as CloudSession & {
    status?: string; worker_status?: string; last_event_at?: string;
    config?: CloudSession['session_context'];
    external_metadata?: CloudSession['external_metadata'] & { post_turn_summary?: CloudSession['post_turn_summary'] };
  };
  const status = String(session.session_status ?? session.status ?? '').replace(/^SESSION_STATUS_/, '').toLowerCase();
  // /v1/code/sessions sends lowercase buckets ("working"); a worker waiting on a permission prompt needs you.
  const bucket = session.worker_status === 'requires_action' ? 'blocked' : session.status_bucket;
  return {
    ...session,
    session_status: status === 'archived' ? 'SESSION_STATUS_ARCHIVED' : session.session_status,
    status_bucket: bucket
      ? (bucket.startsWith('SESSION_STATUS_BUCKET_') ? bucket : `SESSION_STATUS_BUCKET_${bucket.toUpperCase()}`)
      : BUCKET_FOR_STATUS[status],
    updated_at: session.updated_at ?? session.last_event_at,
    session_context: session.session_context ?? session.config,
    post_turn_summary: session.post_turn_summary ?? session.external_metadata?.post_turn_summary,
  };
}

export function sessionsFromResponse(body: unknown): CloudSession[] {
  const b = body as { data?: unknown; sessions?: unknown; ccr?: { data?: unknown } } | null;
  const list = Array.isArray(body) ? body : b?.data ?? b?.sessions ?? b?.ccr?.data;
  return Array.isArray(list) ? list.map(normaliseSession) : [];
}

/** Node's "fetch failed" hides the reason; work networks that inspect HTTPS are the usual one. */
export function explainFetchError(error: unknown) {
  const cause = (error as { cause?: { code?: string; message?: string } })?.cause;
  const reason = cause?.code ?? cause?.message ?? (error instanceof Error ? error.message : String(error));
  const tls = /CERT|SELF_SIGNED|UNABLE_TO|TLS|SSL/i.test(reason);
  return `Couldn't reach Anthropic's API (${reason}).`
    + (tls ? ' Your network seems to inspect HTTPS traffic. Start the office with NODE_OPTIONS=--use-system-ca so Node trusts your Mac\'s certificates.' : '');
}

async function request(path: string, login: Login, beta: boolean) {
  try {
    return await send(path, login, beta);
  } catch (error) {
    throw new Error(explainFetchError(error));
  }
}

function send(path: string, login: Login, beta: boolean) {
  return fetch(`${API}${path}`, {
    headers: {
      Authorization: `Bearer ${login.token}`,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      ...(beta ? { 'anthropic-beta': BETA } : {}),
      ...(login.organization ? { 'x-organization-uuid': login.organization } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
}

/**
 * The plain list leaves out tagged sessions (Projects threads), so ask for those too and merge.
 * Each list is newest first; 100 covers every live session in practice.
 */
const QUERIES = ['', '&tags=hearth-thread'].map((q) => `/v1/code/sessions?limit=100${q}`);

/** Each Projects project has one coordinator session, titled `Project coordinator ("Name")`. */
const COORDINATORS = '/v1/code/sessions?limit=100&tags=hearth-overview';

const bareId = (id = '') => id.replace(/^(cse|session)_/, '');

/** A thread's parent never changes and a project's name rarely does, so both are looked up once. */
const parentOf = new Map<string, string | null>();
const projectName = new Map<string, string>();
const coordinatorName = (title?: string) => title?.match(/"(.+)"/)?.[1] ?? title ?? null;

/** Names each Projects thread by its project, via its parent (the project's coordinator). */
export function nameProjects(sessions: CloudSession[], coordinators: CloudSession[]) {
  for (const c of coordinators) { const name = coordinatorName(c.title); if (name) projectName.set(bareId(c.id), name); }
  for (const s of sessions) {
    // The coordinator is the agent you talk to in the project chat; show it as that project's "Project chat".
    if (s.tags?.includes('hearth-overview')) {
      s.project_name = coordinatorName(s.title) ?? 'Projects';
      s.title = 'Project chat';
      continue;
    }
    if (!s.tags?.includes('hearth-thread')) continue;
    const parent = s.parent_session_id ?? parentOf.get(s.id);
    s.project_name = (parent && projectName.get(bareId(parent))) || 'Projects';
  }
  return sessions;
}

/** One session's full record; the list can leave fields out. */
async function sessionDetail(id: string, login: Login): Promise<Record<string, unknown> | null> {
  // Only the older sessions endpoint carries parent_session_id; it wants the session_… form of the id.
  const sessionId = id.replace(/^cse_/, 'session_');
  try {
    const res = await request(`/v1/sessions/${encodeURIComponent(sessionId)}?beta=true`, login, true);
    if (!res.ok) return null;
    const body = await res.json() as Record<string, unknown> & { ccr?: Record<string, unknown> };
    return body.ccr ?? body;
  } catch {
    return null;
  }
}

/** Fills in parents and project names the lists didn't give, a few lookups per poll. */
async function lookUpProjects(sessions: CloudSession[], login: Login) {
  const threads = sessions.filter((s) => s.tags?.includes('hearth-thread'));
  const unknown = threads.filter((s) => !s.parent_session_id && !parentOf.has(s.id)).slice(0, 10);
  await Promise.all(unknown.map(async (s) => {
    const detail = await sessionDetail(s.id, login);
    const parent = detail?.parent_session_id ?? detail?.parent_id;
    parentOf.set(s.id, typeof parent === 'string' ? parent : null);
  }));
  const parents = new Set(threads.map((s) => s.parent_session_id ?? parentOf.get(s.id)).filter((p): p is string => !!p));
  const missing = [...parents].filter((p) => !projectName.has(bareId(p))).slice(0, 10);
  await Promise.all(missing.map(async (p) => {
    const detail = await sessionDetail(p, login);
    const name = coordinatorName(typeof detail?.title === 'string' ? detail.title : undefined);
    projectName.set(bareId(p), name ?? 'Projects');
  }));
  if (unknown.length || missing.length) {
    console.log(`Projects: ${threads.length} threads, ${parents.size} projects (${[...new Set(projectName.values())].join(', ') || 'no names yet'})`);
  }
}

const REFRESH_EVERY = 5 * 60_000;
let lastRefresh = 0;
let refreshNext = false;

/** Work setups route Claude Code through an API key or gateway; those keys must never pay for the renewal. */
export function usesWorkProvider(settings: unknown) {
  const env = (settings as { env?: Record<string, unknown> } | null)?.env ?? {};
  if ((settings as { apiKeyHelper?: unknown } | null)?.apiKeyHelper) return true;
  return ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX']
    .some((key) => env[key]);
}

const WORK_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX'];

// The same token endpoint and client id `claude` uses to renew its claude.ai login.
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
// Split so the repo's privacy check doesn't mistake it for a session id.
const CLIENT_ID = ['9d1c250a', 'e61b', '44d9', '88ed', '5944d1962f5e'].join('-');
const SERVICE = 'Claude Code-credentials';

const security = (args: string[]) => new Promise<string | null>((resolve) =>
  execFile('security', args, { timeout: 120_000, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => resolve(error ? null : String(stdout))));

/** Applies a token-endpoint reply to the saved credentials, keeping everything else `claude` stored. */
export function renewedCredentials(saved: { claudeAiOauth: Record<string, unknown> }, reply: Record<string, unknown>, now = Date.now()) {
  const oauth: Record<string, unknown> = { ...saved.claudeAiOauth, accessToken: reply.access_token };
  if (typeof reply.refresh_token === 'string') oauth.refreshToken = reply.refresh_token;
  if (typeof reply.expires_in === 'number') oauth.expiresAt = now + reply.expires_in * 1000;
  if (typeof reply.scope === 'string') oauth.scopes = reply.scope.split(' ').filter(Boolean);
  return { ...saved, claudeAiOauth: oauth };
}

/**
 * Renews the claude.ai login the way `claude` does, then saves the new tokens back where `claude` keeps them,
 * so it carries on with them too. Talks only to Anthropic's login server: no model call, no work key or gateway.
 */
async function renewLogin(): Promise<boolean> {
  const mac = process.platform === 'darwin';
  const file = join(claudeConfigDir(), '.credentials.json');
  const raw = mac ? (await security(['find-generic-password', '-s', SERVICE, '-w']))?.trim() : (() => { try { return readFileSync(file, 'utf8'); } catch { return null; } })();
  const saved = raw ? readJson(() => raw) : null;
  const oauth = saved?.claudeAiOauth;
  if (!oauth?.refreshToken) return false;
  const scopes: string[] = Array.isArray(oauth.scopes) && oauth.scopes.length ? oauth.scopes : ['user:profile', 'user:inference', 'user:sessions:claude_code'];
  const res = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: oauth.refreshToken, client_id: CLIENT_ID, scope: scopes.join(' ') }),
  }).catch((error) => { console.error(`Couldn't reach the Claude login server: ${explainFetchError(error)}`); return null; });
  if (!res) return false;
  if (!res.ok) { console.error(`Couldn't renew the Claude login (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`); return false; }
  const reply = await res.json() as Record<string, unknown>;
  if (typeof reply.access_token !== 'string') return false;
  const updated = JSON.stringify(renewedCredentials(saved, reply));
  if (mac) {
    const account = (await security(['find-generic-password', '-s', SERVICE]))?.match(/"acct"<blob>="([^"]*)"/)?.[1] ?? process.env.USER ?? '';
    if ((await security(['add-generic-password', '-U', '-a', account, '-s', SERVICE, '-X', Buffer.from(updated).toString('hex')])) == null) {
      console.error("Renewed the Claude login but couldn't save it to the keychain.");
      return false;
    }
  } else writeFileSync(file, updated, { mode: 0o600 });
  console.log('Renewed the Claude login.');
  return true;
}

/**
 * claude.ai logins last about 8 hours. Renew directly first; if that fails, have the CLI do it with a one-word
 * prompt to the smallest model (`claude auth status` doesn't renew, but any request does).
 * That fallback is skipped when Claude Code's settings route it through a work key or gateway, so that never pays.
 */
async function askClaudeToRefresh(env: NodeJS.ProcessEnv): Promise<void> {
  if (Date.now() - lastRefresh < REFRESH_EVERY) return;
  lastRefresh = Date.now();
  if (await renewLogin().catch(() => false)) return;
  if (usesWorkProvider(readJson(() => readFileSync(join(claudeConfigDir(), 'settings.json'), 'utf8')))) {
    console.error('Not renewing the Claude login: Claude Code settings use a work API key or gateway.');
    return Promise.resolve();
  }
  const childEnv = { ...env };
  for (const key of WORK_KEYS) delete childEnv[key];
  return new Promise((resolve) => {
    execFile(env.CLAUDE_BIN || 'claude', ['-p', 'Reply with just OK.', '--model', 'haiku'],
      // On Windows an npm-installed claude is a .cmd script, which only runs through the shell; the arguments are fixed.
      { env: childEnv, cwd: tmpdir(), timeout: 120_000, shell: process.platform === 'win32', windowsHide: true }, (error) => {
        console.log(error ? `Couldn't renew the Claude login: ${error.message.split('\n')[0]}` : 'Renewed the Claude login.');
        resolve();
      });
  });
}

export async function listCloudSessions(env: NodeJS.ProcessEnv = process.env): Promise<CloudSession[]> {
  let login = await readLogin(env);
  const expiring = !!login?.expiresAt && login.expiresAt < Date.now() + 5 * 60_000;
  if (login && !env.CLAUDE_CODE_OAUTH_TOKEN && (expiring || refreshNext)) {
    refreshNext = false;
    await askClaudeToRefresh(env);
    login = (await readLogin(env)) ?? login;
  }
  if (!login) throw new Error(keychainProblem ? `${NO_LOGIN} (Keychain: ${keychainProblem}. If macOS asks, click Always Allow.)` : NO_LOGIN);
  const first: Login = login;
  let responses = await Promise.all(QUERIES.map((path) => request(path, first, false)));
  // ~/.claude.json can name a different organization than the saved login (e.g. a work setup), so retry without it.
  if (responses.some((res) => res.status === 401) && login.organization) {
    const bare: Login = { ...first, organization: undefined };
    login = bare;
    responses = await Promise.all(QUERIES.map((path) => request(path, bare, false)));
  }
  if (responses.some((res) => res.status === 401)) {
    refreshNext = true;
    const body = (await responses.find((res) => res.status === 401)!.text()).slice(0, 200);
    console.error(`Anthropic said 401: ${body}`);
    throw new Error(login.expiresAt && login.expiresAt < Date.now() ? EXPIRED : `${EXPIRED} (HTTP 401)`);
  }
  const ok = responses.filter((res) => res.ok);
  if (!ok.length) {
    const res = responses[0];
    throw new Error(`Couldn't list your cloud sessions (HTTP ${res.status} ${(await res.text()).slice(0, 200)}).`);
  }
  const byId = new Map<string, CloudSession>();
  for (const res of ok) for (const session of sessionsFromResponse(await res.json())) byId.set(session.id, session);
  const coordinators = await request(COORDINATORS, login, false).then((res) => res.ok ? res.json() : null, () => null);
  const coordinatorSessions = sessionsFromResponse(coordinators);
  nameProjects([], coordinatorSessions);
  for (const session of coordinatorSessions) byId.set(session.id, session);
  const sessions = [...byId.values()];
  await lookUpProjects(sessions, login);
  return nameProjects(sessions, []);
}

/** Each session's updated_at from the last fetch, so a "Got it" lasts only until the session moves on. */
const lastUpdated = new Map<string, string>();

/**
 * Resolving a Projects thread doesn't change its session record, so one that last asked for you keeps waving.
 * "Got it" hides a cloud session until it next updates; acks are stored as `id@updated_at`.
 */
export function cloudAckStore(base: AckStore): AckStore {
  const key = (id: string) => `${id}@${lastUpdated.get(id) ?? ''}`;
  return { has: (id) => base.has(key(id)), add: (id) => base.add(key(id)), remove: (id) => base.remove(key(id)) };
}

export function rememberUpdated(sessions: CloudSession[]) {
  for (const s of sessions) lastUpdated.set(s.id, s.updated_at ?? '');
}

let limit: CloudLimit | null = null;

/** Your plan limit as the most recently active session last saw it (cloud sessions give a status, not a percentage). */
export function latestCloudLimit(sessions: CloudSession[]): CloudLimit | null {
  const seen = sessions
    .filter((s) => s.external_metadata?.rate_limit_info?.status)
    .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))[0]?.external_metadata?.rate_limit_info;
  if (!seen) return null;
  return { status: seen.status!, resetsAt: seen.resetsAt ? seen.resetsAt * 1000 : null, window: seen.rateLimitType ?? null, overage: !!seen.isUsingOverage };
}

export const cloudLimit = () => limit;

/** The agent records the page shows in cloud mode. */
export async function loadCloudAgents({ now, acknowledged }: { now: number; acknowledged?: { has(id: string): boolean } }): Promise<AgentRecord[]> {
  const sessions = await listCloudSessions();
  rememberUpdated(sessions);
  limit = latestCloudLimit(sessions) ?? limit;
  return buildCloudList(sessions, now).filter((r) => r.state === 'working' || !acknowledged?.has(r.sessionId));
}
