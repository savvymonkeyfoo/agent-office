import type { OfficeState } from '../shared/agent.ts';

export type Pose = 'typing' | 'waving' | 'sipping' | 'slumped' | 'standing';
export type BubbleKind = 'working' | 'needs' | 'stale' | 'finished';

export const POSES: Record<OfficeState, { pose: Pose; bubble: BubbleKind | null }> = {
  working: { pose: 'typing', bubble: 'working' },
  needs: { pose: 'waving', bubble: 'needs' },
  done: { pose: 'sipping', bubble: null },
  stale: { pose: 'slumped', bubble: 'stale' },
  finished: { pose: 'standing', bubble: 'finished' },
};

export const SCREEN_OFF = '#2C3350';
const SCREEN_GLOW: Partial<Record<OfficeState, string>> = { working: '#7FB2FF', needs: '#FFB648' };

export const screenColor = (state: OfficeState) => SCREEN_GLOW[state] ?? SCREEN_OFF;
