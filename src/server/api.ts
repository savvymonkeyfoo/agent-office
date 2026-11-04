import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiHandler } from './http.ts';
import type { Feed } from './feed.ts';
import type { AckStore } from './acknowledged.ts';
import { projectList, type HiddenProjectsStore } from './hidden-projects.ts';
import type { PetLauncher } from './pet.ts';
import { isThisMachine } from './tracking.ts';
import type { Insights } from './insights.ts';
import type { Haiku } from './haiku.ts';
import type { SettingsStore } from './settings.ts';

/** The Haiku-backed helpers: briefing, ask box, pet lines and shared settings. */
export interface AssistantApi {
  insights: Insights;
  haiku: Haiku;
  settings: SettingsStore;
}

const MAX_QUESTION = 500;

export interface UsageApi {
  read(): unknown;
  /** Turns on limit tracking; returns the same payload as read(). */
  enable(): unknown;
}

const MAX_BODY = 4096;
/** A full list of hidden project names can be longer than one session id. */
const MAX_PROJECTS_BODY = 64 * 1024;
const MAX_ID = 200;

export function createApi(feed: Feed, acknowledged?: AckStore, usage?: UsageApi, hiddenProjects?: HiddenProjectsStore, pet?: PetLauncher, assistant?: AssistantApi, workProjects?: HiddenProjectsStore): ApiHandler {
  return async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://local').pathname;

    if (req.method === 'GET' && path === '/api/usage' && usage) {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(usage.read()));
      return true;
    }

    if (req.method === 'POST' && path === '/api/usage/enable' && usage) {
      // Edits Claude's settings: JSON only (no cross-site posts) and never from another machine.
      if (!req.headers['content-type']?.startsWith('application/json')) return reply(res, 415, 'Send JSON.');
      if (!isThisMachine(req.socket.remoteAddress)) return reply(res, 403, 'Limit tracking can only be enabled on this computer.');
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(usage.enable()));
      return true;
    }

    if (req.method === 'GET' && path === '/api/agents') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(feed.current()));
      return true;
    }

    if (req.method === 'GET' && path === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
      send(feed.current());
      const unsubscribe = feed.subscribe(send);
      req.on('close', unsubscribe);
      return true;
    }

    if (assistant && path.startsWith('/api/') && await handleAssistant(assistant, req, res, path)) return true;

    if (req.method === 'GET' && path === '/api/pet' && pet) {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ available: pet.available() }));
      return true;
    }

    if (req.method === 'POST' && path === '/api/pet/show' && pet) {
      // Starts a program: JSON only (no cross-site posts) and never from another machine.
      if (!req.headers['content-type']?.startsWith('application/json')) return reply(res, 415, 'Send JSON.');
      if (!isThisMachine(req.socket.remoteAddress)) return reply(res, 403, 'The pet can only be started on this computer.');
      if (!pet.show()) return reply(res, 409, "The desktop pet isn't set up here yet: run node scripts/pet.mjs install.");
      res.writeHead(204).end();
      return true;
    }

    // Two lists of project names: unticked ones, and ones marked as Capgemini work.
    const lists: Record<string, HiddenProjectsStore | undefined> = { '/api/hidden-projects': hiddenProjects, '/api/work-projects': workProjects };
    const store = lists[path];
    if (store) {
      if (req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify(store.get()));
        return true;
      }
      if (req.method === 'PUT') {
        // JSON only, like /api/acknowledge: no cross-site writes.
        if (!req.headers['content-type']?.startsWith('application/json')) return reply(res, 415, 'Send JSON.');
        let list: string[] | null;
        try {
          list = projectList(JSON.parse(await readBody(req, MAX_PROJECTS_BODY)));
        } catch {
          return reply(res, 400, 'Body must be a JSON list of project names.');
        }
        if (!list) return reply(res, 400, 'Body must be a JSON list of project names.');
        store.set(list);
        res.writeHead(204).end();
        return true;
      }
    }

    if (req.method === 'POST' && path === '/api/acknowledge' && acknowledged) {
      // JSON only: browsers can't send it cross-site without a preflight we never answer.
      if (!req.headers['content-type']?.startsWith('application/json')) return reply(res, 415, 'Send JSON.');
      let sessionId: unknown;
      try {
        sessionId = JSON.parse(await readBody(req)).sessionId;
      } catch {
        return reply(res, 400, 'Body must be JSON: { "sessionId": "…" }.');
      }
      if (typeof sessionId !== 'string' || !sessionId || sessionId.length > MAX_ID) return reply(res, 400, 'Missing or invalid sessionId.');
      acknowledged.add(sessionId);
      await feed.refresh();
      res.writeHead(204).end();
      return true;
    }

    return false;
  };
}

const json = (res: ServerResponse, body: unknown) => {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
  return true;
};

async function handleAssistant({ insights, haiku, settings }: AssistantApi, req: IncomingMessage, res: ServerResponse, path: string) {
  if (req.method === 'GET' && path === '/api/assistant') return json(res, { route: haiku.route(), ...settings.get() });

  if (req.method === 'PUT' && path === '/api/settings') {
    if (!req.headers['content-type']?.startsWith('application/json')) return reply(res, 415, 'Send JSON.');
    try {
      return json(res, settings.update(JSON.parse(await readBody(req))));
    } catch {
      return reply(res, 400, 'Body must be JSON settings.');
    }
  }

  if (req.method === 'GET' && path === '/api/briefing') {
    const since = Number(new URL(req.url ?? '/', 'http://local').searchParams.get('since'));
    if (!Number.isFinite(since) || since <= 0) return reply(res, 400, 'Give ?since= as epoch milliseconds.');
    return json(res, await insights.briefing(since));
  }

  if (req.method === 'POST' && path === '/api/ask') {
    // Costs a model call: JSON only, so other sites can't post here.
    if (!req.headers['content-type']?.startsWith('application/json')) return reply(res, 415, 'Send JSON.');
    let question: unknown;
    try {
      question = JSON.parse(await readBody(req)).question;
    } catch {
      return reply(res, 400, 'Body must be JSON: { "question": "…" }.');
    }
    if (typeof question !== 'string' || !question.trim() || question.length > MAX_QUESTION) return reply(res, 400, 'Missing or too long question.');
    if (!haiku.route()) return reply(res, 409, 'Haiku is off: add an API key for the office (see the README).');
    const answer = await insights.ask(question);
    return answer ? json(res, { answer }) : reply(res, 502, "Couldn't get an answer just now. Try again in a minute.");
  }

  if (req.method === 'GET' && path === '/api/announcements') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(': listening\n\n');
    const unsubscribe = insights.onAnnouncement((a) => res.write(`data: ${JSON.stringify(a)}\n\n`));
    req.on('close', unsubscribe);
    return true;
  }

  return false;
}

function reply(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }).end(message);
  return true;
}

function readBody(req: IncomingMessage, limit = MAX_BODY): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > limit) { reject(new Error('too large')); req.destroy(); }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}
