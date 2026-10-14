import { describe, expect, it } from 'vitest';
import { createNeedsNotifier } from '../src/server/notify.ts';
import { latestCloudLimit } from '../src/server/cloud.ts';
import { cloudLinks, cloudProgress } from '../src/cloud/sessions.ts';
import type { AgentRecord } from '../src/shared/agent.ts';

const rec = (sessionId: string, state: AgentRecord['state']): AgentRecord =>
  ({ id: sessionId, sessionId, name: sessionId, project: 'p', cwd: '', state, lastMessage: 'approve it', branch: null, activity: [] });

describe('createNeedsNotifier', () => {
  it('announces only sessions that start needing you after the first list', () => {
    const sent: string[] = [];
    const notify = createNeedsNotifier((title) => sent.push(title));
    notify([rec('a', 'needs')]);
    notify([rec('a', 'needs'), rec('b', 'working')]);
    notify([rec('a', 'needs'), rec('b', 'needs')]);
    expect(sent).toEqual(['b needs you']);
  });
});

describe('cloud session extras', () => {
  const session = {
    id: 'cse_1',
    session_context: { sources: [{ git_repository: { url: 'https://github.com/me/app' } }] },
    external_metadata: {
      current_branches: { '': 'claude/fix' },
      status: { text: 'Fix it\n\n✓ Found it\n**✓ Pushed**\n○ Check' },
      artifacts: [{ title: 'Board', url: 'https://claude.ai/artifact/x' }],
    },
  };

  it('reads the checklist and builds links', () => {
    expect(cloudProgress(session)).toEqual(['Fix it', '✓ Found it', '✓ Pushed', '○ Check']);
    expect(cloudLinks(session)).toEqual([
      { label: 'Pull request', url: 'https://github.com/me/app/pulls?q=is%3Apr%20head%3Aclaude%2Ffix' },
      { label: 'Board', url: 'https://claude.ai/artifact/x' },
    ]);
  });

  it('takes the plan limit from the latest session', () => {
    const limit = latestCloudLimit([
      { id: 'a', updated_at: '2026-10-12T01:00:00Z', external_metadata: { rate_limit_info: { status: 'rejected' } } },
      { id: 'b', updated_at: '2026-10-12T02:00:00Z', external_metadata: { rate_limit_info: { status: 'allowed', resetsAt: 100, rateLimitType: 'five_hour' } } },
    ]);
    expect(limit).toEqual({ status: 'allowed', resetsAt: 100_000, window: 'five_hour', overage: false });
  });
});

describe('coordinators', () => {
  it('are marked on the record and get the crown look', async () => {
    const { toCloudRecord } = await import('../src/cloud/sessions.ts');
    const { lookFor } = await import('../src/client/look.ts');
    expect(toCloudRecord({ id: 'cse_c', tags: ['hearth-overview'] }).coordinator).toBe(true);
    expect(toCloudRecord({ id: 'cse_t', tags: ['hearth-thread'] }).coordinator).toBeUndefined();
    expect(lookFor('cse_c', true).hat).toBe('crown');
    expect(lookFor('cse_c').hat).not.toBe('crown');
  });
});
