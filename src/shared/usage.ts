export interface LimitWindow {
  usedPercentage: number;
  /** Epoch milliseconds. */
  resetsAt: number;
}

export interface Limits {
  /** The 5-hour window; null when unknown. */
  session: LimitWindow | null;
  weekly: LimitWindow | null;
}

/** Is limit tracking (our status line in Claude's settings.json) set up? */
export type TrackingStatus = 'enabled' | 'off' | 'other' | 'unreadable';

export interface ProjectTokens {
  project: string;
  tokens: number;
}

/** Cloud mode: the plan limit status sessions report. `status` is e.g. "allowed", "allowed_warning" or "rejected". */
export interface CloudLimit {
  status: string;
  /** Epoch milliseconds, when known. */
  resetsAt: number | null;
  /** e.g. "five_hour". */
  window: string | null;
  overage: boolean;
}

/** What /api/usage (and POST /api/usage/enable) returns. */
export interface UsagePayload {
  tracking: TrackingStatus;
  limits: Limits;
  /** This week's tokens, highest first. */
  projects: ProjectTokens[];
  /** Present in cloud mode, where it replaces the local limit bars. */
  cloud?: CloudLimit | null;
}
