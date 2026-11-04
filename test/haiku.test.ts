// Haiku helpers: who pays, what the office notices, and the briefing, pet lines, stuck check and ask box built on it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHaiku, foundryFrom, officeKey, wantsWork, type Haiku, type HaikuRequest } from '../src/server/haiku.ts';
import { createInsights, describeChanges, parseStuck, plainBriefing, plainLine, recordLine } from '../src/server/insights.ts';
import { activityFromEvents } from '../src/cloud/sessions.ts';
import { cleanSettings } from '../src/server/settings.ts';
import type { AgentRecord } from '../src/shared/agent.ts';

const rec = (id: string, state: AgentRecord['state'], extra: Partial<AgentRecord> = {}): AgentRecord => ({
  id, sessionId: id, name: `Thread ${id}`, project: 'Office', cwd: '', state, lastMessage: null, branch: null, activity: [], ...extra,
});

const fakeHaiku = (reply: (r: HaikuRequest) => string | null = () => 'From Haiku.') => {
  const asked: HaikuRequest[] = [];
  const haiku: Haiku = { route: () => 'api', ask: async (r) => { asked.push(r); return reply(r); } };
  return { haiku, asked };
};

afterEach(() => vi.useRealTimers());

describe('who pays for Haiku', () => {
  it("uses only the office's own key, never ANTHROPIC_API_KEY", () => {
    expect(officeKey({ AGENT_OFFICE_ANTHROPIC_KEY: ' sk-office ' }, () => '')).toBe('sk-office');
    expect(officeKey({ ANTHROPIC_API_KEY: 'sk-work' }, () => { throw new Error('none'); })).toBeNull();
    expect(officeKey({}, () => 'sk-file\n')).toBe('sk-file');
  });

  it('falls back to the claude.ai login, but never on a work setup', async () => {
    const callCli = vi.fn(async (_r: unknown, _e: unknown, _w?: boolean) => 'hi');
    const callApi = vi.fn(async () => 'api');
    const plain = createHaiku({ env: { ANTHROPIC_API_KEY: 'sk-work' }, callApi, callCli, workSettings: () => false });
    expect(plain.route()).toBe('login');
    expect(await plain.ask({ system: 's', prompt: 'p' })).toBe('hi');
    expect(callApi).not.toHaveBeenCalled();
    expect(callCli.mock.calls[0][2]).toBe(false); // work keys stripped

    const work = createHaiku({ env: {}, callApi, callCli, workSettings: () => true });
    expect(work.route()).toBeNull();
    expect(await work.ask({ system: 's', prompt: 'p' })).toBeNull();
    expect(createHaiku({ env: { AGENT_OFFICE_HAIKU: '0', AGENT_OFFICE_ANTHROPIC_KEY: 'k' } }).route()).toBeNull();
  });

  it('uses the work setup only where you opted in, and leaves its keys in place', async () => {
    const callCli = vi.fn(async (_r: unknown, _e: unknown, _w?: boolean) => 'via work');
    const work = createHaiku({ env: { ANTHROPIC_API_KEY: 'sk-work', AGENT_OFFICE_ANTHROPIC_KEY: 'k' }, callCli, workSettings: () => true, optedInToWork: () => true });
    expect(work.route()).toBe('work');
    expect(await work.ask({ system: 's', prompt: 'p' })).toBe('via work');
    expect(callCli.mock.calls[0][2]).toBe(true);
    expect(wantsWork({ AGENT_OFFICE_HAIKU: 'work' }, () => '')).toBe(true);
    expect(wantsWork({}, () => 'work\n')).toBe(true);
    expect(wantsWork({ AGENT_OFFICE_HAIKU: 'api' }, () => 'work')).toBe(false);
    expect(wantsWork({}, () => { throw new Error('none'); })).toBe(false);
  });

  it('finds the Foundry endpoint in settings, either env shape, and lists models to try', () => {
    const list = { env: ['ANTHROPIC_FOUNDRY_BASE_URL=https://x.services.ai.azure.com/anthropic/', 'ANTHROPIC_FOUNDRY_API_KEY=k', 'ANTHROPIC_DEFAULT_SONNET_MODEL=claude-sonnet-5'] };
    expect(foundryFrom({}, list)).toEqual({ baseUrl: 'https://x.services.ai.azure.com/anthropic', key: 'k', models: ['claude-haiku-5-5', 'claude-sonnet-5'] });
    expect(foundryFrom({ ANTHROPIC_DEFAULT_HAIKU_MODEL: 'my-haiku' }, { env: { ANTHROPIC_FOUNDRY_BASE_URL: 'https://y', ANTHROPIC_FOUNDRY_API_KEY: 'k2' } }))
      .toEqual({ baseUrl: 'https://y', key: 'k2', models: ['my-haiku', 'claude-haiku-5-5'] });
    expect(foundryFrom({}, { env: {} })).toBeNull();
  });

  it('pays through Foundry directly when opted in and set up', async () => {
    const callFoundry = vi.fn(async () => 'via foundry');
    const callCli = vi.fn(async () => 'cli');
    const haiku = createHaiku({ env: { ANTHROPIC_FOUNDRY_BASE_URL: 'https://z', ANTHROPIC_FOUNDRY_API_KEY: 'k' }, optedInToWork: () => true, callFoundry, callCli });
    expect(await haiku.ask({ system: 's', prompt: 'p' })).toBe('via foundry');
    expect(callCli).not.toHaveBeenCalled();
  });

  it('stops for the day after the cap, and survives a failed call', async () => {
    let n = 0;
    const haiku = createHaiku({ env: { AGENT_OFFICE_ANTHROPIC_KEY: 'k' }, callApi: async () => { if (++n === 2) throw new Error('boom'); return 'ok'; }, now: () => 0 });
    expect(await haiku.ask({ system: '', prompt: '' })).toBe('ok');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await haiku.ask({ system: '', prompt: '' })).toBeNull();
    for (let i = 0; i < 500; i++) await haiku.ask({ system: '', prompt: '' });
    expect(n).toBe(400);
  });
});

describe('what the office notices', () => {
  it('records questions, finishes, new work and ticked-off steps, and nothing on the first feed', () => {
    const before = [rec('a', 'working'), rec('b', 'working', { progress: ['Head', '✓ One', '✱ Two'] }), rec('c', 'working')];
    expect(describeChanges(null, before, 0)).toEqual([]);
    const after = [
      rec('a', 'needs', { question: { text: 'Merge it?' } }),
      rec('b', 'working', { progress: ['Head', '✓ One', '✓ Two', '✱ Three'] }),
      rec('c', 'done', { lastMessage: 'All green.' }),
      rec('d', 'working', { progress: ['✱ Start'] }),
    ];
    expect(describeChanges(before, after, 5).map((c) => [c.kind, c.sessionId, c.detail])).toEqual([
      ['asked', 'a', 'Merge it?'], ['step', 'b', 'Two'], ['finished', 'c', 'All green.'], ['started', 'd', 'Start'],
    ]);
  });

  it('describes a session in one prompt line', () => {
    expect(recordLine(rec('a', 'needs', { question: { text: 'Merge\nit?' }, progress: ['✓ a', '✱ b'] })))
      .toBe('- [needs] Office / "Thread a" | now: b | checklist: 1 of 2 done | asks: Merge it?');
  });

  it('reads cloud events as short lines, oldest first', () => {
    const events = [
      { payload: { type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: 'npm ERR! test failed' }] } } },
      { payload: { type: 'assistant', message: { content: [{ type: 'text', text: 'Running tests' }, { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } } },
    ];
    expect(activityFromEvents(events)).toBe('said: Running tests\nran Bash: {"command":"npm test"}\nerror: npm ERR! test failed');
  });
});

describe('briefing and ask box', () => {
  it('briefs on what changed since you left, and says nothing when nothing did', async () => {
    let t = 1_000_000;
    const { haiku, asked } = fakeHaiku();
    const insights = createInsights({ haiku, now: () => t });
    insights.observe([rec('a', 'working')]);
    expect(await insights.briefing(t - 1)).toEqual({ text: null, changes: 0 });
    t += 60_000;
    insights.observe([rec('a', 'needs', { question: { text: 'Push to main?' } })]);
    expect(await insights.briefing(t - 120_000)).toEqual({ text: 'From Haiku.', changes: 1 });
    expect(asked[0].prompt).toContain('asked you: Push to main?');
  });

  it('falls back to a plain briefing and pet line without Haiku', () => {
    const changes = [{ at: 0, kind: 'finished' as const, sessionId: 'c', name: 'Fix login', project: 'x', detail: '' }];
    expect(plainBriefing(changes, [rec('a', 'needs'), rec('b', 'working')])).toBe('"Thread a" needs you. Finished: "Fix login". 1 still working.');
    expect(plainLine(changes)).toBe('Fix login is done.');
  });

  it('answers from the current threads', async () => {
    const { haiku, asked } = fakeHaiku(() => 'Two are waiting.');
    const insights = createInsights({ haiku });
    insights.observe([rec('a', 'needs')]);
    expect(await insights.ask("what's waiting?")).toBe('Two are waiting.');
    expect(asked[0].prompt).toContain('[needs] Office / "Thread a"');
    expect(asked[0].prompt).toContain("Question: what's waiting?");
  });
});

describe('pet lines', () => {
  it("gathers changes into one line, only while a pet listens, and reads it out", async () => {
    vi.useFakeTimers();
    const { haiku, asked } = fakeHaiku(() => 'Two threads want you.');
    const speak = vi.fn();
    const insights = createInsights({ haiku, now: () => Date.now(), gatherMs: 1000, spacingMs: 0, speak });
    insights.observe([rec('a', 'working'), rec('b', 'working')]);
    insights.observe([rec('a', 'needs'), rec('b', 'working')]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(asked).toHaveLength(0);

    const heard = vi.fn();
    insights.onAnnouncement(heard);
    insights.observe([rec('a', 'needs'), rec('b', 'needs')]);
    insights.observe([rec('a', 'done'), rec('b', 'needs')]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(asked).toHaveLength(1);
    expect(heard).toHaveBeenCalledWith(expect.objectContaining({ text: 'Two threads want you.', urgent: true }));
    expect(speak).toHaveBeenCalledTimes(1);
  });
});

describe('stuck check', () => {
  it('asks Haiku once a session has sat on one step, and shows its verdict until the step moves', async () => {
    let t = 0;
    const { haiku, asked } = fakeHaiku(() => 'STUCK: the same test keeps failing');
    const insights = createInsights({ haiku, now: () => t, stuckAfterMs: 60_000, recheckMs: 60_000, recentActivity: async () => 'error: test failed' });
    const working = rec('a', 'working', { progress: ['✱ Fix the test'] });
    insights.observe([working]);
    t = 30_000;
    insights.observe([working]);
    expect(asked).toHaveLength(0);
    t = 61_000;
    insights.observe([working]);
    await new Promise((r) => setTimeout(r, 0));
    expect(asked).toHaveLength(1);
    expect(asked[0].prompt).toContain('error: test failed');
    expect(insights.observe([working])[0].stuck).toBe('the same test keeps failing');
    expect(insights.changesSince(0).some((c) => c.kind === 'stuck')).toBe(true);
    expect(insights.observe([rec('a', 'working', { progress: ['✓ Fix the test', '✱ Push'] })])[0].stuck).toBeUndefined();
  });

  it('reads the verdict', () => {
    expect(parseStuck('STUCK: looping on lint')).toBe('looping on lint');
    expect(parseStuck('OK')).toBeNull();
    expect(parseStuck(null)).toBeNull();
  });
});

it('keeps only known settings', () => {
  expect(cleanSettings({ petVoice: false, evil: 1 })).toEqual({ petVoice: false });
  expect(cleanSettings({ petVoice: 'yes' })).toEqual({});
});
