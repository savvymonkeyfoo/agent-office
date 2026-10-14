import type { AgentRecord, FeedPayload } from '../../shared/agent.ts';

/** What the desktop pet is doing: a question is waiting, work is running, nothing's on, or the office can't be reached. */
export type Mood = 'needs' | 'working' | 'idle' | 'offline';

export interface PetStatus {
  mood: Mood;
  /** Sessions waiting on you, then sessions working, each in feed order. */
  needing: AgentRecord[];
  working: AgentRecord[];
  /** What the speech bubble says about the mood (null: nothing to say). */
  text: string | null;
}

const MAX_NAME = 40;

/** A session's name, quoted and cut short enough for a small bubble. */
export function shortName(record: AgentRecord) {
  const name = record.name.trim() || record.project || 'A session';
  return `“${name.length > MAX_NAME ? `${name.slice(0, MAX_NAME - 1).trimEnd()}…` : name}”`;
}

/** The pet's mood from the latest feed; null or an error payload means the office can't be reached. */
export function petStatus(payload: FeedPayload | null): PetStatus {
  if (!Array.isArray(payload)) return { mood: 'offline', needing: [], working: [], text: "Can't reach the office" };
  const needing = payload.filter((r) => r.state === 'needs');
  const working = payload.filter((r) => r.state === 'working');
  if (needing.length) {
    const text = needing.length === 1 ? `${shortName(needing[0])} has a question for you` : `${needing.length} questions waiting for you`;
    return { mood: 'needs', needing, working, text };
  }
  if (working.length) {
    const text = working.length === 1 ? `Working on ${shortName(working[0])}` : `${working.length} agents working`;
    return { mood: 'working', needing, working, text };
  }
  return { mood: 'idle', needing, working, text: null };
}

export interface FeedChanges {
  /** Sessions that just started waiting on you. */
  newlyNeeding: AgentRecord[];
  /** Sessions that were working and have now stopped without a question. */
  finished: AgentRecord[];
}

/** What changed between two feeds. The first feed only primes it, so opening the pet doesn't announce everything. */
export function feedChanges(previous: AgentRecord[] | null, next: AgentRecord[]): FeedChanges {
  if (!previous) return { newlyNeeding: [], finished: [] };
  const before = new Map(previous.map((r) => [r.sessionId, r.state]));
  return {
    newlyNeeding: next.filter((r) => r.state === 'needs' && before.get(r.sessionId) !== 'needs'),
    finished: next.filter((r) => before.get(r.sessionId) === 'working' && (r.state === 'done' || r.state === 'finished')),
  };
}
