/** Away at least this long and the office opens with a catch-up. */
export const AWAY_MS = 20 * 60_000;
const SEEN_KEY = 'agentOffice.lastSeen';
/** While the page is open and visible, it counts as seen up to now. */
const SEEN_EVERY_MS = 60_000;

interface AssistantState { route: 'api' | 'login' | null; petVoice: boolean }

interface Options {
  request?: typeof fetch;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  now?: () => number;
  /** Called when the panel opens, so the agent card can close (they share a corner). */
  onOpen?: () => void;
}

const safeStorage = () => { try { return window.localStorage; } catch { return null; } };
const para = (text: string, className = '') => Object.assign(document.createElement('p'), { textContent: text, className });

/**
 * The office's Haiku corner (markup in index.html): a catch-up on what happened while you were away, opened by itself
 * when you come back, an ask box, and the pet's voice switch. Hidden when Haiku is off on this computer.
 */
export function mountAssistant(button: HTMLButtonElement, panel: HTMLElement, { request = fetch, storage = safeStorage(), now = Date.now, onOpen }: Options = {}) {
  let state: AssistantState | null = null;
  const read = () => { try { return Number(storage?.getItem(SEEN_KEY)) || 0; } catch { return 0; } };
  const write = (t: number) => { try { storage?.setItem(SEEN_KEY, String(t)); } catch { /* private window */ } };

  const briefing = panel.querySelector<HTMLElement>('[data-briefing]')!;
  const answer = panel.querySelector<HTMLElement>('[data-answer]')!;
  const form = panel.querySelector<HTMLFormElement>('[data-ask]')!;
  const input = form.querySelector<HTMLInputElement>('input')!;
  const voice = panel.querySelector<HTMLInputElement>('[data-voice]')!;

  function open() { panel.hidden = false; button.setAttribute('aria-pressed', 'true'); onOpen?.(); }
  function close() { panel.hidden = true; button.setAttribute('aria-pressed', 'false'); }
  panel.querySelector<HTMLButtonElement>('[data-close]')!.onclick = close;

  async function catchUp(since: number, auto: boolean) {
    briefing.replaceChildren(para('Reading the office…', 'dim'));
    if (!auto) open();
    const body = await request(`/api/briefing?since=${Math.floor(since)}`).then((r) => (r.ok ? r.json() : null), () => null) as { text: string | null } | null;
    if (auto && !body?.text) { briefing.replaceChildren(); return; }
    briefing.replaceChildren(para(body ? (body.text ?? 'Nothing new in the last few hours.') : "Couldn't reach the office."));
    if (auto) open();
  }

  button.addEventListener('click', () => {
    if (!panel.hidden) return close();
    // By hand: the last few hours, or since you were last here if that's longer ago.
    void catchUp(Math.min(read() || now(), now() - 3 * 3600_000), false);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const question = input.value.trim();
    if (!question) return;
    answer.hidden = false;
    answer.replaceChildren(para(question, 'q'), para('Thinking…', 'dim'));
    const res = await request('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question }) }).catch(() => null);
    const text = res?.ok ? String((await res.json()).answer) : (res ? await res.text() : "Couldn't reach the office.");
    answer.replaceChildren(para(question, 'q'), para(text));
  });

  voice.addEventListener('change', () => {
    void request('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ petVoice: voice.checked }) });
  });

  /** Coming back after a while: brief first, then count the page as seen. */
  function returned() {
    const last = read();
    if (state?.route && last && now() - last >= AWAY_MS) void catchUp(last, true);
    write(now());
  }

  const ready = request('/api/assistant').then((r) => (r.ok ? r.json() : null), () => null).then((s: AssistantState | null) => {
    state = s;
    button.hidden = !s?.route;
    if (!s?.route) return;
    voice.checked = s.petVoice;
    if (document.visibilityState !== 'hidden') returned();
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') returned(); });
  const timer = setInterval(() => { if (document.visibilityState === 'visible') write(now()); }, SEEN_EVERY_MS);

  return { ready, open, close, stop: () => clearInterval(timer) };
}
