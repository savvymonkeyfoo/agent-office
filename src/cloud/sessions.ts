import type { AgentRecord, OfficeState, Question } from '../shared/agent.ts';

/** The parts of a Claude Code cloud session (from the Claude Code Remote `list_sessions` tool) the office uses. */
export interface CloudSession {
  id: string;
  title?: string;
  session_status?: string;
  status_bucket?: string;
  updated_at?: string;
  tags?: string[];
  parent_session_id?: string;
  /** The Projects project a thread session belongs to, filled in from its coordinator's title. */
  project_name?: string;
  session_context?: {
    sources?: { git_repository?: { url?: string } }[];
    outcomes?: { git_repository?: { git_info?: { repo?: string; branches?: string[] } } }[];
  };
  post_turn_summary?: { status_detail?: string; recent_action?: string; needs_action?: string };
  external_metadata?: {
    current_branches?: Record<string, string | null>;
    /** The session's progress checklist (Projects threads write one). */
    status?: { text?: string };
    rate_limit_info?: { status?: string; resetsAt?: number; rateLimitType?: string; isUsingOverage?: boolean };
    artifacts?: { title?: string; url?: string }[];
  };
  /** Filled in from the session's latest events while it waits on you. */
  question?: Question;
}

const HOUR = 3600_000;
const DAY = 24 * HOUR;

export function mapCloudState({ status_bucket: bucket, session_status: status }: CloudSession): OfficeState {
  const archived = status === 'SESSION_STATUS_ARCHIVED';
  switch (bucket) {
    case 'SESSION_STATUS_BUCKET_WORKING': return archived ? 'stale' : 'working';
    case 'SESSION_STATUS_BUCKET_BLOCKED': return archived ? 'stale' : 'needs';
    case 'SESSION_STATUS_BUCKET_REVIEW_READY': return archived ? 'finished' : 'done';
    case 'SESSION_STATUS_BUCKET_COMPLETED': return archived ? 'finished' : 'done';
    case 'SESSION_STATUS_BUCKET_FAILED': return 'stale';
    // ponytail: unknown buckets of a live session show as done; map them here if new ones appear.
    default: return archived ? 'finished' : 'done';
  }
}

/** Repo name (`owner/repo` → `repo`), or "Claude" for sessions without one. */
export function cloudProject(session: CloudSession) {
  if (session.project_name) return session.project_name;
  const repo = session.session_context?.outcomes?.find((o) => o.git_repository?.git_info?.repo)?.git_repository?.git_info?.repo
    ?? session.session_context?.sources?.find((s) => s.git_repository?.url)?.git_repository?.url;
  return repo?.replace(/\.git$/, '').split('/').filter(Boolean).at(-1) ?? 'Claude';
}

/** `owner/repo` the session works in, if any. */
function cloudRepo(session: CloudSession) {
  const named = session.session_context?.outcomes?.find((o) => o.git_repository?.git_info?.repo)?.git_repository?.git_info?.repo;
  const url = session.session_context?.sources?.find((s) => s.git_repository?.url)?.git_repository?.url;
  return named ?? url?.match(/github\.com\/([^/]+\/[^/.]+)/)?.[1] ?? null;
}

/** The checklist lines, without markdown bold. */
export function cloudProgress(session: CloudSession) {
  return (session.external_metadata?.status?.text ?? '').split('\n').map((l) => l.replace(/\*\*/g, '').trim()).filter(Boolean);
}

/** The session records no PR link, so search the repo's PRs for its branch; plus any artifacts it published. */
export function cloudLinks(session: CloudSession) {
  const links: { label: string; url: string }[] = [];
  const repo = cloudRepo(session);
  const branch = cloudBranch(session);
  if (repo && branch) links.push({ label: 'Pull request', url: `https://github.com/${repo}/pulls?q=${encodeURIComponent(`is:pr head:${branch}`)}` });
  for (const a of session.external_metadata?.artifacts ?? []) if (a.url?.startsWith('https://')) links.push({ label: a.title || 'Artifact', url: a.url });
  return links;
}

function cloudBranch(session: CloudSession) {
  const current = Object.values(session.external_metadata?.current_branches ?? {}).find(Boolean);
  return current ?? session.session_context?.outcomes?.[0]?.git_repository?.git_info?.branches?.[0] ?? null;
}

export function toCloudRecord(session: CloudSession): AgentRecord {
  const state = mapCloudState(session);
  const summary = session.post_turn_summary ?? {};
  const lastMessage = (state === 'needs' && summary.needs_action) || summary.status_detail || summary.recent_action || null;
  return {
    id: session.id,
    sessionId: session.id,
    name: session.title || 'Untitled session',
    project: cloudProject(session),
    cwd: '',
    state,
    lastMessage,
    branch: cloudBranch(session),
    activity: [summary.recent_action, summary.status_detail].filter((line): line is string => !!line),
    progress: cloudProgress(session),
    links: cloudLinks(session),
    ...(session.tags?.includes('hearth-overview') && { coordinator: true }),
    ...(state === 'needs' && session.question && { question: session.question }),
  };
}

/** Live sessions, plus ended ones touched in the last day (like the local office). */
export function buildCloudList(sessions: CloudSession[], now: number) {
  return sessions.map(toCloudRecord).filter((record, i) => {
    // Archived means you're done with it; it leaves the office.
    if (sessions[i].session_status === 'SESSION_STATUS_ARCHIVED') return false;
    const updated = Date.parse(sessions[i].updated_at ?? '');
    const age = Number.isFinite(updated) ? now - updated : Infinity;
    // Every project has a chat agent that's always around; show it while it's waiting on you, or for an hour after it was last active.
    if (record.coordinator) return record.state === 'needs' || age < HOUR;
    // Idle sessions pile up for weeks; keep only ones working, waiting on you, or touched in the last day.
    if (record.state === 'working' || record.state === 'needs') return true;
    return age < DAY;
  });
}

/** Pulls the session list out of a `list_sessions` payload, whatever wrapping it arrives in. */
export function sessionsFromPayload(payload: unknown): CloudSession[] {
  let value = payload;
  if (typeof value === 'string') {
    const start = value.indexOf('{');
    const end = value.lastIndexOf('}');
    try { value = JSON.parse(value.slice(start, end + 1)); } catch { return []; }
  }
  if (Array.isArray(value)) return value as CloudSession[];
  const v = value as { ccr?: { data?: unknown }; data?: unknown } | null;
  const list = v?.ccr?.data ?? v?.data;
  return Array.isArray(list) ? (list as CloudSession[]) : [];
}

/** Code-session ids (cse_…) and session ids (session_…) name the same session; claude.ai links use the latter. */
export const sessionUrl = (record: AgentRecord) => `https://claude.ai/code/${encodeURIComponent(record.sessionId.replace(/^cse_/, 'session_'))}`;
/** The same session in the Claude desktop app, through the claude:// links it registers. */
export const appUrl = (record: AgentRecord) => sessionUrl(record).replace(/^https:\/\//, 'claude://');

const QUESTION_CHARS = 4000;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, QUESTION_CHARS) : null);

/**
 * What a waiting session last asked, from its events newest first (GET /v1/code/sessions/{id}/events):
 * a Projects decision card (`ask_decision`: question, context and options), else a Projects thread
 * reply, else the agent's last plain text.
 */
export function questionFromEvents(events: unknown[]): Question | null {
  for (const event of events) {
    const payload = (event as { payload?: { type?: string; message?: { content?: unknown } } } | null)?.payload;
    if (payload?.type !== 'assistant' || !Array.isArray(payload.message?.content)) continue;
    const blocks = [...payload.message.content].reverse() as { type?: string; name?: string; text?: string; input?: Record<string, unknown> }[];
    for (const block of blocks) {
      const input = block.input ?? {};
      if (block.type === 'tool_use' && block.name?.endsWith('ask_decision')) {
        const question = str(input.question);
        if (!question) continue;
        const recommended = typeof input.recommended === 'number' ? input.recommended : -1;
        const options = (Array.isArray(input.options) ? input.options : []).flatMap((o: { label?: unknown; consequence?: unknown }, i) => {
          const label = str(o?.label);
          return label ? [{ label, ...(str(o.consequence) && { consequence: str(o.consequence)! }), ...(i === recommended && { recommended: true }) }] : [];
        });
        const context = str(input.context);
        return { text: context ? `${question}\n\n${context}` : question, ...(options.length && { options }) };
      }
      if (block.type === 'tool_use' && block.name?.endsWith('hearthbot__reply')) {
        const text = str(input.text);
        if (text) return { text };
      }
      if (block.type === 'text') {
        const text = str(block.text);
        if (text) return { text };
      }
    }
  }
  return null;
}
