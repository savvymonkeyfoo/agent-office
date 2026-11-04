// What the office notices between polls, and the few places Haiku turns that into words:
// a "while you were away" briefing, the pet's spoken lines, a check on threads that look stuck, and the ask box.
// Every feature has a plain fallback, so the office still works with Haiku off.
import type { AgentRecord } from '../shared/agent.ts';
import type { Haiku } from './haiku.ts';

export type ChangeKind = 'started' | 'asked' | 'finished' | 'step' | 'stuck';

export interface Change {
  at: number;
  kind: ChangeKind;
  sessionId: string;
  name: string;
  project: string;
  /** What it asked, finished with, or the steps it ticked off. */
  detail: string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Changes kept for briefings and questions. */
const KEEP_MS = 48 * HOUR;
const MAX_CHANGES = 400;
const clip = (text: string | null | undefined, max: number) => {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

const done = (lines: string[] = []) => lines.filter((l) => l.startsWith('✓')).map((l) => l.replace(/^✓\s*/, ''));
/** The checklist step a session is on now, else its latest line of news. */
export const currentStep = (r: AgentRecord) =>
  r.progress?.find((l) => l.startsWith('✱'))?.replace(/^✱\s*/, '') ?? r.lastMessage ?? r.activity.at(-1) ?? '';

/** What changed between two feeds. The first feed only primes it, so starting the office announces nothing. */
export function describeChanges(previous: AgentRecord[] | null, next: AgentRecord[], now: number): Change[] {
  if (!previous) return [];
  const before = new Map(previous.map((r) => [r.sessionId, r]));
  const changes: Change[] = [];
  const add = (kind: ChangeKind, r: AgentRecord, detail: string) =>
    changes.push({ at: now, kind, sessionId: r.sessionId, name: r.name, project: r.project, detail: clip(detail, 400) });
  for (const r of next) {
    const was = before.get(r.sessionId);
    if (!was) { if (r.state === 'working') add('started', r, currentStep(r)); continue; }
    if (r.state === 'needs' && was.state !== 'needs') add('asked', r, r.question?.text ?? r.lastMessage ?? '');
    else if (was.state === 'working' && (r.state === 'done' || r.state === 'finished')) add('finished', r, r.lastMessage ?? '');
    const ticked = done(r.progress).filter((step) => !done(was.progress).includes(step));
    if (ticked.length && r.state === 'working') add('step', r, ticked.join('; '));
  }
  return changes;
}

/** One line per session, for prompts. */
export function recordLine(r: AgentRecord) {
  const parts = [`[${r.state}] ${r.project} / "${r.name}"`];
  const step = currentStep(r);
  if (step) parts.push(`now: ${clip(step, 160)}`);
  if (r.progress?.length) parts.push(`checklist: ${done(r.progress).length} of ${r.progress.filter((l) => /^[✓✱○]/.test(l)).length} done`);
  if (r.state === 'needs') parts.push(`asks: ${clip(r.question?.text ?? r.lastMessage, 400)}`);
  else if (r.lastMessage && r.lastMessage !== step) parts.push(`last: ${clip(r.lastMessage, 200)}`);
  if (r.stuck) parts.push(`may be stuck: ${clip(r.stuck, 160)}`);
  return `- ${parts.join(' | ')}`;
}

const changeLine = (c: Change, now: number) =>
  `- ${Math.max(0, Math.round((now - c.at) / MINUTE))} min ago, ${c.project} / "${c.name}" ${{ started: 'started', asked: 'asked you', finished: 'finished', step: 'ticked off', stuck: 'looks stuck' }[c.kind]}${c.detail ? `: ${c.detail}` : ''}`;

const VOICE = 'Write in plain, warm Australian English. Use contractions. No markdown, headings, bullet points or emoji. Call threads by their names. Never invent facts that are not in the data.';

/** The briefing without Haiku: counts and names. */
export function plainBriefing(changes: Change[], records: AgentRecord[]) {
  const needing = records.filter((r) => r.state === 'needs');
  const finished = [...new Set(changes.filter((c) => c.kind === 'finished').map((c) => c.name))];
  const working = records.filter((r) => r.state === 'working');
  const parts: string[] = [];
  if (needing.length) parts.push(`${needing.length === 1 ? `"${needing[0].name}" needs you` : `${needing.length} threads need you: ${needing.map((r) => `"${r.name}"`).join(', ')}`}.`);
  if (finished.length) parts.push(`Finished: ${finished.map((n) => `"${n}"`).join(', ')}.`);
  if (working.length) parts.push(`${working.length} still working.`);
  return parts.join(' ') || 'Nothing much happened while you were away.';
}

/** The pet's line without Haiku. */
export function plainLine(changes: Change[]) {
  const asked = changes.filter((c) => c.kind === 'asked');
  const finished = changes.filter((c) => c.kind === 'finished');
  const stuck = changes.filter((c) => c.kind === 'stuck');
  if (asked.length) return asked.length === 1 ? `${asked[0].name} has a question for you.` : `${asked.length} threads have questions for you.`;
  if (stuck.length) return `${stuck[0].name} might be stuck.`;
  if (finished.length) return finished.length === 1 ? `${finished[0].name} is done.` : `${finished.length} threads are done.`;
  return null;
}

/** Reads Haiku's verdict on a possibly stuck session: "STUCK: reason" or "OK". */
export function parseStuck(reply: string | null): string | null {
  const m = reply?.trim().match(/^STUCK:\s*(.+)/is);
  return m ? clip(m[1], 200) : null;
}

export interface Announcement { text: string; at: number; urgent: boolean }

interface InsightsOptions {
  haiku: Haiku;
  now?: () => number;
  /** Recent activity of a session, for the stuck check (cloud: its latest events). */
  recentActivity?: (record: AgentRecord) => Promise<string | null>;
  /** How long to gather changes into one pet line, and the least time between lines. */
  gatherMs?: number;
  spacingMs?: number;
  /** A session on the same step this long gets checked; and re-checked this often. */
  stuckAfterMs?: number;
  recheckMs?: number;
  /** Reads each pet line out loud (only lines made while a pet is listening). */
  speak?: (a: Announcement) => void;
}

export function createInsights({ haiku, now = Date.now, recentActivity, gatherMs = 20_000, spacingMs = 45_000, stuckAfterMs = 45 * MINUTE, recheckMs = 30 * MINUTE, speak }: InsightsOptions) {
  let previous: AgentRecord[] | null = null;
  let latest: AgentRecord[] = [];
  let changes: Change[] = [];
  const listeners = new Set<(a: Announcement) => void>();
  let pending: Change[] = [];
  let timer: NodeJS.Timeout | null = null;
  let lastSpoken = 0;
  /** Per working session: the step it's on and since when; plus the stuck verdict, if any. */
  const steps = new Map<string, { step: string; since: number; checkedAt: number; checking: boolean; stuck: string | null }>();

  function record(list: Change[]) {
    const cutoff = now() - KEEP_MS;
    changes = [...changes, ...list].filter((c) => c.at >= cutoff).slice(-MAX_CHANGES);
    const spoken = list.filter((c) => c.kind === 'asked' || c.kind === 'finished' || c.kind === 'stuck');
    if (!spoken.length || !listeners.size) return;
    pending.push(...spoken);
    if (!timer) {
      const wait = Math.max(gatherMs, lastSpoken + spacingMs - now());
      timer = setTimeout(announce, wait);
      timer.unref?.();
    }
  }

  async function announce() {
    timer = null;
    const batch = pending;
    pending = [];
    if (!batch.length) return;
    lastSpoken = now();
    const fallback = plainLine(batch);
    const line = await haiku.ask({
      system: `You are a small desk pet that watches the user's AI agents and says one short line out loud when something happens. ${VOICE}`,
      prompt: `What just happened:\n${batch.map((c) => changeLine(c, now())).join('\n')}\n\nSay it in one sentence of at most 20 words. Lead with anything that needs the user. Shorten long thread names.`,
      maxTokens: 800,
    });
    const text = clip(line ?? fallback, 200);
    if (!text) return;
    const a = { text, at: now(), urgent: batch.some((c) => c.kind === 'asked') };
    listeners.forEach((l) => l(a));
    if (listeners.size) speak?.(a);
  }

  function checkStuck(records: AgentRecord[]) {
    const t = now();
    const live = new Set<string>();
    for (const r of records) {
      if (r.state !== 'working' || r.coordinator) continue;
      live.add(r.sessionId);
      const step = currentStep(r);
      let s = steps.get(r.sessionId);
      if (!s || s.step !== step) { s = { step, since: t, checkedAt: 0, checking: false, stuck: null }; steps.set(r.sessionId, s); }
      if (s.checking || t - s.since < stuckAfterMs || t - s.checkedAt < recheckMs || haiku.route() == null) continue;
      s.checking = true;
      s.checkedAt = t;
      const entry = s;
      void (async () => {
        const activity = (await recentActivity?.(r).catch(() => null)) ?? r.activity.join('\n');
        const reply = await haiku.ask({
          system: `You check whether an AI coding agent is stuck. Reply with exactly "OK" if it is making progress (even slowly, e.g. a long build or test run), or "STUCK: <reason in under 15 words>" if it is looping, repeating the same failing step, or waiting on something that will never come. ${VOICE}`,
          prompt: `Session "${r.name}" (${r.project}) has been on the same step for ${Math.round((t - entry.since) / MINUTE)} minutes.\nCurrent step: ${clip(step, 300)}\nChecklist:\n${(r.progress ?? []).join('\n') || '(none)'}\n\nRecent activity, oldest first:\n${clip(activity, 6000) || '(none)'}`,
          maxTokens: 600,
        });
        entry.checking = false;
        const stuck = parseStuck(reply);
        if (stuck && !entry.stuck && steps.get(r.sessionId) === entry) {
          entry.stuck = stuck;
          record([{ at: now(), kind: 'stuck', sessionId: r.sessionId, name: r.name, project: r.project, detail: stuck }]);
        } else if (!stuck) entry.stuck = null;
      })();
    }
    for (const id of steps.keys()) if (!live.has(id)) steps.delete(id);
  }

  return {
    /** Call with every fresh feed; returns the records with any stuck verdicts attached. */
    observe(records: AgentRecord[]): AgentRecord[] {
      record(describeChanges(previous, records, now()));
      previous = records;
      checkStuck(records);
      latest = records.map((r) => {
        const stuck = steps.get(r.sessionId)?.stuck;
        return stuck ? { ...r, stuck } : r;
      });
      return latest;
    },

    changesSince: (since: number) => changes.filter((c) => c.at > since),

    /** A short catch-up on what happened since `since`, most urgent first. */
    async briefing(since: number) {
      const recent = changes.filter((c) => c.at > since);
      const needing = latest.filter((r) => r.state === 'needs');
      if (!recent.length && !needing.length) return { text: null, changes: 0 };
      const fallback = plainBriefing(recent, latest);
      const away = Math.round((now() - since) / MINUTE);
      const text = await haiku.ask({
        system: `You brief the user when they come back to their desk, about the AI agents (threads) working for them. ${VOICE}`,
        prompt: `They've been away about ${away < 120 ? `${away} minutes` : `${Math.round(away / 60)} hours`}.\n\nWhat happened while they were away:\n${recent.map((c) => changeLine(c, now())).join('\n') || '(nothing new)'}\n\nEvery thread right now:\n${latest.map(recordLine).join('\n')}\n\nWrite 2 to 5 short sentences. Start with what needs them, most urgent first, saying briefly what each one wants. Then what finished. Then, in one sentence, what's still moving. Skip anything unimportant.`,
        maxTokens: 1500,
      });
      return { text: text ?? fallback, changes: recent.length };
    },

    /** Answers a question about the office from what it can see. */
    async ask(question: string) {
      const recent = changes.filter((c) => c.at > now() - 24 * HOUR);
      return haiku.ask({
        system: `You answer the user's questions about the AI agents (threads) in their office, using only the data given. If the answer isn't in the data, say you can't see that from here. ${VOICE}`,
        prompt: `Every thread right now:\n${latest.map(recordLine).join('\n') || '(none)'}\n\nWhat happened in the last day:\n${recent.map((c) => changeLine(c, now())).join('\n') || '(nothing recorded since the office started)'}\n\nQuestion: ${clip(question, 500)}\n\nAnswer in 1 to 4 short sentences.`,
        maxTokens: 1500,
      });
    },

    /** The pet's lines; only gathered while someone listens. */
    onAnnouncement(listener: (a: Announcement) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type Insights = ReturnType<typeof createInsights>;
