export type OfficeState = 'working' | 'needs' | 'done' | 'finished' | 'stale';

/** What `claude agents` tells us about a session. */
export interface SessionRecord {
  id: string;
  sessionId: string;
  name: string;
  project: string;
  cwd: string;
  state: OfficeState;
}

/** A session plus what its transcript adds. */
export interface AgentRecord extends SessionRecord {
  lastMessage: string | null;
  branch: string | null;
  /** The last few tool calls, oldest first, one short line each (e.g. `Edit src/client/card.ts`). */
  activity: string[];
  /** Cloud sessions: the session's own progress checklist, one line per step. */
  progress?: string[];
  /** Cloud sessions: places to follow the work (its pull request, published artifacts). */
  links?: { label: string; url: string }[];
  /** Cloud sessions: a Projects coordinator, the agent you talk to in a project's main chat. */
  coordinator?: boolean;
}

/** What /api/agents returns and the event stream sends. */
export type FeedPayload = AgentRecord[] | { error: string };
