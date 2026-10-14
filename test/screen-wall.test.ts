import { describe, expect, it } from 'vitest';
import type { AgentRecord, OfficeState } from '../src/shared/agent.ts';
import { OfficeController } from '../src/client/controller.ts';
import { buildOffice } from '../src/client/office.ts';
import { STATUS_COLORS, paintCalls, paintCentre, paintProjects, type WallModel } from '../src/client/screen-wall.ts';

const rec = (n: number, state: OfficeState = 'working', extra: Partial<AgentRecord> = {}): AgentRecord => ({
  id: `a${n}`, sessionId: `session-${n}`, name: `agent ${n}`, project: 'demo-app',
  cwd: '/home/alex/projects/demo-app', state, lastMessage: null, branch: null, activity: [], ...extra,
});

/** A canvas stand-in that records the text drawn and the colour of each filled dot. */
function recorder() {
  const texts: string[] = [], dots: string[] = [];
  const state: Record<string, unknown> = {};
  const g = new Proxy(state, {
    get: (target, key) => {
      if (key === 'fillText') return (text: string) => texts.push(text);
      if (key === 'measureText') return (text: string) => ({ width: text.length * 8 });
      if (key === 'arc') return () => dots.push(target.fillStyle as string);
      if (key in target) return target[key as string];
      return () => undefined;
    },
    set: (target, key, value) => { target[key as string] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { g, texts, dots };
}

/** A Control room fed `records`, its screen wall brought up to date. */
function controlRoom() {
  const office = buildOffice(3, 'control-room');
  const controller = new OfficeController({}, 'control-room');
  const feed = (records: AgentRecord[]) => {
    controller.update(records);
    office.board.update(controller.occupants());
    return office.board.model as WallModel;
  };
  return { office, feed };
}

describe('#102 AC1 the centre board lists every agent under its state, with a count per column', () => {
  const { feed } = controlRoom();
  const model = feed([rec(1), rec(2, 'needs'), rec(3, 'done'), rec(4, 'finished'), rec(5, 'stale'), rec(6)]);
  const { g, texts } = recorder();
  paintCentre(g, model);

  it('#102 AC1 a heading with its count for each state, in order', () => {
    const headings = texts.filter((t) => /^(WORKING|NEEDS YOU|DONE|STALE) /.test(t));
    expect(headings.map((t) => t.replace(/\s+/g, ' '))).toEqual(['WORKING 2', 'NEEDS YOU 1', 'DONE 2', 'STALE 1']);
  });

  it('#102 AC1 every agent is listed once, under its own state', () => {
    const order = (t: string) => texts.indexOf(t);
    for (let n = 1; n <= 6; n++) expect(texts.filter((t) => t === `agent ${n}`), `agent ${n}`).toHaveLength(1);
    const column = (name: string) => texts.slice(0, order(name)).filter((t) => /^(WORKING|NEEDS YOU|DONE|STALE) /.test(t)).at(-1)!.split(' ')[0];
    expect(['agent 1', 'agent 6'].map(column)).toEqual(['WORKING', 'WORKING']);
    expect(column('agent 2')).toBe('NEEDS');
    expect(['agent 3', 'agent 4'].map(column)).toEqual(['DONE', 'DONE']);
    expect(column('agent 5')).toBe('STALE');
  });

  it('#102 AC1 a full room still counts everyone, with the overflow summed up', () => {
    const many = Array.from({ length: 18 }, (_, i) => rec(i + 1));
    const one = recorder();
    paintCentre(one.g, controlRoom().feed(many));
    expect(one.texts.find((t) => t.startsWith('WORKING'))!.replace(/\s+/g, ' ')).toBe('WORKING 18');
    const listed = one.texts.filter((t) => t.startsWith('agent ')).length;
    const more = Number(one.texts.find((t) => /^\+\d+ more$/.test(t))!.match(/\d+/)![0]);
    expect(listed + more).toBe(18);
  });
});

describe('#102 AC2 the left screen: one row per project, its branch, a dot per session in its state colour', () => {
  const { feed } = controlRoom();
  const model = feed([
    rec(1, 'working', { project: 'agent-office', branch: 'tk/epic-98' }),
    rec(2, 'needs', { project: 'weather-app', branch: 'hourly' }),
    rec(3, 'stale', { project: 'agent-office', branch: 'tk/epic-98' }),
  ]);

  it('#102 AC2 one row per project with its branch and each session\'s state', () => {
    expect(model.projects).toEqual([
      { project: 'agent-office', branches: ['tk/epic-98'], states: ['working', 'stale'] },
      { project: 'weather-app', branches: ['hourly'], states: ['needs'] },
    ]);
  });

  it('#102 AC2 painted: project names, branches, and dots in the state colours', () => {
    const { g, texts, dots } = recorder();
    paintProjects(g, model.projects);
    for (const t of ['agent-office', 'tk/epic-98', 'weather-app', 'hourly']) expect(texts).toContain(t);
    expect(texts.filter((t) => t === 'agent-office')).toHaveLength(1);
    expect(dots).toEqual([STATUS_COLORS.working, STATUS_COLORS.stale, STATUS_COLORS.needs]);
  });
});

describe('#102 AC3 the right screen: the latest tool calls across agents, newest first, each labelled with its session', () => {
  it('#102 AC3 calls from every agent, newest first, labelled with their session', () => {
    const { feed } = controlRoom();
    feed([rec(1, 'working', { activity: ['Read a.ts'] }), rec(2, 'working', { activity: ['Grep foo'] })]);
    feed([rec(1, 'working', { activity: ['Read a.ts', 'Edit a.ts'] }), rec(2, 'working', { activity: ['Grep foo'] })]);
    const model = feed([rec(1, 'working', { activity: ['Read a.ts', 'Edit a.ts'] }), rec(2, 'working', { activity: ['Grep foo', 'Bash npm test'] })]);
    expect(model.calls.slice(0, 2)).toEqual([
      { session: 'agent 2', line: 'Bash npm test' },
      { session: 'agent 1', line: 'Edit a.ts' },
    ]);
    expect(model.calls).toHaveLength(4);

    const { g, texts } = recorder();
    paintCalls(g, model.calls);
    const first = texts.indexOf('Bash');
    expect(texts.slice(first, first + 3)).toEqual(['Bash', 'agent 2', 'npm test']);
    expect(texts.indexOf('Edit')).toBeGreaterThan(first);
  });

  it('#102 AC3 a sliding window of calls only adds the new ones', () => {
    const { feed } = controlRoom();
    feed([rec(1, 'working', { activity: ['Read a', 'Read b', 'Read c'] })]);
    const model = feed([rec(1, 'working', { activity: ['Read b', 'Read c', 'Edit c'] })]);
    expect(model.calls.map((c) => c.line)).toEqual(['Edit c', 'Read c', 'Read b', 'Read a']);
  });
});

describe('#102 AC4 the screens update on the next feed update after a change', () => {
  it('#102 AC4 a state change, a new project and a new call all show on the next update', () => {
    const { feed } = controlRoom();
    feed([rec(1)]);
    const model = feed([rec(1, 'needs'), rec(2, 'working', { project: 'other', activity: ['Bash ls'] })]);
    const { g, texts } = recorder();
    paintCentre(g, model);
    expect(texts.find((t) => t.startsWith('NEEDS YOU'))!.replace(/\s+/g, ' ')).toBe('NEEDS YOU 1');
    expect(model.projects.map((p) => p.project)).toEqual(['demo-app', 'other']);
    expect(model.calls[0]).toEqual({ session: 'agent 2', line: 'Bash ls' });
  });

  it('#102 AC4 an agent who leaves drops off the board and its project', () => {
    const { feed } = controlRoom();
    feed([rec(1), rec(2, 'done', { project: 'other' })]);
    const model = feed([rec(1)]);
    expect(model.tiles.map((t) => t.name)).toEqual(['agent 1']);
    expect(model.projects.map((p) => p.project)).toEqual(['demo-app']);
  });
});
