import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOST, lanUrls, resolvePort, startServer, wantsLan } from './http.ts';
import { createApi } from './api.ts';
import { createFeed } from './feed.ts';
import { listClaudeAgents } from './claude.ts';
import { loadAgents } from './load.ts';
import { cloudAckStore, cloudActivity, cloudLimit, loadCloudAgents, wantsCloud } from './cloud.ts';
import { createHaiku } from './haiku.ts';
import { createInsights } from './insights.ts';
import { createSettingsStore } from './settings.ts';
import { speak } from './speak.ts';
import { createNeedsNotifier } from './notify.ts';
import { createAckStore } from './acknowledged.ts';
import { createHiddenProjectsStore, createProjectKindsStore } from './hidden-projects.ts';
import { createPetLauncher } from './pet.ts';
import { limitsFile, readLimits } from './limits.ts';
import { weekStart, weeklyTokens } from './tokens.ts';
import { claudeConfigDir } from './transcript.ts';
import type { UsagePayload } from '../shared/usage.ts';
import { enableTracking, refreshScript, trackingFiles, trackingStatus } from './tracking.ts';

const POLL_MS = 2000;
/** Cloud sessions come over the network, so ask less often. */
const CLOUD_POLL_MS = 10_000;
const staticDir = fileURLToPath(new URL('../../client', import.meta.url));
const port = resolvePort(process.env);
const lan = wantsLan(process.argv, process.env);
const cloud = wantsCloud(process.argv, process.env);

const acknowledged = cloud ? cloudAckStore(createAckStore()) : createAckStore();
const tracking = { ...trackingFiles(), scriptSource: fileURLToPath(new URL('../../../bin/statusline.js', import.meta.url)) };
refreshScript(tracking);
const projectsDir = join(claudeConfigDir(), 'projects');
function readUsage(): UsagePayload {
  const now = Date.now();
  const limits = readLimits(limitsFile(), now);
  if (cloud) return { tracking: trackingStatus(tracking), limits, projects: [], cloud: cloudLimit() };
  return { tracking: trackingStatus(tracking), limits, projects: weeklyTokens(projectsDir, weekStart(limits.weekly, now)) };
}
const usage = { read: readUsage, enable: () => (enableTracking(tracking), readUsage()) };
// NOTIFY=0 turns off the Mac notification when a cloud session starts needing you.
const notifyNeeds = process.env.NOTIFY === '0' ? () => {} : createNeedsNotifier();
const haiku = createHaiku();
const settings = createSettingsStore();
// The pet's lines are read out loud here, in the computer's own voice, while a pet is listening and its voice is on.
const insights = createInsights({
  haiku,
  recentActivity: cloud ? (r) => cloudActivity(r.sessionId) : undefined,
  speak: (a) => { if (settings.get().petVoice) speak(a.text); },
});
const feed = cloud
  ? createFeed(async () => { const records = await loadCloudAgents({ now: Date.now(), acknowledged }); notifyNeeds(records); return insights.observe(records); })
  : createFeed(async () => insights.observe(await loadAgents({ list: listClaudeAgents, now: Date.now(), acknowledged })));
await feed.poll(cloud ? CLOUD_POLL_MS : POLL_MS);

try {
  await startServer({ port, staticDir, api: createApi(feed, acknowledged, usage, createHiddenProjectsStore(), createPetLauncher({ root: fileURLToPath(new URL('../../..', import.meta.url)) }), { insights, haiku, settings }, createProjectKindsStore()), lan });
} catch (error) {
  const inUse = (error as NodeJS.ErrnoException).code === 'EADDRINUSE';
  console.error(inUse ? `Port ${port} is already in use. Start with another port, e.g. PORT=${port + 1}.` : String(error));
  process.exit(1);
}
console.log(`Agent Office is running at http://${HOST}:${port}${cloud ? ', showing your Claude Code cloud sessions' : ''}`);
if (lan) lanUrls(port).forEach((line) => console.log(line));
console.log({ api: 'Haiku helpers on, paid from the office\'s API key.', login: 'Haiku helpers on, through your claude.ai login.', work: 'Haiku helpers on, through Claude Code\'s work setup on this computer (you opted in).', none: 'Haiku helpers off (no office API key, and Claude Code uses a work key or gateway: run `echo work > ~/.agent-office/haiku-provider` to let that pay).' }[haiku.route() ?? 'none']);

const startup = feed.current();
if (!Array.isArray(startup)) console.error(startup.error);
