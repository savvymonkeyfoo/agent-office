import { describe, expect, it } from 'vitest';
import { cloudAckStore, explainFetchError, usesWorkProvider, normaliseSession, rememberUpdated, sessionsFromResponse, wantsCloud } from '../src/server/cloud.ts';
import { mapCloudState } from '../src/cloud/sessions.ts';

describe('cloud mode', () => {
  it('turns on with --cloud or CLOUD=1', () => {
    expect(wantsCloud(['--cloud'], {})).toBe(true);
    expect(wantsCloud([], { CLOUD: '1' })).toBe(true);
    expect(wantsCloud([], {})).toBe(false);
  });

  it('maps plain session statuses onto office states', () => {
    const state = (status: string) => mapCloudState(normaliseSession({ id: 's', status }));
    expect(state('working')).toBe('working');
    expect(state('waiting')).toBe('needs');
    expect(state('idle')).toBe('done');
    expect(state('archived')).toBe('finished');
    expect(state('cancelled')).toBe('stale');
  });

  it('keeps a status bucket the API already sends', () => {
    expect(normaliseSession({ id: 's', session_status: 'SESSION_STATUS_IDLE', status_bucket: 'SESSION_STATUS_BUCKET_WORKING' }).status_bucket)
      .toBe('SESSION_STATUS_BUCKET_WORKING');
  });

  it('reads /v1/code/sessions objects', () => {
    const [s] = sessionsFromResponse({ data: [{
      id: 'cse_1', status: 'active', status_bucket: 'review_ready', worker_status: 'idle', last_event_at: '2026-10-12T00:00:00Z',
      external_metadata: { post_turn_summary: { status_detail: 'done the thing' } },
    }] });
    expect(mapCloudState(s)).toBe('done');
    expect(s.updated_at).toBe('2026-10-12T00:00:00Z');
    expect(s.post_turn_summary?.status_detail).toBe('done the thing');
    expect(mapCloudState(normaliseSession({ id: 'x', status: 'active', status_bucket: 'working', worker_status: 'requires_action' }))).toBe('needs');
    expect(mapCloudState(normaliseSession({ id: 'x', status: 'archived', status_bucket: 'completed' }))).toBe('finished');
  });

  it('reads data, sessions or bare lists', () => {
    expect(sessionsFromResponse({ data: [{ id: 'a' }] }).map((s) => s.id)).toEqual(['a']);
    expect(sessionsFromResponse({ sessions: [{ id: 'b' }] }).map((s) => s.id)).toEqual(['b']);
    expect(sessionsFromResponse([{ id: 'c' }]).map((s) => s.id)).toEqual(['c']);
    expect(sessionsFromResponse(null)).toEqual([]);
  });
});

describe('cloudAckStore', () => {
  it('hides a session only until it updates again', () => {
    const ids = new Set<string>();
    const store = cloudAckStore({ has: (id) => ids.has(id), add: (id) => { ids.add(id); }, remove: (id) => { ids.delete(id); } });
    rememberUpdated([{ id: 'cse_1', updated_at: '2026-10-12T05:00:00Z' } as never]);
    store.add('cse_1');
    expect(store.has('cse_1')).toBe(true);
    rememberUpdated([{ id: 'cse_1', updated_at: '2026-10-12T06:00:00Z' } as never]);
    expect(store.has('cse_1')).toBe(false);
  });
});

describe('explainFetchError', () => {
  it('names the cause and suggests system certificates for TLS problems', () => {
    const error = Object.assign(new TypeError('fetch failed'), { cause: { code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' } });
    expect(explainFetchError(error)).toContain('UNABLE_TO_GET_ISSUER_CERT_LOCALLY');
    expect(explainFetchError(error)).toContain('--use-system-ca');
  });
});

describe('usesWorkProvider', () => {
  it('spots work API settings in Claude Code settings', () => {
    expect(usesWorkProvider({ env: { CLAUDE_CODE_USE_FOUNDRY: '1' } })).toBe(true);
    expect(usesWorkProvider({ env: { FOO: '1' } })).toBe(false);
    expect(usesWorkProvider(null)).toBe(false);
  });
});

describe('renewedCredentials', () => {
  it('swaps in the new tokens and keeps everything else', async () => {
    const { renewedCredentials } = await import('../src/server/cloud.ts');
    const saved = { claudeAiOauth: { accessToken: 'old', refreshToken: 'r1', expiresAt: 1, scopes: ['a'], subscriptionType: 'max' }, other: 1 };
    const next = renewedCredentials(saved, { access_token: 'new', refresh_token: 'r2', expires_in: 60, scope: 'a b' }, 1000);
    expect(next).toEqual({ claudeAiOauth: { accessToken: 'new', refreshToken: 'r2', expiresAt: 61_000, scopes: ['a', 'b'], subscriptionType: 'max' }, other: 1 });
    expect(renewedCredentials(saved, { access_token: 'new' }).claudeAiOauth.refreshToken).toBe('r1');
  });
});
