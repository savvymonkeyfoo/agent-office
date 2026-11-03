// Fake session feeds for checking layouts without live sessions (dev only).
// Each scenario is a list of steps: { at: seconds, records: AgentRecord[] }.

const PROJECTS = ['agent-office', 'hub', 'garden-planner', 'pitch-deck', 'budget-app', 'recipe-bot', 'site-refresh', 'photo-sorter', 'trip-planner', 'music-tagger', 'notes-sync', 'home-lab'];
const TASKS = ['Edit src/client/lab.ts', 'Bash npm test', 'Read README.md', 'Grep "layout"', 'Write docs/plan.md', 'Bash git push'];
const STATES = ['working', 'needs', 'working', 'done', 'working', 'needs', 'finished'];

/** A fake session: `p` picks the project, `i` the session within it. */
export function record(p, i, state) {
  const project = PROJECTS[p % PROJECTS.length];
  const id = `fake-${p}-${i}`;
  return {
    id, sessionId: id, name: `${project.split('-')[0]} ${i + 1}`, project, cwd: `/demo/${project}`, state,
    lastMessage: state === 'needs' ? 'Should I go ahead and merge the layout change?' : 'Pushed the branch and opened a draft PR.',
    branch: `claude/${project}-${i}`,
    activity: TASKS.slice(0, 3 + ((p + i) % 3)).map((t, k) => TASKS[(k + p + i) % TASKS.length]),
    progress: ['Read the code', 'Write the change', 'Run the tests'].map((s, k) => `${k < (i % 3) + 1 ? '✓' : '○'} ${s}`),
    links: [{ label: 'Thread', url: 'https://claude.ai/' }],
  };
}

/** `projects` projects with `perProject` sessions each, states spread out. */
export function room(projects, perProject = 2) {
  const out = [];
  for (let p = 0; p < projects; p++) for (let i = 0; i < perProject; i++) out.push(record(p, i, STATES[(p * 3 + i) % STATES.length]));
  return out;
}

const many = (p, n, state = 'working') => Array.from({ length: n }, (_, i) => record(p, i, i % 4 === 1 ? 'needs' : state));

export const scenarios = {
  one: [{ at: 0, records: room(1, 2) }],
  five: [{ at: 0, records: room(5, 2) }],
  twelve: [{ at: 0, records: room(12, 2) }],
  // Uneven: one busy project (8 sessions, then 10) next to a small one (2) and a single.
  uneven: [
    { at: 0, records: [...many(1, 2), ...many(0, 8)] },
    { at: 3, records: [...many(1, 2), ...many(0, 8), record(2, 0, 'working')] },
    { at: 6, records: [...many(1, 2), ...many(0, 10), record(2, 0, 'working')] },
  ],
  // Sessions come and go: arrivals, a session ending mid-walk, state changes.
  churn: [
    { at: 0, records: room(4, 2) },
    { at: 3, records: [...room(4, 2), record(4, 0, 'working'), record(4, 1, 'working')] },
    { at: 4, records: [...room(4, 2).filter((r) => r.sessionId !== 'fake-1-0'), record(4, 0, 'working'), record(4, 1, 'needs')] },
    { at: 8, records: [...room(4, 2).filter((r) => !['fake-1-0', 'fake-2-1'].includes(r.sessionId)).map((r) => ({ ...r, state: 'done' })), record(4, 0, 'needs')] },
    { at: 12, records: [...room(3, 1), record(4, 0, 'working'), record(5, 0, 'working')] },
  ],
};
