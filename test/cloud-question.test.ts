// @vitest-environment jsdom
// A cloud session waiting on you: the card shows what it asked in full, and a decision card's options,
// read from the session's latest events.
import { describe, expect, it } from 'vitest';
import { appUrl, questionFromEvents, toCloudRecord } from '../src/cloud/sessions.ts';
import { renderCard } from '../src/client/card.ts';

const assistant = (...content: unknown[]) => ({ event_type: 'message', payload: { type: 'assistant', message: { role: 'assistant', content } } });
const tool = (name: string, input: Record<string, unknown>) => ({ type: 'tool_use', name, input });

describe('what a waiting session asked', () => {
  it('reads a decision card: question, context and options, with the recommended one marked', () => {
    const q = questionFromEvents([
      assistant(tool('mcp__hearthbot__update_status', { text: 'x' })),
      assistant(tool('mcp__hearthbot__ask_decision', {
        question: 'Run a dry run on a real note first?', context: 'It writes nothing.',
        options: [{ label: 'Dry run', consequence: 'Nothing is saved.' }, { label: 'Go live', consequence: 'Notes are filed.' }], recommended: 0,
      })),
    ]);
    expect(q).toEqual({
      text: 'Run a dry run on a real note first?\n\nIt writes nothing.',
      options: [{ label: 'Dry run', consequence: 'Nothing is saved.', recommended: true }, { label: 'Go live', consequence: 'Notes are filed.' }],
    });
  });

  it("takes the newest thread reply, else the agent's last words, and skips everything else", () => {
    const events = [
      { payload: { type: 'user', message: { content: [{ type: 'text', text: 'tool result' }] } } },
      assistant({ type: 'thinking', thinking: 'hmm' }, tool('mcp__hearthbot__reply', { text: 'Want me to merge PR #8?' })),
      assistant({ type: 'text', text: 'older' }),
    ];
    expect(questionFromEvents(events)).toEqual({ text: 'Want me to merge PR #8?' });
    expect(questionFromEvents([assistant({ type: 'text', text: 'Shall I push?' })])).toEqual({ text: 'Shall I push?' });
    expect(questionFromEvents([null, {}, { payload: 'x' }])).toBeNull();
  });

  it('only rides on a record while the session waits on you', () => {
    const question = { text: 'Merge it?' };
    expect(toCloudRecord({ id: 'cse_a', status_bucket: 'SESSION_STATUS_BUCKET_BLOCKED', question }).question).toEqual(question);
    expect(toCloudRecord({ id: 'cse_a', status_bucket: 'SESSION_STATUS_BUCKET_WORKING', question }).question).toBeUndefined();
  });
});

describe('the card', () => {
  const record = { ...toCloudRecord({ id: 'cse_abc', status_bucket: 'SESSION_STATUS_BUCKET_BLOCKED' }), question: { text: 'Go **live**?', options: [{ label: 'Yes', recommended: true }, { label: 'No', consequence: 'Stays off.' }] } };
  const actions = { close() {}, acknowledge() {}, expanded: false, toggleMessage() {}, openLink: () => 'https://claude.ai/code/session_abc', appLink: appUrl };

  it('shows the question and its options in place of the one-line summary', () => {
    const card = document.createElement('div');
    renderCard(card, record, actions);
    expect(card.querySelector('.desc strong')?.textContent).toBe('live');
    expect([...card.querySelectorAll('.options li')].map((li) => li.textContent)).toEqual(['Yes (recommended)', 'NoStays off.']);
  });

  it('opens the session in the desktop app, or in the browser', () => {
    const card = document.createElement('div');
    renderCard(card, record, actions);
    expect([...card.querySelectorAll('.links a')].map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Open in app', 'claude://claude.ai/code/session_abc'],
      ['Open in browser', 'https://claude.ai/code/session_abc'],
    ]);
  });
});
