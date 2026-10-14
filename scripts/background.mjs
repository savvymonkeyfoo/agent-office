#!/usr/bin/env node
// Runs Agent Office (cloud mode) in the background: starts when you log in, restarts if it stops.
//   node scripts/background.mjs install    set it up and start it now (run it again after an update to restart)
//   node scripts/background.mjs uninstall  stop it and remove it
// macOS uses launchd (scripts/launch-agent.sh), Windows your Startup folder, Linux a systemd user service.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OFFICE = join(DIR, 'bin', 'agent-office.js');
const URL = 'http://127.0.0.1:4321';
const action = process.argv[2];
if (action !== 'install' && action !== 'uninstall') {
  console.log('Usage: node scripts/background.mjs install|uninstall');
  process.exit(1);
}

const run = (command, args, options = {}) => execFileSync(command, args, { stdio: 'inherit', ...options });

if (process.platform === 'darwin') {
  run('sh', [join(DIR, 'scripts', 'launch-agent.sh'), action]);
} else if (process.platform === 'win32') {
  windows();
} else {
  linux();
}

function windows() {
  const home = join(homedir(), '.agent-office');
  const script = join(home, 'run.cmd');
  const log = join(home, 'agent-office.log');
  const startup = join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'agent-office.vbs');

  // Stop the restart loop first, then the office itself. Matches on the full paths, so nothing else is touched.
  const quote = (text) => `'${text.replace(/'/g, "''")}'`;
  const stop = `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and ($_.CommandLine.Contains(${quote(script)}) -or $_.CommandLine.Contains(${quote(OFFICE)})) } | Sort-Object { $_.Name -ne 'cmd.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  try { run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', stop], { windowsHide: true }); } catch { /* nothing running */ }

  if (action === 'uninstall') {
    rmSync(startup, { force: true });
    rmSync(script, { force: true });
    console.log('Agent Office no longer runs in the background.');
    return;
  }
  mkdirSync(home, { recursive: true });
  // `timeout` needs a console, which a hidden window doesn't have; ping waits about 30 seconds instead.
  writeFileSync(script, [
    '@echo off',
    'set CLOUD=1',
    `cd /d "${DIR}"`,
    ':loop',
    `"${process.execPath}" "${OFFICE}" >> "${log}" 2>&1`,
    'ping -n 31 127.0.0.1 >nul',
    'goto loop',
    '',
  ].join('\r\n'));
  // A .vbs in the Startup folder runs at login with no window; no admin rights needed.
  writeFileSync(startup, `CreateObject("WScript.Shell").Run """${script}""", 0, False\r\n`);
  spawn('wscript.exe', [startup], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  console.log(`Agent Office now runs in the background at ${URL} (log: ${log})`);
}

function linux() {
  const unitDir = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'systemd', 'user');
  const unit = join(unitDir, 'agent-office.service');
  const systemctl = (...args) => run('systemctl', ['--user', ...args]);
  if (action === 'uninstall') {
    try { systemctl('disable', '--now', 'agent-office'); } catch { /* not installed */ }
    rmSync(unit, { force: true });
    try { systemctl('daemon-reload'); } catch { /* no systemd */ }
    console.log('Agent Office no longer runs in the background.');
    return;
  }
  mkdirSync(unitDir, { recursive: true });
  writeFileSync(unit, [
    '[Unit]',
    'Description=Agent Office',
    '',
    '[Service]',
    'Environment=CLOUD=1',
    `Environment=PATH=${process.env.PATH ?? ''}`,
    `WorkingDirectory=${DIR}`,
    `ExecStart="${process.execPath}" "${OFFICE}"`,
    'Restart=always',
    'RestartSec=30',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n'));
  systemctl('daemon-reload');
  systemctl('enable', 'agent-office');
  systemctl('restart', 'agent-office');
  console.log(`Agent Office now runs in the background at ${URL} (log: journalctl --user -u agent-office)`);
}
