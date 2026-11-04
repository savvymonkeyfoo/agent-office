// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mountProjectFilter } from '../src/client/projects.ts';
import { nameProjects } from '../src/server/cloud.ts';
import type { AgentRecord } from '../src/shared/agent.ts';

const rec = (sessionId: string, project: string): AgentRecord =>
  ({ id: sessionId, sessionId, name: sessionId, project, cwd: '', state: 'working', lastMessage: null, branch: null, activity: [] });

describe('nameProjects', () => {
  it('names threads after their coordinator and leaves other sessions alone', () => {
    const [thread, other] = nameProjects(
      [{ id: 'cse_t', tags: ['hearth-thread'], parent_session_id: 'session_c' }, { id: 'cse_o' }],
      [{ id: 'cse_c', title: 'Project coordinator ("Agent Office")' }],
    );
    expect(thread.project_name).toBe('Agent Office');
    expect(other.project_name).toBeUndefined();
  });

  it('shows a coordinator as its project\'s chat', () => {
    const [chat] = nameProjects([{ id: 'cse_c', tags: ['hearth-overview'], title: 'Project coordinator ("McD App")' }], []);
    expect(chat.project_name).toBe('McD App');
    expect(chat.title).toBe('Project chat');
  });
});

describe('mountProjectFilter', () => {
  it('lists projects and hides unticked ones', () => {
    localStorage.clear();
    const el = document.createElement('aside');
    let changes = 0;
    const filter = mountProjectFilter(el, () => { changes += 1; });
    const records = [rec('a', 'Agent Office'), rec('b', 'Trading'), rec('c', 'Trading')];
    expect(filter.filter(records)).toHaveLength(3);
    expect(el.hidden).toBe(false);
    const box = el.querySelector<HTMLInputElement>('input[data-project="Trading"]')!;
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    expect(changes).toBe(1);
    expect(filter.filter(records).map((r) => r.sessionId)).toEqual(['a']);
  });
});

describe('Capgemini and personal tabs', () => {
  const records = [rec('a', 'Agent Office'), rec('b', 'AIE reporting'), rec('c', 'AIE reporting')];
  const listed = (el: HTMLElement) => [...el.querySelectorAll<HTMLInputElement>('input[data-project]')].map((b) => b.dataset.project);
  const click = (el: HTMLElement, selector: string) => el.querySelector<HTMLButtonElement>(selector)!.click();

  it('counts unmarked projects as Capgemini, and narrows the list and office once one is marked personal', () => {
    localStorage.clear();
    const el = document.createElement('aside');
    let changes = 0;
    const filter = mountProjectFilter(el, () => { changes += 1; });
    expect(filter.filter(records)).toHaveLength(3);
    expect(el.querySelector('[data-tab="all"]')!.getAttribute('aria-pressed')).toBe('true');

    // Nothing is marked yet: everything is Capgemini.
    click(el, '[data-tab="personal"]');
    expect(filter.filter(records)).toHaveLength(0);
    expect(el.textContent).toContain('No personal projects yet');
    click(el, '[data-tab="work"]');
    expect(filter.filter(records)).toHaveLength(3);
    expect(el.querySelector('[data-kind="AIE reporting"]')!.textContent).toBe('💼');

    click(el, '[data-kind="Agent Office"]');
    expect(listed(el)).toEqual(['AIE reporting']);
    expect(filter.filter(records).map((r) => r.sessionId)).toEqual(['b', 'c']);
    click(el, '[data-tab="personal"]');
    expect(listed(el)).toEqual(['Agent Office']);
    expect(filter.filter(records).map((r) => r.sessionId)).toEqual(['a']);
    expect(el.querySelector('[data-kind="Agent Office"]')!.textContent).toBe('🏠');
    expect(changes).toBe(4);
  });

  it('remembers the tab and the marks', () => {
    localStorage.clear();
    const first = document.createElement('aside');
    const one = mountProjectFilter(first, () => {});
    one.filter(records);
    click(first, '[data-kind="Agent Office"]');
    click(first, '[data-tab="personal"]');

    const again = document.createElement('aside');
    const two = mountProjectFilter(again, () => {});
    expect(two.filter(records).map((r) => r.sessionId)).toEqual(['a']);
    expect(again.querySelector('[data-tab="personal"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it("takes the server's marks and saves one project at a time", async () => {
    localStorage.clear();
    const saves: [string, string][] = [];
    const el = document.createElement('aside');
    let changes = 0;
    const filter = mountProjectFilter(el, () => { changes += 1; }, undefined, {
      load: async () => ({ 'Agent Office': 'personal' }),
      save: (project, kind) => { saves.push([project, kind]); },
    });
    filter.filter(records);
    await new Promise((r) => setTimeout(r));
    expect(changes).toBe(1);
    click(el, '[data-kind="AIE reporting"]');
    expect(saves).toEqual([['AIE reporting', 'personal']]);
    click(el, '[data-tab="personal"]');
    expect(filter.filter(records).map((r) => r.sessionId)).toEqual(['a', 'b', 'c']);
  });

  it("gives an empty server this browser's marks", async () => {
    localStorage.clear();
    localStorage.setItem('agent-office:project-kinds', JSON.stringify({ Trading: 'personal' }));
    const saves: [string, string][] = [];
    mountProjectFilter(document.createElement('aside'), () => {}, undefined, { load: async () => ({}), save: (p, k) => { saves.push([p, k]); } });
    await new Promise((r) => setTimeout(r));
    expect(saves).toEqual([['Trading', 'personal']]);
  });
});
