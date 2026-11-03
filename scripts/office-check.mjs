// Visual and motion checks for the office layouts, run against a fake feed (dev only).
//   node scripts/office-check.mjs --layouts classic,control-room,lab --scenarios one,five,twelve --out shots
// Saves a screenshot per layout × scenario, and (with --motion) samples every character's position
// each frame to report pops, overlaps and walking through desks.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { scenarios } from './scenarios.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const layouts = arg('layouts', 'classic,control-room').split(',');
const names = arg('scenarios', 'one,five,twelve').split(',');
const out = arg('out', 'shots');
const settle = Number(arg('settle', '6'));
const motion = process.argv.includes('--motion');
const width = Number(arg('width', '1440')), height = Number(arg('height', '900'));
const extra = arg('query', '');
mkdirSync(out, { recursive: true });

// No config file: the dev proxy to a real server isn't wanted (the feed is fake).
const server = await createServer({ configFile: false, server: { port: 5199, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = {};
try {
  for (const layout of layouts) {
    for (const name of names) {
      const page = await browser.newPage({ viewport: { width, height } });
      page.on('pageerror', (e) => console.error(`[${layout}/${name}] page error:`, e.message));
      await page.addInitScript((id) => { localStorage.setItem('agent-office.layout', id); localStorage.setItem('agent-office.motion-check', '1'); }, layout);
      await page.goto(`http://localhost:5199/?${extra}`);
      await page.waitForFunction(() => 'officeFeed' in window && 'officeDebug' in window, null, { timeout: 60000 });
      const steps = scenarios[name];
      if (motion) await page.evaluate(() => (window).__motion?.start());
      const t0 = Date.now();
      for (const step of steps) {
        const wait = step.at * 1000 - (Date.now() - t0);
        if (wait > 0) await page.waitForTimeout(wait);
        await page.evaluate((records) => (window).officeFeed(records), step.records);
      }
      await page.waitForTimeout(settle * 1000);
      await page.screenshot({ path: `${out}/${layout}-${name}.png` });
      if (motion) report[`${layout}/${name}`] = await page.evaluate(() => (window).__motion?.stop() ?? null);
      await page.close();
      console.log(`${layout}/${name} done`);
    }
  }
} finally {
  await browser.close();
  await server.close();
}
if (motion) {
  writeFileSync(`${out}/motion.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
