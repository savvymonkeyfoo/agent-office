// Agent Pet for Windows and Linux: the same floating office character as the Mac app (mac/AgentPet.swift),
// drawn from the office's /pet.html in a see-through, always-on-top Electron window you can drag anywhere.
// Start it with `node scripts/pet.mjs run`, which fetches Electron the first time.
const { app, BrowserWindow, Menu, ipcMain, screen, shell } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

/** Where the office runs: AGENT_OFFICE_URL, else 127.0.0.1 on PORT (default 4321), like the office itself. */
const OFFICE_URL = process.env.AGENT_OFFICE_URL || `http://127.0.0.1:${Number(process.env.PORT) || 4321}/`;
const SIZES = { small: [160, 192], medium: [200, 240], large: [260, 312] };
const CHARACTERS = [['worker', 'Office worker'], ['dog', 'Office dog']];

let settingsFile;
let settings = { character: 'worker', size: 'medium' };
const save = () => { try { writeFileSync(settingsFile, JSON.stringify(settings)); } catch { /* not critical */ } };

let win;
/** The parts of the window the page says are the pet, window coordinates; empty means all of it. */
let hitRects = [];
let offline = false;
let pointerOver = false;
let retry = null;
/** While the left button is down on the pet: where the cursor and window started, to drag and to tell a click. */
let press = null;

const sizeOf = () => SIZES[settings.size] ?? SIZES.medium;

if (!app.requestSingleInstanceLock()) app.quit();

app.whenReady().then(() => {
  settingsFile = join(app.getPath('userData'), 'settings.json');
  try { settings = { ...settings, ...JSON.parse(readFileSync(settingsFile, 'utf8')) }; } catch { /* first run */ }
  const [width, height] = sizeOf();
  win = new BrowserWindow({
    ...startingPosition(width, height), width, height,
    frame: false, transparent: true, resizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, hasShadow: false, alwaysOnTop: true, show: false, backgroundColor: '#00000000',
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.once('ready-to-show', () => win.showInactive());
  win.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  win.webContents.on('did-navigate', (_event, url, code) => {
    if (url.startsWith('http') && code !== 200) showOffline('Rebuild the office to get the pet: npm run build');
  });
  win.webContents.on('did-fail-load', (_event, code, _description, url, mainFrame) => {
    // -3: replaced by another load.
    if (mainFrame && code !== -3 && url.startsWith('http')) showOffline("Agent Office isn't running");
  });
  load();
  // Clicks only land on the character and its bubble; anywhere else in the window they go through to what's behind.
  setInterval(track, 50);
  if (process.env.AGENT_PET_SCREENSHOT) screenshotAndQuit(process.env.AGENT_PET_SCREENSHOT);
});

/** Where it was left last time if that's still on a screen, else the bottom-right corner of the main screen. */
function startingPosition(width, height) {
  const saved = settings.position;
  if (saved && screen.getAllDisplays().some(({ workArea: a }) => saved.x < a.x + a.width && saved.x + width > a.x && saved.y < a.y + a.height && saved.y + height > a.y)) {
    return { x: saved.x, y: saved.y };
  }
  const area = screen.getPrimaryDisplay().workArea;
  return { x: area.x + area.width - width - 24, y: area.y + area.height - height - 24 };
}

function load() {
  clearTimeout(retry);
  offline = false;
  hitRects = [];
  const url = new URL('pet.html', OFFICE_URL);
  url.searchParams.set('character', settings.character);
  win.loadURL(url.href).catch(() => { /* reported through did-fail-load */ });
}

function showOffline(message) {
  offline = true;
  const [width, height] = sizeOf();
  hitRects = [{ x: 0, y: height - 64, width, height: 64 }]; // the note at the bottom
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(offlinePage(message))}`).catch(() => {});
  clearTimeout(retry);
  retry = setTimeout(load, 5000);
}

function track() {
  const cursor = screen.getCursorScreenPoint(), bounds = win.getBounds();
  if (press) {
    const dx = cursor.x - press.cursor.x, dy = cursor.y - press.cursor.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) press.moved = true;
    if (press.moved) win.setPosition(press.window.x + dx, press.window.y + dy);
  }
  const x = cursor.x - bounds.x, y = cursor.y - bounds.y;
  const inside = x >= 0 && y >= 0 && x < bounds.width && y < bounds.height;
  const over = !!press || (inside && (hitRects.length === 0 || hitRects.some((r) => x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height)));
  if (over !== pointerOver) {
    pointerOver = over;
    // `forward` keeps mouse moves coming to the page while clicks go through, so hovering still works.
    win.setIgnoreMouseEvents(!over, { forward: true });
    run(`window.pet && window.pet.hover && window.pet.hover(${over})`);
  }
}

const run = (script) => win.webContents.executeJavaScript(script).catch(() => {});

ipcMain.on('pet', (event, message) => {
  if (event.sender !== win.webContents || !message || typeof message.type !== 'string') return;
  if (message.type === 'open') openExternal(message.url);
  else if (message.type === 'hit' && Array.isArray(message.rects)) {
    hitRects = message.rects.filter((r) => [r.x, r.y, r.width, r.height].every(Number.isFinite));
  } else if (message.type === 'down') {
    press = { cursor: screen.getCursorScreenPoint(), window: win.getBounds(), moved: false };
  } else if (message.type === 'up' && press) {
    const { moved } = press;
    press = null;
    if (moved) { settings.position = { x: win.getBounds().x, y: win.getBounds().y }; save(); }
    else if (offline) load();
    else run('window.pet && window.pet.click()');
  } else if (message.type === 'menu') {
    menu().popup({ window: win });
  }
});

function openExternal(url) {
  try { if (['http:', 'https:'].includes(new URL(url).protocol)) shell.openExternal(url); } catch { /* not a URL */ }
}

function menu() {
  return Menu.buildFromTemplate([
    ...CHARACTERS.map(([key, label]) => ({
      label, type: 'radio', checked: settings.character === key,
      click: () => { if (settings.character !== key) { settings.character = key; save(); load(); } },
    })),
    { type: 'separator' },
    {
      label: 'Size',
      submenu: Object.keys(SIZES).map((key) => ({
        label: key[0].toUpperCase() + key.slice(1), type: 'radio', checked: settings.size === key,
        click: () => resize(key),
      })),
    },
    { label: 'Open Agent Office', click: () => openExternal(OFFICE_URL) },
    { label: 'Reload', click: load },
    { type: 'separator' },
    { label: 'Quit Agent Pet', click: () => app.quit() },
  ]);
}

/** Grows and shrinks about its bottom middle, so it stays where you put it. */
function resize(key) {
  settings.size = key;
  const old = win.getBounds(), [width, height] = sizeOf();
  win.setBounds({ x: Math.round(old.x + old.width / 2 - width / 2), y: old.y + old.height - height, width, height });
  settings.position = { x: win.getBounds().x, y: win.getBounds().y };
  save();
  if (offline) showOffline("Agent Office isn't running");
}

/** For checks: saves what the window shows once the page has had time to draw, then quits. */
function screenshotAndQuit(file) {
  setTimeout(async () => {
    try {
      const image = await win.webContents.capturePage();
      writeFileSync(file, image.toPNG());
      // What a check can read without seeing the picture: how much was drawn, and any text on the page.
      const bitmap = image.toBitmap();
      let drawn = 0;
      for (let i = 3; i < bitmap.length; i += 4) if (bitmap[i] > 0) drawn++;
      const text = await win.webContents.executeJavaScript('document.body.innerText').catch(() => '');
      const webgl = await win.webContents.executeJavaScript("!!document.createElement('canvas').getContext('webgl2')").catch(() => null);
      console.log(`Pet screenshot: ${drawn} of ${bitmap.length / 4} pixels drawn; WebGL2: ${webgl}; text: ${JSON.stringify(text)}`);
    } finally { app.quit(); }
  }, Number(process.env.AGENT_PET_SCREENSHOT_DELAY) || 8000);
}

/** Shown while the office can't be reached: a small grey note at the bottom of the window. */
function offlinePage(message) {
  const text = message.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<!doctype html><meta charset="utf-8">
<style>
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; user-select: none; }
  body { display: flex; align-items: flex-end; justify-content: center; font: 800 12px "Segoe UI", system-ui, sans-serif; }
  p { margin: 0 8px 12px; padding: 6px 11px; border-radius: 14px; border: 2.5px solid #2A2238; background: #D9D3E6; color: #5B5275; text-align: center; }
</style>
<p>💤 ${text}</p>`;
}
