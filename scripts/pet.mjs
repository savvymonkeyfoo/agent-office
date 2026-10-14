#!/usr/bin/env node
// Agent Pet: a little office character that floats on your desktop. The office must be running.
//   node scripts/pet.mjs run        start it now
//   node scripts/pet.mjs install    start it now and at every login
//   node scripts/pet.mjs uninstall  stop it and remove it
// macOS builds the native app (scripts/pet.sh, needs Xcode's command line tools).
// Windows and Linux run desktop-pet/ in Electron, fetched into ~/.agent-office/pet the first time (about 100 MB).
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, statSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(DIR, 'desktop-pet', 'main.cjs');
const ELECTRON_VERSION = '44.5.0';
const HOME = join(homedir(), '.agent-office', 'pet');
const action = process.argv[2];
if (!['run', 'install', 'uninstall'].includes(action)) {
  console.log('Usage: node scripts/pet.mjs run|install|uninstall');
  process.exit(1);
}
const windows = process.platform === 'win32';
const run = (command, args, options = {}) => execFileSync(command, args, { stdio: 'inherit', ...options });

if (process.platform === 'darwin') {
  run('sh', [join(DIR, 'scripts', 'pet.sh'), action]);
  process.exit(0);
}

stop();
const startup = windows
  ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'agent-pet.vbs')
  : join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'autostart', 'agent-pet.desktop');

if (action === 'uninstall') {
  rmSync(startup, { force: true });
  console.log('Agent Pet is removed.');
  process.exit(0);
}

const electron = ensureElectron();
// Linux: Electron's sandbox helper needs root to set up (chown root + chmod 4755 on chrome-sandbox), which npm can't do.
// Without it Electron refuses to start, so run without that layer; the pet only shows this computer's own office page.
const sandboxHelper = join(dirname(electron), 'chrome-sandbox');
const args = !windows && !setuidRoot(sandboxHelper) ? [APP, '--no-sandbox'] : [APP];
if (action === 'install') {
  mkdirSync(dirname(startup), { recursive: true });
  if (windows) {
    // A .vbs in the Startup folder runs at login; no admin rights needed.
    writeFileSync(startup, `CreateObject("WScript.Shell").Run """${electron}"" ""${APP}""", 0, False\r\n`);
  } else {
    writeFileSync(startup, `[Desktop Entry]\nType=Application\nName=Agent Pet\nExec=${[electron, ...args].map((a) => `"${a}"`).join(' ')}\nX-GNOME-Autostart-enabled=true\n`);
  }
}
// Its output goes to a log, for when it doesn't appear.
const log = openSync(join(HOME, 'pet.log'), 'a');
spawn(electron, args, { detached: true, stdio: ['ignore', log, log], windowsHide: true }).unref();
console.log(action === 'install'
  ? 'Agent Pet is installed and on your desktop. It starts at login; right-click it to quit.'
  : 'Agent Pet is on your desktop. Drag it anywhere; right-click for options.');

/** The Electron binary, fetched once into ~/.agent-office/pet so the office itself doesn't carry it. */
function ensureElectron() {
  const pkg = join(HOME, 'node_modules', 'electron');
  const installed = (() => { try { return JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version; } catch { return null; } })();
  if (installed !== ELECTRON_VERSION) {
    console.log(`Fetching Electron ${ELECTRON_VERSION} for the pet (once; about 100 MB)...`);
    mkdirSync(HOME, { recursive: true });
    if (!existsSync(join(HOME, 'package.json'))) writeFileSync(join(HOME, 'package.json'), '{ "private": true }\n');
    // npm is a .cmd script on Windows, which only runs through the shell; the arguments are fixed.
    run('npm', ['install', '--no-audit', '--no-fund', '--prefix', HOME, `electron@${ELECTRON_VERSION}`], { shell: windows });
  }
  // Electron fetches its binary on first use rather than at install; do it now, while there's a terminal to show it.
  // path.txt is written once that download has finished.
  if (!existsSync(join(pkg, 'path.txt'))) {
    try { run(process.execPath, [join(pkg, 'install.js')]); } catch { /* reported below */ }
  }
  const binary = (() => { try { return readFileSync(join(pkg, 'path.txt'), 'utf8').trim(); } catch { return null; } })();
  if (!binary) {
    rmSync(pkg, { recursive: true, force: true }); // so the next try fetches it again
    console.error("Couldn't download Electron for the pet. Check your internet connection and run this again.");
    process.exit(1);
  }
  return join(pkg, 'dist', binary);
}

function setuidRoot(file) {
  try { const { uid, mode } = statSync(file); return uid === 0 && (mode & 0o4000) !== 0; } catch { return false; }
}

/** Stops a running pet, matched on the app's full path so nothing else is touched. */
function stop() {
  try {
    if (windows) {
      const quote = (text) => `'${text.replace(/'/g, "''")}'`;
      run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains(${quote(APP)}) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],
      { windowsHide: true });
    } else {
      run('pkill', ['-f', APP], { stdio: 'ignore' });
    }
  } catch { /* not running */ }
}
