// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createPetLauncher, type PetLauncher } from '../src/server/pet.ts';
import { createFeed } from '../src/server/feed.ts';
import { createApi } from '../src/server/api.ts';
import { startServer } from '../src/server/http.ts';
import { bindPetButton } from '../src/client/pet-button.ts';

function launcher(platform: NodeJS.Platform, present: string[]) {
  const runs: [string, string[]][] = [];
  const pet = createPetLauncher({ root: '/office', platform, home: '/home/alex', exists: (p) => present.includes(p), run: (c, a) => runs.push([c, a]) });
  return { pet, runs };
}

describe('bringing the desktop pet back', () => {
  it('on a Mac, opens the installed app, else the one scripts/pet.sh built', () => {
    const installed = launcher('darwin', ['/home/alex/Applications/Agent Pet.app', '/office/mac/build/Agent Pet.app']);
    expect(installed.pet.show()).toBe(true);
    expect(installed.runs).toEqual([['open', ['/home/alex/Applications/Agent Pet.app']]]);
    const built = launcher('darwin', ['/office/mac/build/Agent Pet.app']);
    built.pet.show();
    expect(built.runs).toEqual([['open', ['/office/mac/build/Agent Pet.app']]]);
  });

  it('elsewhere, runs pet.mjs once Electron has been fetched', () => {
    const { pet, runs } = launcher('win32', ['/home/alex/.agent-office/pet/node_modules/electron/path.txt']);
    expect(pet.available()).toBe(true);
    pet.show();
    expect(runs).toEqual([[process.execPath, ['/office/scripts/pet.mjs', 'run']]]);
  });

  it("does nothing when the pet was never set up", () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const { pet, runs } = launcher(platform, []);
      expect(pet.available()).toBe(false);
      expect(pet.show()).toBe(false);
      expect(runs).toEqual([]);
    }
  });
});

describe('the office API for the pet', () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  async function serve(pet: PetLauncher) {
    const staticDir = mkdtempSync(join(tmpdir(), 'office-static-'));
    writeFileSync(join(staticDir, 'index.html'), 'page');
    server = await startServer({ port: 0, staticDir, api: createApi(createFeed(async () => []), undefined, undefined, undefined, pet) });
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }
  const show = (base: string, type = 'application/json') => fetch(`${base}/api/pet/show`, { method: 'POST', headers: { 'content-type': type }, body: '{}' });

  it('says whether the pet is set up, and starts it', async () => {
    const { pet, runs } = launcher('darwin', ['/home/alex/Applications/Agent Pet.app']);
    const base = await serve(pet);
    expect(await (await fetch(`${base}/api/pet`)).json()).toEqual({ available: true });
    expect((await show(base)).status).toBe(204);
    expect(runs).toHaveLength(1);
  });

  it('only takes JSON, and explains when there is no pet to start', async () => {
    const base = await serve(launcher('darwin', []).pet);
    expect((await show(base, 'text/plain')).status).toBe(415);
    const res = await show(base);
    expect(res.status).toBe(409);
    expect(await res.text()).toContain('node scripts/pet.mjs install');
  });
});

describe('the office button', () => {
  const answer = (body: unknown, ok = true) => Promise.resolve({ ok, json: async () => body, text: async () => String(body) } as Response);

  it('stays hidden until the pet is set up', async () => {
    const button = document.createElement('button');
    button.hidden = true;
    await bindPetButton(button, () => answer({ available: false }));
    expect(button.hidden).toBe(true);
    await bindPetButton(button, () => Promise.reject(new Error('offline')));
    expect(button.hidden).toBe(true);
  });

  it('asks the office to bring the pet back', async () => {
    const button = document.createElement('button');
    button.hidden = true;
    button.title = 'Bring back the desktop pet';
    const calls: string[] = [];
    await bindPetButton(button, ((url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      return answer(url === '/api/pet' ? { available: true } : null);
    }) as typeof fetch);
    expect(button.hidden).toBe(false);
    button.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(['GET /api/pet', 'POST /api/pet/show']);
    expect(button.title).toBe('The pet is on your desktop');
  });
});
