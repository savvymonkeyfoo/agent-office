import { describe, expect, it } from 'vitest';
import { buildCloudList, mapCloudState, sessionsFromPayload, toCloudRecord } from '../src/cloud/sessions.ts';

const NOW = Date.parse('2026-10-12T00:00:00Z');
const session = (over: object) => ({ id: 'session_1', title: 'Fix login', updated_at: '2026-10-11T23:00:00Z', ...over });

describe('cloud sessions', () => {
  it('maps status buckets onto office states', () => {
    expect(mapCloudState({ id: 'x', status_bucket: 'SESSION_STATUS_BUCKET_WORKING' })).toBe('working');
    expect(mapCloudState({ id: 'x', status_bucket: 'SESSION_STATUS_BUCKET_BLOCKED' })).toBe('needs');
    expect(mapCloudState({ id: 'x', status_bucket: 'SESSION_STATUS_BUCKET_REVIEW_READY' })).toBe('done');
    expect(mapCloudState({ id: 'x', status_bucket: 'SESSION_STATUS_BUCKET_COMPLETED', session_status: 'SESSION_STATUS_ARCHIVED' })).toBe('finished');
    expect(mapCloudState({ id: 'x', status_bucket: 'SESSION_STATUS_BUCKET_FAILED' })).toBe('stale');
  });

  it('names the repo and shows what a blocked session needs', () => {
    const record = toCloudRecord(session({
      status_bucket: 'SESSION_STATUS_BUCKET_BLOCKED',
      session_context: { sources: [{ git_repository: { url: 'https://github.com/acme/web-app' } }] },
      post_turn_summary: { status_detail: 'waiting', needs_action: 'approve the plan' },
    }));
    expect(record).toMatchObject({ project: 'web-app', name: 'Fix login', state: 'needs', lastMessage: 'approve the plan' });
  });

  it('drops archived sessions, and idle or ended ones older than a day', () => {
    const list = buildCloudList([
      session({ id: 'a', status_bucket: 'SESSION_STATUS_BUCKET_COMPLETED', session_status: 'SESSION_STATUS_ARCHIVED' }),
      session({ id: 'b', status_bucket: 'SESSION_STATUS_BUCKET_FAILED', updated_at: '2026-10-01T00:00:00Z' }),
      session({ id: 'c', status_bucket: 'SESSION_STATUS_BUCKET_WORKING', updated_at: '2026-10-01T00:00:00Z' }),
      session({ id: 'd', status_bucket: 'SESSION_STATUS_BUCKET_REVIEW_READY', updated_at: '2026-10-01T00:00:00Z' }),
    ], NOW);
    expect(list.map((r) => r.sessionId)).toEqual(['c']);
  });

  it('reads the list from wrapped or text payloads', () => {
    expect(sessionsFromPayload({ ccr: { data: [{ id: 'a' }] } })).toEqual([{ id: 'a' }]);
    expect(sessionsFromPayload('<x>{"data":[{"id":"b"}]}</x>')).toEqual([{ id: 'b' }]);
    expect(sessionsFromPayload(null)).toEqual([]);
  });
});

describe('project chat agents', () => {
  it('show while waiting on you, or for an hour after they were last active', async () => {
    const { buildCloudList } = await import('../src/cloud/sessions.ts');
    const now = Date.parse('2026-10-13T12:00:00Z');
    const chat = (id: string, minutesAgo: number) => ({ id, tags: ['hearth-overview'], session_status: 'idle', updated_at: new Date(now - minutesAgo * 60_000).toISOString() });
    expect(buildCloudList([chat('recent', 30), chat('stale', 90)], now).map((r) => r.id)).toEqual(['recent']);
    const waiting = { ...chat('waiting', 300), status_bucket: 'SESSION_STATUS_BUCKET_BLOCKED' };
    expect(buildCloudList([waiting], now).map((r) => r.id)).toEqual(['waiting']);
  });
});
