// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createHiddenProjectsStore, hiddenProjectsFile } from '../src/server/hidden-projects.ts';
import { createFeed } from '../src/server/feed.ts';
import { createApi } from '../src/server/api.ts';
import { startServer } from '../src/server/http.ts';
import { mountProjectFilter, type HiddenSync } from '../src/client/projects.ts';
import { startPet } from '../src/client/pet/main.ts';
import type { PetScene } from '../src/client/pet/scene.ts';
import type { AgentRecord, OfficeState } from '../src/shared/agent.ts';

const rec = (id: string, project: string, state: OfficeState = 'working'): AgentRecord =>
  ({ id, sessionId: id, name: id, project, cwd: '', state, lastMessage: null, branch: null, activity: [] });
const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'office-home-')), '.agent-office', 'hidden-projects.json');

describe('hidden projects on the server', () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  async function serve(file = tmpFile()) {
    const staticDir = mkdtempSync(join(tmpdir(), 'office-static-'));
    writeFileSync(join(staticDir, 'index.html'), 'page');
    server = await startServer({ port: 0, staticDir, api: createApi(createFeed(async () => []), undefined, undefined, createHiddenProjectsStore(file)) });
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, file };
  }
  const put = (base: string, body: string, type = 'application/json') =>
    fetch(`${base}/api/hidden-projects`, { method: 'PUT', headers: { 'content-type': type }, body });

  it('lives at ~/.agent-office/hidden-projects.json', () => {
    expect(hiddenProjectsFile('/home/alex')).toBe(join('/home/alex', '.agent-office', 'hidden-projects.json'));
  });

  it('starts empty, saves what the office sends, and reads it back after a restart', async () => {
    const { base, file } = await serve();
    expect(await (await fetch(`${base}/api/hidden-projects`)).json()).toEqual([]);
    expect((await put(base, JSON.stringify(['40 South', 'Projects', '40 South']))).status).toBe(204);
    expect(await (await fetch(`${base}/api/hidden-projects`)).json()).toEqual(['40 South', 'Projects']);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(['40 South', 'Projects']);
    expect(createHiddenProjectsStore(file).get()).toEqual(['40 South', 'Projects']);
  });

  it('only takes a JSON list of names', async () => {
    const { base } = await serve();
    expect((await put(base, '["a"]', 'text/plain')).status).toBe(415);
    expect((await put(base, '{"a":1}')).status).toBe(400);
    expect((await put(base, '[1]')).status).toBe(400);
    expect((await put(base, 'not json')).status).toBe(400);
    expect(await (await fetch(`${base}/api/hidden-projects`)).json()).toEqual([]);
  });

  it('ignores a broken file', () => {
    const file = tmpFile();
    createHiddenProjectsStore(file).set(['x']);
    writeFileSync(file, '{oops');
    expect(createHiddenProjectsStore(file).get()).toEqual([]);
  });
});

function fakeSync(saved: string[] | null) {
  const saves: string[][] = [];
  const sync: HiddenSync = { load: async () => saved, save: (list) => { saves.push(list); } };
  return { sync, saves };
}

describe('the office Projects panel keeps hidden projects on the server', () => {
  const records = [rec('a', 'Agent Office'), rec('b', 'Trading')];

  it("takes the server's list over this browser's", async () => {
    localStorage.clear();
    const el = document.createElement('aside');
    let changes = 0;
    const filter = mountProjectFilter(el, () => { changes += 1; }, fakeSync(['Trading']).sync);
    filter.filter(records);
    await vi.waitFor(() => expect(changes).toBe(1));
    expect(filter.filter(records).map((r) => r.sessionId)).toEqual(['a']);
    expect(el.querySelector<HTMLInputElement>('input[data-project="Trading"]')!.checked).toBe(false);
  });

  it('shares what this browser hid when the server has nothing yet', async () => {
    localStorage.clear();
    localStorage.setItem('agent-office:hidden-projects', JSON.stringify(['Trading']));
    const { sync, saves } = fakeSync([]);
    mountProjectFilter(document.createElement('aside'), () => {}, sync);
    await vi.waitFor(() => expect(saves).toEqual([['Trading']]));
  });

  it('saves each tick to the server', () => {
    localStorage.clear();
    const el = document.createElement('aside');
    const { sync, saves } = fakeSync(null);
    mountProjectFilter(el, () => {}, sync).filter(records);
    const box = el.querySelector<HTMLInputElement>('input[data-project="Trading"]')!;
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    expect(saves.at(-1)).toEqual(['Trading']);
  });
});

describe('the desktop pet leaves hidden projects out', () => {
  const scene: PetScene = { setMood() {}, showIcon() {}, hop() {}, bounds: () => null, dispose() {} };

  it('counts only questions from projects shown in the office', () => {
    const root = document.createElement('div');
    const opened: string[] = [];
    const pet = startPet(root, { kind: 'dog', officeUrl: 'http://office/', createScene: () => scene, open: (u) => opened.push(u) });
    pet.applyFeed([rec('session_a', 'AP LPO Support app', 'needs'), rec('session_b', 'AP Innovation Tour 2026', 'needs')]);
    expect(pet.status.text).toBe('2 questions waiting for you');
    pet.setHiddenProjects(['AP Innovation Tour 2026']);
    expect(pet.status.text).toBe('“session_a” has a question for you');
    pet.click();
    expect(opened).toEqual(['https://claude.ai/code/session_a']);
    pet.setHiddenProjects(['AP Innovation Tour 2026', 'AP LPO Support app']);
    expect(pet.status.mood).toBe('idle');
    pet.stop();
  });

  it("changing the filter doesn't announce anything", () => {
    const root = document.createElement('div');
    let hops = 0;
    const pet = startPet(root, { kind: 'dog', officeUrl: 'http://office/', createScene: () => ({ ...scene, hop: () => { hops++; } }) });
    pet.setHiddenProjects(['Hidden']);
    pet.applyFeed([rec('a', 'Hidden', 'needs')]);
    pet.applyFeed([rec('a', 'Hidden', 'needs')]);
    pet.setHiddenProjects([]);
    expect(pet.status.mood).toBe('needs');
    expect(hops).toBe(0);
    pet.stop();
  });
});
