import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDetails } from '../src/server/transcript.ts';
import { loadAgents } from '../src/server/load.ts';

const CWD = '/home/alex/projects/demo-app';
const line = (o: object) => JSON.stringify(o);
let id = 0;
const call = (name: string, input: object) => ({ type: 'tool_use', id: `t${++id}`, name, input });
const assistant = (...content: object[]) => line({ type: 'assistant', cwd: CWD, message: { role: 'assistant', content } });
const result = (output: string) => line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${id}`, content: output }] } });
const activity = (...lines: string[]) => parseDetails(lines.join('\n'), CWD).activity;

describe('#26 AC1 the last 6 tool calls, oldest first', () => {
  it('#26 AC1 each call is the tool name and its main target', () => {
    expect(activity(
      assistant(call('Read', { file_path: `${CWD}/src/client/card.ts` })),
      assistant(call('Edit', { file_path: `${CWD}/src/client/markdown.ts`, old_string: 'a', new_string: 'b' })),
      assistant(call('Bash', { command: 'npm test', description: 'Run tests' })),
      assistant(call('Grep', { pattern: 'escapeHtml', path: `${CWD}/src` })),
    )).toEqual(['Read src/client/card.ts', 'Edit src/client/markdown.ts', 'Bash npm test', 'Grep "escapeHtml" src']);
  });

  it('#26 AC1 keeps only the newest 6, oldest first, counting several calls in one message', () => {
    const reads = Array.from({ length: 8 }, (_, i) => call('Read', { file_path: `${CWD}/f${i}.ts` }));
    expect(activity(assistant(...reads.slice(0, 3)), assistant(...reads.slice(3)))).toEqual(
      ['Read f2.ts', 'Read f3.ts', 'Read f4.ts', 'Read f5.ts', 'Read f6.ts', 'Read f7.ts'],
    );
  });

  it('#26 AC1 other tools show their main target, or just their name', () => {
    expect(activity(assistant(
      call('Write', { file_path: `${CWD}/README.md`, content: 'x' }),
      call('Glob', { pattern: '**/*.ts' }),
      call('WebFetch', { url: 'https://example.com/docs', prompt: 'summarise' }),
      call('Agent', { description: 'Find the parser', prompt: 'long prompt' }),
      call('TodoWrite', { todos: [] }),
      call('Grep', { pattern: 'TODO' }),
    ))).toEqual(['Write README.md', 'Glob **/*.ts', 'WebFetch https://example.com/docs', 'Agent Find the parser', 'TodoWrite', 'Grep "TODO"']);
  });

  it('#26 AC1 the agent record carries the activity', async () => {
    const config = mkdtempSync(join(tmpdir(), 'office-activity-'));
    const folder = join(config, 'projects', '-home-alex-projects-demo-app');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 's1.jsonl'), assistant(call('Bash', { command: 'ls' })));
    const [record] = await loadAgents({
      list: async () => [{ pid: 1, id: 'a1', cwd: CWD, sessionId: 's1', name: 'one', state: 'working' }],
      paths: { env: { CLAUDE_CONFIG_DIR: config } },
      now: Date.now(),
    });
    expect(record.activity).toEqual(['Bash ls']);
  });
});

describe('#26 AC2 paths relative to the session cwd', () => {
  it('#26 AC2 inside the cwd: relative; outside: as given', () => {
    expect(activity(assistant(
      call('Read', { file_path: `${CWD}/src/a.ts` }),
      call('Read', { file_path: '/etc/hosts' }),
      call('Read', { file_path: '/home/alex/projects/demo-app-two/b.ts' }),
      call('Grep', { pattern: 'x', path: '/usr/lib' }),
    ))).toEqual(['Read src/a.ts', 'Read /etc/hosts', 'Read /home/alex/projects/demo-app-two/b.ts', 'Grep "x" /usr/lib']);
  });

  it('#26 AC2 a session that moved into a worktree shows paths relative to where it was', () => {
    const tree = `${CWD}/.claude/worktrees/x`;
    const moved = line({ type: 'assistant', cwd: tree, message: { role: 'assistant', content: [call('Edit', { file_path: `${tree}/src/b.ts` })] } });
    expect(activity(moved)).toEqual(['Edit src/b.ts']);
  });
});

describe('#26 AC3 short lines', () => {
  it('#26 AC3 Bash shows only the first line, cut at 60 characters with …', () => {
    const [multi, long] = activity(
      assistant(call('Bash', { command: 'git add -A\ngit commit -m "secret"' })),
      assistant(call('Bash', { command: `echo ${'x'.repeat(100)}` })),
    );
    expect(multi).toBe('Bash git add -A');
    expect(long).toHaveLength(60);
    expect(long.endsWith('…')).toBe(true);
    expect(long.startsWith('Bash echo xxx')).toBe(true);
  });

  it('#26 AC3 any line is at most 60 characters', () => {
    const lines = activity(assistant(
      call('Read', { file_path: `/${'deep/'.repeat(20)}file.ts` }),
      call('Grep', { pattern: 'y'.repeat(80), path: `${CWD}/src` }),
      call('WebSearch', { query: 'q '.repeat(50) }),
    ));
    expect(lines).toHaveLength(3);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(60);
  });
});

describe('#26 AC4 no tool output', () => {
  it('#26 AC4 tool results and output never appear', () => {
    const lines = activity(
      assistant(call('Bash', { command: 'cat .env' })),
      result('API_KEY=supersecret'),
      line({ type: 'user', toolUseResult: { stdout: 'more secret output' }, message: { role: 'user', content: [{ type: 'tool_result', content: [{ type: 'text', text: 'nested secret' }] }] } }),
      assistant({ type: 'text', text: 'Done.' }),
    );
    expect(lines).toEqual(['Bash cat .env']);
    expect(lines.join('\n')).not.toMatch(/secret/);
  });
});

describe('#26 AC5 no tool calls', () => {
  it('#26 AC5 a session with no tool calls has an empty list', () => {
    expect(activity(assistant({ type: 'text', text: 'Hello' }), line({ type: 'user', message: { role: 'user', content: 'hi' } }))).toEqual([]);
    expect(activity('')).toEqual([]);
  });
});

describe('Windows paths', () => {
  it('shows paths inside a Windows cwd relative to it, whatever the host', () => {
    const cwd = 'C:\\Users\\alex\\demo';
    const win = line({ type: 'assistant', cwd, message: { role: 'assistant', content: [call('Read', { file_path: 'C:\\Users\\alex\\demo\\src\\a.ts' }), call('Read', { file_path: 'D:\\other\\b.ts' })] } });
    expect(parseDetails(win, cwd).activity).toEqual(['Read src\\a.ts', 'Read D:\\other\\b.ts']);
  });
});
