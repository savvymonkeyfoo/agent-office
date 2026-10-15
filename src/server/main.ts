import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOST, lanUrls, resolvePort, startServer, wantsLan } from './http.ts';
import { createApi } from './api.ts';
import { createFeed } from './feed.ts';
import { listClaudeAgents } from './claude.ts';
import { loadAgents } from './load.ts';
import { cloudAckStore, cloudLimit, loadCloudAgents, wantsCloud } from './cloud.ts';
import { createNeedsNotifier } from './notify.ts';
import { createAckStore } from './acknowledged.ts';
import { createHiddenProjectsStore } from './hidden-projects.ts';
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
const feed = cloud
  ? createFeed(async () => { const records = await loadCloudAgents({ now: Date.now(), acknowledged }); notifyNeeds(records); return records; })
  : createFeed(() => loadAgents({ list: listClaudeAgents, now: Date.now(), acknowledged }));
await feed.poll(cloud ? CLOUD_POLL_MS : POLL_MS);

try {
  await startServer({ port, staticDir, api: createApi(feed, acknowledged, usage, createHiddenProjectsStore(), createPetLauncher({ root: fileURLToPath(new URL('../../..', import.meta.url)) })), lan });
} catch (error) {
  const inUse = (error as NodeJS.ErrnoException).code === 'EADDRINUSE';
  console.error(inUse ? `Port ${port} is already in use. Start with another port, e.g. PORT=${port + 1}.` : String(error));
  process.exit(1);
}
console.log(`Agent Office is running at http://${HOST}:${port}${cloud ? ', showing your Claude Code cloud sessions' : ''}`);
if (lan) lanUrls(port).forEach((line) => console.log(line));

const startup = feed.current();
if (!Array.isArray(startup)) console.error(startup.error);
